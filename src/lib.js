(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.PixivDownloaderUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const I18n = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./i18n.js")
    : globalThis.PixivI18n;
  const t = (key, params) => (I18n ? I18n.t(key, params) : key);

  const ARTWORK_URL = /^https:\/\/(?:www\.)?pixiv\.net\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?artworks\/(\d+)(?:[/?#]|$)/i;

  function extractArtworkId(url) {
    if (typeof url !== "string") return null;
    const match = url.match(ARTWORK_URL);
    return match ? match[1] : null;
  }

  function sanitizeSegment(value, fallback = "untitled") {
    const cleaned = String(value || "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 100);
    return cleaned || fallback;
  }

  function filenameFromUrl(url, fallback) {
    try {
      const pathname = new URL(url).pathname;
      const name = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
      return sanitizeSegment(name, fallback);
    } catch (_error) {
      return fallback;
    }
  }

  function extensionFromUrl(url, fallback = "jpg") {
    const normalizedFallback = String(fallback).replace(/^\./, "").toLowerCase() || "jpg";
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.([a-z0-9]+)$/i);
      if (!match) return normalizedFallback;
      const extension = match[1].toLowerCase();
      return extension === "jpeg" ? "jpg" : extension;
    } catch (_error) {
      return normalizedFallback;
    }
  }

  function normalizedArtworkFilename(artworkId, pageIndex, url, forcedExtension) {
    const id = String(artworkId || "").replace(/\D/g, "");
    if (!id) throw new Error(t("artworkIdNumeric"));
    const page = Math.max(0, Number.parseInt(pageIndex, 10) || 0);
    const extension = String(forcedExtension || extensionFromUrl(url, "jpg"))
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase() || "jpg";
    return `${id}_p${page}.${extension === "jpeg" ? "jpg" : extension}`;
  }

  function uniqueArtworks(tabs) {
    const seen = new Set();
    const artworks = [];
    for (const tab of tabs || []) {
      const id = extractArtworkId(tab && tab.url);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      artworks.push({ id, tabId: tab.id, url: tab.url, title: tab.title || "" });
    }
    return artworks;
  }

  // 允许用 "/" 指定多级文件夹，例如 "原神/角色"；每一级单独清理，丢弃 "." 和 ".."。
  function sanitizeFolderPath(value) {
    return String(value || "")
      .split(/[/\\]+/)
      .map((segment) => sanitizeSegment(segment, ""))
      .filter(Boolean)
      .join("/");
  }

  // 下载目录里的保存文件夹：没设置时用 Pixiv；设成空字符串表示直接存在下载目录里；可以写多级。
  function normalizeDownloadRoot(value) {
    return value === undefined || value === null ? "Pixiv" : sanitizeFolderPath(value);
  }

  function buildDownloadPath({ root, artworkId, title, filename, folderMode, tagFolder }) {
    const prefix = normalizeDownloadRoot(root) ? `${normalizeDownloadRoot(root)}/` : "";
    const safeFilename = sanitizeSegment(filename, `${artworkId || "pixiv"}.jpg`);
    const safeTagFolder = sanitizeFolderPath(tagFolder);
    // 命中标签规则的作品一律平铺在标签文件夹内。
    if (safeTagFolder) return `${prefix}${safeTagFolder}/${safeFilename}`;
    if (folderMode === "flat") return `${prefix}${safeFilename}`;
    const safeTitle = sanitizeSegment(title, artworkId || "untitled");
    return `${prefix}${artworkId} - ${safeTitle}/${safeFilename}`;
  }

  // 标签比较时忽略全角/半角、大小写和空白，"Genshin Impact" 与 "genshinimpact" 视为同一标签。
  function normalizeTagKey(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  }

  // 从 /ajax/illust/{id} 的 body 中取出标签：name 是原始标签，translation 是 Pixiv 提供的译名。
  function artworkTags(info) {
    const list = info && info.tags && Array.isArray(info.tags.tags) ? info.tags.tags : [];
    const tags = [];
    const seen = new Set();
    for (const item of list) {
      const name = String(item && item.tag || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const translation = String(item.translation && item.translation.en || "").trim();
      tags.push({ name, translation: translation && translation !== name ? translation : "" });
    }
    return tags;
  }

  function splitTagList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
    return String(value || "").split(/[\n,，、]+/).map((item) => item.trim()).filter(Boolean);
  }

  function normalizeRules(rules) {
    const result = [];
    for (const rule of Array.isArray(rules) ? rules : []) {
      const folder = sanitizeFolderPath(rule && rule.folder);
      const seen = new Set();
      const tags = [];
      for (const tag of splitTagList(rule && rule.tags)) {
        const key = normalizeTagKey(tag);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        tags.push(tag);
      }
      if (folder && tags.length) result.push({ folder, tags });
    }
    return result;
  }

  // 返回第一条命中的规则（规则顺序即优先级），没有命中则返回 null。
  function matchRule(rules, tags) {
    const keys = new Set();
    for (const tag of tags || []) {
      keys.add(normalizeTagKey(tag.name));
      if (tag.translation) keys.add(normalizeTagKey(tag.translation));
    }
    keys.delete("");
    for (const rule of rules || []) {
      if ((rule.tags || []).some((tag) => keys.has(normalizeTagKey(tag)))) return rule;
    }
    return null;
  }

  // override: undefined / "auto" 按规则匹配；"root" 强制不用标签文件夹；其他值视为指定的文件夹。
  function resolveTagFolder(rules, tags, override) {
    if (override === "root") return "";
    if (override && override !== "auto") return sanitizeFolderPath(override);
    const rule = matchRule(rules, tags);
    return rule ? rule.folder : "";
  }

  // 把一个标签归入某个文件夹：已有同名文件夹就追加为别名，否则新建规则；
  // 同一标签若在其他规则里出现则移除，避免它继续被更靠前的规则抢走。
  function addTagToRules(rules, tag, folder) {
    const safeFolder = sanitizeFolderPath(folder);
    const key = normalizeTagKey(tag);
    if (!safeFolder || !key) return normalizeRules(rules);
    const folderKey = safeFolder.toLowerCase();
    let target = null;
    const next = [];
    for (const rule of normalizeRules(rules)) {
      if (!target && rule.folder.toLowerCase() === folderKey) {
        target = { folder: rule.folder, tags: rule.tags.filter((item) => normalizeTagKey(item) !== key) };
        target.tags.push(String(tag).trim());
        next.push(target);
        continue;
      }
      const tags = rule.tags.filter((item) => normalizeTagKey(item) !== key);
      if (tags.length) next.push({ folder: rule.folder, tags });
    }
    if (!target) next.push({ folder: safeFolder, tags: [String(tag).trim()] });
    return next;
  }

  // 尺寸筛选：mode "dimensions" 要求长边、短边分别达到阈值的长边、短边（横竖都算）；
  // mode "pixels" 要求宽×高达到阈值的像素数。
  function normalizeSizeFilter(raw) {
    const toSize = (value, fallback) => {
      const number = Math.floor(Number(value));
      return Number.isFinite(number) && number > 0 ? Math.min(number, 100000) : fallback;
    };
    return {
      enabled: Boolean(raw && raw.enabled),
      mode: raw && raw.mode === "pixels" ? "pixels" : "dimensions",
      width: toSize(raw && raw.width, 1920),
      height: toSize(raw && raw.height, 1080)
    };
  }

  // 静态图片和动图各一套筛选。兼容旧的单套设置：旧设置同时用于两者，升级后行为不变。
  function normalizeSizeFilters(raw) {
    if (raw && (raw.image || raw.ugoira)) {
      return { image: normalizeSizeFilter(raw.image), ugoira: normalizeSizeFilter(raw.ugoira) };
    }
    const shared = normalizeSizeFilter(raw);
    return { image: shared, ugoira: { ...shared } };
  }

  // 尺寸未知（接口没给宽高）时不跳过，宁可多下也不误删。
  function passesSizeFilter(filter, width, height) {
    if (!filter || !filter.enabled) return true;
    const w = Number(width);
    const h = Number(height);
    if (!(w > 0 && h > 0)) return true;
    if (filter.mode === "pixels") return w * h >= filter.width * filter.height;
    return Math.max(w, h) >= Math.max(filter.width, filter.height) &&
      Math.min(w, h) >= Math.min(filter.width, filter.height);
  }

  return {
    extractArtworkId,
    sanitizeSegment,
    sanitizeFolderPath,
    filenameFromUrl,
    extensionFromUrl,
    normalizedArtworkFilename,
    uniqueArtworks,
    buildDownloadPath,
    normalizeDownloadRoot,
    normalizeTagKey,
    artworkTags,
    splitTagList,
    normalizeRules,
    matchRule,
    resolveTagFolder,
    addTagToRules,
    normalizeSizeFilter,
    normalizeSizeFilters,
    passesSizeFilter
  };
});
