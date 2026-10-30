(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PixivMetadata = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const I18n = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./i18n.js")
    : globalThis.PixivI18n;
  const t = (key, params) => (I18n ? I18n.t(key, params) : key);

  // 把标签、作者、作品链接以 XMP 写进 JPG / PNG / GIF，不改动像素数据。
  const XMP_JPEG_HEADER = "http://ns.adobe.com/xap/1.0/\0";
  const XMP_PNG_KEYWORD = "XML:com.adobe.xmp";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("latin1");

  function escapeXml(value) {
    return String(value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // keywords 可以是字符串，也可以是分组（如 [标签原名, 译名]）；精简时按组整体删除。
  function keywordGroups(keywords) {
    return (keywords || []).map((item) => Array.isArray(item) ? item : [item]);
  }

  function uniqueKeywords(keywords) {
    const seen = new Set();
    const result = [];
    for (const keyword of keywordGroups(keywords).flat()) {
      const value = String(keyword || "").trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
    return result;
  }

  function bag(items) {
    return `<rdf:Bag>${items.map((item) => `<rdf:li>${escapeXml(item)}</rdf:li>`).join("")}</rdf:Bag>`;
  }

  // dc:subject 是通用的关键词字段；MicrosoftPhoto:LastKeywordXMP 是给 Windows 的同一组值。
  // 实测 Windows 只有 dc:subject 也能显示“标记”，所以空间不够时可以省掉后者（windowsKeywords: false）。
  function buildXmp({ keywords, creator, source } = {}, { windowsKeywords = true } = {}) {
    const tags = uniqueKeywords(keywords);
    const fields = [];
    if (tags.length) {
      fields.push(`<dc:subject>${bag(tags)}</dc:subject>`);
      if (windowsKeywords) fields.push(`<MicrosoftPhoto:LastKeywordXMP>${bag(tags)}</MicrosoftPhoto:LastKeywordXMP>`);
    }
    if (creator) fields.push(`<dc:creator><rdf:Seq><rdf:li>${escapeXml(creator)}</rdf:li></rdf:Seq></dc:creator>`);
    if (source) {
      fields.push(`<dc:source>${escapeXml(source)}</dc:source>`);
      fields.push(`<dc:identifier>${escapeXml(source)}</dc:identifier>`);
      // Windows 资源管理器把 exif:UserComment 显示为“备注”。
      fields.push(`<exif:UserComment><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(source)}</rdf:li></rdf:Alt></exif:UserComment>`);
    }
    return [
      '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      '<rdf:Description rdf:about=""',
      ' xmlns:dc="http://purl.org/dc/elements/1.1/"',
      ' xmlns:exif="http://ns.adobe.com/exif/1.0/"',
      ' xmlns:MicrosoftPhoto="http://ns.microsoft.com/photo/1.0/">',
      ...fields,
      "</rdf:Description>",
      "</rdf:RDF>",
      "</x:xmpmeta>",
      '<?xpacket end="w"?>'
    ].join("\n");
  }

  function concat(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  function startsWith(bytes, offset, signature) {
    if (offset + signature.length > bytes.length) return false;
    for (let index = 0; index < signature.length; index += 1) {
      if (bytes[offset + index] !== signature[index]) return false;
    }
    return true;
  }

  function detectFormat(bytes) {
    if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return "jpeg";
    if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
    if (startsWith(bytes, 0, [0x47, 0x49, 0x46, 0x38])) return "gif";
    return "";
  }

  // ---- JPEG：XMP 必须放进单个 APP1 段（上限约 64 KB），超出时逐步精简 ----
  const JPEG_XMP_LIMIT = 0xffff - 2 - XMP_JPEG_HEADER.length;

  function fitsJpeg(xmp) {
    return encoder.encode(xmp).length <= JPEG_XMP_LIMIT;
  }

  // 依次尝试：完整写入 → 去掉重复的 Windows 关键词副本 → 从末尾按组删标签（二分查找能保留的最多组数）。
  // 作者和链接始终保留；连 0 个标签都放不下才报错。返回 { xmp, omitted }，omitted 是删掉的组数。
  function fitJpegXmp(metadata) {
    const full = buildXmp(metadata);
    if (fitsJpeg(full)) return { xmp: full, omitted: 0 };
    const compact = buildXmp(metadata, { windowsKeywords: false });
    if (fitsJpeg(compact)) return { xmp: compact, omitted: 0 };

    const groups = keywordGroups(metadata.keywords);
    const build = (count) => buildXmp({ ...metadata, keywords: groups.slice(0, count) }, { windowsKeywords: false });
    if (!fitsJpeg(build(0))) throw new Error(t("metadataTooLarge"));
    let low = 0;
    let high = groups.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fitsJpeg(build(middle))) low = middle;
      else high = middle - 1;
    }
    return { xmp: build(low), omitted: groups.length - low };
  }

  // ---- JPEG：在 APP0/APP1(Exif) 之后插入 XMP APP1，原有 XMP 段会被替换 ----
  function embedJpeg(bytes, xmp) {
    const payload = concat([encoder.encode(XMP_JPEG_HEADER), encoder.encode(xmp)]);
    if (payload.length + 2 > 0xffff) throw new Error(t("metadataTooLarge"));
    const segment = new Uint8Array(4 + payload.length);
    segment.set([0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff]);
    segment.set(payload, 4);

    const kept = [];
    let insertAt = 2;
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      // 遇到 SOS 或非 APPn/COM 段就停止扫描，后面是图像数据。
      if (marker === 0xda || !((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) break;
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      const end = offset + 2 + length;
      if (length < 2 || end > bytes.length) break;
      const isXmp = marker === 0xe1 &&
        decoder.decode(bytes.subarray(offset + 4, Math.min(end, offset + 4 + XMP_JPEG_HEADER.length))) === XMP_JPEG_HEADER;
      if (isXmp) {
        kept.push([offset, end]);
      } else if (marker === 0xe0 || marker === 0xe1) {
        if (!kept.length) insertAt = end;
      }
      offset = end;
    }

    const parts = [bytes.subarray(0, insertAt), segment];
    let cursor = insertAt;
    for (const [start, end] of kept) {
      if (start < cursor) continue;
      parts.push(bytes.subarray(cursor, start));
      cursor = end;
    }
    parts.push(bytes.subarray(cursor));
    return concat(parts);
  }

  // ---- PNG：在 IHDR 之后插入 iTXt(XML:com.adobe.xmp)，原有 XMP 块会被移除 ----
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function uint32(value) {
    return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  }

  function pngChunk(type, data) {
    const typeAndData = concat([encoder.encode(type), data]);
    return concat([uint32(data.length), typeAndData, uint32(crc32(typeAndData))]);
  }

  function embedPng(bytes, xmp) {
    const data = concat([
      encoder.encode(XMP_PNG_KEYWORD),
      Uint8Array.of(0, 0, 0, 0, 0),
      encoder.encode(xmp)
    ]);
    const chunk = pngChunk("iTXt", data);
    const parts = [bytes.subarray(0, 8)];
    let offset = 8;
    let inserted = false;
    while (offset + 12 <= bytes.length) {
      const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
      const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
      const end = offset + 12 + length;
      if (end > bytes.length) throw new Error(t("pngChunkCorrupt"));
      const isXmp = type === "iTXt" &&
        decoder.decode(bytes.subarray(offset + 8, offset + 8 + XMP_PNG_KEYWORD.length + 1)) === `${XMP_PNG_KEYWORD}\0`;
      if (!isXmp) parts.push(bytes.subarray(offset, end));
      if (type === "IHDR" && !inserted) {
        parts.push(chunk);
        inserted = true;
      }
      offset = end;
      if (type === "IEND") break;
    }
    if (!inserted) throw new Error(t("pngNoIhdr"));
    return concat(parts);
  }

  // ---- GIF：在全局调色板之后插入 "XMP DataXMP" 应用扩展（含 258 字节魔术尾） ----
  function embedGif(bytes, xmp) {
    if (bytes.length < 13) throw new Error(t("gifTooShort"));
    const packed = bytes[10];
    const insertAt = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0);
    if (insertAt > bytes.length) throw new Error(t("gifPaletteOverflow"));
    const trailer = new Uint8Array(258);
    trailer[0] = 0x01;
    for (let index = 0; index < 256; index += 1) trailer[index + 1] = 0xff - index;
    trailer[257] = 0x00;
    const extension = concat([
      Uint8Array.of(0x21, 0xff, 0x0b),
      encoder.encode("XMP DataXMP"),
      encoder.encode(xmp),
      trailer
    ]);
    return concat([bytes.subarray(0, insertAt), extension, bytes.subarray(insertAt)]);
  }

  // 返回 { bytes, omitted }：omitted > 0 表示为了放进 JPG 删掉了末尾的若干组标签。
  function embedXmpDetailed(input, metadata) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const format = detectFormat(bytes);
    if (format === "jpeg") {
      const { xmp, omitted } = fitJpegXmp(metadata);
      return { bytes: embedJpeg(bytes, xmp), omitted };
    }
    if (format === "png") return { bytes: embedPng(bytes, buildXmp(metadata)), omitted: 0 };
    if (format === "gif") return { bytes: embedGif(bytes, buildXmp(metadata)), omitted: 0 };
    return { bytes, omitted: 0 };
  }

  function embedXmp(input, metadata) {
    return embedXmpDetailed(input, metadata).bytes;
  }

  function mimeType(bytes) {
    const format = detectFormat(bytes);
    if (format === "jpeg") return "image/jpeg";
    if (format === "png") return "image/png";
    if (format === "gif") return "image/gif";
    return "application/octet-stream";
  }

  // ---- 完整性检查：按格式逐段走到结尾标志，找不到就说明文件没下载完 ----

  // JPG：逐段跳过，压缩数据里的 FF00 / RSTn 不是段标记；走到 EOI(FFD9) 才算完整。
  // EOI 之后的附加数据（部分软件会追加）不影响判断。
  function jpegComplete(bytes) {
    const length = bytes.length;
    let offset = 2;
    while (offset + 1 < length) {
      if (bytes[offset] !== 0xff) return false;
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd9) return true;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (offset + 4 > length) return false;
      const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (segmentLength < 2) return false;
      offset += 2 + segmentLength;
      if (offset > length) return false;
      if (marker === 0xda) {
        while (offset + 1 < length) {
          if (bytes[offset] === 0xff) {
            const next = bytes[offset + 1];
            if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
              offset += 2;
              continue;
            }
            if (next === 0xff) {
              offset += 1;
              continue;
            }
            break;
          }
          offset += 1;
        }
      }
    }
    return false;
  }

  // PNG：按声明长度逐块跳过，完整走到 IEND 块才算完整。
  function pngComplete(bytes) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
      const end = offset + 12 + length;
      if (end > bytes.length) return false;
      if (decoder.decode(bytes.subarray(offset + 4, offset + 8)) === "IEND") return true;
      offset = end;
    }
    return false;
  }

  function skipSubBlocks(bytes, offset) {
    while (offset < bytes.length) {
      const size = bytes[offset];
      offset += 1;
      if (size === 0) return offset;
      offset += size;
    }
    return -1;
  }

  // GIF：逐个跳过扩展块和图像块，走到结束符 0x3B 才算完整。
  function gifComplete(bytes) {
    if (bytes.length < 13) return false;
    const packed = bytes[10];
    let offset = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0);
    while (offset < bytes.length) {
      const introducer = bytes[offset];
      if (introducer === 0x3b) return true;
      if (introducer === 0x21) {
        offset = skipSubBlocks(bytes, offset + 2);
      } else if (introducer === 0x2c) {
        if (offset + 10 > bytes.length) return false;
        const local = bytes[offset + 9];
        offset += 10 + (local & 0x80 ? 3 * (1 << ((local & 0x07) + 1)) : 0) + 1;
        offset = skipSubBlocks(bytes, offset);
      } else {
        return false;
      }
      if (offset < 0) return false;
    }
    return false;
  }

  function describeUnknown(bytes) {
    if (!bytes.length) return t("emptyResponse");
    const head = decoder.decode(bytes.subarray(0, 256)).trimStart().toLowerCase();
    if (head.startsWith("<")) return t("htmlResponse");
    return t("notImage");
  }

  // 返回空字符串表示通过；否则返回问题描述（都属于下载问题，值得重试）。
  function checkImage(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const format = detectFormat(bytes);
    if (!format) return describeUnknown(bytes);
    if (format === "jpeg" && !jpegComplete(bytes)) return t("jpgIncomplete");
    if (format === "png" && !pngComplete(bytes)) return t("pngIncomplete");
    if (format === "gif" && !gifComplete(bytes)) return t("gifIncomplete");
    return "";
  }

  return { buildXmp, detectFormat, embedXmp, embedXmpDetailed, mimeType, crc32, checkImage };
});
