(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PixivI18n = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 界面语言：zh（简体中文）或 en（英文）。设置存在 storage.local 的 uiLanguage 里，
  // 弹窗、规则页、后台共用；"auto" 跟随浏览器语言（中文显示中文，其他语言显示英文）。
  // 没有调用 init / setPreference 之前默认中文，保证单元测试里的提示文字不变。
  const LANGUAGE_KEY = "uiLanguage";
  const PREFERENCES = ["auto", "zh", "en"];

  const MESSAGES = {
    zh: {
      // ---- 通用 ----
      languageLabel: "语言",
      languageAuto: "跟随浏览器",
      on: "开启",
      off: "关闭",
      cancel: "取消",
      saveFailed: "保存失败：{message}",
      colon: "：",
      listSeparator: "，",

      // ---- 弹窗：页头与任务卡片 ----
      headerTitle: "Pixiv 作品下载",
      headerSubtitle: "扫描当前浏览器的所有窗口",
      windowSubtitle: "独立窗口 · 点击其他地方不会关闭",
      taskRunning: "下载进行中",
      taskLastResult: "上次下载结果",
      openWindow: "在独立窗口中查看",
      dismissResult: "关闭这条结果",
      failuresTitle: "失败项",
      retryFailed: "重试失败项",
      retryFailedCount: "重试失败项（{count}）",
      warningsTitle: "元数据未完整写入",
      skippedTitle: "已跳过的小图",

      // ---- 弹窗：扫描与作品列表 ----
      scanning: "正在扫描…",
      pleaseWait: "请稍候",
      scanningTabs: "正在读取已打开标签页和作品标签",
      scanFailed: "扫描失败",
      foundArtworks: "找到 {count} 个作品",
      openArtworkFirst: "请先打开形如 pixiv.net/artworks/数字ID 的页面",
      artworksHeading: "作品与保存位置",
      manageRules: "管理标签规则",
      artworksHint: "点击标签可把它归入一个文件夹（会保存为规则）；下拉框可临时改变单个作品的去向。",
      saveLocation: "保存位置",
      destAuto: "自动：{path}",
      destRoot: "不用标签文件夹：{path}",
      fallbackPerArtwork: "{root}作品ID - 标题/",
      tagFormLabel: "把「{tag}」存到 {root}",
      saveRule: "保存规则",
      pages: "{count} 页",
      willSkipSuffix: " · 将跳过",
      willSkipSummary: "将跳过（尺寸过小）",
      readTagsFailed: "读取标签失败：{message}",
      chipRuled: "已在标签规则中，点击修改所属文件夹",
      chipAdd: "点击把这个标签归入一个文件夹",
      noTags: "没有标签",

      // ---- 弹窗：保存方式与设置面板 ----
      folderLegend: "未命中标签规则的作品",
      folderPerArtwork: "每个作品单独文件夹",
      folderPerArtworkPath: "{root}作品ID - 标题/图片",
      folderFlat: "全部放在同一文件夹",
      folderFlatPath: "{root}所有图片",
      pathNoteRules: "命中标签规则的作品统一平铺保存到 <code>{root}规则文件夹/</code>。",
      saveLocationNote: "扩展只能把文件存进 Firefox 的下载目录。想存到其他磁盘或文件夹，请在 Firefox 设置里修改默认下载目录。",
      saveLocationLegend: "保存位置",
      saveFolderLabel: "保存到",
      downloadsDir: "下载目录",
      rootEmptyPlaceholder: "留空则直接存到下载目录",
      openDownloadsFolder: "打开下载目录",
      metadataTitle: "图片元数据",
      metadataOption: "写入标签、作者和作品链接",
      metadataOptionHint: "资源管理器“属性 → 详细信息”中显示为 标记 / 作者 / 备注",
      metadataOn: "写入",
      metadataOff: "不写入",
      sizeTitle: "尺寸筛选",
      sizeTabImage: "静态图片",
      sizeTabUgoira: "动图",
      sizeSkipImages: "跳过尺寸过小的静态图片",
      sizeSkipImagesHint: "多页作品按页判断；跳过的图片不下载，也不算失败",
      sizeSkipUgoira: "跳过尺寸过小的动图",
      sizeSkipUgoiraHint: "按动图本身的尺寸判断；选了多种格式时一起跳过",
      width: "宽",
      height: "高",
      modeDimensions: "长边和短边都要达到",
      modePixels: "总像素数要达到",
      dimensionsHint: "长边 ≥ {long} 且短边 ≥ {short}，例如 {short}×{long} 也达标",
      pixelsHint: "宽×高 ≥ {pixels}",
      sizeSummary: "图片 {image} · 动图 {ugoira}",
      sizeDescribePixels: "像素数 ≥ {threshold}",
      sizeDescribeDimensions: "长短边 ≥ {threshold}",
      ugoiraTitle: "动图格式",
      ugoiraHint: "可多选，每种格式各存一个文件",
      ugoiraKeepOne: "至少要保留一种格式",
      selectAll: "全选",
      formatGif: "GIF（默认）",
      formatGifHint: "兼容性最好；最多 256 色（已用专属调色板优化）",
      formatApngHint: "无损、全彩色，浏览器可播放；部分看图软件只显示第一帧，文件较大",
      formatZip: "原始帧压缩包",
      formatZipHint: "Pixiv 原始帧 + animation.json（帧时长、标签、作者、链接），不转换",
      formatAllThree: "全部三种",
      downloadAll: "下载所有已打开作品",
      rescan: "重新扫描",
      footerSaved: "保存位置：{path}",
      disclaimerShort: "免责声明：作品版权归原作者所有，下载内容仅供个人欣赏与收藏；转载、二次发布或商用前请先取得作者授权，并遵守 Pixiv 使用条款。本扩展不是 Pixiv 官方产品。",

      // ---- 弹窗：进度与结果 ----
      readingArtworks: "正在读取作品信息…",
      retryingFailed: "正在重试失败项…",
      progressRetrying: "正在重试失败项 {current}（{done}/{total}）",
      progressConverting: "正在转换动图 {current}（{finished}/{total}）",
      progressProcessing: "正在处理 {current}（{finished}/{total}）",
      artworkPlaceholder: "作品",
      resultSaved: "完成：已保存 {count} 个文件",
      resultFailed: "{count} 项失败",
      resultWarnings: "{count} 个文件元数据不完整",
      resultSkipped: "跳过 {count} 张小图",
      downloadJobFailed: "下载任务失败",
      failedPrefix: "失败：{message}",

      // ---- 规则页 ----
      optionsTitle: "标签文件夹规则",
      optionsDocumentTitle: "标签文件夹规则 - {name}",
      explainSave: "作品带有规则里的任一标签时，图片平铺保存到 <code>{root}文件夹/</code>；没有命中任何规则的作品按弹窗里的原有方式保存。",
      explainMatch: "规则<strong>从上到下</strong>匹配，命中第一条即停止，可用 ↑ ↓ 调整优先级。标签会同时和 Pixiv 原始标签及其译名比较，忽略大小写、全角半角和空格。文件夹可以用 <code>/</code> 写多级，例如 <code>原神/角色</code>。",
      emptyRules: "还没有规则。点击下面的按钮添加，或在弹窗里直接点击作品的标签。",
      addRule: "添加规则",
      saving: "正在保存…",
      saved: "已保存",
      savedSkipped: "已保存（{count} 条缺少文件夹或标签的规则未生效）",
      folderPlaceholder: "文件夹名",
      tagsCaption: "标签（每行一个，或用逗号分隔）",
      moveUp: "提高优先级",
      moveDown: "降低优先级",
      deleteLabel: "删除",
      deleteRule: "删除这条规则",
      disclaimerFull: "免责声明：本扩展只是帮你保存自己在 Pixiv 上能够查看的作品，不是 Pixiv 官方产品。作品的著作权归原作者所有，下载的内容仅供个人欣赏与收藏；转载、二次发布或商业使用前，请先取得作者授权，并遵守 Pixiv 使用条款。因使用本扩展产生的版权纠纷，由使用者自行承担。",
      backupTitle: "备份",
      backupText: "卸载扩展会清空规则，建议定期导出。导入会<strong>替换</strong>当前全部规则。",
      exportJson: "导出为 JSON",
      importJson: "导入 JSON",
      importNoRules: "文件里没有有效的规则",
      imported: "已导入 {count} 条规则",
      importFailed: "导入失败：{message}",

      // ---- 后台与处理模块的提示 ----
      extensionLabel: "扩展",
      labelImage: "图片",
      httpError: "{label} 返回 HTTP {status}",
      shortRead: "{label}只收到 {received} 字节，应为 {expected} 字节",
      downloadInterrupted: "下载被中断",
      downloadInterruptedCode: "下载被中断（{code}）",
      unsupportedFormat: "不支持写入该图片格式",
      tagsOmitted: "标签过多，已省略最后 {count} 个标签",
      apiRejected: "Pixiv API 拒绝了请求",
      noUgoiraArchive: "没有找到动图帧压缩包",
      noImages: "作品没有可下载的图片",
      pageMissingUrl: "第 {page} 页缺少图片地址",
      badgeRetry: "重试",
      artworkIdNumeric: "作品 ID 必须为数字",
      metadataTooLarge: "元数据过大，无法写入 JPG",
      pngChunkCorrupt: "PNG 数据块已损坏",
      pngNoIhdr: "PNG 缺少 IHDR",
      gifTooShort: "GIF 数据过短",
      gifPaletteOverflow: "GIF 调色板越界",
      emptyResponse: "服务器返回了空内容",
      htmlResponse: "服务器返回了网页而不是图片",
      notImage: "内容不是 JPG / PNG / GIF 图片",
      jpgIncomplete: "JPG 文件不完整（缺少结束标记）",
      pngIncomplete: "PNG 文件不完整（缺少 IEND 块）",
      gifIncomplete: "GIF 文件不完整（缺少结束符）",
      zipNoCentralDir: "动图 ZIP 缺少中央目录",
      zipCentralDirCorrupt: "动图 ZIP 的中央目录已损坏",
      zipNameOverflow: "动图 ZIP 文件名越界",
      zipLocalHeaderCorrupt: "动图帧 {file} 的本地文件头已损坏",
      zipDataOverflow: "动图帧 {file} 数据越界",
      zipUnsupportedMethod: "不支持 ZIP 压缩方式 {method}",
      zipNoDecompression: "当前浏览器不支持动图 ZIP 解压",
      zipInflateLength: "动图帧 {file} 解压长度不正确",
      gifNoPixels: "GIF 帧没有像素",
      ugoiraSizeInvalid: "动图尺寸无效",
      gifFrameSizeMismatch: "GIF 帧尺寸不一致",
      noCanvas: "当前浏览器后台无法创建 GIF 画布",
      frameMissing: "ZIP 中没有找到动图帧 {file}",
      noCanvasContext: "无法创建 GIF 画布上下文",
      framesSizeMismatch: "动图各帧尺寸不一致",
      noApngCompression: "当前浏览器不支持 APNG 压缩",
      noFrames: "动图没有帧",
      noFrameInfo: "动图缺少帧信息",
      noImageDecode: "当前浏览器不能解码动图帧",
      zipHttp: "动图 ZIP 返回 HTTP {status}",
      zipShortRead: "动图压缩包只收到 {received} 字节，应为 {expected} 字节"
    },

    en: {
      languageLabel: "Language",
      languageAuto: "Browser default",
      on: "On",
      off: "Off",
      cancel: "Cancel",
      saveFailed: "Save failed: {message}",
      colon: ": ",
      listSeparator: ", ",

      headerTitle: "Pixiv Downloader",
      headerSubtitle: "Scans every window in this browser",
      windowSubtitle: "Separate window · stays open when you click elsewhere",
      taskRunning: "Downloading",
      taskLastResult: "Last download",
      openWindow: "Open in a separate window",
      dismissResult: "Dismiss this result",
      failuresTitle: "Failed items",
      retryFailed: "Retry failed items",
      retryFailedCount: "Retry failed items ({count})",
      warningsTitle: "Metadata not fully written",
      skippedTitle: "Skipped small images",

      scanning: "Scanning…",
      pleaseWait: "Please wait",
      scanningTabs: "Reading open tabs and artwork tags",
      scanFailed: "Scan failed",
      foundArtworks: "Found {count} artworks",
      openArtworkFirst: "Open pages like pixiv.net/artworks/<number> first",
      artworksHeading: "Artworks and save locations",
      manageRules: "Manage tag rules",
      artworksHint: "Click a tag to assign it to a folder (saved as a rule). Use the dropdown to change where one artwork goes for this download only.",
      saveLocation: "Save location",
      destAuto: "Auto: {path}",
      destRoot: "No tag folder: {path}",
      fallbackPerArtwork: "{root}ID - title/",
      tagFormLabel: "Save “{tag}” to {root}",
      saveRule: "Save rule",
      pages: "{count} pages",
      willSkipSuffix: " · will skip",
      willSkipSummary: "Will skip (too small)",
      readTagsFailed: "Couldn't read tags: {message}",
      chipRuled: "Already in a tag rule. Click to change its folder",
      chipAdd: "Click to assign this tag to a folder",
      noTags: "No tags",

      folderLegend: "Artworks that match no tag rule",
      folderPerArtwork: "One folder per artwork",
      folderPerArtworkPath: "{root}ID - title/images",
      folderFlat: "Everything in one folder",
      folderFlatPath: "{root}all images",
      pathNoteRules: "Artworks that match a tag rule are saved directly in <code>{root}&lt;rule folder&gt;/</code>.",
      saveLocationNote: "Extensions can only save into Firefox's download folder. To save to another drive or folder, change the default download folder in Firefox's settings.",
      saveLocationLegend: "Save location",
      saveFolderLabel: "Save to",
      downloadsDir: "Downloads",
      rootEmptyPlaceholder: "Leave empty to save straight into Downloads",
      openDownloadsFolder: "Open download folder",
      metadataTitle: "Image metadata",
      metadataOption: "Write tags, artist and artwork link",
      metadataOptionHint: "Shown in Windows Explorer under Properties → Details as Tags / Authors / Comments",
      metadataOn: "On",
      metadataOff: "Off",
      sizeTitle: "Size filter",
      sizeTabImage: "Images",
      sizeTabUgoira: "Animations",
      sizeSkipImages: "Skip images that are too small",
      sizeSkipImagesHint: "Checked page by page. Skipped images are not downloaded and don't count as failures",
      sizeSkipUgoira: "Skip animations that are too small",
      sizeSkipUgoiraHint: "Uses the animation's own size. All selected formats are skipped together",
      width: "Width",
      height: "Height",
      modeDimensions: "Long and short side must both reach it",
      modePixels: "Total pixel count must reach it",
      dimensionsHint: "Long side ≥ {long} and short side ≥ {short}. {short}×{long} also passes",
      pixelsHint: "Width × height ≥ {pixels}",
      sizeSummary: "Images {image} · Animations {ugoira}",
      sizeDescribePixels: "pixels ≥ {threshold}",
      sizeDescribeDimensions: "sides ≥ {threshold}",
      ugoiraTitle: "Animation format",
      ugoiraHint: "Pick one or more. Each format is saved as its own file",
      ugoiraKeepOne: "Keep at least one format",
      selectAll: "Select all",
      formatGif: "GIF (default)",
      formatGifHint: "Plays everywhere. Up to 256 colors (palette tuned for each animation)",
      formatApngHint: "Lossless, full color, plays in browsers. Some image viewers show only the first frame. Larger files",
      formatZip: "Original frames (ZIP)",
      formatZipHint: "pixiv's original frames + animation.json (frame delays, tags, artist, link), no conversion",
      formatAllThree: "All three",
      downloadAll: "Download all open artworks",
      rescan: "Rescan",
      footerSaved: "Saving to: {path}",
      disclaimerShort: "Disclaimer: artworks belong to their creators. Downloads are for personal viewing and collecting only. Get the artist's permission before reposting, redistributing or using them commercially, and follow pixiv's Terms of Use. This extension is not made by pixiv.",

      readingArtworks: "Reading artwork info…",
      retryingFailed: "Retrying failed items…",
      progressRetrying: "Retrying failed items {current} ({done}/{total})",
      progressConverting: "Converting animation {current} ({finished}/{total})",
      progressProcessing: "Processing {current} ({finished}/{total})",
      artworkPlaceholder: "artwork",
      resultSaved: "Done: saved {count} files",
      resultFailed: "{count} failed",
      resultWarnings: "{count} with incomplete metadata",
      resultSkipped: "{count} small images skipped",
      downloadJobFailed: "Download failed",
      failedPrefix: "Failed: {message}",

      optionsTitle: "Tag folder rules",
      optionsDocumentTitle: "Tag folder rules - {name}",
      explainSave: "When an artwork has any tag from a rule, its images are saved directly in <code>{root}&lt;folder&gt;/</code>. Artworks that match no rule are saved the way you chose in the popup.",
      explainMatch: "Rules are checked <strong>from top to bottom</strong> and the first match wins. Use ↑ ↓ to change priority. Tags are compared with both pixiv's original tag and its translation, ignoring case, full-width/half-width and spaces. Use <code>/</code> for subfolders, e.g. <code>Genshin/Characters</code>.",
      emptyRules: "No rules yet. Add one with the button below, or click an artwork's tag in the popup.",
      addRule: "Add rule",
      saving: "Saving…",
      saved: "Saved",
      savedSkipped: "Saved ({count} rules without a folder or tags are ignored)",
      folderPlaceholder: "Folder name",
      tagsCaption: "Tags (one per line, or comma-separated)",
      moveUp: "Move up",
      moveDown: "Move down",
      deleteLabel: "Delete",
      deleteRule: "Delete this rule",
      disclaimerFull: "Disclaimer: this extension only helps you save artworks you can already view on pixiv, and is not made by pixiv. Artworks belong to their creators. Downloads are for personal viewing and collecting only. Get the artist's permission before reposting, redistributing or using them commercially, and follow pixiv's Terms of Use. You are responsible for any copyright dispute arising from your use of this extension.",
      backupTitle: "Backup",
      backupText: "Uninstalling the extension deletes your rules, so export them now and then. Importing <strong>replaces</strong> all current rules.",
      exportJson: "Export as JSON",
      importJson: "Import JSON",
      importNoRules: "No valid rules in the file",
      imported: "Imported {count} rules",
      importFailed: "Import failed: {message}",

      extensionLabel: "Extension",
      labelImage: "Image",
      httpError: "{label} returned HTTP {status}",
      shortRead: "{label}: received {received} bytes, expected {expected}",
      downloadInterrupted: "Download interrupted",
      downloadInterruptedCode: "Download interrupted ({code})",
      unsupportedFormat: "Metadata can't be written to this image format",
      tagsOmitted: "Too many tags. The last {count} were left out",
      apiRejected: "The pixiv API rejected the request",
      noUgoiraArchive: "Animation frame archive not found",
      noImages: "This artwork has no downloadable images",
      pageMissingUrl: "Page {page} has no image URL",
      badgeRetry: "↻",
      artworkIdNumeric: "Artwork ID must be a number",
      metadataTooLarge: "Metadata is too large for JPG",
      pngChunkCorrupt: "PNG chunk is corrupt",
      pngNoIhdr: "PNG has no IHDR chunk",
      gifTooShort: "GIF data is too short",
      gifPaletteOverflow: "GIF palette is out of bounds",
      emptyResponse: "The server returned an empty response",
      htmlResponse: "The server returned a web page instead of an image",
      notImage: "The content is not a JPG / PNG / GIF image",
      jpgIncomplete: "JPG file is incomplete (no end marker)",
      pngIncomplete: "PNG file is incomplete (no IEND chunk)",
      gifIncomplete: "GIF file is incomplete (no trailer)",
      zipNoCentralDir: "Animation ZIP has no central directory",
      zipCentralDirCorrupt: "Animation ZIP central directory is corrupt",
      zipNameOverflow: "Animation ZIP file name is out of bounds",
      zipLocalHeaderCorrupt: "Local header of frame {file} is corrupt",
      zipDataOverflow: "Data of frame {file} is out of bounds",
      zipUnsupportedMethod: "Unsupported ZIP compression method {method}",
      zipNoDecompression: "This browser can't unzip animations",
      zipInflateLength: "Frame {file} unzipped to the wrong length",
      gifNoPixels: "GIF frame has no pixels",
      ugoiraSizeInvalid: "Invalid animation size",
      gifFrameSizeMismatch: "GIF frame size doesn't match",
      noCanvas: "This browser can't create a canvas in the background",
      frameMissing: "Frame {file} not found in the ZIP",
      noCanvasContext: "Couldn't create a canvas context",
      framesSizeMismatch: "Animation frames have different sizes",
      noApngCompression: "This browser can't compress APNG",
      noFrames: "The animation has no frames",
      noFrameInfo: "The animation has no frame information",
      noImageDecode: "This browser can't decode animation frames",
      zipHttp: "Animation ZIP returned HTTP {status}",
      zipShortRead: "Animation ZIP: received {received} bytes, expected {expected}"
    }
  };

  let preference = null;
  let language = "zh";
  const listeners = new Set();

  function detectBrowserLanguage() {
    let tag = "";
    try {
      if (typeof chrome !== "undefined" && chrome.i18n && typeof chrome.i18n.getUILanguage === "function") {
        tag = chrome.i18n.getUILanguage();
      }
    } catch (_error) {
      tag = "";
    }
    if (!tag && typeof navigator !== "undefined") tag = navigator.language || "";
    return /^zh/i.test(tag) ? "zh" : "en";
  }

  function normalizePreference(value) {
    return PREFERENCES.includes(value) ? value : "auto";
  }

  function resolveLanguage(value) {
    const normalized = normalizePreference(value);
    return normalized === "auto" ? detectBrowserLanguage() : normalized;
  }

  function setPreference(value) {
    preference = normalizePreference(value);
    const next = resolveLanguage(preference);
    const changed = next !== language;
    language = next;
    if (changed) for (const listener of listeners) listener(language);
    return language;
  }

  // 找不到键时退回中文，再退回键名本身，避免界面出现空白。
  function t(key, params) {
    const table = MESSAGES[language] || MESSAGES.zh;
    const template = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : MESSAGES.zh[key];
    if (template === undefined) return key;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // 读取保存的语言设置，并在任一页面修改设置时同步到当前页面。
  let initialized = null;
  function init() {
    if (initialized) return initialized;
    initialized = new Promise((resolve) => {
      const storage = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
      if (!storage) {
        resolve(setPreference("auto"));
        return;
      }
      if (chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === "local" && changes[LANGUAGE_KEY]) setPreference(changes[LANGUAGE_KEY].newValue);
        });
      }
      storage.get(LANGUAGE_KEY, (items) => {
        const failed = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError;
        resolve(setPreference(failed ? "auto" : items && items[LANGUAGE_KEY]));
      });
    });
    return initialized;
  }

  function savePreference(value) {
    const normalized = normalizePreference(value);
    setPreference(normalized);
    const storage = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
    if (storage) storage.set({ [LANGUAGE_KEY]: normalized });
  }

  function decodeEntities(text) {
    return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
  }

  // 把文案里的 <code> / <strong> 转成真正的元素，其余一律当纯文本，不使用 innerHTML。
  function renderMarkup(element, markup) {
    const doc = element.ownerDocument;
    const nodes = [];
    const stack = [{ append: (node) => nodes.push(node) }];
    for (const part of String(markup).split(/(<\/?(?:code|strong)>)/)) {
      if (!part) continue;
      const tag = part.match(/^<(\/?)(code|strong)>$/);
      if (!tag) {
        stack[stack.length - 1].append(doc.createTextNode(decodeEntities(part)));
      } else if (tag[1]) {
        if (stack.length > 1) stack.pop();
      } else {
        const child = doc.createElement(tag[2]);
        stack[stack.length - 1].append(child);
        stack.push(child);
      }
    }
    element.replaceChildren(...nodes);
  }

  // 按 data-i18n* 属性替换页面文字。data-i18n-html 的文案可以带 <code> / <strong>。
  // params 用来填页面文字里的占位符（例如 {root}）。
  function applyDom(root, params) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    for (const element of root.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n, params);
    for (const element of root.querySelectorAll("[data-i18n-html]")) renderMarkup(element, t(element.dataset.i18nHtml, params));
    for (const element of root.querySelectorAll("[data-i18n-title]")) element.title = t(element.dataset.i18nTitle, params);
    for (const element of root.querySelectorAll("[data-i18n-placeholder]")) element.placeholder = t(element.dataset.i18nPlaceholder, params);
    for (const element of root.querySelectorAll("[data-i18n-aria-label]")) element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel, params));
    if (root.documentElement) root.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }

  // 语言下拉框：显示当前设置，改动后保存（其他页面和后台会通过 storage 事件同步）。
  function bindLanguageSelect(select) {
    if (!select) return;
    select.value = preference || "auto";
    select.addEventListener("change", () => savePreference(select.value));
  }

  return {
    LANGUAGE_KEY,
    MESSAGES,
    t,
    init,
    onChange,
    setPreference,
    savePreference,
    resolveLanguage,
    detectBrowserLanguage,
    applyDom,
    renderMarkup,
    bindLanguageSelect,
    language: () => language,
    preference: () => preference || "auto"
  };
});
