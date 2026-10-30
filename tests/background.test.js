"use strict";

// 在 vm 里加载 lib.js + background.js，用假的 chrome / fetch 走一遍完整的预览和下载流程。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { resolveObjectURL } = require("node:buffer");
const { crc32 } = require("../src/metadata.js");

const SRC = path.join(__dirname, "..", "src");

const ARTWORKS = {
  101: { illustTitle: "璃月风景", illustType: 0, userName: "画师甲", tags: { tags: [{ tag: "原神", translation: { en: "Genshin Impact" } }, { tag: "風景" }] } },
  202: { illustTitle: "女孩", illustType: 0, tags: { tags: [{ tag: "オリジナル", translation: { en: "原创" } }] } },
  303: { illustTitle: "多页", illustType: 0, tags: { tags: [{ tag: "風景", translation: { en: "风景" } }] } }
};

// 每页尺寸：101 是 1600×1400（像素数够、长边不够），202 是竖图 1080×1920，303 第二页是小图。
const PAGE_SIZES = {
  "101_p0": [1600, 1400],
  "202_p0": [1080, 1920],
  "303_p0": [2560, 1440],
  "303_p1": [800, 600]
};

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

// hooks.respond(url, 第几次请求) 可返回自定义响应；hooks.downloadResult(filename, 第几次保存) 可模拟下载中断。
// 带 Content-Length 的图片响应；declared 可故意给错来模拟传输中断。
function imageResponse(buffer, declared = buffer.length) {
  return {
    ok: true,
    headers: { get: (name) => name.toLowerCase() === "content-length" ? String(declared) : null },
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length)
  };
}

const infoResponse = (body) => ({ ok: true, json: async () => ({ error: false, body }) });

function createHarness(storedRules, hooks = {}) {
  const requestCounts = new Map();
  const saveCounts = new Map();
  const filenamesById = new Map();
  const downloads = [];
  const fetched = [];
  const saved = [];
  const listeners = [];
  const tabs = [
    { id: 1, url: "https://www.pixiv.net/artworks/101", title: "a" },
    { id: 2, url: "https://www.pixiv.net/en/artworks/202", title: "b" },
    { id: 3, url: "https://www.pixiv.net/artworks/303?x=1", title: "c" },
    { id: 4, url: "https://www.pixiv.net/artworks/101#big", title: "dup" },
    { id: 5, url: "https://example.com/", title: "other" }
  ];

  const json = (body) => ({ ok: true, json: async () => ({ error: false, body }) });
  const context = {
    console,
    // 后台的语言默认跟随浏览器；测试里固定为中文，断言用的都是中文提示。
    navigator: { language: "zh-CN" },
    URL,
    Blob,
    TextEncoder,
    TextDecoder,
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout,
    fetch: async (url) => {
      fetched.push(url);
      requestCounts.set(url, (requestCounts.get(url) || 0) + 1);
      const custom = hooks.respond && hooks.respond(url, requestCounts.get(url));
      if (custom) return custom;
      if (url.includes("pximg.net")) return imageResponse(SAMPLE_PNG);
      const match = url.match(/\/ajax\/illust\/(\d+)(\/pages)?/);
      const id = match[1];
      if (match[2]) {
        const count = id === "303" ? 2 : 1;
        return json(Array.from({ length: count }, (_, index) => ({
          urls: { original: `https://i.pximg.net/img-original/img/${id}_p${index}.png` },
          width: PAGE_SIZES[`${id}_p${index}`][0],
          height: PAGE_SIZES[`${id}_p${index}`][1]
        })));
      }
      const [width, height] = PAGE_SIZES[`${id}_p0`];
      return json({ width, height, pageCount: id === "303" ? 2 : 1, ...ARTWORKS[id] });
    },
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener: (fn) => listeners.push(fn) }
      },
      tabs: { query: (_info, callback) => callback(tabs) },
      storage: { local: { get: (_key, callback) => callback({ tagRules: storedRules }) } },
      downloads: {
        download: (options, callback) => {
          downloads.push(options.filename);
          saved.push({ filename: options.filename, url: options.url, blob: options.url.startsWith("blob:") ? resolveObjectURL(options.url) : null });
          filenamesById.set(downloads.length, options.filename);
          callback(downloads.length);
        },
        onChanged: { addListener() {}, removeListener() {} },
        search: (query, callback) => {
          const filename = filenamesById.get(query.id);
          saveCounts.set(filename, (saveCounts.get(filename) || 0) + 1);
          const result = hooks.downloadResult && hooks.downloadResult(filename, saveCounts.get(filename));
          callback([result || { state: "complete" }]);
        }
      }
    }
  };
  // hooks.extensionApis 打开时模拟 windows / browserAction（桌面版 Firefox）；默认不提供（相当于 Android）。
  const ui = { windowsCreated: [], windowsFocused: [], badges: [], removeWindow: null };
  if (hooks.extensionApis) {
    let nextWindowId = 100;
    const open = new Set();
    const removedListeners = [];
    context.chrome.runtime.getURL = (relative) => `moz-extension://test/${relative}`;
    context.chrome.windows = {
      create: (options, callback) => {
        const id = nextWindowId++;
        open.add(id);
        ui.windowsCreated.push({ id, ...options });
        callback({ id });
      },
      update: (id, options, callback) => {
        if (open.has(id)) {
          context.chrome.runtime.lastError = null;
          ui.windowsFocused.push(id);
        } else {
          context.chrome.runtime.lastError = { message: "Invalid window ID" };
        }
        callback();
        context.chrome.runtime.lastError = null;
      },
      onRemoved: { addListener: (fn) => removedListeners.push(fn) }
    };
    // 只删除窗口、不触发 onRemoved，模拟漏掉关闭事件的情况。
    ui.closeSilently = (id) => open.delete(id);
    ui.removeWindow = (id) => {
      open.delete(id);
      for (const fn of removedListeners) fn(id);
    };
    context.chrome.browserAction = {
      setBadgeText: ({ text }) => ui.badges.push({ text }),
      setBadgeBackgroundColor: ({ color }) => { ui.badges[ui.badges.length - 1].color = color; }
    };
  }
  // hooks.ugoira 打开时加载 ugoira.js，并模拟图片解码和画布：帧文件内容直接当作 RGBA 像素（宽高见 FAKE_FRAME）。
  if (hooks.ugoira) {
    // hooks.noCompression 模拟不支持 CompressionStream 的环境（APNG 会转换失败）。
    Object.assign(context, { Response, DecompressionStream });
    if (!hooks.noCompression) context.CompressionStream = CompressionStream;
    context.createImageBitmap = async (blob) => ({
      width: FAKE_FRAME.width,
      height: FAKE_FRAME.height,
      pixels: new Uint8Array(await blob.arrayBuffer()),
      close() {}
    });
    context.OffscreenCanvas = class {
      constructor(width, height) { this.width = width; this.height = height; }
      getContext() {
        let drawn = null;
        return {
          clearRect() {},
          drawImage(bitmap) { drawn = bitmap.pixels; },
          getImageData: () => ({ data: Uint8ClampedArray.from(drawn) })
        };
      }
    };
  }
  context.globalThis = context;
  vm.createContext(context);
  for (const file of hooks.ugoira ? ["i18n.js", "lib.js", "ugoira.js", "metadata.js", "prepare.js", "background.js"] : ["i18n.js", "lib.js", "metadata.js", "prepare.js", "background.js"]) {
    vm.runInContext(fs.readFileSync(path.join(SRC, file), "utf8"), context, { filename: file });
  }

  const send = (message) => new Promise((resolve) => {
    const keepOpen = listeners[0](message, {}, resolve);
    if (!keepOpen) return;
  });
  return { send, downloads, fetched, saved, ui };
}

const RULES = [
  { folder: "风景", tags: ["風景"] },
  { folder: "原神", tags: ["Genshin Impact"] }
];

test("preview 返回去重后的作品和标签", async () => {
  const harness = createHarness(RULES);
  const response = await harness.send({ type: "preview" });
  assert.equal(response.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.artworks.map((item) => item.id))), ["101", "202", "303"]);
  assert.deepEqual(JSON.parse(JSON.stringify(response.artworks[0].tags)), [
    { name: "原神", translation: "Genshin Impact" },
    { name: "風景", translation: "" }
  ]);
});

test("download 按规则顺序分文件夹，未命中的沿用原方式，且复用预览缓存", async () => {
  const harness = createHarness(RULES);
  await harness.send({ type: "preview" });
  const response = await harness.send({ type: "download", folderMode: "artwork", overrides: {} });
  assert.equal(response.ok, true);
  assert.equal(response.state.failures.length, 0);
  assert.deepEqual(harness.downloads, [
    "Pixiv/风景/101_p0.png",
    "Pixiv/202 - 女孩/202_p0.png",
    "Pixiv/风景/303_p0.png",
    "Pixiv/风景/303_p1.png"
  ]);
  const infoRequests = harness.fetched.filter((url) => /\/illust\/\d+\?/.test(url));
  assert.equal(infoRequests.length, 3, "作品信息应只请求一次");
});

test("download 支持单个作品的临时去向", async () => {
  const harness = createHarness(RULES);
  const response = await harness.send({
    type: "download",
    folderMode: "flat",
    overrides: { 101: "原神", 202: "收藏", 303: "root" }
  });
  assert.equal(response.state.failures.length, 0);
  assert.deepEqual(harness.downloads, [
    "Pixiv/原神/101_p0.png",
    "Pixiv/收藏/202_p0.png",
    "Pixiv/303_p0.png",
    "Pixiv/303_p1.png"
  ]);
});

test("没有规则时行为与 1.2.0 一致", async () => {
  const harness = createHarness(undefined);
  await harness.send({ type: "download", folderMode: "artwork" });
  assert.deepEqual(harness.downloads, [
    "Pixiv/101 - 璃月风景/101_p0.png",
    "Pixiv/202 - 女孩/202_p0.png",
    "Pixiv/303 - 多页/303_p0.png",
    "Pixiv/303 - 多页/303_p1.png"
  ]);
});

test("默认写入元数据：保存的是带 XMP 的图片数据", async () => {
  const harness = createHarness(RULES);
  const response = await harness.send({ type: "download", folderMode: "artwork" });
  assert.equal(response.state.failures.length, 0);
  assert.ok(harness.saved.every((item) => item.blob), "应通过 blob 保存");
  const first = Buffer.from(await harness.saved[0].blob.arrayBuffer());
  const xml = first.toString("utf8");
  assert.equal(harness.saved[0].filename, "Pixiv/风景/101_p0.png");
  assert.equal(harness.saved[0].blob.type, "image/png");
  for (const expected of ["<rdf:li>原神</rdf:li>", "<rdf:li>Genshin Impact</rdf:li>", "<rdf:li>風景</rdf:li>", "画师甲", "https://www.pixiv.net/artworks/101"]) {
    assert.ok(xml.includes(expected), `缺少 ${expected}`);
  }
  assert.ok(first.length > SAMPLE_PNG.length);
});

test("关闭元数据开关时保存与原图完全相同的字节", async () => {
  const harness = createHarness(RULES);
  const response = await harness.send({ type: "download", folderMode: "artwork", embedMetadata: false });
  assert.equal(response.state.failures.length, 0);
  for (const item of harness.saved) {
    assert.deepEqual(Buffer.from(await item.blob.arrayBuffer()), SAMPLE_PNG);
  }
});

const status = (code) => ({ ok: false, status: code });
const P0_101 = "https://i.pximg.net/img-original/img/101_p0.png";
const P1_303 = "https://i.pximg.net/img-original/img/303_p1.png";
const countOf = (list, url) => list.filter((item) => item === url).length;

test("临时错误（503）自动重试后成功，不计为失败", async () => {
  const harness = createHarness(RULES, { respond: (url, n) => url === P0_101 && n <= 2 ? status(503) : null });
  const response = await harness.send({ type: "download", folderMode: "artwork" });
  assert.equal(response.state.failures.length, 0);
  assert.equal(countOf(harness.fetched, P0_101), 3);
  assert.equal(response.state.queuedFiles, 4);
});

test("永久错误（404）不重试，且不影响同一作品的其他页", async () => {
  const harness = createHarness(RULES, { respond: (url) => url === P1_303 ? status(404) : null });
  const response = await harness.send({ type: "download", folderMode: "artwork" });
  assert.equal(countOf(harness.fetched, P1_303), 1);
  assert.ok(harness.downloads.includes("Pixiv/风景/303_p0.png"));
  assert.deepEqual(JSON.parse(JSON.stringify(response.state.failures)), [
    { id: "303", filename: "303_p1.png", message: "图片 返回 HTTP 404" }
  ]);
  assert.equal(response.state.retryTotal, 0, "不可重试的错误不进入收尾重试");
});

test("持续失败的文件在收尾轮再试，最终失败后可手动重试成功", async () => {
  let broken = true;
  const harness = createHarness(RULES, { respond: (url) => broken && url === P1_303 ? status(503) : null });
  const first = await harness.send({ type: "download", folderMode: "artwork" });
  assert.equal(countOf(harness.fetched, P1_303), 6, "3 次立即重试 + 收尾轮 3 次");
  assert.equal(first.state.retryTotal, 1);
  assert.equal(first.state.failures.length, 1);
  assert.equal(first.state.queuedFiles, 3);

  broken = false;
  const retry = await harness.send({ type: "retry" });
  assert.equal(retry.state.failures.length, 0);
  assert.equal(retry.state.queuedFiles, 1);
  assert.equal(harness.downloads.at(-1), "Pixiv/风景/303_p1.png", "沿用原来的保存路径");
});

test("作品信息取不到时，手动重试会重新解析整个作品", async () => {
  let broken = true;
  const harness = createHarness(RULES, { respond: (url) => broken && /\/illust\/202\?/.test(url) ? status(500) : null });
  const first = await harness.send({ type: "download", folderMode: "flat" });
  assert.deepEqual(JSON.parse(JSON.stringify(first.state.failures)), [{ id: "202", filename: "", message: "Pixiv API 返回 HTTP 500" }]);
  broken = false;
  const retry = await harness.send({ type: "retry" });
  assert.equal(retry.state.failures.length, 0);
  assert.equal(harness.downloads.at(-1), "Pixiv/202_p0.png");
});

test("磁盘类下载中断不重试；网络中断会重试", async () => {
  const harness = createHarness(RULES, {
    downloadResult: (filename, n) => {
      if (filename === "Pixiv/202 - 女孩/202_p0.png") return { state: "interrupted", error: "FILE_NO_SPACE" };
      if (filename === "Pixiv/风景/101_p0.png" && n === 1) return { state: "interrupted", error: "NETWORK_FAILED" };
      return null;
    }
  });
  const response = await harness.send({ type: "download", folderMode: "artwork" });
  assert.equal(countOf(harness.downloads, "Pixiv/202 - 女孩/202_p0.png"), 1);
  assert.equal(countOf(harness.downloads, "Pixiv/风景/101_p0.png"), 2);
  assert.deepEqual(JSON.parse(JSON.stringify(response.state.failures)), [
    { id: "202", filename: "202_p0.png", message: "下载被中断（FILE_NO_SPACE）" }
  ]);
});

const P0_202 = "https://i.pximg.net/img-original/img/202_p0.png";

test("服务器返回网页时算可重试的失败，不保存", async () => {
  const html = Buffer.from("<!DOCTYPE html><html><body>Too Many Requests</body></html>");
  const harness = createHarness(RULES, { respond: (url) => url === P0_202 ? imageResponse(html) : null });
  const response = await harness.send({ type: "download", folderMode: "artwork" });
  assert.equal(countOf(harness.fetched, P0_202), 6, "立即重试 3 次 + 收尾轮 3 次");
  assert.ok(!harness.downloads.some((name) => name.endsWith("202_p0.png")), "错误页不应被保存");
  assert.deepEqual(JSON.parse(JSON.stringify(response.state.failures)), [
    { id: "202", filename: "202_p0.png", message: "服务器返回了网页而不是图片" }
  ]);
});

test("收到的字节数少于声明大小时重试，恢复后正常保存", async () => {
  const harness = createHarness(RULES, {
    respond: (url, n) => url === P0_202 && n === 1 ? imageResponse(SAMPLE_PNG.subarray(0, 20), SAMPLE_PNG.length) : null
  });
  const response = await harness.send({ type: "download", folderMode: "artwork" });
  assert.equal(response.state.failures.length, 0);
  assert.equal(countOf(harness.fetched, P0_202), 2);
  assert.equal(countOf(harness.downloads, "Pixiv/202 - 女孩/202_p0.png"), 1);
});

test("缺少结尾标志的图片（大小也对得上）算可重试的失败", async () => {
  const noEnd = SAMPLE_PNG.subarray(0, SAMPLE_PNG.length - 12);
  const harness = createHarness(RULES, { respond: (url) => url === P0_202 ? imageResponse(noEnd) : null });
  const response = await harness.send({ type: "download", folderMode: "artwork" });
  assert.equal(countOf(harness.fetched, P0_202), 6);
  assert.deepEqual(JSON.parse(JSON.stringify(response.state.failures)), [
    { id: "202", filename: "202_p0.png", message: "PNG 文件不完整（缺少 IEND 块）" }
  ]);
});

test("标签多到放不进 JPG 时删掉末尾部分标签再写入，并列入提示", async () => {
  // 标签总量远超 JPG 单个 XMP 段的 64 KB 上限。
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0xd9]);
  const manyTags = Array.from({ length: 3000 }, (_, index) => ({ tag: `很长的标签名称第${index}个`, translation: { en: `译名${index}` } }));
  const harness = createHarness(RULES, {
    respond: (url) => {
      if (url === P0_101) return imageResponse(jpeg);
      if (/\/illust\/101\?/.test(url)) return infoResponse({ illustTitle: "多标签", illustType: 0, userName: "画师甲", tags: { tags: manyTags } });
      return null;
    }
  });
  const response = await harness.send({ type: "download", folderMode: "flat" });
  assert.equal(response.state.failures.length, 0);
  assert.equal(response.state.warnings.length, 1);
  const omitted = Number(response.state.warnings[0].message.match(/已省略最后 (\d+) 个标签/)[1]);
  assert.ok(omitted > 0 && omitted < 3000);

  const saved = Buffer.from(await harness.saved[0].blob.arrayBuffer());
  const xml = saved.toString("utf8");
  const kept = 3000 - omitted;
  assert.ok(xml.includes(`<rdf:li>很长的标签名称第${kept - 1}个</rdf:li><rdf:li>译名${kept - 1}</rdf:li>`), "最后保留的一组标签与译名都在");
  assert.ok(!xml.includes(`很长的标签名称第${kept}个`) && !xml.includes(`译名${kept}<`), "被删的组整体不在");
  assert.ok(xml.includes("画师甲") && xml.includes("https://www.pixiv.net/artworks/101"), "作者和链接保留");
  assert.ok(!xml.includes("LastKeywordXMP"));
  assert.equal(saved.readUInt16BE(4) <= 0xffff, true);
  const { checkImage } = require("../src/metadata.js");
  assert.equal(checkImage(saved), "");
});

const FILTER_1080P = { enabled: true, width: 1920, height: 1080 };

test("尺寸筛选（长短边）：横竖图都按长边/短边判断，小页跳过且不请求", async () => {
  const harness = createHarness(RULES);
  const response = await harness.send({ type: "download", folderMode: "artwork", sizeFilter: { ...FILTER_1080P, mode: "dimensions" } });
  assert.equal(response.state.failures.length, 0);
  assert.deepEqual(harness.downloads, ["Pixiv/202 - 女孩/202_p0.png", "Pixiv/风景/303_p0.png"]);
  assert.deepEqual(JSON.parse(JSON.stringify(response.state.skipped)), [
    { id: "101", filename: "101_p0.png", width: 1600, height: 1400 },
    { id: "303", filename: "303_p1.png", width: 800, height: 600 }
  ]);
  assert.equal(harness.fetched.filter((url) => url.includes("pximg.net")).length, 2, "跳过的图不发请求");
});

test("尺寸筛选（总像素数）：1600×1400 达到 1920×1080 的像素数，保留", async () => {
  const harness = createHarness(RULES);
  const response = await harness.send({ type: "download", folderMode: "artwork", sizeFilter: { ...FILTER_1080P, mode: "pixels" } });
  assert.deepEqual(harness.downloads, ["Pixiv/风景/101_p0.png", "Pixiv/202 - 女孩/202_p0.png", "Pixiv/风景/303_p0.png"]);
  assert.deepEqual(JSON.parse(JSON.stringify(response.state.skipped)).map((item) => item.filename), ["303_p1.png"]);
});

test("尺寸筛选关闭或未传时全部下载；预览带上首页尺寸与页数", async () => {
  const harness = createHarness(RULES);
  const preview = await harness.send({ type: "preview" });
  assert.deepEqual(JSON.parse(JSON.stringify(preview.artworks.map(({ id, width, height, pageCount }) => ({ id, width, height, pageCount })))), [
    { id: "101", width: 1600, height: 1400, pageCount: 1 },
    { id: "202", width: 1080, height: 1920, pageCount: 1 },
    { id: "303", width: 2560, height: 1440, pageCount: 2 }
  ]);
  const response = await harness.send({ type: "download", folderMode: "artwork", sizeFilter: { ...FILTER_1080P, enabled: false } });
  assert.equal(harness.downloads.length, 4);
  assert.equal(response.state.skipped.length, 0);
});

test("下载时打开独立进度窗口；窗口还在就切到前台，关掉后再下载会重新打开", async () => {
  const harness = createHarness(RULES, { extensionApis: true });
  await harness.send({ type: "download", folderMode: "artwork", openWindow: true });
  assert.equal(harness.ui.windowsCreated.length, 1);
  assert.equal(harness.ui.windowsCreated[0].url, "moz-extension://test/popup.html?view=window");
  assert.equal(harness.ui.windowsCreated[0].type, "popup");

  await harness.send({ type: "download", folderMode: "artwork", openWindow: true });
  assert.equal(harness.ui.windowsCreated.length, 1, "已有窗口时不重复打开");
  assert.deepEqual(harness.ui.windowsFocused, [100]);

  harness.ui.removeWindow(100);
  await harness.send({ type: "retry", openWindow: true });
  assert.equal(harness.ui.windowsCreated.length, 2);

  await harness.send({ type: "download", folderMode: "artwork" });
  assert.equal(harness.ui.windowsCreated.length, 2, "窗口里发起的下载（openWindow 为假）不开新窗口");
});

test("窗口被用户关掉但没收到关闭事件时，切换失败会改为新开", async () => {
  const harness = createHarness(RULES, { extensionApis: true });
  await harness.send({ type: "download", folderMode: "artwork", openWindow: true });
  // 模拟窗口已不存在、却没有触发 onRemoved：让 update 报错。
  const created = harness.ui.windowsCreated[0].id;
  harness.ui.windowsCreated.length = 0;
  harness.ui.closeSilently(created);
  await harness.send({ type: "download", folderMode: "artwork", openWindow: true });
  assert.equal(harness.ui.windowsCreated.length, 1);
  assert.deepEqual(harness.ui.windowsFocused, [], "切换失败，没有聚焦成功");
});

test("角标：进行中显示百分比，失败时显示红色数量，全部成功后清除", async () => {
  let broken = true;
  const harness = createHarness(RULES, {
    extensionApis: true,
    respond: (url) => broken && url === "https://i.pximg.net/img-original/img/202_p0.png" ? status(404) : null
  });
  await harness.send({ type: "download", folderMode: "artwork" });
  const texts = harness.ui.badges.map((badge) => badge.text);
  assert.deepEqual(texts.slice(0, 4), ["0%", "33%", "66%", "100%"]);
  assert.deepEqual(harness.ui.badges.at(-1), { text: "1", color: "#d03b3b" });

  broken = false;
  await harness.send({ type: "retry" });
  assert.deepEqual(harness.ui.badges.at(-1), { text: "" });
});

test("没有 windows / browserAction 接口（Android）时照常下载", async () => {
  const harness = createHarness(RULES);
  const response = await harness.send({ type: "download", folderMode: "artwork", openWindow: true });
  assert.equal(response.state.failures.length, 0);
  assert.equal(harness.downloads.length, 4);
});

test("openWindow 消息只在用户点链接时打开窗口；下载本身不再自动开窗口", async () => {
  const harness = createHarness(RULES, { extensionApis: true });
  await harness.send({ type: "download", folderMode: "artwork" });
  assert.equal(harness.ui.windowsCreated.length, 0);
  await harness.send({ type: "openWindow" });
  assert.equal(harness.ui.windowsCreated.length, 1);
  await harness.send({ type: "openWindow" });
  assert.equal(harness.ui.windowsCreated.length, 1, "再点一次只切到前台");
  assert.deepEqual(harness.ui.windowsFocused, [100]);
});

test("dismiss 关掉上次结果：状态带上标记、清除失败角标；下一次下载重新显示", async () => {
  const harness = createHarness(RULES, {
    extensionApis: true,
    respond: (url) => url === "https://i.pximg.net/img-original/img/202_p0.png" ? status(404) : null
  });
  await harness.send({ type: "download", folderMode: "artwork" });
  assert.deepEqual(harness.ui.badges.at(-1), { text: "1", color: "#d03b3b" });

  const dismissed = await harness.send({ type: "dismiss" });
  assert.equal(dismissed.state.dismissed, true);
  assert.deepEqual(harness.ui.badges.at(-1), { text: "" });
  assert.equal((await harness.send({ type: "state" })).state.dismissed, true);

  const next = await harness.send({ type: "download", folderMode: "artwork" });
  assert.equal(next.state.dismissed, false);
  assert.deepEqual(harness.ui.badges.at(-1), { text: "1", color: "#d03b3b" });
});

const FAKE_FRAME = { width: 6, height: 4 };
const U = require("../src/ugoira.js");
const { findZipEntries, inflateEntry } = U;

// 101 改成动图：3 帧，每帧是 6×4 的 RGBA 像素。
function ugoiraHooks() {
  const frames = [0, 1, 2].map((n) => Uint8Array.from({ length: 6 * 4 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 11 + n * 40) & 255)));
  const archive = Buffer.from(U.buildStoredZip(frames.map((bytes, n) => ({ name: `00000${n}.jpg`, bytes }))));
  const archiveUrl = "https://i.pximg.net/img-zip-ugoira/img/101_ugoira1920x1080.zip";
  return {
    frames,
    hooks: {
      ugoira: true,
      respond: (url) => {
        if (/\/illust\/101\/ugoira_meta/.test(url)) {
          return infoResponse({ originalSrc: archiveUrl, mime_type: "image/jpeg", frames: frames.map((_, n) => ({ file: `00000${n}.jpg`, delay: 80 + n * 10 })) });
        }
        if (/\/illust\/101\?/.test(url)) {
          return infoResponse({ illustTitle: "动图", illustType: 2, userName: "画师甲", userId: "42", width: 6, height: 4, pageCount: 1, tags: { tags: [{ tag: "原神", translation: { en: "Genshin Impact" } }] } });
        }
        if (url === archiveUrl) return { ...imageResponse(archive), blob: async () => new Blob([archive]) };
        return null;
      }
    }
  };
}

async function downloadUgoira(format) {
  const { frames, hooks } = ugoiraHooks();
  const harness = createHarness(RULES, hooks);
  const response = await harness.send({ type: "download", folderMode: "artwork", ugoiraFormat: format });
  assert.equal(response.state.failures.length, 0, JSON.stringify(response.state.failures));
  const item = harness.saved.find((entry) => entry.filename.includes("101"));
  return { frames, item, bytes: Buffer.from(await item.blob.arrayBuffer()), response };
}

test("动图保存为 GIF（默认）：文件名 _p0.gif，写入元数据且结构完整", async () => {
  const { item, bytes } = await downloadUgoira(undefined);
  assert.equal(item.filename, "Pixiv/原神/101_p0.gif");
  assert.equal(item.blob.type, "image/gif");
  const { checkImage } = require("../src/metadata.js");
  assert.equal(checkImage(bytes), "");
  assert.ok(bytes.toString("utf8").includes("<rdf:li>原神</rdf:li>"));
});

test("动图保存为 APNG：文件名 _p0.png，3 帧无损，写入元数据", async () => {
  const { item, bytes, frames } = await downloadUgoira("apng");
  assert.equal(item.filename, "Pixiv/原神/101_p0.png");
  assert.equal(item.blob.type, "image/png");
  const { checkImage } = require("../src/metadata.js");
  assert.equal(checkImage(bytes), "");
  const text = bytes.toString("latin1");
  assert.ok(text.includes("acTL") && text.includes("fdAT"));
  assert.ok(bytes.toString("utf8").includes("画师甲"));
  // 解出第 3 帧比对像素（RGB，不透明）。
  const zlib = require("node:zlib");
  let offset = 8;
  const fdat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString("latin1", offset + 4, offset + 8) === "fdAT") fdat.push(bytes.subarray(offset + 12, offset + 8 + length));
    offset += 12 + length;
  }
  assert.equal(fdat.length, 2);
  const raw = zlib.inflateSync(fdat[1]);
  assert.equal(raw.length, 4 * (1 + 6 * 3));
});

test("动图保存为原始帧压缩包：帧原样保留，animation.json 带帧时长和作品信息", async () => {
  const { item, bytes, frames } = await downloadUgoira("zip");
  assert.equal(item.filename, "Pixiv/原神/101_ugoira.zip");
  assert.equal(item.blob.type, "application/zip");
  const zip = new Uint8Array(bytes);
  const entries = findZipEntries(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length));
  assert.deepEqual(entries.map((entry) => entry.filename), ["000000.jpg", "000001.jpg", "000002.jpg", "animation.json"]);
  for (const n of [0, 1, 2]) assert.deepEqual(await inflateEntry(zip, entries[n]), frames[n]);
  const animation = JSON.parse(new TextDecoder().decode(await inflateEntry(zip, entries[3])));
  assert.deepEqual(animation.frames, [{ file: "000000.jpg", delay: 80 }, { file: "000001.jpg", delay: 90 }, { file: "000002.jpg", delay: 100 }]);
  assert.equal(animation.illustId, "101");
  assert.equal(animation.userName, "画师甲");
  assert.equal(animation.source, "https://www.pixiv.net/artworks/101");
  assert.deepEqual(animation.tags, [{ name: "原神", translation: "Genshin Impact" }]);
  assert.ok(!bytes.toString("utf8").includes("<x:xmpmeta"), "压缩包本身不写 XMP");
});

const ARCHIVE_URL = "https://i.pximg.net/img-zip-ugoira/img/101_ugoira1920x1080.zip";

test("动图多选全部三种：各存一个文件，原始压缩包只下载一次", async () => {
  const { hooks } = ugoiraHooks();
  const harness = createHarness(RULES, hooks);
  const response = await harness.send({ type: "download", folderMode: "artwork", ugoiraFormats: ["gif", "apng", "zip"] });
  assert.equal(response.state.failures.length, 0);
  const saved = harness.saved.filter((item) => item.filename.includes("101"));
  assert.deepEqual(saved.map((item) => item.filename), ["Pixiv/原神/101_p0.gif", "Pixiv/原神/101_p0.png", "Pixiv/原神/101_ugoira.zip"]);
  assert.deepEqual(saved.map((item) => item.blob.type), ["image/gif", "image/png", "application/zip"]);
  assert.equal(harness.fetched.filter((url) => url === ARCHIVE_URL).length, 1);
});

test("动图格式去重并按固定顺序；无效值被忽略，全无效时退回 GIF", async () => {
  const { hooks } = ugoiraHooks();
  const harness = createHarness(RULES, hooks);
  await harness.send({ type: "download", folderMode: "artwork", ugoiraFormats: ["zip", "bogus", "gif", "zip"] });
  assert.deepEqual(harness.downloads.filter((name) => name.includes("101")), ["Pixiv/原神/101_p0.gif", "Pixiv/原神/101_ugoira.zip"]);

  const second = createHarness(RULES, ugoiraHooks().hooks);
  await second.send({ type: "download", folderMode: "artwork", ugoiraFormats: ["bogus"] });
  assert.deepEqual(second.downloads.filter((name) => name.includes("101")), ["Pixiv/原神/101_p0.gif"]);
});

test("某一种格式转换失败不影响其他格式；重试只针对失败的格式", async () => {
  const { hooks } = ugoiraHooks();
  const harness = createHarness(RULES, { ...hooks, noCompression: true });
  const response = await harness.send({ type: "download", folderMode: "artwork", ugoiraFormats: ["gif", "apng", "zip"] });
  assert.deepEqual(harness.downloads.filter((name) => name.includes("101")), ["Pixiv/原神/101_p0.gif", "Pixiv/原神/101_ugoira.zip"]);
  assert.deepEqual(JSON.parse(JSON.stringify(response.state.failures)), [
    { id: "101", filename: "101_p0.png", message: "当前浏览器不支持 APNG 压缩" }
  ]);
  assert.equal(harness.fetched.filter((url) => url === ARCHIVE_URL).length, 1, "转换失败不可重试，不会重复下载压缩包");

  const retry = await harness.send({ type: "retry" });
  assert.equal(retry.state.failures.length, 1);
  assert.equal(harness.downloads.filter((name) => name.includes("101")).length, 2, "重试没有重新保存已成功的格式");
});

test("尺寸筛选分开：只开静态图筛选时小动图照常保存", async () => {
  const { hooks } = ugoiraHooks();
  const harness = createHarness(RULES, hooks);
  const response = await harness.send({
    type: "download",
    folderMode: "artwork",
    ugoiraFormats: ["gif", "zip"],
    sizeFilter: { image: { enabled: true, width: 1920, height: 1080 }, ugoira: { enabled: false } }
  });
  // 动图只有 6×4，但动图筛选关闭；静态图里 303_p1（800×600）被跳过。
  assert.deepEqual(harness.downloads, ["Pixiv/原神/101_p0.gif", "Pixiv/原神/101_ugoira.zip", "Pixiv/202 - 女孩/202_p0.png", "Pixiv/风景/303_p0.png"]);
  assert.deepEqual(JSON.parse(JSON.stringify(response.state.skipped)).map((item) => item.filename), ["303_p1.png"]);
});

test("尺寸筛选分开：只开动图筛选时，小动图的所有格式一起跳过，静态图全部保存", async () => {
  const { hooks } = ugoiraHooks();
  const harness = createHarness(RULES, hooks);
  const response = await harness.send({
    type: "download",
    folderMode: "artwork",
    ugoiraFormats: ["gif", "apng"],
    sizeFilter: { image: { enabled: false }, ugoira: { enabled: true, mode: "pixels", width: 100, height: 100 } }
  });
  assert.ok(!harness.downloads.some((name) => name.includes("101")));
  assert.equal(harness.downloads.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(response.state.skipped)).map((item) => item.filename), ["101_p0.gif", "101_p0.png"]);
  assert.equal(harness.fetched.filter((url) => url === ARCHIVE_URL).length, 0, "跳过的动图不下载压缩包");
});

test("预览标出哪些作品是动图", async () => {
  const { hooks } = ugoiraHooks();
  const harness = createHarness(RULES, hooks);
  const preview = await harness.send({ type: "preview" });
  assert.deepEqual(JSON.parse(JSON.stringify(preview.artworks.map(({ id, isUgoira }) => ({ id, isUgoira })))), [
    { id: "101", isUgoira: true },
    { id: "202", isUgoira: false },
    { id: "303", isUgoira: false }
  ]);
});

test("保存文件夹：按设置保存；留空直接存在下载目录；重试沿用当时的设置", async () => {
  const harness = createHarness(RULES);
  await harness.send({ type: "download", folderMode: "artwork", downloadRoot: "插画/Pixiv" });
  assert.deepEqual(harness.downloads, [
    "插画/Pixiv/风景/101_p0.png",
    "插画/Pixiv/202 - 女孩/202_p0.png",
    "插画/Pixiv/风景/303_p0.png",
    "插画/Pixiv/风景/303_p1.png"
  ]);

  const flat = createHarness(RULES);
  await flat.send({ type: "download", folderMode: "flat", downloadRoot: "" });
  assert.deepEqual(flat.downloads, ["风景/101_p0.png", "202_p0.png", "风景/303_p0.png", "风景/303_p1.png"]);

  let broken = true;
  const retrying = createHarness(RULES, { respond: (url) => broken && url.endsWith("/202_p0.png") ? status(404) : null });
  await retrying.send({ type: "download", folderMode: "artwork", downloadRoot: "Art" });
  broken = false;
  await retrying.send({ type: "retry" });
  assert.equal(retrying.downloads.at(-1), "Art/202 - 女孩/202_p0.png");
});
