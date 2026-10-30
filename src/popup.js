/* global chrome, PixivDownloaderUtils, PixivI18n */
"use strict";

const {
  normalizeRules,
  matchRule,
  normalizeTagKey,
  addTagToRules,
  sanitizeFolderPath,
  normalizeSizeFilter,
  normalizeSizeFilters,
  passesSizeFilter,
  normalizeDownloadRoot
} = PixivDownloaderUtils;
const { t } = PixivI18n;

const count = document.querySelector("#count");
const detail = document.querySelector("#detail");
const downloadButton = document.querySelector("#download");
const rescanButton = document.querySelector("#rescan");
const progress = document.querySelector("#progress");
const progressText = document.querySelector("#progressText");
const barFill = document.querySelector("#barFill");
const errors = document.querySelector("#errors");
const errorList = document.querySelector("#errorList");
const retryButton = document.querySelector("#retryFailed");
const warnings = document.querySelector("#warnings");
const warningList = document.querySelector("#warningList");
const skippedDetails = document.querySelector("#skipped");
const taskTitle = document.querySelector("#taskTitle");
const openWindowButton = document.querySelector("#openWindow");
const dismissButton = document.querySelector("#dismissTask");
const skippedList = document.querySelector("#skippedList");
const sizeOptions = document.querySelector("#sizeOptions");
// 尺寸筛选分“静态图片 / 动图”两套，界面结构相同，按 data-kind 区分。
const SIZE_KINDS = ["image", "ugoira"];
const sizeTabs = [...document.querySelectorAll(".size-tab")];
const sizeBlocks = Object.fromEntries(SIZE_KINDS.map((kind) => {
  const root = document.querySelector(`.size-block[data-kind="${kind}"]`);
  return [kind, {
    root,
    enabled: root.querySelector(".size-enabled"),
    width: root.querySelector(".size-width"),
    height: root.querySelector(".size-height"),
    modes: [...root.querySelectorAll(`input[name="sizeMode-${kind}"]`)],
    dimensionsHint: root.querySelector(".dimensions-hint"),
    pixelsHint: root.querySelector(".pixels-hint"),
    tabSummary: document.querySelector(`.size-tab small[data-summary="${kind}"]`)
  }];
}));
const folderOptions = document.querySelector("#folderOptions");
const folderModeInputs = [...document.querySelectorAll('input[name="folderMode"]')];
const artworksSection = document.querySelector("#artworks");
const artworkList = document.querySelector("#artworkList");
const folderChoices = document.querySelector("#folderChoices");
const openRulesButton = document.querySelector("#openRules");
const metadataOptions = document.querySelector("#metadataOptions");
const embedMetadataInput = document.querySelector("#embedMetadata");
const FOLDER_MODE_KEY = "pixiv-folder-mode";
const EMBED_METADATA_KEY = "pixiv-embed-metadata";
const SIZE_FILTER_KEY = "pixiv-size-filter";
const OPEN_PANELS_KEY = "pixiv-open-panels";
const UGOIRA_FORMATS_KEY = "pixiv-ugoira-formats";
const LEGACY_UGOIRA_FORMAT_KEY = "pixiv-ugoira-format";
const ugoiraAllButton = document.querySelector("#ugoiraAll");
const ugoiraHint = document.querySelector("#ugoiraHint");
const UGOIRA_FORMAT_LABELS = { gif: () => "GIF", apng: () => "APNG", zip: () => t("formatZip") };
const ugoiraOptions = document.querySelector("#ugoiraOptions");
const ugoiraSummary = document.querySelector("#ugoiraSummary");
const ugoiraFormatInputs = [...document.querySelectorAll('input[name="ugoiraFormat"]')];
const panels = [...document.querySelectorAll("details.panel")];
const metadataSummary = document.querySelector("#metadataSummary");
const sizeSummary = document.querySelector("#sizeSummary");
const RULES_KEY = "tagRules";
const DOWNLOAD_ROOT_KEY = "pixiv-download-root";
const downloadRootInput = document.querySelector("#downloadRoot");
const showDownloadsButton = document.querySelector("#showDownloads");

// 下载目录里的保存文件夹（默认 Pixiv，留空 = 直接存在下载目录）。存在 localStorage，规则页也读得到。
function currentRoot() {
  return normalizeDownloadRoot(downloadRootInput.value);
}

// 界面上显示的前缀：“Pixiv/”；留空时显示“下载目录/”。
function rootLabel() {
  const root = currentRoot();
  return root ? `${root}/` : `${t("downloadsDir")}/`;
}

function pageParams() {
  const root = currentRoot();
  return { root: rootLabel(), path: `${t("downloadsDir")}/${root ? `${root}/` : ""}` };
}

function restoreDownloadRoot() {
  const saved = localStorage.getItem(DOWNLOAD_ROOT_KEY);
  downloadRootInput.value = saved === null ? "Pixiv" : normalizeDownloadRoot(saved);
}

let rules = [];
let artworks = [];
// 作品 ID → "root" 或文件夹名；只在本次弹窗内有效，不写入规则。
const overrides = {};
let busy = false;
// 独立进度窗口里打开时带 ?view=window，不会再去开新窗口。
const isWindowView = new URLSearchParams(location.search).get("view") === "window";
let scanned = false;

function selectedFolderMode() {
  return folderModeInputs.find((input) => input.checked)?.value === "flat" ? "flat" : "artwork";
}

function restoreFolderMode() {
  const saved = localStorage.getItem(FOLDER_MODE_KEY);
  const input = folderModeInputs.find((item) => item.value === saved);
  if (input) input.checked = true;
}

// 折叠时在标题右侧显示当前设置，不用展开也能看到。
function selectedUgoiraFormats() {
  const chosen = ugoiraFormatInputs.filter((input) => input.checked).map((input) => input.value);
  return chosen.length ? chosen : ["gif"];
}

function applyUgoiraFormats(formats) {
  for (const input of ugoiraFormatInputs) input.checked = formats.includes(input.value);
  ugoiraAllButton.disabled = formats.length === ugoiraFormatInputs.length;
}

// 读取多选设置；兼容 1.10.0 的单选设置。
function restoreUgoiraFormat() {
  let formats = null;
  try {
    formats = JSON.parse(localStorage.getItem(UGOIRA_FORMATS_KEY) || "null");
  } catch (_error) {
    formats = null;
  }
  if (!Array.isArray(formats)) {
    const legacy = localStorage.getItem(LEGACY_UGOIRA_FORMAT_KEY);
    formats = legacy ? [legacy] : ["gif"];
  }
  formats = formats.filter((format) => Object.prototype.hasOwnProperty.call(UGOIRA_FORMAT_LABELS, format));
  applyUgoiraFormats(formats.length ? formats : ["gif"]);
}

function saveUgoiraFormats() {
  const formats = selectedUgoiraFormats();
  localStorage.setItem(UGOIRA_FORMATS_KEY, JSON.stringify(formats));
  applyUgoiraFormats(formats);
  updatePanelSummaries();
}

for (const input of ugoiraFormatInputs) {
  input.addEventListener("change", () => {
    // 至少保留一种格式：取消最后一个勾选时恢复并提示。
    if (!ugoiraFormatInputs.some((item) => item.checked)) {
      input.checked = true;
      ugoiraHint.textContent = t("ugoiraKeepOne");
      ugoiraHint.classList.add("warn");
      return;
    }
    ugoiraHint.textContent = t("ugoiraHint");
    ugoiraHint.classList.remove("warn");
    saveUgoiraFormats();
  });
}

ugoiraAllButton.addEventListener("click", () => {
  for (const input of ugoiraFormatInputs) input.checked = true;
  saveUgoiraFormats();
});

function updatePanelSummaries() {
  const formats = selectedUgoiraFormats();
  ugoiraSummary.textContent = formats.length === ugoiraFormatInputs.length
    ? t("formatAllThree")
    : formats.map((format) => UGOIRA_FORMAT_LABELS[format]()).join(" + ");
  metadataSummary.textContent = embedMetadataInput.checked ? t("metadataOn") : t("metadataOff");
  const filters = currentSizeFilters();
  sizeSummary.textContent = t("sizeSummary", { image: describeSizeFilter(filters.image), ugoira: describeSizeFilter(filters.ugoira) });
  sizeSummary.classList.toggle("on", filters.image.enabled || filters.ugoira.enabled);
}

// 折叠面板默认收起，展开状态按面板记住。
function restorePanels() {
  let open = {};
  try {
    open = JSON.parse(localStorage.getItem(OPEN_PANELS_KEY) || "{}") || {};
  } catch (_error) {
    open = {};
  }
  for (const panel of panels) {
    panel.open = Boolean(open[panel.id]);
    panel.addEventListener("toggle", () => {
      const state = Object.fromEntries(panels.map((item) => [item.id, item.open]));
      localStorage.setItem(OPEN_PANELS_KEY, JSON.stringify(state));
    });
  }
}

function restoreEmbedMetadata() {
  embedMetadataInput.checked = localStorage.getItem(EMBED_METADATA_KEY) !== "off";
}

embedMetadataInput.addEventListener("change", () => {
  localStorage.setItem(EMBED_METADATA_KEY, embedMetadataInput.checked ? "on" : "off");
  updatePanelSummaries();
});

function describeSizeFilter(filter) {
  if (!filter.enabled) return t("off");
  const threshold = `${filter.width}×${filter.height}`;
  return t(filter.mode === "pixels" ? "sizeDescribePixels" : "sizeDescribeDimensions", { threshold });
}

function readSizeFilter(kind) {
  const block = sizeBlocks[kind];
  return normalizeSizeFilter({
    enabled: block.enabled.checked,
    mode: block.modes.find((input) => input.checked)?.value,
    width: block.width.value,
    height: block.height.value
  });
}

function currentSizeFilters() {
  return { image: readSizeFilter("image"), ugoira: readSizeFilter("ugoira") };
}

function updateSizeControls() {
  for (const kind of SIZE_KINDS) {
    const block = sizeBlocks[kind];
    const filter = readSizeFilter(kind);
    for (const input of [block.width, block.height, ...block.modes]) input.disabled = !filter.enabled;
    const long = Math.max(filter.width, filter.height);
    const short = Math.min(filter.width, filter.height);
    block.dimensionsHint.textContent = t("dimensionsHint", { long, short });
    block.pixelsHint.textContent = t("pixelsHint", { pixels: (filter.width * filter.height).toLocaleString("en-US") });
    block.tabSummary.textContent = filter.enabled ? t("on") : t("off");
    block.tabSummary.classList.toggle("on", filter.enabled);
  }
  updatePanelSummaries();
}

function restoreSizeFilter() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SIZE_FILTER_KEY) || "null");
  } catch (_error) {
    saved = null;
  }
  const filters = normalizeSizeFilters(saved);
  for (const kind of SIZE_KINDS) {
    const block = sizeBlocks[kind];
    const filter = filters[kind];
    block.enabled.checked = filter.enabled;
    block.width.value = filter.width;
    block.height.value = filter.height;
    for (const input of block.modes) input.checked = input.value === filter.mode;
  }
  updateSizeControls();
}

function onSizeFilterChange() {
  localStorage.setItem(SIZE_FILTER_KEY, JSON.stringify(currentSizeFilters()));
  updateSizeControls();
  renderArtworks();
}

for (const kind of SIZE_KINDS) {
  const block = sizeBlocks[kind];
  for (const input of [block.enabled, block.width, block.height, ...block.modes]) {
    input.addEventListener("change", onSizeFilterChange);
  }
}

for (const tab of sizeTabs) {
  tab.addEventListener("click", () => {
    for (const item of sizeTabs) item.classList.toggle("active", item === tab);
    for (const kind of SIZE_KINDS) sizeBlocks[kind].root.classList.toggle("hidden", kind !== tab.dataset.kind);
  });
}

// 单页作品在预览阶段就能判断；多页作品要到下载时按页判断。
function willSkip(artwork) {
  const filter = currentSizeFilters()[artwork.isUgoira ? "ugoira" : "image"];
  return artwork.pageCount === 1 && !passesSizeFilter(filter, artwork.width, artwork.height);
}

for (const input of folderModeInputs) {
  input.addEventListener("change", () => {
    localStorage.setItem(FOLDER_MODE_KEY, selectedFolderMode());
    renderArtworks();
  });
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

function loadRules() {
  return new Promise((resolve) => {
    chrome.storage.local.get(RULES_KEY, (items) => {
      resolve(chrome.runtime.lastError ? [] : normalizeRules(items && items[RULES_KEY]));
    });
  });
}

function saveRules(nextRules) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [RULES_KEY]: nextRules }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function ruleFolders() {
  return [...new Set(rules.map((rule) => rule.folder))];
}

function fallbackLabel() {
  return selectedFolderMode() === "flat" ? rootLabel() : t("fallbackPerArtwork", { root: rootLabel() });
}

function destinationLabel(artwork) {
  const override = overrides[artwork.id];
  if (override === "root") return fallbackLabel();
  if (override) return `${rootLabel()}${override}/`;
  const rule = matchRule(rules, artwork.tags);
  return rule ? `${rootLabel()}${rule.folder}/` : fallbackLabel();
}

function option(value, text, selected) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = text;
  element.selected = selected;
  return element;
}

function renderDestinationSelect(artwork) {
  const select = document.createElement("select");
  select.className = "dest";
  select.title = t("saveLocation");
  const rule = matchRule(rules, artwork.tags);
  const current = overrides[artwork.id] || "auto";
  select.append(option("auto", t("destAuto", { path: rule ? `${rootLabel()}${rule.folder}/` : fallbackLabel() }), current === "auto"));
  select.append(option("root", t("destRoot", { path: fallbackLabel() }), current === "root"));
  const folders = ruleFolders();
  if (current !== "auto" && current !== "root" && !folders.includes(current)) folders.push(current);
  for (const folder of folders) {
    select.append(option(`f:${folder}`, `${rootLabel()}${folder}/`, current === folder));
  }
  select.addEventListener("change", () => {
    const value = select.value;
    if (value === "auto") delete overrides[artwork.id];
    else overrides[artwork.id] = value === "root" ? "root" : value.slice(2);
    renderArtworks();
  });
  return select;
}

function renderTagForm(item, artwork, tag) {
  const form = document.createElement("form");
  form.className = "tag-form";
  const label = document.createElement("span");
  label.textContent = t("tagFormLabel", { tag: tag.name, root: rootLabel() });
  const input = document.createElement("input");
  input.type = "text";
  input.required = true;
  input.setAttribute("list", "folderChoices");
  const existing = rules.find((rule) => rule.tags.some((name) => normalizeTagKey(name) === normalizeTagKey(tag.name)));
  input.value = existing ? existing.folder : (tag.translation || tag.name);
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = t("saveRule");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = t("cancel");
  cancel.addEventListener("click", () => form.remove());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const folder = sanitizeFolderPath(input.value);
    if (!folder) return;
    try {
      const nextRules = addTagToRules(rules, tag.name, folder);
      await saveRules(nextRules);
      rules = nextRules;
      renderArtworks();
    } catch (error) {
      label.textContent = t("saveFailed", { message: error.message || String(error) });
    }
  });
  form.append(label, input, save, cancel);
  item.querySelector(".tag-form")?.remove();
  item.append(form);
  input.focus();
  input.select();
}

function renderArtwork(artwork) {
  const item = document.createElement("li");

  const head = document.createElement("div");
  head.className = "art-head";
  const title = document.createElement("span");
  title.className = "art-title";
  title.textContent = artwork.title;
  title.title = artwork.title;
  const id = document.createElement("span");
  id.className = "art-id";
  id.textContent = artwork.id;
  head.append(title, id);
  if (artwork.width || artwork.pageCount > 1) {
    const size = document.createElement("span");
    size.className = "art-size";
    size.textContent = artwork.pageCount > 1 ? t("pages", { count: artwork.pageCount }) : `${artwork.width}×${artwork.height}`;
    if (willSkip(artwork)) {
      size.classList.add("skip");
      size.textContent += t("willSkipSuffix");
    }
    head.append(size);
  }
  item.append(head, renderDestinationSelect(artwork));

  if (artwork.error) {
    const message = document.createElement("p");
    message.className = "art-error";
    message.textContent = t("readTagsFailed", { message: artwork.error });
    item.append(message);
    return item;
  }

  const tags = document.createElement("div");
  tags.className = "tags";
  const ruled = new Set(rules.flatMap((rule) => rule.tags.map(normalizeTagKey)));
  for (const tag of artwork.tags) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    const hit = ruled.has(normalizeTagKey(tag.name)) || (tag.translation && ruled.has(normalizeTagKey(tag.translation)));
    if (hit) chip.classList.add("ruled");
    chip.textContent = tag.name;
    if (tag.translation) {
      const translation = document.createElement("small");
      translation.textContent = tag.translation;
      chip.append(translation);
    }
    chip.title = hit ? t("chipRuled") : t("chipAdd");
    chip.addEventListener("click", () => renderTagForm(item, artwork, tag));
    tags.append(chip);
  }
  if (!artwork.tags.length) {
    const none = document.createElement("small");
    none.className = "muted";
    none.textContent = t("noTags");
    tags.append(none);
  }
  item.append(tags);
  return item;
}

function renderSummary() {
  if (!scanned) return;
  count.textContent = t("foundArtworks", { count: artworks.length });
  if (!artworks.length) {
    detail.textContent = t("openArtworkFirst");
    return;
  }
  const tally = new Map();
  for (const artwork of artworks) {
    const label = willSkip(artwork) ? t("willSkipSummary") : destinationLabel(artwork);
    tally.set(label, (tally.get(label) || 0) + 1);
  }
  detail.textContent = [...tally].map(([label, number]) => `${label} × ${number}`).join("　");
}

function renderArtworks() {
  renderSummary();
  folderChoices.replaceChildren(...ruleFolders().map((folder) => option(folder, folder, false)));
  artworkList.replaceChildren(...artworks.map(renderArtwork));
  artworksSection.classList.toggle("hidden", busy || artworks.length === 0);
  for (const select of artworkList.querySelectorAll("select")) select.disabled = busy;
}

async function scan() {
  count.textContent = t("scanning");
  detail.textContent = t("scanningTabs");
  downloadButton.disabled = true;
  scanned = false;
  try {
    const response = await sendMessage({ type: "preview" });
    if (!response || !response.ok) throw new Error(response && response.error || t("scanFailed"));
    artworks = response.artworks || [];
    scanned = true;
    renderArtworks();
    downloadButton.disabled = busy || artworks.length === 0;
  } catch (error) {
    count.textContent = t("scanFailed");
    detail.textContent = error.message || String(error);
  }
}

function progressLabel(state, finished, total) {
  if (state.phase === "retrying") return t("progressRetrying", { current: state.current || "", done: state.retryDone || 0, total: state.retryTotal || 0 });
  if (state.phase === "converting") return t("progressConverting", { current: state.current || "", finished, total });
  return t("progressProcessing", { current: state.current || t("artworkPlaceholder"), finished, total });
}

function resultLabel(state) {
  const parts = [t("resultSaved", { count: state.queuedFiles })];
  if (state.failures.length) parts.push(t("resultFailed", { count: state.failures.length }));
  if (state.warnings && state.warnings.length) parts.push(t("resultWarnings", { count: state.warnings.length }));
  if (state.skipped && state.skipped.length) parts.push(t("resultSkipped", { count: state.skipped.length }));
  return parts.join(t("listSeparator"));
}

function fillList(list, items, format) {
  list.replaceChildren(...items.map((entry) => {
    const item = document.createElement("li");
    item.textContent = format(entry);
    return item;
  }));
}

// 记住最后一次显示的任务状态，切换语言时用它重新渲染卡片。
let lastRenderedState = null;

function renderResult(state) {
  lastRenderedState = state;
  const total = state.artworkCount || 0;
  const finished = state.finishedArtworks || 0;
  const percent = total ? Math.round(finished / total * 100) : 100;
  barFill.style.width = `${percent}%`;
  progressText.textContent = state.running ? progressLabel(state, finished, total) : resultLabel(state);
  taskTitle.textContent = state.running ? t("taskRunning") : t("taskLastResult");
  dismissButton.classList.toggle("hidden", Boolean(state.running));

  const failures = state.failures || [];
  fillList(errorList, failures, (failure) =>
    `${failure.id}${failure.filename ? ` · ${failure.filename}` : ""}${t("colon")}${failure.message}`);
  errors.classList.toggle("hidden", failures.length === 0);
  retryButton.classList.toggle("hidden", state.running || failures.length === 0);
  retryButton.textContent = t("retryFailedCount", { count: failures.length });

  const warningItems = state.warnings || [];
  fillList(warningList, warningItems, (warning) => `${warning.filename.split("/").pop()}${t("colon")}${warning.message}`);
  warnings.classList.toggle("hidden", warningItems.length === 0);

  const skippedItems = state.skipped || [];
  fillList(skippedList, skippedItems, (item) => `${item.id} · ${item.filename}${t("colon")}${item.width}×${item.height}`);
  skippedDetails.classList.toggle("hidden", skippedItems.length === 0);
}

function setBusy(value) {
  busy = value;
  downloadButton.disabled = value || artworks.length === 0;
  rescanButton.disabled = value;
  folderOptions.disabled = value;
  document.querySelector("#rootOptions").disabled = value;
  metadataOptions.disabled = value;
  sizeOptions.disabled = value;
  ugoiraOptions.disabled = value;
  retryButton.disabled = value;
  for (const select of artworkList.querySelectorAll("select")) select.disabled = value;
  // 进行中收起作品列表，让状态卡片和设置不挤在一起；结束后由 renderArtworks 恢复。
  artworksSection.classList.toggle("hidden", value || artworks.length === 0);
  if (value) {
    progress.classList.remove("hidden");
    errors.classList.add("hidden");
    warnings.classList.add("hidden");
    skippedDetails.classList.add("hidden");
    retryButton.classList.add("hidden");
  }
}

function pollState(onDone) {
  const timer = setInterval(async () => {
    try {
      const response = await sendMessage({ type: "state" });
      if (!response || !response.ok) return;
      renderResult(response.state);
      if (onDone && !response.state.running) {
        clearInterval(timer);
        onDone();
      }
    } catch (_error) {
      // 最终请求会显示明确错误；轮询失败无需打断下载。
    }
  }, 250);
  return timer;
}

async function runJob(message, startText) {
  setBusy(true);
  progressText.textContent = startText;
  barFill.style.width = "4%";

  const timer = pollState();
  try {
    const response = await sendMessage(message);
    if (!response || !response.ok) throw new Error(response && response.error || t("downloadJobFailed"));
    renderResult(response.state);
  } catch (error) {
    progressText.textContent = t("failedPrefix", { message: error.message || String(error) });
  } finally {
    clearInterval(timer);
    setBusy(false);
    await scan();
  }
}

function downloadAll() {
  return runJob({
    type: "download",
    folderMode: selectedFolderMode(),
    overrides: { ...overrides },
    embedMetadata: embedMetadataInput.checked,
    sizeFilter: currentSizeFilters(),
    ugoiraFormats: selectedUgoiraFormats(),
    downloadRoot: currentRoot()
  }, t("readingArtworks"));
}

function retryFailed() {
  return runJob({ type: "retry" }, t("retryingFailed"));
}

// 重新打开弹窗时：任务进行中就接上进度；已结束且有失败或警告就显示上次结果。
async function resumeIfRunning() {
  try {
    const response = await sendMessage({ type: "state" });
    if (!response || !response.ok) return;
    const last = response.state;
    if (!last.running) {
      if (last.finishedAt && !last.dismissed) {
        progress.classList.remove("hidden");
        renderResult(last);
      }
      return;
    }
    setBusy(true);
    renderResult(response.state);
    pollState(() => {
      setBusy(false);
      scan();
    });
  } catch (_error) {
    // 读不到状态时按空闲处理。
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[RULES_KEY]) return;
  rules = normalizeRules(changes[RULES_KEY].newValue);
  renderArtworks();
});

downloadButton.addEventListener("click", downloadAll);
retryButton.addEventListener("click", retryFailed);

openWindowButton.addEventListener("click", async () => {
  try {
    await sendMessage({ type: "openWindow" });
  } catch (_error) {
    // 打开窗口时弹窗会失焦关闭，响应可能收不到。
  }
});

dismissButton.addEventListener("click", async () => {
  progress.classList.add("hidden");
  try {
    await sendMessage({ type: "dismiss" });
  } catch (_error) {
    // 关闭结果失败不影响使用，下次打开弹窗还会显示。
  }
});
rescanButton.addEventListener("click", scan);
openRulesButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

if (!chrome.windows) openWindowButton.classList.add("hidden");

// 标题用 _locales 里的扩展名（随浏览器语言，私人版和公开版各不相同）。
try {
  const name = chrome.i18n && chrome.i18n.getMessage("extensionName");
  if (name) document.title = name;
} catch (_error) {
  // 没有 i18n 接口时保留 HTML 里的标题。
}

if (isWindowView) {
  document.body.classList.add("window-view");
  document.querySelector("#headerSubtitle").dataset.i18n = "windowSubtitle";
  openWindowButton.classList.add("hidden");
}

// 切换语言：替换静态文字，再按当前状态重画动态内容。
function applyLanguage() {
  PixivI18n.applyDom(document, pageParams());
  if (!ugoiraHint.classList.contains("warn")) ugoiraHint.textContent = t("ugoiraHint");
  updateSizeControls();
  if (scanned) renderArtworks();
  else {
    count.textContent = t("scanning");
    detail.textContent = t("pleaseWait");
  }
  if (lastRenderedState) renderResult(lastRenderedState);
  else taskTitle.textContent = t("taskRunning");
}

PixivI18n.onChange(applyLanguage);

// 改保存文件夹：清理非法字符后保存，并刷新所有显示路径的地方。
downloadRootInput.addEventListener("change", () => {
  downloadRootInput.value = currentRoot();
  localStorage.setItem(DOWNLOAD_ROOT_KEY, downloadRootInput.value);
  applyLanguage();
});

// 打开 Firefox 的下载目录，确认文件实际存到了哪里（Android 没有这个接口时隐藏按钮）。
if (chrome.downloads && typeof chrome.downloads.showDefaultFolder === "function") {
  showDownloadsButton.addEventListener("click", () => chrome.downloads.showDefaultFolder());
} else {
  showDownloadsButton.classList.add("hidden");
}

(async () => {
  await PixivI18n.init();
  PixivI18n.bindLanguageSelect(document.querySelector("#languageSelect"));
  restoreDownloadRoot();
  applyLanguage();
  restoreFolderMode();
  restorePanels();
  restoreEmbedMetadata();
  restoreSizeFilter();
  restoreUgoiraFormat();
  updatePanelSummaries();
  rules = await loadRules();
  await resumeIfRunning();
  await scan();
})();
