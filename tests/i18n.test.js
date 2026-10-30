"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const I18n = require("../src/i18n.js");
const M = require("../src/metadata.js");

const SRC = path.join(__dirname, "..", "src");
const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort();

test("中英文对照表的键完全一致，占位符也一致", () => {
  const zh = I18n.MESSAGES.zh;
  const en = I18n.MESSAGES.en;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const key of Object.keys(zh)) {
    assert.deepEqual(placeholders(en[key]), placeholders(zh[key]), `${key} 的占位符不一致`);
    assert.ok(en[key].trim(), `${key} 的英文为空`);
  }
});

test("页面里引用的 data-i18n 键都在对照表里", () => {
  for (const file of ["popup.html", "options.html"]) {
    const html = fs.readFileSync(path.join(SRC, file), "utf8");
    const keys = [...html.matchAll(/data-i18n(?:-html|-title|-placeholder|-aria-label)?="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(keys.length > 10);
    for (const key of keys) assert.ok(I18n.MESSAGES.zh[key], `${file} 引用了不存在的键 ${key}`);
  }
});

test("脚本里 t(\"…\") 引用的键都在对照表里", () => {
  for (const file of fs.readdirSync(SRC).filter((name) => name.endsWith(".js") && name !== "i18n.js")) {
    const source = fs.readFileSync(path.join(SRC, file), "utf8");
    for (const match of source.matchAll(/\bt\("(\w+)"/g)) {
      assert.ok(I18n.MESSAGES.zh[match[1]], `${file} 引用了不存在的键 ${match[1]}`);
    }
  }
});

test("t：插值、未知键、退回中文", () => {
  I18n.setPreference("zh");
  assert.equal(I18n.t("foundArtworks", { count: 3 }), "找到 3 个作品");
  assert.equal(I18n.t("noSuchKey"), "noSuchKey");
  I18n.setPreference("en");
  assert.equal(I18n.t("foundArtworks", { count: 3 }), "Found 3 artworks");
  assert.equal(I18n.t("httpError", { label: "Image", status: 404 }), "Image returned HTTP 404");
  I18n.setPreference("zh");
});

test("跟随浏览器：中文浏览器显示中文，其他语言显示英文", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const setLanguage = (language) => Object.defineProperty(globalThis, "navigator", { value: { language }, configurable: true });
  try {
    setLanguage("zh-TW");
    assert.equal(I18n.resolveLanguage("auto"), "zh");
    setLanguage("ja-JP");
    assert.equal(I18n.resolveLanguage("auto"), "en");
    setLanguage("en-US");
    assert.equal(I18n.resolveLanguage("auto"), "en");
    assert.equal(I18n.resolveLanguage("zh"), "zh");
    assert.equal(I18n.resolveLanguage("bogus"), "en");
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  }
});

test("切换语言后，处理模块生成的提示也跟着变", () => {
  const html = Buffer.from("<html>");
  try {
    I18n.setPreference("en");
    assert.equal(M.checkImage(html), "The server returned a web page instead of an image");
    I18n.setPreference("zh");
    assert.equal(M.checkImage(html), "服务器返回了网页而不是图片");
  } finally {
    I18n.setPreference("zh");
  }
});

test("onChange 只在实际语言变化时通知", () => {
  I18n.setPreference("zh");
  const seen = [];
  const off = I18n.onChange((language) => seen.push(language));
  I18n.setPreference("zh");
  I18n.setPreference("en");
  I18n.setPreference("en");
  I18n.setPreference("zh");
  off();
  I18n.setPreference("en");
  I18n.setPreference("zh");
  assert.deepEqual(seen, ["en", "zh"]);
});

// 极简的假 DOM：记录节点结构，序列化后比较；不依赖 innerHTML。
function fakeDocument() {
  const doc = {
    createTextNode: (text) => ({ text }),
    createElement: (tag) => ({ tag, children: [], append(node) { this.children.push(node); } })
  };
  return doc;
}

function serialize(nodes) {
  return nodes.map((node) => (node.tag ? `<${node.tag}>${serialize(node.children)}</${node.tag}>` : node.text)).join("");
}

test("applyDom：替换文字和属性，填入保存文件夹等参数（不使用 innerHTML）", () => {
  const doc = fakeDocument();
  const make = (dataset, attributes = {}) => ({
    dataset,
    attributes,
    ownerDocument: doc,
    textContent: "",
    title: "",
    placeholder: "",
    children: [],
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name]; }
  });
  const text = make({ i18n: "rescan" });
  const html = make({ i18nHtml: "backupText" });
  const titled = make({ i18nTitle: "dismissResult", i18nAriaLabel: "dismissResult" });
  const withRoot = make({ i18nHtml: "pathNoteRules" });
  const footer = make({ i18n: "footerSaved" });
  const groups = {
    "[data-i18n]": [text, footer],
    "[data-i18n-html]": [html, withRoot],
    "[data-i18n-title]": [titled],
    "[data-i18n-placeholder]": [],
    "[data-i18n-aria-label]": [titled]
  };
  const root = { querySelectorAll: (selector) => groups[selector] || [], documentElement: { lang: "" } };
  try {
    I18n.setPreference("en");
    I18n.applyDom(root, { root: "Art/Pixiv/", path: "Downloads/Art/Pixiv/" });
    assert.equal(text.textContent, "Rescan");
    assert.equal(serialize(html.children), "Uninstalling the extension deletes your rules, so export them now and then. Importing <strong>replaces</strong> all current rules.");
    assert.equal(titled.title, "Dismiss this result");
    assert.equal(titled.attributes["aria-label"], "Dismiss this result");
    assert.equal(serialize(withRoot.children), "Artworks that match a tag rule are saved directly in <code>Art/Pixiv/<rule folder>/</code>.");
    assert.equal(footer.textContent, "Saving to: Downloads/Art/Pixiv/");
    assert.equal(root.documentElement.lang, "en");
  } finally {
    I18n.setPreference("zh");
  }
});

test("renderMarkup：只认 <code> / <strong>，其他标签当纯文本", () => {
  const doc = fakeDocument();
  const element = { ownerDocument: doc, children: [], replaceChildren(...nodes) { this.children = nodes; } };
  I18n.renderMarkup(element, "a <script>x</script> <strong>b <code>c</code></strong> &lt;d&gt;");
  assert.equal(serialize(element.children), "a <script>x</script> <strong>b <code>c</code></strong> <d>");
  assert.ok(element.children.every((node) => !node.tag || ["code", "strong"].includes(node.tag)));
  assert.equal(element.children[0].text, "a <script>x</script> ");
});
