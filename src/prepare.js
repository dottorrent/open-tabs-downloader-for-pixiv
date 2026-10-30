(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PixivPrepare = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 把一个待下载文件准备成 Blob：取回原图、检查完整性、写入元数据，或把动图转换成所选格式。
  // Firefox 在后台页里直接调用；Chrome/Edge 的 service worker 不能创建 blob 地址，所以在离屏页（offscreen.js）里调用。
  const isNode = typeof module === "object" && module.exports && typeof require === "function";
  const I18n = isNode ? require("./i18n.js") : globalThis.PixivI18n;
  const t = (key, params) => (I18n ? I18n.t(key, params) : key);
  // 处理模块按需取用：service worker 只用到错误工具，不加载 ugoira.js / metadata.js。
  const metadataModule = () => (isNode ? require("./metadata.js") : globalThis.PixivMetadata);
  const ugoiraModule = () => (isNode ? require("./ugoira.js") : globalThis.PixivUgoira);

  // retriable === false 表示重试也不会成功（作品已删除、磁盘错误等）。
  function taskError(message, retriable, status) {
    const error = new Error(message);
    error.retriable = retriable;
    if (status) error.status = status;
    return error;
  }

  function httpError(label, status) {
    return taskError(t("httpError", { label, status }), status === 408 || status === 429 || status >= 500, status);
  }

  // Chrome 的扩展消息只能传 JSON，错误要拆成普通对象再还原，保留是否可重试和 HTTP 状态码。
  function serializeError(error) {
    return {
      message: (error && error.message) || String(error),
      retriable: error && typeof error.retriable === "boolean" ? error.retriable : undefined,
      status: error && typeof error.status === "number" ? error.status : undefined
    };
  }

  function deserializeError(data) {
    const error = new Error((data && data.message) || "Unknown error");
    if (data && typeof data.retriable === "boolean") error.retriable = data.retriable;
    if (data && typeof data.status === "number") error.status = data.status;
    return error;
  }

  // 实际收到的字节数与服务器声明的不一致，说明传输中断（有压缩编码时无法比较，跳过）。
  function checkContentLength(response, bytes, label) {
    const headers = response.headers;
    if (!headers || typeof headers.get !== "function" || headers.get("content-encoding")) return;
    const declared = Number(headers.get("content-length"));
    if (declared > 0 && declared !== bytes.length) {
      throw taskError(t("shortRead", { label, received: bytes.length, expected: declared }), true);
    }
  }

  // 先把原图取回内存并检查完整性，有问题就按可重试的下载失败处理，不会把错误页或半张图存下来。
  async function fetchImage(file) {
    const response = await fetch(file.url, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw httpError(t("labelImage"), response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    checkContentLength(response, bytes, t("labelImage"));
    const problem = metadataModule().checkImage(bytes);
    if (problem) throw taskError(problem, true);
    return bytes;
  }

  // 标签多到放不进 JPG 时会删掉末尾的部分标签再写入，并记录提示；彻底写不进去时保存原始数据并记录。
  function withMetadata(bytes, file, warnings) {
    if (!file.metadata) return bytes;
    const Metadata = metadataModule();
    if (!Metadata.detectFormat(bytes)) {
      warnings.push(t("unsupportedFormat"));
      return bytes;
    }
    try {
      const result = Metadata.embedXmpDetailed(bytes, file.metadata);
      if (result.omitted > 0) warnings.push(t("tagsOmitted", { count: result.omitted }));
      return result.bytes;
    } catch (error) {
      warnings.push(error.message || String(error));
      return bytes;
    }
  }

  // 同一个动图选了多种格式时，原始压缩包只下载一次，各格式共用；该作品处理完就释放。
  const ugoiraArchives = new Map();

  function getUgoiraArchive(url) {
    if (!ugoiraArchives.has(url)) {
      const promise = ugoiraModule().fetchArchive(url);
      ugoiraArchives.set(url, promise);
      promise.catch(() => ugoiraArchives.delete(url));
    }
    return ugoiraArchives.get(url);
  }

  function releaseUgoiraArchive(url) {
    ugoiraArchives.delete(url);
  }

  // 返回 { blob, warnings }：warnings 是元数据没能完整写入时的提示文字。
  async function prepareFile(file) {
    const warnings = [];
    if (file.kind === "ugoira") {
      const archive = await getUgoiraArchive(file.archiveUrl);
      let blob = await ugoiraModule().convertArchiveFinal(archive, file.frames, { format: file.format, info: file.info });
      // GIF 和 APNG 写入 XMP；压缩包的作品信息已经放在 animation.json 里。
      if (file.metadata && file.format !== "zip") {
        const bytes = withMetadata(new Uint8Array(await blob.arrayBuffer()), file, warnings);
        blob = new Blob([bytes], { type: blob.type });
      }
      return { blob, warnings };
    }
    // 开启元数据时插入 XMP；关闭时保存与原图完全相同的字节。
    const original = await fetchImage(file);
    const bytes = file.metadata ? withMetadata(original, file, warnings) : original;
    return { blob: new Blob([bytes], { type: metadataModule().mimeType(bytes) }), warnings };
  }

  return {
    taskError,
    httpError,
    serializeError,
    deserializeError,
    checkContentLength,
    fetchImage,
    withMetadata,
    getUgoiraArchive,
    releaseUgoiraArchive,
    prepareFile
  };
});
