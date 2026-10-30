/* global chrome, PixivDownloaderUtils, PixivPrepare, PixivI18n */
"use strict";

// 失败原因等提示按界面语言生成；语言设置在弹窗或规则页修改后会通过 storage 事件同步过来。
const { t } = PixivI18n;
PixivI18n.init();

const {
  uniqueArtworks,
  normalizedArtworkFilename,
  sanitizeSegment,
  buildDownloadPath,
  artworkTags,
  normalizeRules,
  resolveTagFolder,
  normalizeSizeFilters,
  passesSizeFilter,
  normalizeDownloadRoot
} = PixivDownloaderUtils;
const { taskError, httpError } = PixivPrepare;
const API_ROOT = "https://www.pixiv.net/ajax/illust";
const RULES_KEY = "tagRules";
const INFO_TTL = 10 * 60 * 1000;
const PREVIEW_CONCURRENCY = 4;
const RETRY_ATTEMPTS = 3;
// 动图保存格式：gif（默认，256 色）、apng（无损全彩色）、zip（原始帧 + animation.json）。
const UGOIRA_FILENAMES = {
  gif: (id) => normalizedArtworkFilename(id, 0, "", "gif"),
  apng: (id) => normalizedArtworkFilename(id, 0, "", "png"),
  zip: (id) => `${id}_ugoira.zip`
};

// 可多选：按 gif → apng → zip 的固定顺序去重；一个都没选（或格式无效）时退回 GIF。
function normalizeUgoiraFormats(formats) {
  const list = Array.isArray(formats) ? formats : [formats];
  const chosen = Object.keys(UGOIRA_FILENAMES).filter((format) => list.includes(format));
  return chosen.length ? chosen : ["gif"];
}

const RETRY_ROUND_DELAY = 10 * 1000;

// 预览和下载都要用作品信息，缓存起来避免重复请求 Pixiv。
const infoCache = new Map();

let state = freshState();
// 最近一次任务中最终失败的项，供“重试失败项”使用。
let lastFailedTasks = [];

function freshState() {
  return {
    running: false,
    phase: "idle",
    artworkCount: 0,
    finishedArtworks: 0,
    queuedFiles: 0,
    current: "",
    failures: [],
    warnings: [],
    skipped: [],
    // 用户在弹窗里关掉了这条结果，重新打开弹窗时不再显示。
    dismissed: false,
    retryTotal: 0,
    retryDone: 0,
    startedAt: null,
    finishedAt: null
  };
}

function isRetriable(error) {
  if (error && error.retriable === false) return false;
  if (error && typeof error.status === "number") return error.status === 408 || error.status === 429 || error.status >= 500;
  return true;
}

// 限流时多等一会儿，其他错误 1.5 秒、4.5 秒后重试。
function retryDelay(attempt, error) {
  if (error && error.status === 429) return 15000 * (attempt + 1);
  return 1500 * 3 ** attempt;
}

async function withRetry(operation) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt + 1 >= RETRY_ATTEMPTS || !isRetriable(error)) throw error;
      await delay(retryDelay(attempt, error));
    }
  }
}

function tabsQuery(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tabs || []);
    });
  });
}

function queueDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) reject(taskError(error.message, false));
      else resolve(downloadId);
    });
  });
}

// FILE_* 是磁盘或文件名问题，USER_* 是用户取消，都不重试；NETWORK_* / SERVER_* 可以重试。
function interruptedError(reason) {
  const code = String(reason || "");
  return taskError(code ? t("downloadInterruptedCode", { code }) : t("downloadInterrupted"), !/^(FILE_|USER_)/.test(code));
}

function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(listener);
      if (error) reject(error);
      else resolve();
    };
    const listener = (delta) => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === "complete") {
        finish();
      } else if (delta.state.current === "interrupted") {
        finish(interruptedError(delta.error && delta.error.current));
      }
    };
    chrome.downloads.onChanged.addListener(listener);
    chrome.downloads.search({ id: downloadId }, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        finish(new Error(error.message));
        return;
      }
      const item = items && items[0];
      if (item && item.state === "complete") finish();
      else if (item && item.state === "interrupted") finish(interruptedError(item.error));
    });
  });
}

function recordWarning(file, message) {
  if (state.warnings.some((item) => item.filename === file.filename)) return;
  state.warnings.push({ id: file.artworkId, filename: file.filename, message });
}

// ---- 浏览器差异 ----
// prepare(file) 把文件准备好并返回可下载的地址 { url, warnings }；release 释放地址；releaseArchive 释放动图压缩包缓存。
// Firefox 的后台是常驻页面，可以直接处理并创建 blob 地址；Chrome/Edge 的 service worker 不能创建 blob 地址，
// 由 platform-chrome.js 提供基于离屏页的实现（先于本文件加载，挂在 globalThis.PixivPlatform 上）。
const localPlatform = {
  async prepare(file) {
    const { blob, warnings } = await PixivPrepare.prepareFile(file);
    return { url: URL.createObjectURL(blob), warnings };
  },
  async release(prepared) {
    if (prepared) URL.revokeObjectURL(prepared.url);
  },
  releaseArchive(url) {
    PixivPrepare.releaseUgoiraArchive(url);
  }
};
const platform = globalThis.PixivPlatform || localPlatform;

// 准备文件（动图在这一步转换）→ 交给浏览器下载 → 等保存完成 → 释放地址。
async function downloadFile(file) {
  const previousPhase = state.phase;
  if (file.kind === "ugoira") state.phase = "converting";
  let prepared = null;
  try {
    prepared = await platform.prepare(file);
    state.phase = previousPhase;
    for (const message of prepared.warnings || []) recordWarning(file, message);
    const downloadId = await queueDownload({
      url: prepared.url,
      filename: file.filename,
      conflictAction: "overwrite",
      saveAs: false
    });
    await waitForDownload(downloadId);
  } finally {
    state.phase = previousPhase;
    if (prepared) await Promise.resolve(platform.release(prepared)).catch(() => {});
  }
}

function artworkMetadata(artworkId, info) {
  // 每个标签的原名和译名作为一组，精简时整组删除。
  const keywords = artworkTags(info).map((tag) => [tag.name, tag.translation].filter(Boolean));
  return {
    keywords,
    creator: info.userName || "",
    source: `https://www.pixiv.net/artworks/${artworkId}`
  };
}

async function getOpenArtworks() {
  const tabs = await tabsQuery({});
  return uniqueArtworks(tabs);
}

async function getPixivJson(path) {
  const response = await fetch(`${API_ROOT}/${path}`, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw httpError("Pixiv API", response.status);
  const payload = await response.json();
  if (payload.error) throw taskError(payload.message || t("apiRejected"), false);
  return payload.body;
}

function getArtworkInfo(id) {
  const cached = infoCache.get(id);
  if (cached && Date.now() - cached.at < INFO_TTL) return cached.promise;
  const promise = getPixivJson(`${id}?lang=zh`);
  infoCache.set(id, { at: Date.now(), promise });
  promise.catch(() => infoCache.delete(id));
  return promise;
}

function loadRules() {
  return new Promise((resolve) => {
    chrome.storage.local.get(RULES_KEY, (items) => {
      if (chrome.runtime.lastError) resolve([]);
      else resolve(normalizeRules(items && items[RULES_KEY]));
    });
  });
}

async function previewArtwork(artwork) {
  try {
    const info = await getArtworkInfo(artwork.id);
    return {
      id: artwork.id,
      title: info.illustTitle || artwork.title || artwork.id,
      tags: artworkTags(info),
      isUgoira: Number(info.illustType) === 2,
      // info 里的宽高是第一页的；多页作品要到下载时按页判断。
      width: Number(info.width) || 0,
      height: Number(info.height) || 0,
      pageCount: Number(info.pageCount) || 1
    };
  } catch (error) {
    return { id: artwork.id, title: artwork.title || artwork.id, tags: [], error: error.message || String(error) };
  }
}

async function previewArtworks() {
  const artworks = await getOpenArtworks();
  const results = new Array(artworks.length);
  let next = 0;
  async function worker() {
    while (next < artworks.length) {
      const index = next;
      next += 1;
      results[index] = await previewArtwork(artworks[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PREVIEW_CONCURRENCY, artworks.length) }, worker));
  return results;
}

async function resolveArtwork(artwork, context) {
  const { folderMode, rules, override, embedMetadata } = context;
  const info = await getArtworkInfo(artwork.id);
  const metadata = embedMetadata ? artworkMetadata(artwork.id, info) : null;
  const title = sanitizeSegment(info.illustTitle || artwork.title || artwork.id, artwork.id);
  const tagFolder = resolveTagFolder(rules, artworkTags(info), override);

  if (Number(info.illustType) === 2) {
    const ugoira = await getPixivJson(`${artwork.id}/ugoira_meta?lang=zh`);
    const archiveUrl = ugoira && (ugoira.originalSrc || ugoira.src);
    if (!archiveUrl) throw taskError(t("noUgoiraArchive"), false);
    const formats = normalizeUgoiraFormats(context.ugoiraFormats || context.ugoiraFormat);
    return formats.map((format) => ({
      kind: "ugoira",
      format,
      artworkId: artwork.id,
      archiveUrl,
      metadata,
      // 写进原始帧压缩包的 animation.json，方便以后播放或转换。
      info: {
        illustId: artwork.id,
        title: info.illustTitle || "",
        userName: info.userName || "",
        userId: info.userId || "",
        source: `https://www.pixiv.net/artworks/${artwork.id}`,
        tags: artworkTags(info),
        mimeType: ugoira.mime_type || "",
        width: Number(info.width) || 0,
        height: Number(info.height) || 0
      },
      width: Number(info.width) || 0,
      height: Number(info.height) || 0,
      frames: ugoira.frames,
      filename: buildDownloadPath({
        root: context.downloadRoot,
        artworkId: artwork.id,
        title,
        filename: UGOIRA_FILENAMES[format](artwork.id),
        folderMode,
        tagFolder
      })
    }));
  }

  const pages = await getPixivJson(`${artwork.id}/pages?lang=zh`);
  if (!Array.isArray(pages) || pages.length === 0) throw taskError(t("noImages"), false);
  return pages.map((page, index) => {
    const url = page && page.urls && (page.urls.original || page.urls.regular);
    if (!url) throw taskError(t("pageMissingUrl", { page: index + 1 }), false);
    return {
      kind: "image",
      artworkId: artwork.id,
      url,
      metadata,
      width: Number(page.width) || 0,
      height: Number(page.height) || 0,
      filename: buildDownloadPath({
        root: context.downloadRoot,
        artworkId: artwork.id,
        title,
        filename: normalizedArtworkFilename(artwork.id, index, url, ""),
        folderMode,
        tagFolder
      })
    };
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error) {
  return error && error.message || String(error);
}

// 任务分两种：artwork（作品信息没取到，重试时重新解析）和 file（单个文件下载失败）。
// 返回最终仍失败的任务，每个任务带上最后一次的错误信息和是否值得再试。
async function processTask(task) {
  if (task.type === "file") {
    try {
      await withRetry(() => downloadFile(task.file));
      state.queuedFiles += 1;
      return [];
    } catch (error) {
      return [{ ...task, message: errorMessage(error), retriable: isRetriable(error) }];
    } finally {
      // 单独重试的动图文件用完就释放；作品内的多格式由下面统一释放。
      if (!task.shareArchive && task.file.archiveUrl) platform.releaseArchive(task.file.archiveUrl);
    }
  }

  const { artwork, context } = task;
  let files;
  try {
    files = await withRetry(() => resolveArtwork(artwork, context));
  } catch (error) {
    return [{ ...task, message: errorMessage(error), retriable: isRetriable(error) }];
  }
  const failed = [];
  for (const file of files) {
    // 尺寸不达标的页直接跳过，不请求图片，也不算失败。
    // 静态图片和动图分别用各自的筛选设置。
    const filters = context.sizeFilters || normalizeSizeFilters(context.sizeFilter);
    if (!passesSizeFilter(file.kind === "ugoira" ? filters.ugoira : filters.image, file.width, file.height)) {
      state.skipped.push({ id: artwork.id, filename: file.filename.split("/").pop(), width: file.width, height: file.height });
      continue;
    }
    failed.push(...await processTask({ type: "file", id: artwork.id, file, shareArchive: true }));
    await delay(120);
  }
  for (const file of files) if (file.archiveUrl) platform.releaseArchive(file.archiveUrl);
  // 失败项之后单独重试时不再共享压缩包。
  return failed.map((task) => ({ ...task, shareArchive: false }));
}

function describeFailure(task) {
  const filename = task.file ? task.file.filename.split("/").pop() : "";
  return { id: task.id, filename, message: task.message };
}

async function processAll(tasks, retryRound) {
  let failed = [];
  for (const task of tasks) {
    state.current = task.id;
    failed.push(...await processTask(task));
    state.finishedArtworks += 1;
    updateBadge();
  }
  // 全部跑完后，把仍可重试的失败项再统一补一轮（先等限流缓解）。
  const retriable = failed.filter((task) => task.retriable !== false);
  if (retryRound && retriable.length) {
    state.phase = "retrying";
    state.retryTotal = retriable.length;
    updateBadge();
    await delay(RETRY_ROUND_DELAY);
    const stillFailed = failed.filter((task) => task.retriable === false);
    for (const task of retriable) {
      state.current = task.id;
      stillFailed.push(...await processTask(task));
      state.retryDone += 1;
    }
    failed = stillFailed;
  }
  lastFailedTasks = failed;
  state.failures = failed.map(describeFailure);
}

// ---- 独立进度窗口：工具栏弹窗失焦就会关闭，下载时另开一个不会自动关闭的小窗口 ----
// Firefox Android 没有 windows API，此时只显示角标。
const PROGRESS_WINDOW_URL = "popup.html?view=window";
let progressWindowId = null;

function createProgressWindow() {
  chrome.windows.create({
    url: chrome.runtime.getURL(PROGRESS_WINDOW_URL),
    type: "popup",
    width: 500,
    height: 760
  }, (createdWindow) => {
    if (chrome.runtime.lastError || !createdWindow) return;
    progressWindowId = createdWindow.id;
  });
}

// 已经开着就切到前台，否则新建；窗口被关掉后下次会重新打开。
function openProgressWindow() {
  if (!chrome.windows || typeof chrome.windows.create !== "function") return;
  if (progressWindowId === null) {
    createProgressWindow();
    return;
  }
  chrome.windows.update(progressWindowId, { focused: true }, () => {
    if (!chrome.runtime.lastError) return;
    progressWindowId = null;
    createProgressWindow();
  });
}

if (chrome.windows && chrome.windows.onRemoved) {
  chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === progressWindowId) progressWindowId = null;
  });
}

// ---- 工具栏角标：进行中显示百分比，结束后有失败显示红色数量，全部成功则清除 ----
const actionApi = chrome.browserAction || chrome.action;

function setBadge(text, color) {
  if (!actionApi || typeof actionApi.setBadgeText !== "function") return;
  actionApi.setBadgeText({ text });
  if (color && typeof actionApi.setBadgeBackgroundColor === "function") {
    actionApi.setBadgeBackgroundColor({ color });
  }
}

function updateBadge() {
  if (state.running) {
    if (state.phase === "retrying") {
      setBadge(t("badgeRetry"), "#76695f");
      return;
    }
    const total = state.artworkCount;
    setBadge(`${total ? Math.floor(state.finishedArtworks / total * 100) : 0}%`, "#c2410c");
  } else if (state.failures.length && !state.dismissed) {
    setBadge(String(state.failures.length), "#d03b3b");
  } else {
    setBadge("", null);
  }
}

// 结果和失败项交给平台保存（Chrome 的 service worker 闲置后会被关掉，重启后要能恢复）。
function persistState() {
  if (typeof platform.saveState === "function") platform.saveState({ state, lastFailedTasks });
}

function startState(phase) {
  state = freshState();
  state.running = true;
  state.phase = phase;
  state.startedAt = Date.now();
  updateBadge();
  if (typeof platform.keepAlive === "function") platform.keepAlive(true);
}

function finishState() {
  state.running = false;
  state.phase = "done";
  state.current = "";
  state.finishedAt = Date.now();
  updateBadge();
  persistState();
  if (typeof platform.keepAlive === "function") platform.keepAlive(false);
}

// service worker 重启后恢复上次的结果（Firefox 的后台页常驻，不需要）。
if (typeof platform.loadState === "function") {
  Promise.resolve(platform.loadState()).then((saved) => {
    if (!saved || !saved.state || state.running || state.finishedAt) return;
    state = { ...freshState(), ...saved.state, running: false };
    lastFailedTasks = Array.isArray(saved.lastFailedTasks) ? saved.lastFailedTasks : [];
    updateBadge();
  }).catch(() => {});
}

async function runDownload(requestedFolderMode, overrides, embedMetadata, sizeFilter, ugoiraFormats, downloadRoot) {
  if (state.running) return state;
  const folderMode = requestedFolderMode === "flat" ? "flat" : "artwork";
  const folderOverrides = overrides && typeof overrides === "object" ? overrides : {};
  const sizeFilters = normalizeSizeFilters(sizeFilter);
  startState("scanning");

  try {
    const rules = await loadRules();
    const artworks = await getOpenArtworks();
    state.artworkCount = artworks.length;
    state.phase = "downloading";
    const tasks = artworks.map((artwork) => ({
      type: "artwork",
      id: artwork.id,
      artwork,
      context: { folderMode, rules, override: folderOverrides[artwork.id], embedMetadata: embedMetadata !== false, sizeFilters, ugoiraFormats: normalizeUgoiraFormats(ugoiraFormats), downloadRoot: normalizeDownloadRoot(downloadRoot) }
    }));
    await processAll(tasks, true);
  } catch (error) {
    state.failures.push({ id: t("extensionLabel"), filename: "", message: errorMessage(error) });
  } finally {
    finishState();
  }
  return state;
}

// 只重新执行上一次最终失败的项，沿用当时的文件夹、规则和元数据设置。
async function runRetry() {
  if (state.running) return state;
  const tasks = lastFailedTasks;
  startState("downloading");
  state.artworkCount = tasks.length;
  try {
    await processAll(tasks, false);
  } catch (error) {
    state.failures.push({ id: t("extensionLabel"), filename: "", message: errorMessage(error) });
  } finally {
    finishState();
  }
  return state;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === "scan") {
    getOpenArtworks()
      .then((artworks) => sendResponse({ ok: true, artworks }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message.type === "preview") {
    previewArtworks()
      .then((artworks) => sendResponse({ ok: true, artworks }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message.type === "openWindow") {
    openProgressWindow();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "dismiss") {
    if (!state.running) {
      state.dismissed = true;
      updateBadge();
      persistState();
    }
    sendResponse({ ok: true, state });
    return false;
  }

  if (message.type === "state") {
    sendResponse({ ok: true, state });
    return false;
  }

  if (message.type === "retry") {
    const job = runRetry();
    if (message.openWindow) openProgressWindow();
    job
      .then((result) => sendResponse({ ok: true, state: result }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (message.type === "download") {
    // runDownload 同步地把状态置为进行中，所以新窗口打开时能直接接上进度。
    const job = runDownload(message.folderMode, message.overrides, message.embedMetadata, message.sizeFilter, message.ugoiraFormats || message.ugoiraFormat, message.downloadRoot);
    if (message.openWindow) openProgressWindow();
    job
      .then((result) => sendResponse({ ok: true, state: result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  return false;
});
