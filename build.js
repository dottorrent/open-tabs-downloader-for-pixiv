"use strict";

// 把 src/ 打包成未签名的 xpi，分“私人版”和“公开版”两个版本：
//   node build.js            两个版本都打包
//   node build.js public     只打包公开版
// 两个版本共用同一份源码，差异只在打包时套用（见 EDITIONS）。
// Firefox 要求 zip 内路径使用 "/"，所以这里自己写 zip，不依赖 Compress-Archive。
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
    // 名称和简介写在 _locales 里，管理页和商店按浏览器语言显示。
    messages: {
      en: {
        extensionName: "Open Tabs Downloader for Pixiv",
        extensionDescription: "Download the original images of every open pixiv artwork tab: folders by tag, tags written into image metadata, size filter, animations as GIF / APNG / original frames. Not made by pixiv."
      },
      zh_CN: PUBLIC_ZH,
      zh_TW: PUBLIC_ZH
    }
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

// 返回某个版本的全部文件内容（不写盘），供打包和测试使用。
function editionFiles(editionName) {
  const edition = EDITIONS[editionName];
  if (!edition) throw new Error(`未知版本：${editionName}（可选 ${Object.keys(EDITIONS).join(" / ")}）`);
  const manifest = edition.manifest(JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8")));
  const entries = listFiles(SRC).map((name) => {
    let data = fs.readFileSync(path.join(SRC, name));
    if (name === "manifest.json") data = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    const locale = name.match(/^_locales\/([^/]+)\/messages\.json$/);
    if (locale && edition.messages[locale[1]]) {
      const messages = JSON.parse(data.toString("utf8"));
      for (const [key, message] of Object.entries(edition.messages[locale[1]])) messages[key].message = message;
      data = Buffer.from(JSON.stringify(messages, null, 2) + "\n");
    }
    return { name, data };
  });
  // 许可证放在项目根目录（开源仓库的惯例），打包时一并放进安装包。
  entries.push({ name: "LICENSE", data: fs.readFileSync(path.join(__dirname, "LICENSE")) });
  return { manifest, entries, names: { en: localizedName(entries, "en"), zh: localizedName(entries, "zh_CN") } };
}

function buildEdition(editionName, outDir = DIST) {
  const { manifest, entries, names } = editionFiles(editionName);
  fs.mkdirSync(outDir, { recursive: true });
  const output = path.join(outDir, `${EDITIONS[editionName].filePrefix}-${manifest.version}-${editionName}-unsigned.xpi`);
  fs.writeFileSync(output, buildZip(entries));
  return { output, manifest, names, files: entries.map((entry) => entry.name) };
}

module.exports = { EDITIONS, editionFiles, buildEdition };

if (require.main === module) {
  const requested = process.argv.slice(2);
  for (const editionName of requested.length ? requested : Object.keys(EDITIONS)) {
    const { output, manifest, names, files } = buildEdition(editionName);
    console.log(`[${editionName}] ${names.zh} / ${names.en} ${manifest.version}\n  ${output}\n  ${files.length} files`);
  }
}
