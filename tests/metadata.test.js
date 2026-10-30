"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/metadata.js");
const { GifEncoder } = require("../src/ugoira.js");

const META = { keywords: ["原神", "Genshin Impact", "原神", "A&B <x>"], creator: "作者", source: "https://www.pixiv.net/artworks/1" };
const text = (bytes) => Buffer.from(bytes).toString("utf8");
const bytes = (...parts) => Buffer.concat(parts.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part)));

test("buildXmp 去重并转义关键词，写入作者与链接", () => {
  const xmp = M.buildXmp(META);
  assert.equal((xmp.match(/<rdf:li>原神<\/rdf:li>/g) || []).length, 2, "dc:subject 与 LastKeywordXMP 各一次");
  assert.match(xmp, /<rdf:li>A&amp;B &lt;x&gt;<\/rdf:li>/);
  assert.match(xmp, /<dc:creator><rdf:Seq><rdf:li>作者<\/rdf:li>/);
  assert.match(xmp, /<exif:UserComment><rdf:Alt><rdf:li xml:lang="x-default">https:\/\/www\.pixiv\.net\/artworks\/1</);
  assert.doesNotMatch(M.buildXmp({}), /dc:subject|dc:creator|dc:source/);
});

function segment(marker, payload) {
  const body = Buffer.from(payload);
  const head = Buffer.from([0xff, marker, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff]);
  return Buffer.concat([head, body]);
}

test("JPG：XMP 插在 APP0/Exif 之后，旧 XMP 被替换，其余字节不变", () => {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = segment(0xe0, "JFIF\0\x01\x01\0\0\x01\0\x01\0\0");
  const exif = segment(0xe1, "Exif\0\0MM\0*");
  const oldXmp = segment(0xe1, "http://ns.adobe.com/xap/1.0/\0<old/>");
  const icc = segment(0xe2, "ICC_PROFILE\0data");
  const tail = Buffer.from([0xff, 0xdb, 0x00, 0x03, 0x01, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
  const input = bytes(soi, app0, exif, oldXmp, icc, tail);
  const output = Buffer.from(M.embedXmp(input, META));

  const xmpStart = soi.length + app0.length + exif.length;
  assert.deepEqual(output.subarray(0, xmpStart), input.subarray(0, xmpStart));
  assert.deepEqual([...output.subarray(xmpStart, xmpStart + 2)], [0xff, 0xe1]);
  const xmpLength = output.readUInt16BE(xmpStart + 2);
  assert.match(text(output.subarray(xmpStart + 4, xmpStart + 2 + xmpLength)), /^http:\/\/ns\.adobe\.com\/xap\/1\.0\/\0<\?xpacket/);
  assert.deepEqual(output.subarray(xmpStart + 2 + xmpLength), bytes(icc, tail));
  assert.ok(!text(output).includes("<old/>"));
});

function pngChunk(type, data) {
  const body = Buffer.from(data);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(M.crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function readChunks(buffer) {
  const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const crc = buffer.readUInt32BE(offset + 8 + length);
    chunks.push({ type, data, crcOk: crc === M.crc32(buffer.subarray(offset + 4, offset + 8 + length)) });
    offset += 12 + length;
  }
  return chunks;
}

test("PNG：iTXt XMP 紧跟 IHDR，CRC 正确，旧 XMP 被移除", () => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const input = bytes(
    signature,
    pngChunk("IHDR", Buffer.alloc(13, 1)),
    pngChunk("iTXt", "XML:com.adobe.xmp\0\0\0\0\0<old/>"),
    pngChunk("tEXt", "Software\0x"),
    pngChunk("IDAT", Buffer.from([1, 2, 3])),
    pngChunk("IEND", "")
  );
  const chunks = readChunks(Buffer.from(M.embedXmp(input, META)));
  assert.deepEqual(chunks.map((chunk) => chunk.type), ["IHDR", "iTXt", "tEXt", "IDAT", "IEND"]);
  assert.ok(chunks.every((chunk) => chunk.crcOk));
  assert.match(text(chunks[1].data), /^XML:com\.adobe\.xmp\0\0\0\0\0<\?xpacket[\s\S]*Genshin Impact/);
});

test("GIF：XMP 应用扩展插在全局调色板之后，并带魔术尾", () => {
  const encoder = new GifEncoder(2, 2);
  encoder.addFrame(Uint8Array.of(0, 1, 2, 3), 100);
  const input = encoder.finishBytes();
  const output = Buffer.from(M.embedXmp(input, META));
  const insertAt = 13 + 256 * 3;
  assert.deepEqual(output.subarray(0, insertAt), Buffer.from(input.subarray(0, insertAt)));
  assert.equal(output.toString("latin1", insertAt + 3, insertAt + 14), "XMP DataXMP");
  const trailerEnd = output.length - (input.length - insertAt);
  const trailer = output.subarray(trailerEnd - 258, trailerEnd);
  assert.equal(trailer[0], 0x01);
  assert.equal(trailer[1], 0xff);
  assert.equal(trailer[256], 0x00);
  assert.equal(trailer[257], 0x00);
  assert.deepEqual(output.subarray(trailerEnd), Buffer.from(input.subarray(insertAt)));
});

test("未知格式原样返回", () => {
  const input = Uint8Array.of(1, 2, 3, 4);
  assert.deepEqual(M.embedXmp(input, META), input);
  assert.equal(M.detectFormat(input), "");
  assert.equal(M.mimeType(input), "application/octet-stream");
});

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const seg = (marker, ...payload) => [0xff, marker, 0x00, payload.length + 2, ...payload];
// 压缩数据里含有 FF00（转义）和 FFD0（RST 标记），都不是段结束。
const SCAN = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];
const BASELINE = Uint8Array.from([...SOI, ...seg(0xe0, 1, 2), ...seg(0xdb, 0), ...seg(0xc0, 8), ...seg(0xc4, 0), ...seg(0xda, 1, 0), ...SCAN, ...EOI]);
const PROGRESSIVE = Uint8Array.from([...SOI, ...seg(0xc2, 8), ...seg(0xc4, 0), ...seg(0xda, 1, 0), ...SCAN, ...seg(0xc4, 1), ...seg(0xda, 2, 0), ...SCAN, ...EOI]);

test("checkImage：完整的基线 / 渐进式 JPG 通过，EOI 之后有附加数据也通过", () => {
  assert.equal(M.checkImage(BASELINE), "");
  assert.equal(M.checkImage(PROGRESSIVE), "");
  assert.equal(M.checkImage(Uint8Array.from([...BASELINE, 0, 0, 0x41, 0x42])), "");
});

test("checkImage：截断的 JPG 在任意位置都能发现", () => {
  for (const sample of [BASELINE, PROGRESSIVE]) {
    for (let length = 3; length < sample.length; length += 1) {
      assert.notEqual(M.checkImage(sample.subarray(0, length)), "", `截断到 ${length} 字节未被发现`);
    }
  }
});

test("checkImage：PNG 与 GIF 必须走到结尾标志", () => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = Buffer.concat([signature, pngChunk("IHDR", Buffer.alloc(13)), pngChunk("IDAT", Buffer.alloc(40, 7)), pngChunk("IEND", "")]);
  assert.equal(M.checkImage(png), "");
  assert.equal(M.checkImage(png.subarray(0, png.length - 12)), "PNG 文件不完整（缺少 IEND 块）");
  assert.equal(M.checkImage(png.subarray(0, 40)), "PNG 文件不完整（缺少 IEND 块）");

  const encoder = new GifEncoder(4, 4);
  encoder.addFrame(new Uint8Array(16).fill(3), 50);
  encoder.addFrame(new Uint8Array(16).fill(9), 50);
  const gif = encoder.finishBytes();
  assert.equal(M.checkImage(gif), "");
  assert.equal(M.checkImage(M.embedXmp(gif, META)), "", "写入 XMP 后的 GIF 仍可完整解析");
  assert.equal(M.checkImage(gif.subarray(0, gif.length - 1)), "GIF 文件不完整（缺少结束符）");
});

test("checkImage：识别网页、空内容和其他格式", () => {
  assert.equal(M.checkImage(Buffer.from("  <!DOCTYPE html><html>")), "服务器返回了网页而不是图片");
  assert.equal(M.checkImage(new Uint8Array(0)), "服务器返回了空内容");
  assert.equal(M.checkImage(Buffer.from("RIFF....WEBP")), "内容不是 JPG / PNG / GIF 图片");
});

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0xd9]);
const xmpSegmentLength = (bytes) => (bytes[4] << 8) | bytes[5];
const groupsOf = (count, size) => Array.from({ length: count }, (_, index) => [`标签${index}${"字".repeat(size)}`, `tr${index}`]);

test("JPG：只超出一点时先去掉 Windows 副本，一个标签都不删", () => {
  // 单份约 40 KB：两份超限，一份放得下。
  const metadata = { keywords: groupsOf(400, 30), creator: "作者", source: "https://www.pixiv.net/artworks/1" };
  assert.ok(new TextEncoder().encode(M.buildXmp(metadata)).length > 65535);
  const { bytes, omitted } = M.embedXmpDetailed(JPEG, metadata);
  const xml = Buffer.from(bytes).toString("utf8");
  assert.equal(omitted, 0);
  assert.ok(!xml.includes("LastKeywordXMP"));
  assert.ok(xml.includes("<rdf:li>tr399</rdf:li>"));
  assert.equal(M.checkImage(bytes), "");
});

test("JPG：超出很多时按组从末尾删除，保留尽可能多的标签", () => {
  const metadata = { keywords: groupsOf(2000, 30), creator: "作者", source: "s" };
  const { bytes, omitted } = M.embedXmpDetailed(JPEG, metadata);
  const kept = 2000 - omitted;
  const xml = Buffer.from(bytes).toString("utf8");
  assert.ok(omitted > 0);
  assert.ok(xml.includes(`<rdf:li>tr${kept - 1}</rdf:li>`));
  assert.ok(!xml.includes(`<rdf:li>tr${kept}</rdf:li>`));
  assert.ok(xmpSegmentLength(bytes) <= 0xffff);
  // 再多保留一组就会超限，说明保留数量已经是最大值。
  const oneMore = M.buildXmp({ ...metadata, keywords: metadata.keywords.slice(0, kept + 1) }, { windowsKeywords: false });
  assert.ok(new TextEncoder().encode(oneMore).length > 0xffff - 2 - 29);
});

test("JPG：连作者和链接都放不下时才报错；PNG 不受 64 KB 限制", () => {
  assert.throws(() => M.embedXmpDetailed(JPEG, { keywords: ["a"], creator: "x".repeat(70000) }), /元数据过大/);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = Buffer.concat([signature, pngChunk("IHDR", Buffer.alloc(13)), pngChunk("IDAT", Buffer.alloc(4)), pngChunk("IEND", "")]);
  const result = M.embedXmpDetailed(png, { keywords: groupsOf(2000, 30) });
  assert.equal(result.omitted, 0);
  assert.ok(Buffer.from(result.bytes).toString("utf8").includes("<rdf:li>tr1999</rdf:li>"));
});
