(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PixivUgoira = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const I18n = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./i18n.js")
    : globalThis.PixivI18n;
  const t = (key, params) => (I18n ? I18n.t(key, params) : key);

  const textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;

  function readUint16(view, offset) {
    return view.getUint16(offset, true);
  }

  function readUint32(view, offset) {
    return view.getUint32(offset, true);
  }

  function decodeFilename(bytes) {
    if (textDecoder) return textDecoder.decode(bytes);
    return String.fromCharCode(...bytes);
  }

  function findZipEntries(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const minimumEocdOffset = Math.max(0, bytes.length - 65557);
    let eocdOffset = -1;

    for (let offset = bytes.length - 22; offset >= minimumEocdOffset; offset -= 1) {
      if (readUint32(view, offset) === 0x06054b50) {
        eocdOffset = offset;
        break;
      }
    }
    if (eocdOffset < 0) throw new Error(t("zipNoCentralDir"));

    const entryCount = readUint16(view, eocdOffset + 10);
    let offset = readUint32(view, eocdOffset + 16);
    const entries = [];

    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > bytes.length || readUint32(view, offset) !== 0x02014b50) {
        throw new Error(t("zipCentralDirCorrupt"));
      }
      const compressionMethod = readUint16(view, offset + 10);
      const compressedSize = readUint32(view, offset + 20);
      const uncompressedSize = readUint32(view, offset + 24);
      const filenameLength = readUint16(view, offset + 28);
      const extraLength = readUint16(view, offset + 30);
      const commentLength = readUint16(view, offset + 32);
      const localHeaderOffset = readUint32(view, offset + 42);
      const filenameStart = offset + 46;
      const filenameEnd = filenameStart + filenameLength;
      if (filenameEnd > bytes.length) throw new Error(t("zipNameOverflow"));
      const filename = decodeFilename(bytes.subarray(filenameStart, filenameEnd));

      if (localHeaderOffset + 30 > bytes.length || readUint32(view, localHeaderOffset) !== 0x04034b50) {
        throw new Error(t("zipLocalHeaderCorrupt", { file: filename }));
      }
      const localFilenameLength = readUint16(view, localHeaderOffset + 26);
      const localExtraLength = readUint16(view, localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
      if (dataOffset + compressedSize > bytes.length) throw new Error(t("zipDataOverflow", { file: filename }));

      entries.push({ filename, compressionMethod, compressedSize, uncompressedSize, dataOffset });
      offset = filenameEnd + extraLength + commentLength;
    }
    return entries;
  }

  async function inflateEntry(zipBytes, entry) {
    const compressed = zipBytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
    if (entry.compressionMethod === 0) return compressed.slice();
    if (entry.compressionMethod !== 8) {
      throw new Error(t("zipUnsupportedMethod", { method: entry.compressionMethod }));
    }
    if (typeof DecompressionStream === "undefined") {
      throw new Error(t("zipNoDecompression"));
    }
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const result = new Uint8Array(await new Response(stream).arrayBuffer());
    if (entry.uncompressedSize && result.length !== entry.uncompressedSize) {
      throw new Error(t("zipInflateLength", { file: entry.filename }));
    }
    return result;
  }

  function mimeTypeForFilename(filename) {
    const extension = String(filename).split(".").pop().toLowerCase();
    if (extension === "png") return "image/png";
    if (extension === "webp") return "image/webp";
    return "image/jpeg";
  }

  function createPalette332() {
    const palette = new Uint8Array(256 * 3);
    for (let index = 0; index < 256; index += 1) {
      const red = (index >> 5) & 7;
      const green = (index >> 2) & 7;
      const blue = index & 3;
      palette[index * 3] = Math.round(red * 255 / 7);
      palette[index * 3 + 1] = Math.round(green * 255 / 7);
      palette[index * 3 + 2] = Math.round(blue * 255 / 3);
    }
    return palette;
  }

  function rgbaToPalette332(rgba) {
    const indexed = new Uint8Array(rgba.length / 4);
    for (let source = 0, target = 0; source < rgba.length; source += 4, target += 1) {
      indexed[target] = ((rgba[source] >> 5) << 5) |
        ((rgba[source + 1] >> 5) << 2) |
        (rgba[source + 2] >> 6);
    }
    return indexed;
  }

  // ---- 自适应调色板：统计整段动图实际用到的颜色，用中位切分挑出 256 种，再做几轮 k-means 微调 ----
  // 统计在 5-5-5 位的颜色直方图上进行（32768 个格子），记录每格像素数和颜色总和，取平均时不丢精度。
  const HISTOGRAM_BITS = 5;
  const HISTOGRAM_SIDE = 1 << HISTOGRAM_BITS;
  const HISTOGRAM_SIZE = HISTOGRAM_SIDE ** 3;

  function createHistogram() {
    return {
      count: new Float64Array(HISTOGRAM_SIZE),
      red: new Float64Array(HISTOGRAM_SIZE),
      green: new Float64Array(HISTOGRAM_SIZE),
      blue: new Float64Array(HISTOGRAM_SIZE)
    };
  }

  function histogramIndex(red, green, blue) {
    return ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
  }

  // step 控制采样密度：大图隔几个像素取一个即可，颜色分布不会变。
  function addToHistogram(histogram, rgba, step = 1) {
    const stride = Math.max(1, Math.floor(step)) * 4;
    for (let offset = 0; offset < rgba.length; offset += stride) {
      const red = rgba[offset];
      const green = rgba[offset + 1];
      const blue = rgba[offset + 2];
      const index = histogramIndex(red, green, blue);
      histogram.count[index] += 1;
      histogram.red[index] += red;
      histogram.green[index] += green;
      histogram.blue[index] += blue;
    }
  }

  function boxStats(histogram, box) {
    let count = 0;
    for (let r = box[0]; r <= box[1]; r += 1) {
      for (let g = box[2]; g <= box[3]; g += 1) {
        const base = (r << 10) | (g << 5);
        for (let b = box[4]; b <= box[5]; b += 1) count += histogram.count[base | b];
      }
    }
    return count;
  }

  // 把颜色盒收缩到实际有像素的范围，切分才不会落在空白区域。
  function shrinkBox(histogram, box) {
    let minR = HISTOGRAM_SIDE; let maxR = -1;
    let minG = HISTOGRAM_SIDE; let maxG = -1;
    let minB = HISTOGRAM_SIDE; let maxB = -1;
    for (let r = box[0]; r <= box[1]; r += 1) {
      for (let g = box[2]; g <= box[3]; g += 1) {
        const base = (r << 10) | (g << 5);
        for (let b = box[4]; b <= box[5]; b += 1) {
          if (!histogram.count[base | b]) continue;
          if (r < minR) minR = r; if (r > maxR) maxR = r;
          if (g < minG) minG = g; if (g > maxG) maxG = g;
          if (b < minB) minB = b; if (b > maxB) maxB = b;
        }
      }
    }
    return maxR < 0 ? null : [minR, maxR, minG, maxG, minB, maxB];
  }

  // 沿最长的轴，在像素数的中位处把盒子一分为二。
  function splitBox(histogram, box) {
    const lengths = [box[1] - box[0], box[3] - box[2], box[5] - box[4]];
    const axis = lengths.indexOf(Math.max(...lengths));
    if (lengths[axis] === 0) return null;
    const low = box[axis * 2];
    const high = box[axis * 2 + 1];
    const slices = new Float64Array(high - low + 1);
    for (let r = box[0]; r <= box[1]; r += 1) {
      for (let g = box[2]; g <= box[3]; g += 1) {
        const base = (r << 10) | (g << 5);
        for (let b = box[4]; b <= box[5]; b += 1) {
          const count = histogram.count[base | b];
          if (count) slices[[r, g, b][axis] - low] += count;
        }
      }
    }
    const total = slices.reduce((sum, value) => sum + value, 0);
    let running = 0;
    let cut = low;
    for (let index = 0; index < slices.length - 1; index += 1) {
      running += slices[index];
      cut = low + index;
      if (running >= total / 2) break;
    }
    const first = box.slice();
    const second = box.slice();
    first[axis * 2 + 1] = cut;
    second[axis * 2] = cut + 1;
    return [shrinkBox(histogram, first), shrinkBox(histogram, second)].filter(Boolean);
  }

  function boxVolume(box) {
    return (box[1] - box[0] + 1) * (box[3] - box[2] + 1) * (box[5] - box[4] + 1);
  }

  // 返回 { palette: Uint8Array(256*3), size }。前一半按像素数切（常见颜色分得细），
  // 后一半按“像素数×体积”切（照顾颜色跨度大的区域，例如渐变）。
  function buildPalette(histogram, maxColors = 256) {
    const start = shrinkBox(histogram, [0, HISTOGRAM_SIDE - 1, 0, HISTOGRAM_SIDE - 1, 0, HISTOGRAM_SIDE - 1]);
    const palette = new Uint8Array(256 * 3);
    if (!start) return { palette, size: 1 };
    const boxes = [{ box: start, count: boxStats(histogram, start) }];
    const phaseOne = Math.floor(maxColors * 0.6);
    while (boxes.length < maxColors) {
      const byVolume = boxes.length >= phaseOne;
      let best = -1;
      let bestScore = 0;
      for (let index = 0; index < boxes.length; index += 1) {
        const item = boxes[index];
        if (boxVolume(item.box) <= 1) continue;
        const score = byVolume ? item.count * boxVolume(item.box) : item.count;
        if (score > bestScore) {
          bestScore = score;
          best = index;
        }
      }
      if (best < 0) break;
      const parts = splitBox(histogram, boxes[best].box);
      if (!parts || parts.length < 2) {
        boxes[best].count = 0;
        continue;
      }
      boxes.splice(best, 1, ...parts.map((box) => ({ box, count: boxStats(histogram, box) })));
    }

    const centers = boxes.map(({ box }) => {
      let count = 0; let red = 0; let green = 0; let blue = 0;
      for (let r = box[0]; r <= box[1]; r += 1) {
        for (let g = box[2]; g <= box[3]; g += 1) {
          const base = (r << 10) | (g << 5);
          for (let b = box[4]; b <= box[5]; b += 1) {
            const index = base | b;
            count += histogram.count[index];
            red += histogram.red[index];
            green += histogram.green[index];
            blue += histogram.blue[index];
          }
        }
      }
      return count ? [red / count, green / count, blue / count] : [0, 0, 0];
    });
    refinePalette(histogram, centers, 3);
    centers.forEach((center, index) => {
      palette[index * 3] = Math.round(center[0]);
      palette[index * 3 + 1] = Math.round(center[1]);
      palette[index * 3 + 2] = Math.round(center[2]);
    });
    return { palette, size: centers.length };
  }

  // k-means 微调：每个直方图格子归到最近的颜色，再把颜色移到所属像素的平均值。
  function refinePalette(histogram, centers, iterations) {
    const occupied = [];
    for (let index = 0; index < HISTOGRAM_SIZE; index += 1) if (histogram.count[index]) occupied.push(index);
    for (let round = 0; round < iterations; round += 1) {
      const sums = centers.map(() => [0, 0, 0, 0]);
      for (const index of occupied) {
        const count = histogram.count[index];
        const red = histogram.red[index] / count;
        const green = histogram.green[index] / count;
        const blue = histogram.blue[index] / count;
        let best = 0;
        let bestDistance = Infinity;
        for (let c = 0; c < centers.length; c += 1) {
          const dr = red - centers[c][0];
          const dg = green - centers[c][1];
          const db = blue - centers[c][2];
          const distance = dr * dr + dg * dg + db * db;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = c;
          }
        }
        const sum = sums[best];
        sum[0] += histogram.red[index];
        sum[1] += histogram.green[index];
        sum[2] += histogram.blue[index];
        sum[3] += count;
      }
      sums.forEach((sum, c) => {
        if (sum[3]) centers[c] = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
      });
    }
  }

  // ---- 抖动量化：Floyd–Steinberg 误差扩散（蛇形扫描），把每个像素映射到调色板 ----
  // 最近颜色查找按 6-6-6 位缓存，同一段动图里重复出现的颜色只算一次。
  // strength：误差扩散强度，1 为标准 Floyd–Steinberg，0 为不抖动。
  function createQuantizer(palette, size, strength = 1) {
    const cache = new Int16Array(1 << 18).fill(-1);
    function nearest(red, green, blue) {
      const key = ((red >> 2) << 12) | ((green >> 2) << 6) | (blue >> 2);
      const cached = cache[key];
      if (cached >= 0) return cached;
      const r = (red & ~3) + 2;
      const g = (green & ~3) + 2;
      const b = (blue & ~3) + 2;
      let best = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < size; index += 1) {
        const dr = r - palette[index * 3];
        const dg = g - palette[index * 3 + 1];
        const db = b - palette[index * 3 + 2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
      cache[key] = best;
      return best;
    }

    return function quantize(rgba, width, height) {
      const indexed = new Uint8Array(width * height);
      // 当前行和下一行的误差（RGB 各一份，左右各留一格边界）。
      let current = new Float32Array((width + 2) * 3);
      let next = new Float32Array((width + 2) * 3);
      for (let y = 0; y < height; y += 1) {
        const leftToRight = (y & 1) === 0;
        const direction = leftToRight ? 1 : -1;
        next.fill(0);
        for (let step = 0; step < width; step += 1) {
          const x = leftToRight ? step : width - 1 - step;
          const pixel = (y * width + x) * 4;
          const slot = (x + 1) * 3;
          const red = Math.min(255, Math.max(0, rgba[pixel] + current[slot]));
          const green = Math.min(255, Math.max(0, rgba[pixel + 1] + current[slot + 1]));
          const blue = Math.min(255, Math.max(0, rgba[pixel + 2] + current[slot + 2]));
          const index = nearest(red | 0, green | 0, blue | 0);
          indexed[y * width + x] = index;
          const errorRed = (red - palette[index * 3]) * strength;
          const errorGreen = (green - palette[index * 3 + 1]) * strength;
          const errorBlue = (blue - palette[index * 3 + 2]) * strength;
          const ahead = slot + direction * 3;
          const behind = slot - direction * 3;
          // 7/16 给同一行的下一个像素，3/16、5/16、1/16 给下一行。
          current[ahead] += errorRed * 0.4375;
          current[ahead + 1] += errorGreen * 0.4375;
          current[ahead + 2] += errorBlue * 0.4375;
          next[behind] += errorRed * 0.1875;
          next[behind + 1] += errorGreen * 0.1875;
          next[behind + 2] += errorBlue * 0.1875;
          next[slot] += errorRed * 0.3125;
          next[slot + 1] += errorGreen * 0.3125;
          next[slot + 2] += errorBlue * 0.3125;
          next[ahead] += errorRed * 0.0625;
          next[ahead + 1] += errorGreen * 0.0625;
          next[ahead + 2] += errorBlue * 0.0625;
        }
        [current, next] = [next, current];
      }
      return indexed;
    };
  }

  function lzwEncode(indices, minimumCodeSize = 8) {
    if (!indices.length) throw new Error(t("gifNoPixels"));
    const clearCode = 1 << minimumCodeSize;
    const endCode = clearCode + 1;
    let nextCode = endCode + 1;
    let codeSize = minimumCodeSize + 1;
    let dictionary = new Map();
    const output = [];
    let bitBuffer = 0;
    let bitCount = 0;

    function writeCode(code) {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        output.push(bitBuffer & 0xff);
        bitBuffer >>>= 8;
        bitCount -= 8;
      }
    }

    function resetDictionary() {
      dictionary = new Map();
      nextCode = endCode + 1;
      codeSize = minimumCodeSize + 1;
    }

    writeCode(clearCode);
    let prefix = indices[0];
    for (let index = 1; index < indices.length; index += 1) {
      const value = indices[index];
      const key = prefix * 256 + value;
      const existing = dictionary.get(key);
      if (existing !== undefined) {
        prefix = existing;
        continue;
      }

      writeCode(prefix);
      if (nextCode < 4096) {
        dictionary.set(key, nextCode);
        nextCode += 1;
        // GIF decoders add a dictionary entry one emitted code later than the
        // encoder. Grow after assigning the first code of the new width so
        // both sides change width before that code can be emitted.
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize += 1;
      } else {
        writeCode(clearCode);
        resetDictionary();
      }
      prefix = value;
    }
    writeCode(prefix);
    writeCode(endCode);
    if (bitCount > 0) output.push(bitBuffer & 0xff);
    return new Uint8Array(output);
  }

  function littleEndian16(value) {
    return [value & 0xff, (value >> 8) & 0xff];
  }

  function asciiBytes(value) {
    return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
  }

  function gifDataBlocks(data) {
    const blocks = [];
    for (let offset = 0; offset < data.length; offset += 255) {
      const chunk = data.subarray(offset, Math.min(offset + 255, data.length));
      blocks.push(Uint8Array.of(chunk.length), chunk);
    }
    blocks.push(Uint8Array.of(0));
    return blocks;
  }

  class GifEncoder {
    // palette：256×3 字节的全局调色板；不传时用旧的固定 3-3-2 调色板。
    constructor(width, height, palette = createPalette332()) {
      if (!width || !height || width > 65535 || height > 65535) throw new Error(t("ugoiraSizeInvalid"));
      this.width = width;
      this.height = height;
      this.parts = [
        asciiBytes("GIF89a"),
        Uint8Array.from([...littleEndian16(width), ...littleEndian16(height), 0xf7, 0, 0]),
        palette,
        Uint8Array.from([0x21, 0xff, 0x0b]),
        asciiBytes("NETSCAPE2.0"),
        Uint8Array.from([0x03, 0x01, 0x00, 0x00, 0x00])
      ];
    }

    addFrame(indexedPixels, delayMilliseconds) {
      if (indexedPixels.length !== this.width * this.height) throw new Error(t("gifFrameSizeMismatch"));
      const delay = Math.max(1, Math.min(65535, Math.round(Number(delayMilliseconds || 10) / 10)));
      const compressed = lzwEncode(indexedPixels, 8);
      this.parts.push(
        Uint8Array.from([0x21, 0xf9, 0x04, 0x04, ...littleEndian16(delay), 0x00, 0x00]),
        Uint8Array.from([
          0x2c,
          0x00, 0x00, 0x00, 0x00,
          ...littleEndian16(this.width),
          ...littleEndian16(this.height),
          0x00,
          0x08
        ]),
        ...gifDataBlocks(compressed)
      );
    }

    finishBlob() {
      return new Blob([...this.parts, Uint8Array.of(0x3b)], { type: "image/gif" });
    }

    finishBytes() {
      const parts = [...this.parts, Uint8Array.of(0x3b)];
      const length = parts.reduce((total, part) => total + part.length, 0);
      const result = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
      }
      return result;
    }
  }

  function makeCanvas(width, height) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    throw new Error(t("noCanvas"));
  }

  function findFrameEntry(entries, filename) {
    const exact = entries.find((entry) => entry.filename === filename);
    if (exact) return exact;
    const basename = String(filename).split("/").pop();
    return entries.find((entry) => entry.filename.split("/").pop() === basename);
  }

  // 依次解码每一帧并交给 callback(rgba, width, height, frame)。
  async function forEachFrame(zipBytes, entries, frames, callback) {
    let canvas;
    let context;
    let width = 0;
    let height = 0;
    for (const frame of frames) {
      const entry = findFrameEntry(entries, frame.file);
      if (!entry) throw new Error(t("frameMissing", { file: frame.file }));
      const frameBytes = await inflateEntry(zipBytes, entry);
      const bitmap = await createImageBitmap(new Blob([frameBytes], { type: mimeTypeForFilename(frame.file) }));
      try {
        if (!context) {
          width = bitmap.width;
          height = bitmap.height;
          if (!width || !height || width > 65535 || height > 65535) throw new Error(t("ugoiraSizeInvalid"));
          canvas = makeCanvas(width, height);
          context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error(t("noCanvasContext"));
        }
        if (bitmap.width !== width || bitmap.height !== height) throw new Error(t("framesSizeMismatch"));
        context.clearRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0);
        await callback(context.getImageData(0, 0, width, height).data, width, height, frame);
      } finally {
        if (typeof bitmap.close === "function") bitmap.close();
      }
    }
  }

  // 每段动图最多统计约 200 万个采样像素来定调色板，再大的动图第一遍也很快。
  const PALETTE_SAMPLE_BUDGET = 2000000;

  // 两遍处理：第一遍统计所有帧的颜色生成专属调色板，第二遍抖动量化并编码。
  // 抖动强度默认 0.5：实测（800×600、24 帧）不抖动时渐变有明显色带，全强度抖动有颗粒噪点且文件最大；
  // 0.5 时色带基本消失，PSNR 与最高值只差约 0.5 dB，文件大小居中。
  function encodeFramesToGif(frameSource, { ditherStrength = 0.5 } = {}) {
    return (async () => {
      const histogram = createHistogram();
      let step = 1;
      await frameSource((rgba, width, height, _frame, frameCount) => {
        step = Math.max(1, Math.ceil(width * height * frameCount / PALETTE_SAMPLE_BUDGET));
        addToHistogram(histogram, rgba, step);
      });
      const { palette, size } = buildPalette(histogram, 256);
      const quantize = createQuantizer(palette, size, ditherStrength);
      let encoder;
      await frameSource((rgba, width, height, frame) => {
        if (!encoder) encoder = new GifEncoder(width, height, palette);
        encoder.addFrame(quantize(rgba, width, height), frame.delay);
      });
      return encoder;
    })();
  }

  // ---- APNG：无损全彩色。逐行自适应滤波 + 浏览器内置 zlib 压缩，再拼成动画 PNG ----
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes, crc = 0xffffffff) {
    for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    return crc;
  }

  function uint32(value) {
    return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  }

  function uint16(value) {
    return Uint8Array.of((value >>> 8) & 0xff, value & 0xff);
  }

  function concatBytes(parts) {
    const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  function pngChunk(type, data) {
    const typeBytes = asciiBytes(type);
    const crc = (crc32(data, crc32(typeBytes)) ^ 0xffffffff) >>> 0;
    return concatBytes([uint32(data.length), typeBytes, data, uint32(crc)]);
  }

  function paeth(left, up, upLeft) {
    const estimate = left + up - upLeft;
    const distanceLeft = Math.abs(estimate - left);
    const distanceUp = Math.abs(estimate - up);
    const distanceUpLeft = Math.abs(estimate - upLeft);
    if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
    return distanceUp <= distanceUpLeft ? up : upLeft;
  }

  // 把 RGBA 像素转成 PNG 扫描线：每行在 5 种滤波里选“绝对值和”最小的一种（libpng 的常用做法）。
  function filterScanlines(rgba, width, height, channels) {
    const rowLength = width * channels;
    const output = new Uint8Array(height * (rowLength + 1));
    let previous = new Uint8Array(rowLength);
    let current = new Uint8Array(rowLength);
    const candidates = Array.from({ length: 5 }, () => new Uint8Array(rowLength));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const source = (y * width + x) * 4;
        const target = x * channels;
        current[target] = rgba[source];
        current[target + 1] = rgba[source + 1];
        current[target + 2] = rgba[source + 2];
        if (channels === 4) current[target + 3] = rgba[source + 3];
      }
      let bestType = 0;
      let bestScore = Infinity;
      for (let type = 0; type < 5; type += 1) {
        const row = candidates[type];
        let score = 0;
        for (let i = 0; i < rowLength; i += 1) {
          const left = i >= channels ? current[i - channels] : 0;
          const up = previous[i];
          const upLeft = i >= channels ? previous[i - channels] : 0;
          let predicted = 0;
          if (type === 1) predicted = left;
          else if (type === 2) predicted = up;
          else if (type === 3) predicted = (left + up) >> 1;
          else if (type === 4) predicted = paeth(left, up, upLeft);
          const value = (current[i] - predicted) & 0xff;
          row[i] = value;
          score += value < 128 ? value : 256 - value;
          if (score >= bestScore) break;
        }
        if (score < bestScore) {
          bestScore = score;
          bestType = type;
        }
      }
      // 提前中断的候选行不完整，选中后按完整长度重新计算一次。
      const chosen = candidates[bestType];
      for (let i = 0; i < rowLength; i += 1) {
        const left = i >= channels ? current[i - channels] : 0;
        const up = previous[i];
        const upLeft = i >= channels ? previous[i - channels] : 0;
        let predicted = 0;
        if (bestType === 1) predicted = left;
        else if (bestType === 2) predicted = up;
        else if (bestType === 3) predicted = (left + up) >> 1;
        else if (bestType === 4) predicted = paeth(left, up, upLeft);
        chosen[i] = (current[i] - predicted) & 0xff;
      }
      const offset = y * (rowLength + 1);
      output[offset] = bestType;
      output.set(chosen, offset + 1);
      [previous, current] = [current, previous];
    }
    return output;
  }

  // CompressionStream("deflate") 输出的就是 PNG 要求的 zlib 格式。
  async function zlibCompress(bytes) {
    if (typeof CompressionStream === "undefined") throw new Error(t("noApngCompression"));
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function hasTransparency(rgba) {
    for (let offset = 3; offset < rgba.length; offset += 4) if (rgba[offset] !== 255) return true;
    return false;
  }

  // 每帧完整写入（dispose: none，blend: source），播放无限循环。第一帧不透明就用 RGB，否则 RGBA。
  async function encodeFramesToApng(frameSource) {
    const frameParts = [];
    let sequence = 0;
    let width = 0;
    let height = 0;
    let channels = 3;
    let frameCount = 0;
    await frameSource(async (rgba, frameWidth, frameHeight, frame) => {
      if (!frameCount) {
        width = frameWidth;
        height = frameHeight;
        channels = hasTransparency(rgba) ? 4 : 3;
      }
      const compressed = await zlibCompress(filterScanlines(rgba, width, height, channels));
      const delay = Math.max(1, Math.min(65535, Math.round(Number(frame.delay) || 100)));
      frameParts.push(pngChunk("fcTL", concatBytes([
        uint32(sequence++), uint32(width), uint32(height), uint32(0), uint32(0),
        uint16(delay), uint16(1000), Uint8Array.of(0, 0)
      ])));
      if (!frameCount) {
        frameParts.push(pngChunk("IDAT", compressed));
      } else {
        frameParts.push(pngChunk("fdAT", concatBytes([uint32(sequence++), compressed])));
      }
      frameCount += 1;
    });
    if (!frameCount) throw new Error(t("noFrames"));
    const header = concatBytes([uint32(width), uint32(height), Uint8Array.of(8, channels === 4 ? 6 : 2, 0, 0, 0)]);
    return concatBytes([
      Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      pngChunk("IHDR", header),
      pngChunk("acTL", concatBytes([uint32(frameCount), uint32(0)])),
      ...frameParts,
      pngChunk("IEND", new Uint8Array(0))
    ]);
  }

  // ---- 原始帧压缩包：不转换画面，帧原样存入（JPEG 本身已压缩，用“存储”方式），另附 animation.json ----
  function buildStoredZip(files) {
    const encoder = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const item of files) {
      const name = encoder.encode(item.name);
      const crc = (crc32(item.bytes) ^ 0xffffffff) >>> 0;
      const local = new Uint8Array(30);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, item.bytes.length, true);
      localView.setUint32(22, item.bytes.length, true);
      localView.setUint16(26, name.length, true);
      locals.push(local, name, item.bytes);

      const central = new Uint8Array(46);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, item.bytes.length, true);
      centralView.setUint32(24, item.bytes.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint32(42, offset, true);
      centrals.push(central, name);
      offset += 30 + name.length + item.bytes.length;
    }
    const centralSize = centrals.reduce((total, part) => total + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    return concatBytes([...locals, ...centrals, end]);
  }

  async function buildFrameArchive(zipBytes, entries, frames, info) {
    const files = [];
    for (const frame of frames) {
      const entry = findFrameEntry(entries, frame.file);
      if (!entry) throw new Error(t("frameMissing", { file: frame.file }));
      files.push({ name: entry.filename.split("/").pop(), bytes: await inflateEntry(zipBytes, entry) });
    }
    const animation = {
      ...info,
      frames: frames.map((frame) => ({ file: String(frame.file).split("/").pop(), delay: Number(frame.delay) || 0 }))
    };
    files.push({ name: "animation.json", bytes: new TextEncoder().encode(JSON.stringify(animation, null, 2)) });
    return buildStoredZip(files);
  }

  const UGOIRA_FORMATS = {
    gif: { extension: "gif", type: "image/gif" },
    apng: { extension: "png", type: "image/png" },
    zip: { extension: "zip", type: "application/zip" }
  };

  function normalizeUgoiraFormat(format) {
    return Object.prototype.hasOwnProperty.call(UGOIRA_FORMATS, format) ? format : "gif";
  }

  // format：gif（默认）、apng、zip。info 只用于压缩包里的 animation.json。
  async function convertArchive(archiveBlob, frames, { format = "gif", info = {} } = {}) {
    if (!Array.isArray(frames) || frames.length === 0) throw new Error(t("noFrameInfo"));
    const kind = normalizeUgoiraFormat(format);
    const archiveBuffer = await archiveBlob.arrayBuffer();
    const zipBytes = new Uint8Array(archiveBuffer);
    const entries = findZipEntries(archiveBuffer);
    const type = UGOIRA_FORMATS[kind].type;
    if (kind === "zip") return new Blob([await buildFrameArchive(zipBytes, entries, frames, info)], { type });

    if (typeof createImageBitmap !== "function") throw new Error(t("noImageDecode"));
    const frameSource = (callback) => forEachFrame(zipBytes, entries, frames, (rgba, width, height, frame) =>
      callback(rgba, width, height, frame, frames.length));
    if (kind === "apng") return new Blob([await encodeFramesToApng(frameSource)], { type });
    return (await encodeFramesToGif(frameSource)).finishBlob();
  }

  function convertArchiveToGif(archiveBlob, frames) {
    return convertArchive(archiveBlob, frames, { format: "gif" });
  }

  async function fetchArchive(archiveUrl) {
    const response = await fetch(archiveUrl, { credentials: "include", cache: "no-store" });
    if (!response.ok) {
      const error = new Error(t("zipHttp", { status: response.status }));
      error.status = response.status;
      throw error;
    }
    const archive = await response.blob();
    // 压缩包没收全时属于下载问题，交给上层重试；收全之后的解析错误才是数据本身的问题。
    const declared = Number(response.headers && response.headers.get && response.headers.get("content-length"));
    const encoded = response.headers && response.headers.get && response.headers.get("content-encoding");
    if (!encoded && declared > 0 && declared !== archive.size) {
      throw new Error(t("zipShortRead", { received: archive.size, expected: declared }));
    }
    return archive;
  }

  // 转换失败说明帧数据本身有问题，标记为不可重试。
  async function convertArchiveFinal(archive, frames, options = {}) {
    try {
      return await convertArchive(archive, frames, options);
    } catch (error) {
      // 帧数据本身有问题时，重新下载也无济于事。
      error.retriable = false;
      throw error;
    }
  }

  async function fetchAndConvert(archiveUrl, frames, options = {}) {
    return convertArchiveFinal(await fetchArchive(archiveUrl), frames, options);
  }

  return {
    findZipEntries,
    inflateEntry,
    rgbaToPalette332,
    createPalette332,
    createHistogram,
    addToHistogram,
    buildPalette,
    createQuantizer,
    encodeFramesToGif,
    encodeFramesToApng,
    filterScanlines,
    buildStoredZip,
    normalizeUgoiraFormat,
    UGOIRA_FORMATS,
    lzwEncode,
    GifEncoder,
    convertArchive,
    convertArchiveToGif,
    fetchArchive,
    convertArchiveFinal,
    fetchAndConvert
  };
});
