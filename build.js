"use strict";

// 把 src/ 打包成未签名的安装包。两个维度：
//   版本（EDITIONS）：private 私人版 / public 公开版，名称和 ID 不同。
//   浏览器（TARGETS）：firefox（Manifest V2，.xpi）/ chrome（Manifest V3，.zip，Chrome 和 Edge 通用）。
//   node build.js                    全部打包（2 个版本 × 2 种浏览器）
//   node build.js public             只打包公开版（两种浏览器）
//   node build.js chrome             只打包 Chrome/Edge（两个版本）
//   node build.js public firefox     只打包公开版的 Firefox 安装包
// 所有版本共用同一份源码；src/chrome/ 里是 Chrome/Edge 专用文件，打包时放到安装包根目录。
// 浏览器要求 zip 内路径使用 "/"，所以这里自己写 zip，不依赖 Compress-Archive。
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SRC = path.join(__dirname, "src");
const DIST = path.join(__dirname, "dist");

const PUBLIC_ZH = {
  extensionName: "已打开作品批量下载器 for Pixiv",
  extensionDescription: "一键下载所有已打开的 Pixiv 作品页原图：按标签分文件夹、写入标签等元数据、按尺寸筛选、动图可存为 GIF / APNG / 原始帧。非 Pixiv 官方扩展。"
};

const EDITIONS = {
  // 私人版：沿用 src/ 里的名称（_locales）和 ID（仅自己可见的那个）。
  private: {
    filePrefix: "pixiv-open-tabs-downloader",
    manifest: (manifest) => manifest,
    messages: {}
  },
  // 公开版：新名称、新 ID，作为新的扩展提交到商店。
  // gecko_android 保留：它只规定 Android 版的最低版本（数据收集声明要求 ≥ 142，web-ext lint 会检查），
  // 是否在商店标为“兼容 Android”由提交时勾选决定。
  public: {
    filePrefix: "open-tabs-downloader-for-pixiv",
    manifest: (manifest) => {
      const result = JSON.parse(JSON.stringify(manifest));
      result.browser_specific_settings.gecko.id = "{834e8355-938e-4b17-b870-17a16a64c422}";
      return result;
    },
    // 名称和简介写在 _locales 里，管理页和商店按浏览器语言显示。Chrome 要求简介不超过 132 个字符。
    messages: {
      en: {
        extensionName: "Open Tabs Downloader for Pixiv",
        extensionDescription: "Download originals of every open pixiv artwork tab: tag folders, image metadata, size filter, GIF/APNG animations. Not by pixiv."
      },
      zh_CN: PUBLIC_ZH,
      zh_TW: PUBLIC_ZH
    }
  }
};

const CHROME_ICONS = { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" };

// Chrome / Edge 只接受 Manifest V3：后台改为 service worker，Referer 改用 declarativeNetRequest，
// 图标用 PNG，去掉 Firefox 专用的 browser_specific_settings。
function chromeManifest(source) {
  return {
    manifest_version: 3,
    name: source.name,
    description: source.description,
    default_locale: source.default_locale,
    version: source.version,
    icons: CHROME_ICONS,
    permissions: ["tabs", "downloads", "storage", "declarativeNetRequest", "offscreen"],
    host_permissions: source.permissions.filter((permission) => permission.includes("://")),
    background: { service_worker: "background-sw.js" },
    action: {
      default_title: source.browser_action.default_title,
      default_popup: source.browser_action.default_popup,
      default_icon: CHROME_ICONS
    },
    options_ui: source.options_ui,
    minimum_chrome_version: "116"
  };
}

const TARGETS = {
  firefox: {
    extension: "unsigned.xpi",
    manifest: (manifest) => manifest,
    // src/chrome/ 里的文件只属于 Chrome/Edge。
    include: (name) => !name.startsWith("chrome/"),
    rename: (name) => name
  },
  chrome: {
    extension: "chrome.zip",
    manifest: chromeManifest,
    // Firefox 用 webRequest 改 Referer 的脚本在 Chrome 里不需要（也不允许）。
    include: (name) => name !== "firefox-referer.js",
    rename: (name) => (name.startsWith("chrome/") ? name.slice("chrome/".length) : name)
  }
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function listFiles(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), relative) : [relative];
  }).sort();
}

// entries: [{ name, data: Buffer }]
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0x00210000, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function localizedName(entries, locale) {
  const entry = entries.find((item) => item.name === `_locales/${locale}/messages.json`);
  return entry ? JSON.parse(entry.data.toString("utf8")).extensionName.message : "";
}

// 返回某个版本、某种浏览器的全部文件内容（不写盘），供打包和测试使用。
function editionFiles(editionName, targetName = "firefox") {
  const edition = EDITIONS[editionName];
  if (!edition) throw new Error(`未知版本：${editionName}（可选 ${Object.keys(EDITIONS).join(" / ")}）`);
  const target = TARGETS[targetName];
  if (!target) throw new Error(`未知浏览器：${targetName}（可选 ${Object.keys(TARGETS).join(" / ")}）`);
  const manifest = target.manifest(edition.manifest(JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"))));
  const entries = listFiles(SRC).filter(target.include).map((sourceName) => {
    const name = target.rename(sourceName);
    let data = fs.readFileSync(path.join(SRC, sourceName));
    if (name === "manifest.json") data = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    const locale = name.match(/^_locales\/([^/]+)\/messages\.json$/);
    if (locale && edition.messages[locale[1]]) {
      const messages = JSON.parse(data.toString("utf8"));
      for (const [key, message] of Object.entries(edition.messages[locale[1]])) messages[key].message = message;
      data = Buffer.from(JSON.stringify(messages, null, 2) + "\n");
    }
    return { name, data };
  }).sort((a, b) => a.name.localeCompare(b.name));
  // 许可证放在项目根目录（开源仓库的惯例），打包时一并放进安装包。
  entries.push({ name: "LICENSE", data: fs.readFileSync(path.join(__dirname, "LICENSE")) });
  return { manifest, entries, names: { en: localizedName(entries, "en"), zh: localizedName(entries, "zh_CN") } };
}

function buildEdition(editionName, outDir = DIST, targetName = "firefox") {
  const { manifest, entries, names } = editionFiles(editionName, targetName);
  fs.mkdirSync(outDir, { recursive: true });
  const output = path.join(outDir, `${EDITIONS[editionName].filePrefix}-${manifest.version}-${editionName}-${TARGETS[targetName].extension}`);
  fs.writeFileSync(output, buildZip(entries));
  return { output, manifest, names, files: entries.map((entry) => entry.name) };
}

module.exports = { EDITIONS, TARGETS, editionFiles, buildEdition };

if (require.main === module) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => !EDITIONS[arg] && !TARGETS[arg]);
  if (unknown.length) throw new Error(`未知参数：${unknown.join(" ")}`);
  const editions = args.filter((arg) => EDITIONS[arg]);
  const targets = args.filter((arg) => TARGETS[arg]);
  for (const editionName of editions.length ? editions : Object.keys(EDITIONS)) {
    for (const targetName of targets.length ? targets : Object.keys(TARGETS)) {
      const { output, manifest, names, files } = buildEdition(editionName, DIST, targetName);
      console.log(`[${editionName} / ${targetName}] ${names.zh} / ${names.en} ${manifest.version}\n  ${output}\n  ${files.length} files`);
    }
  }
}
