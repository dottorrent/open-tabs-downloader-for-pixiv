/* global chrome, PixivDownloaderUtils, PixivI18n */
"use strict";

const { normalizeRules, splitTagList, normalizeDownloadRoot } = PixivDownloaderUtils;
const RULES_KEY = "tagRules";
const { t } = PixivI18n;

// 保存文件夹在弹窗里设置（localStorage，扩展各页面共用）；这里只用来显示路径前缀。
function rootLabel() {
  const saved = localStorage.getItem("pixiv-download-root");
  const root = saved === null ? "Pixiv" : normalizeDownloadRoot(saved);
  return root ? `${root}/` : `${t("downloadsDir")}/`;
}

// 扩展名称来自 _locales（随浏览器语言，私人版和公开版各不相同）。
function extensionName() {
  try {
    const name = chrome.i18n && chrome.i18n.getMessage("extensionName");
    if (name) return name;
  } catch (_error) {
    // 没有 i18n 接口时退回 manifest。
  }
  const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
  return manifest && manifest.name && !manifest.name.startsWith("__MSG_") ? manifest.name : "";
}

function applyHeader() {
  const name = extensionName();
  if (!name) return;
  document.querySelector("#extensionName").textContent = name;
  document.title = t("optionsDocumentTitle", { name });
}

const ruleList = document.querySelector("#ruleList");
const empty = document.querySelector("#empty");
const status = document.querySelector("#status");
const addButton = document.querySelector("#addRule");
const exportButton = document.querySelector("#exportRules");
const importInput = document.querySelector("#importRules");

// 编辑中的草稿：允许暂时为空的规则存在，保存时才用 normalizeRules 过滤。
let draft = [];
let lastSaved = "[]";
let saveTimer = null;

function loadRules() {
  return new Promise((resolve) => {
    chrome.storage.local.get(RULES_KEY, (items) => {
      resolve(chrome.runtime.lastError ? [] : normalizeRules(items && items[RULES_KEY]));
    });
  });
}

function writeRules(rules) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [RULES_KEY]: rules }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

async function saveNow() {
  clearTimeout(saveTimer);
  const rules = normalizeRules(draft.map((rule) => ({ folder: rule.folder, tags: splitTagList(rule.tags) })));
  lastSaved = JSON.stringify(rules);
  try {
    await writeRules(rules);
    const skipped = draft.length - rules.length;
    status.textContent = skipped ? t("savedSkipped", { count: skipped }) : t("saved");
  } catch (error) {
    status.textContent = t("saveFailed", { message: error.message || String(error) });
  }
}

function scheduleSave() {
  status.textContent = t("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

function toDraft(rules) {
  return rules.map((rule) => ({ folder: rule.folder, tags: rule.tags.join("\n") }));
}

function smallButton(text, title, onClick, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon";
  button.textContent = text;
  button.title = title;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function move(index, offset) {
  const target = index + offset;
  if (target < 0 || target >= draft.length) return;
  [draft[index], draft[target]] = [draft[target], draft[index]];
  render();
  saveNow();
}

function render() {
  ruleList.replaceChildren(...draft.map((rule, index) => {
    const item = document.createElement("li");

    const folderLabel = document.createElement("label");
    folderLabel.className = "folder";
    const prefix = document.createElement("span");
    prefix.textContent = rootLabel();
    const folder = document.createElement("input");
    folder.type = "text";
    folder.placeholder = t("folderPlaceholder");
    folder.value = rule.folder;
    folder.addEventListener("input", () => {
      rule.folder = folder.value;
      scheduleSave();
    });
    folderLabel.append(prefix, folder);

    const tagsLabel = document.createElement("label");
    tagsLabel.className = "tags";
    const caption = document.createElement("span");
    caption.textContent = t("tagsCaption");
    const tags = document.createElement("textarea");
    tags.rows = Math.min(6, Math.max(2, rule.tags.split("\n").length));
    tags.placeholder = "原神\nGenshinImpact";
    tags.value = rule.tags;
    tags.addEventListener("input", () => {
      rule.tags = tags.value;
      scheduleSave();
    });
    tagsLabel.append(caption, tags);

    const tools = document.createElement("div");
    tools.className = "tools";
    tools.append(
      smallButton("↑", t("moveUp"), () => move(index, -1), index === 0),
      smallButton("↓", t("moveDown"), () => move(index, 1), index === draft.length - 1),
      smallButton(t("deleteLabel"), t("deleteRule"), () => {
        draft.splice(index, 1);
        render();
        saveNow();
      }, false)
    );

    item.append(folderLabel, tagsLabel, tools);
    return item;
  }));
  empty.classList.toggle("hidden", draft.length > 0);
}

addButton.addEventListener("click", () => {
  draft.push({ folder: "", tags: "" });
  render();
  ruleList.lastElementChild.querySelector("input").focus();
});

exportButton.addEventListener("click", async () => {
  await saveNow();
  const blob = new Blob([JSON.stringify(JSON.parse(lastSaved), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pixiv-tag-rules.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

importInput.addEventListener("change", async () => {
  const file = importInput.files && importInput.files[0];
  importInput.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const rules = normalizeRules(Array.isArray(parsed) ? parsed : parsed && parsed[RULES_KEY]);
    if (!rules.length) throw new Error(t("importNoRules"));
    draft = toDraft(rules);
    render();
    await saveNow();
    status.textContent = t("imported", { count: rules.length });
  } catch (error) {
    status.textContent = t("importFailed", { message: error.message || String(error) });
  }
});

// 弹窗里新增规则时同步过来；自己刚保存的改动不重绘，避免打断输入。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[RULES_KEY]) return;
  const rules = normalizeRules(changes[RULES_KEY].newValue);
  if (JSON.stringify(rules) === lastSaved) return;
  lastSaved = JSON.stringify(rules);
  draft = toDraft(rules);
  render();
});

PixivI18n.onChange(() => {
  PixivI18n.applyDom(document, { root: rootLabel() });
  applyHeader();
  render();
});

(async () => {
  await PixivI18n.init();
  PixivI18n.bindLanguageSelect(document.querySelector("#languageSelect"));
  PixivI18n.applyDom(document, { root: rootLabel() });
  applyHeader();
  const rules = await loadRules();
  lastSaved = JSON.stringify(rules);
  draft = toDraft(rules);
  render();
})();
