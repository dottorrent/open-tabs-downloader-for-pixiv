"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../src/ugoira.js");
const { checkImage } = require("../src/metadata.js");

// 测试用的 GIF LZW 解码器：验证编码器输出能逐像素还原。
function lzwDecode(data, minimumCodeSize, pixelCount) {
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minimumCodeSize + 1;
  let dictionary = [];
  const reset = () => {
    dictionary = Array.from({ length: clearCode }, (_, index) => [index]);
    dictionary.push(null, null);
    codeSize = minimumCodeSize + 1;
  };
  reset();
  const output = [];
  let previous = null;
  let bitBuffer = 0;
  let bitCount = 0;
  let offset = 0;
  while (output.length < pixelCount) {
    while (bitCount < codeSize) {
      bitBuffer |= data[offset++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuffer & ((1 << codeSize) - 1);
    bitBuffer >>>= codeSize;
    bitCount -= codeSize;
    if (code === clearCode) {
      reset();
      previous = null;
      continue;
    }
    if (code === endCode) break;
    let entry;
    if (code < dictionary.length) entry = dictionary[code];
    else entry = [...previous, previous[0]];
    output.push(...entry);
    if (previous && dictionary.length < 4096) dictionary.push([...previous, entry[0]]);
    if (dictionary.length === (1 << codeSize) && codeSize < 12) codeSize += 1;
    previous = entry;
  }
  return Uint8Array.from(output);
}

function gradientFrame(width, height, shift = 0) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      rgba[p] = Math.round(255 * x / (width - 1));
      rgba[p + 1] = Math.round(255 * y / (height - 1));
      rgba[p + 2] = (x * 3 + y * 5 + shift) & 255;
      rgba[p + 3] = 255;
    }
  }
  return rgba;
}

function meanSquaredError(rgba, indices, palette) {
  let sum = 0;
  for (let i = 0; i < indices.length; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const error = rgba[i * 4 + c] - palette[indices[i] * 3 + c];
      sum += error * error;
    }
  }
  return sum / (indices.length * 3);
}

test("调色板：颜色不超过 256 种时完全还原，量化零误差", () => {
  const colors = [[12, 200, 31], [250, 250, 250], [0, 0, 0], [128, 64, 255]];
  const width = 16;
  const height = 8;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba.set([...colors[i % colors.length], 255], i * 4);
  }
  const histogram = U.createHistogram();
  U.addToHistogram(histogram, rgba);
  const { palette, size } = U.buildPalette(histogram);
  assert.equal(size, 4);
  const found = Array.from({ length: size }, (_, i) => [...palette.subarray(i * 3, i * 3 + 3)]);
  for (const color of colors) assert.ok(found.some((entry) => entry.join() === color.join()), `缺少 ${color}`);
  const indices = U.createQuantizer(palette, size, 1)(rgba, width, height);
  assert.equal(meanSquaredError(rgba, indices, palette), 0);
});

test("渐变：自适应调色板 + 抖动的误差远小于旧的固定 3-3-2 调色板", () => {
  const width = 96;
  const height = 64;
  const rgba = gradientFrame(width, height);
  const oldError = meanSquaredError(rgba, U.rgbaToPalette332(rgba), U.createPalette332());

  const histogram = U.createHistogram();
  U.addToHistogram(histogram, rgba);
  const { palette, size } = U.buildPalette(histogram);
  const plain = meanSquaredError(rgba, U.createQuantizer(palette, size, 0)(rgba, width, height), palette);
  const dithered = meanSquaredError(rgba, U.createQuantizer(palette, size, 0.5)(rgba, width, height), palette);
  assert.ok(plain * 4 < oldError, `不抖动 ${plain.toFixed(1)} vs 旧 ${oldError.toFixed(1)}`);
  assert.ok(dithered * 4 < oldError, `抖动 ${dithered.toFixed(1)} vs 旧 ${oldError.toFixed(1)}`);
  assert.ok(size <= 256);
});

test("encodeFramesToGif：两遍处理，写入专属调色板，抖动后的帧能逐像素解码还原", async () => {
  const width = 64;
  const height = 48;
  const frames = [0, 40, 80].map((shift) => gradientFrame(width, height, shift));
  let passes = 0;
  const encoder = await U.encodeFramesToGif(async (callback) => {
    passes += 1;
    for (const rgba of frames) await callback(rgba, width, height, { delay: 100 }, frames.length);
  });
  assert.equal(passes, 2);
  const bytes = encoder.finishBytes();
  assert.equal(checkImage(bytes), "");

  const palette = bytes.subarray(13, 13 + 768);
  assert.notDeepEqual([...palette], [...U.createPalette332()], "不再是固定 3-3-2 调色板");

  // 逐帧找到图像块，解码 LZW，与同一调色板重新量化的结果比较。
  const histogram = U.createHistogram();
  for (const rgba of frames) U.addToHistogram(histogram, rgba);
  const expectedQuantize = U.createQuantizer(palette, U.buildPalette(histogram).size, 0.5);
  let offset = 13 + 768;
  let frameIndex = 0;
  while (bytes[offset] !== 0x3b) {
    if (bytes[offset] === 0x21) {
      offset += 2;
      while (bytes[offset]) offset += bytes[offset] + 1;
      offset += 1;
      continue;
    }
    assert.equal(bytes[offset], 0x2c);
    const minimumCodeSize = bytes[offset + 10];
    offset += 11;
    const chunks = [];
    while (bytes[offset]) {
      chunks.push(bytes.subarray(offset + 1, offset + 1 + bytes[offset]));
      offset += bytes[offset] + 1;
    }
    offset += 1;
    const data = Uint8Array.from(chunks.flatMap((chunk) => [...chunk]));
    const decoded = lzwDecode(data, minimumCodeSize, width * height);
    assert.deepEqual(decoded, expectedQuantize(frames[frameIndex], width, height), `第 ${frameIndex} 帧还原不一致`);
    frameIndex += 1;
  }
  assert.equal(frameIndex, frames.length);
});

test("lzwEncode：大面积噪声数据（字典多次写满重置）也能正确还原", () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
  const indices = Uint8Array.from({ length: 200000 }, () => random());
  assert.deepEqual(lzwDecode(U.lzwEncode(indices, 8), 8, indices.length), indices);
});

// 测试用的 APNG 解码：逐块解析、zlib 解压、按滤波类型还原扫描线。
function decodeApng(bytes) {
  const zlib = require("node:zlib");
  const buffer = Buffer.from(bytes);
  const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    chunks.push({ type: buffer.toString("latin1", offset + 4, offset + 8), data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  const header = chunks[0].data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const channels = header[9] === 6 ? 4 : 3;
  const sequence = [];
  const frames = [];
  let current = null;
  for (const chunk of chunks) {
    if (chunk.type === "fcTL") {
      sequence.push(chunk.data.readUInt32BE(0));
      current = { delay: chunk.data.readUInt16BE(20) / chunk.data.readUInt16BE(22) * 1000, data: [] };
      frames.push(current);
    } else if (chunk.type === "IDAT") {
      current.data.push(chunk.data);
    } else if (chunk.type === "fdAT") {
      sequence.push(chunk.data.readUInt32BE(0));
      current.data.push(chunk.data.subarray(4));
    }
  }
  const rowLength = width * channels;
  const pixels = frames.map((frame) => {
    const raw = zlib.inflateSync(Buffer.concat(frame.data));
    const out = new Uint8Array(height * rowLength);
    for (let y = 0; y < height; y += 1) {
      const type = raw[y * (rowLength + 1)];
      for (let i = 0; i < rowLength; i += 1) {
        const value = raw[y * (rowLength + 1) + 1 + i];
        const left = i >= channels ? out[y * rowLength + i - channels] : 0;
        const up = y ? out[(y - 1) * rowLength + i] : 0;
        const upLeft = y && i >= channels ? out[(y - 1) * rowLength + i - channels] : 0;
        let predicted = 0;
        if (type === 1) predicted = left;
        else if (type === 2) predicted = up;
        else if (type === 3) predicted = (left + up) >> 1;
        else if (type === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft);
          predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        out[y * rowLength + i] = (value + predicted) & 0xff;
      }
    }
    return out;
  });
  const actl = chunks.find((chunk) => chunk.type === "acTL").data;
  return { width, height, channels, frames, pixels, sequence, frameCount: actl.readUInt32BE(0), plays: actl.readUInt32BE(4) };
}

function dropAlpha(rgba) {
  const rgb = new Uint8Array(rgba.length / 4 * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) rgb.set(rgba.subarray(i, i + 3), j);
  return rgb;
}

test("APNG：不透明帧用 RGB，逐像素无损；序号连续、帧时长正确、无限循环", async () => {
  const width = 37;
  const height = 23;
  const frames = [0, 50, 100, 150].map((shift) => gradientFrame(width, height, shift));
  const bytes = await U.encodeFramesToApng(async (callback) => {
    for (const [index, rgba] of frames.entries()) await callback(rgba, width, height, { delay: 60 + index * 10 }, frames.length);
  });
  assert.equal(checkImage(bytes), "");
  const decoded = decodeApng(bytes);
  assert.equal(decoded.channels, 3);
  assert.equal(decoded.frameCount, 4);
  assert.equal(decoded.plays, 0);
  assert.deepEqual(decoded.sequence, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(decoded.frames.map((frame) => Math.round(frame.delay)), [60, 70, 80, 90]);
  decoded.pixels.forEach((pixels, index) => assert.deepEqual(pixels, dropAlpha(frames[index]), `第 ${index} 帧不一致`));
});

test("APNG：带透明度的帧用 RGBA，逐像素无损", async () => {
  const width = 20;
  const height = 10;
  const rgba = gradientFrame(width, height);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = (i * 7) & 255;
  const bytes = await U.encodeFramesToApng(async (callback) => callback(rgba, width, height, { delay: 100 }, 1));
  const decoded = decodeApng(bytes);
  assert.equal(decoded.channels, 4);
  assert.deepEqual(decoded.pixels[0], rgba);
});

test("原始帧压缩包：存储方式写入，能被重新解析并逐字节取回", async () => {
  const files = [
    { name: "000000.jpg", bytes: Uint8Array.of(1, 2, 3) },
    { name: "animation.json", bytes: new TextEncoder().encode('{"frames":[]}') }
  ];
  const zip = U.buildStoredZip(files);
  const entries = U.findZipEntries(zip.buffer);
  assert.deepEqual(entries.map((entry) => entry.filename), ["000000.jpg", "animation.json"]);
  for (const [index, entry] of entries.entries()) {
    assert.equal(entry.compressionMethod, 0);
    assert.deepEqual(await U.inflateEntry(zip, entry), files[index].bytes);
  }
});
