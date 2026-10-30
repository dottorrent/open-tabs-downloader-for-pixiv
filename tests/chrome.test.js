"use strict";

// Chrome / Edge 版：在两个 vm 环境里分别加载 service worker（background-sw.js 引入的模块）和离屏页（offscreen.html 的脚本），
// 用模拟的 chrome.runtime.sendMessage 把它们连起来，走一遍完整的下载流程。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { resolveObjectURL } = require("node:buffer");
const { crc32 } = require("../src/metadata.js");

const SRC = path.join(__dirname, "..", "src");
// vm 里创建的数组和对象原型不同，比较前转成普通值。
const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (name) => fs.readFileSync(path.join(SRC, name), "utf8");

function pngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(typeAndData.length - 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

const SAMPLE_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk("IHDR", Buffer.alloc(13, 1)),
  pngChunk("IDAT", Buffer.from([1, 2, 3])),
  pngChunk("IEND", Buffer.alloc(0))
]);

const json = (body) => ({ ok: true, json: async () => ({ error: false, body }) });
const image = (buffer) => ({
  ok: true,
  headers: { get: (name) => name.toLowerCase() === "content-length" ? String(buffer.length) : null },
  arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length)
});

// 脚本里找出要加载的文件：service worker 看 importScripts，离屏页看 <script src>。
function serviceWorkerScripts() {
  const source = read("chrome/background-sw.js");
  return [...source.match(/importScripts\(([^)]*)\)/)[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function offscreenScripts() {
  return [...read("chrome/offscreen.html").matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
}

const sourcePath = (name) => (fs.existsSync(path.join(SRC, name)) ? name : `chrome/${name}`);

function createChromeHarness({ respond, uiLanguage } = {}) {
  const log = { downloads: [], sessionRules: [], offscreenCreated: 0, fetched: [], session: {} };
  const offscreenListeners = [];
  const workerListeners = [];

  const fetchMock = async (url) => {
    log.fetched.push(url);
    const custom = respond && respond(url);
    if (custom) return custom;
    if (url.includes("pximg.net")) return image(SAMPLE_PNG);
    const match = url.match(/\/ajax\/illust\/(\d+)(\/pages)?/);
    if (match[2]) return json([{ urls: { original: `https://i.pximg.net/img-original/img/${match[1]}_p0.png` }, width: 2000, height: 2000 }]);
    return json({ illustTitle: "标题", illustType: 0, userName: "画师甲", width: 2000, height: 2000, pageCount: 1, tags: { tags: [{ tag: "原神", translation: { en: "Genshin Impact" } }] } });
  };

  // ---- 离屏页：只有 chrome.runtime，可以创建 blob 地址 ----
  const offscreen = {
    console, URL, Blob, Response, TextEncoder, TextDecoder, DecompressionStream, CompressionStream,
    navigator: { language: "zh-CN" },
    fetch: fetchMock,
    chrome: { runtime: { onMessage: { addListener: (fn) => offscreenListeners.push(fn) } } }
  };
  offscreen.globalThis = offscreen;
  vm.createContext(offscreen);

  // ---- service worker：没有 URL.createObjectURL ----
  const WorkerURL = function (...args) { return new URL(...args); };
  WorkerURL.prototype = URL.prototype;
  const store = { tagRules: [], uiLanguage };
  const worker = {
    console, Blob, Response, TextEncoder, TextDecoder,
    URL: WorkerURL,
    navigator: { language: "zh-CN" },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout, setInterval: () => 1, clearInterval: () => {},
    fetch: fetchMock,
    importScripts: () => {},
    chrome: {
      runtime: {
        lastError: null,
        getURL: (relative) => `chrome-extension://test/${relative}`,
        getContexts: async () => (log.offscreenCreated ? [{}] : []),
        getPlatformInfo: (callback) => callback({}),
        onMessage: { addListener: (fn) => workerListeners.push(fn) },
        // service worker 发出的消息只送到离屏页（Chrome 不会把消息送回发送方自己）。
        sendMessage: (message) => new Promise((resolve) => {
          let answered = false;
          for (const listener of offscreenListeners) {
            const keepOpen = listener(message, {}, (response) => { answered = true; resolve(response); });
            if (keepOpen || answered) return;
          }
          resolve(undefined);
        })
      },
      offscreen: {
        createDocument: async (options) => {
          log.offscreenCreated += 1;
          log.offscreenOptions = options;
          for (const name of offscreenScripts()) vm.runInContext(read(sourcePath(name)), offscreen, { filename: name });
        }
      },
      declarativeNetRequest: { updateSessionRules: async (update) => { log.sessionRules.push(update); } },
      tabs: { query: (_info, callback) => callback([{ id: 1, url: "https://www.pixiv.net/artworks/101" }, { id: 2, url: "https://www.pixiv.net/artworks/202" }]) },
      storage: {
        local: { get: (_key, callback) => callback({ ...store }), set: () => {} },
        session: {
          set: async (items) => Object.assign(log.session, items),
          get: async (key) => ({ [key]: log.session[key] })
        }
      },
      downloads: {
        download: (options, callback) => {
          log.downloads.push({ filename: options.filename, url: options.url, blob: resolveObjectURL(options.url) });
          callback(log.downloads.length);
        },
        onChanged: { addListener() {}, removeListener() {} },
        search: (_query, callback) => callback([{ state: "complete" }])
      }
    }
  };
  worker.globalThis = worker;
  vm.createContext(worker);
  for (const name of serviceWorkerScripts()) vm.runInContext(read(sourcePath(name)), worker, { filename: name });

  const send = (message) => new Promise((resolve) => {
    const keepOpen = workerListeners[0](message, {}, resolve);
    if (!keepOpen) return;
  });
  return { send, log, worker };
}

test("service worker 不加载图片处理模块，也没有 URL.createObjectURL", () => {
  const scripts = serviceWorkerScripts();
  assert.deepEqual(scripts, ["i18n.js", "lib.js", "prepare.js", "platform-chrome.js", "background.js"]);
  const harness = createChromeHarness();
  assert.equal(typeof harness.worker.URL.createObjectURL, "undefined");
  assert.equal(typeof harness.worker.PixivPlatform.prepare, "function");
});

test("Referer 会话规则只改扩展自己发往 pximg.net 的请求", async () => {
  const harness = createChromeHarness();
  await harness.send({ type: "preview" });
  const [update] = plain(harness.log.sessionRules);
  assert.deepEqual(update.removeRuleIds, [1]);
  const [rule] = update.addRules;
  assert.deepEqual(rule.action.requestHeaders, [{ header: "Referer", operation: "set", value: "https://www.pixiv.net/" }]);
  assert.deepEqual(rule.condition.requestDomains, ["pximg.net"]);
  assert.deepEqual(rule.condition.tabIds, [-1], "不影响网页标签里的请求");
});

test("下载经离屏页处理：写入元数据、离屏页只建一次、下载用离屏页创建的 blob 地址", async () => {
  const harness = createChromeHarness();
  const response = await harness.send({ type: "download", folderMode: "artwork" });
  assert.equal(response.state.failures.length, 0, JSON.stringify(response.state.failures));
  assert.equal(harness.log.offscreenCreated, 1);
  assert.deepEqual(plain(harness.log.offscreenOptions.reasons), ["BLOBS"]);
  assert.deepEqual(harness.log.downloads.map((item) => item.filename), ["Pixiv/101 - 标题/101_p0.png", "Pixiv/202 - 标题/202_p0.png"]);
  for (const item of harness.log.downloads) {
    assert.match(item.url, /^blob:/);
    const xml = Buffer.from(await item.blob.arrayBuffer()).toString("utf8");
    assert.ok(xml.includes("<rdf:li>原神</rdf:li>") && xml.includes("画师甲"));
  }
});

test("离屏页里的错误传回后台后仍保留“是否可重试”：404 不重试，503 重试", async () => {
  const p0 = (id) => `https://i.pximg.net/img-original/img/${id}_p0.png`;
  let attempts503 = 0;
  const harness = createChromeHarness({
    respond: (url) => {
      if (url === p0(101)) return { ok: false, status: 404 };
      if (url === p0(202)) {
        attempts503 += 1;
        return attempts503 < 3 ? { ok: false, status: 503 } : null;
      }
      return null;
    }
  });
  const response = await harness.send({ type: "download", folderMode: "flat" });
  assert.equal(harness.log.fetched.filter((url) => url === p0(101)).length, 1, "404 只请求一次");
  assert.equal(attempts503, 3, "503 重试到成功");
  assert.deepEqual(JSON.parse(JSON.stringify(response.state.failures)), [{ id: "101", filename: "101_p0.png", message: "图片 返回 HTTP 404" }]);
  assert.deepEqual(harness.log.downloads.map((item) => item.filename), ["Pixiv/202_p0.png"]);
});

test("界面语言随消息带到离屏页，提示文字跟着变", async () => {
  const harness = createChromeHarness({ uiLanguage: "en", respond: (url) => (url.includes("pximg.net") ? { ok: false, status: 404 } : null) });
  const response = await harness.send({ type: "download", folderMode: "flat" });
  assert.equal(response.state.failures[0].message, "Image returned HTTP 404");
});

test("结果存进 storage.session，service worker 重启后能恢复上次结果", async () => {
  const harness = createChromeHarness({ respond: (url) => (url.endsWith("/202_p0.png") ? { ok: false, status: 404 } : null) });
  await harness.send({ type: "download", folderMode: "flat" });
  const saved = harness.log.session.pixivLastRun;
  assert.equal(saved.state.queuedFiles, 1);
  assert.equal(saved.lastFailedTasks.length, 1);
  assert.doesNotThrow(() => JSON.stringify(saved), "能存进 storage");

  // 模拟重启：新的 service worker 读到保存的结果。
  const restarted = createChromeHarness();
  Object.assign(restarted.log.session, harness.log.session);
  const { worker } = restarted;
  const restored = await worker.PixivPlatform.loadState();
  assert.equal(restored.state.failures.length, 1);
});
