"use strict";

// 检查私人版和公开版打包结果的差异，以及公开版里不含个人信息和无用代码。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { editionFiles, buildEdition } = require("../build.js");
const { findZipEntries, inflateEntry } = require("../src/ugoira.js");

const text = (entries, name) => entries.find((entry) => entry.name === name).data.toString("utf8");

test("公开版：新名称、新 ID，Android 最低版本满足数据收集声明，与私人版版本号一致", () => {
  const privateEdition = editionFiles("private");
  const publicEdition = editionFiles("public");
  assert.equal(privateEdition.manifest.name, "__MSG_extensionName__");
  assert.deepEqual(privateEdition.names, { en: "Pixiv Open Tabs Downloader", zh: "Pixiv 已打开作品下载器" });
  assert.equal(privateEdition.manifest.browser_specific_settings.gecko.id, "pixiv-open-tabs-downloader@local");
  assert.ok(privateEdition.manifest.browser_specific_settings.gecko_android);

  assert.deepEqual(publicEdition.names, { en: "Open Tabs Downloader for Pixiv", zh: "已打开作品批量下载器 for Pixiv" });
  assert.equal(publicEdition.manifest.default_locale, "en");
  assert.match(publicEdition.manifest.browser_specific_settings.gecko.id, /^\{[0-9a-f-]{36}\}$/);
  assert.notEqual(publicEdition.manifest.browser_specific_settings.gecko.id, privateEdition.manifest.browser_specific_settings.gecko.id);
  // data_collection_permissions 要求 Firefox for Android ≥ 142（web-ext lint 的 KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION）。
  assert.equal(publicEdition.manifest.browser_specific_settings.gecko_android.strict_min_version, "142.0");
  assert.equal(publicEdition.manifest.version, privateEdition.manifest.version);
  assert.deepEqual(publicEdition.manifest.browser_specific_settings.gecko.data_collection_permissions, { required: ["none"] });
});

test("两个版本都不含个人路径、打包标记和 Edge 旧代码；弹窗有保存文件夹设置", () => {
  for (const edition of ["private", "public"]) {
    const { entries } = editionFiles(edition);
    for (const entry of entries) {
      const content = entry.data.toString("utf8");
      // 安装包里不应出现 Windows 绝对路径（例如个人的下载目录）。
      assert.ok(!/\b[A-Z]:\\[A-Za-z]/.test(content), `${edition} ${entry.name} 含绝对路径`);
      assert.ok(!/edge-offscreen|PixivEdgeOffscreen|importScripts/.test(content), `${edition} ${entry.name} 含 Edge 旧代码`);
      assert.ok(!/edition:path-note|data-lang-(zh|en)/.test(content), `${edition} ${entry.name} 残留打包标记`);
    }
    const popup = text(entries, "popup.html");
    assert.match(popup, /<input id="downloadRoot"/);
    assert.match(popup, /id="showDownloads"/);
  }
});

test("manifest 引用的文件都在包里", () => {
  for (const edition of ["private", "public"]) {
    const { manifest, entries } = editionFiles(edition);
    const names = new Set(entries.map((entry) => entry.name));
    const referenced = [
      ...manifest.background.scripts,
      manifest.browser_action.default_popup,
      manifest.browser_action.default_icon,
      manifest.options_ui.page,
      ...Object.values(manifest.icons)
    ];
    for (const file of referenced) assert.ok(names.has(file), `${edition} 缺少 ${file}`);
  }
});

test("打包出的 xpi 能被解析，内容与源文件一致", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixiv-build-"));
  try {
    const { output, files } = buildEdition("public", outDir);
    assert.match(path.basename(output), /^open-tabs-downloader-for-pixiv-.+-public-unsigned\.xpi$/);
    const bytes = new Uint8Array(fs.readFileSync(output));
    const entries = findZipEntries(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    assert.deepEqual(entries.map((entry) => entry.filename), files);
    const manifestEntry = entries.find((entry) => entry.filename === "manifest.json");
    const manifest = JSON.parse(new TextDecoder().decode(await inflateEntry(bytes, manifestEntry)));
    assert.equal(manifest.name, "__MSG_extensionName__");
    const zhEntry = entries.find((entry) => entry.filename === "_locales/zh_CN/messages.json");
    const zhMessages = JSON.parse(new TextDecoder().decode(await inflateEntry(bytes, zhEntry)));
    assert.equal(zhMessages.extensionName.message, "已打开作品批量下载器 for Pixiv");
    const libEntry = entries.find((entry) => entry.filename === "lib.js");
    assert.deepEqual(Buffer.from(await inflateEntry(bytes, libEntry)), fs.readFileSync(path.join(__dirname, "..", "src", "lib.js")));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test("两个版本都带 MIT 许可证；弹窗和规则页都有免责声明", () => {
  for (const edition of ["private", "public"]) {
    const { entries } = editionFiles(edition);
    assert.match(text(entries, "LICENSE"), /^MIT License/);
    assert.match(text(entries, "LICENSE"), /grants no rights to\s+any artwork/);
    assert.match(text(entries, "popup.html"), /免责声明：作品版权归原作者所有/);
    assert.match(text(entries, "options.html"), /免责声明：.*由使用者自行承担/);
  }
});

test("manifest 里的 __MSG_ 占位符在每种语言的 _locales 里都有", () => {
  for (const edition of ["private", "public"]) {
    const { manifest, entries } = editionFiles(edition);
    const placeholders = JSON.stringify(manifest).match(/__MSG_(\w+)__/g).map((item) => item.slice(6, -2));
    for (const locale of ["en", "zh_CN", "zh_TW"]) {
      const messages = JSON.parse(text(entries, `_locales/${locale}/messages.json`));
      for (const key of placeholders) assert.ok(messages[key] && messages[key].message, `${edition} ${locale} 缺少 ${key}`);
    }
    assert.equal(manifest.background.scripts[0], "i18n.js", "语言模块要最先加载");
  }
});

test("Chrome/Edge 安装包：Manifest V3、没有 webRequest 阻塞权限、没有 Firefox 专用设置", () => {
  for (const edition of ["private", "public"]) {
    const { manifest, entries } = editionFiles(edition, "chrome");
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.browser_specific_settings, undefined);
    assert.equal(manifest.browser_action, undefined);
    assert.ok(!manifest.permissions.some((permission) => /webRequest|:\/\//.test(permission)), "权限里不能有 webRequest 或网址");
    assert.deepEqual(manifest.host_permissions, ["https://www.pixiv.net/*", "https://*.pximg.net/*"]);
    for (const permission of ["downloads", "storage", "tabs", "declarativeNetRequest", "offscreen"]) {
      assert.ok(manifest.permissions.includes(permission), `缺少权限 ${permission}`);
    }
    const names = entries.map((entry) => entry.name);
    assert.ok(!names.includes("firefox-referer.js"));
    assert.ok(!names.some((name) => name.startsWith("chrome/")), "Chrome 专用文件应放在包根目录");
  }
});

test("Chrome/Edge 安装包：manifest、service worker、离屏页引用的文件都在包里", () => {
  for (const edition of ["private", "public"]) {
    const { manifest, entries } = editionFiles(edition, "chrome");
    const names = new Set(entries.map((entry) => entry.name));
    const sw = text(entries, manifest.background.service_worker);
    const offscreen = text(entries, "offscreen.html");
    const referenced = [
      manifest.background.service_worker,
      manifest.action.default_popup,
      manifest.options_ui.page,
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
      ...[...sw.match(/importScripts\(([^)]*)\)/)[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]),
      ...[...offscreen.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1])
    ];
    for (const file of referenced) assert.ok(names.has(file), `${edition} 缺少 ${file}`);
    // PNG 图标的实际尺寸要和 manifest 里写的一致。
    for (const [size, file] of Object.entries(manifest.icons)) {
      const png = entries.find((entry) => entry.name === file).data;
      assert.equal(png.readUInt32BE(16), Number(size), `${file} 宽度`);
      assert.equal(png.readUInt32BE(20), Number(size), `${file} 高度`);
    }
  }
});

test("Chrome 要求扩展名不超过 75 个字符、简介不超过 132 个字符", () => {
  for (const edition of ["private", "public"]) {
    for (const target of ["firefox", "chrome"]) {
      const { entries } = editionFiles(edition, target);
      for (const locale of ["en", "zh_CN", "zh_TW"]) {
        const messages = JSON.parse(text(entries, `_locales/${locale}/messages.json`));
        assert.ok([...messages.extensionName.message].length <= 75, `${edition} ${locale} 名称过长`);
        assert.ok([...messages.extensionDescription.message].length <= 132, `${edition} ${locale} 简介过长`);
      }
    }
  }
});

test("Firefox 安装包不含 Chrome 专用文件，Chrome 安装包能被解析", async () => {
  const firefoxNames = editionFiles("public", "firefox").entries.map((entry) => entry.name);
  assert.ok(!firefoxNames.some((name) => /^(chrome\/|background-sw\.js|offscreen\.|platform-chrome\.js|icons\/icon-\d+\.png)/.test(name)));
  assert.ok(firefoxNames.includes("firefox-referer.js"));

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixiv-build-chrome-"));
  try {
    const { output, files } = buildEdition("public", outDir, "chrome");
    assert.match(path.basename(output), /^open-tabs-downloader-for-pixiv-.+-public-chrome\.zip$/);
    const bytes = new Uint8Array(fs.readFileSync(output));
    const entries = findZipEntries(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    assert.deepEqual(entries.map((entry) => entry.filename), files);
    const manifest = JSON.parse(new TextDecoder().decode(await inflateEntry(bytes, entries.find((entry) => entry.filename === "manifest.json"))));
    assert.equal(manifest.manifest_version, 3);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
