/* global chrome, PixivI18n, PixivPrepare */
"use strict";

// 离屏页只处理后台（platform-chrome.js）发来的消息；弹窗发给后台的消息也会广播到这里，按 target 忽略。
// 离屏页里只能用 chrome.runtime，读不到 storage，所以界面语言由后台随消息一起带过来。
async function handle(message) {
  switch (message.type) {
    case "prepare": {
      const { blob, warnings } = await PixivPrepare.prepareFile(message.file);
      return { url: URL.createObjectURL(blob), warnings };
    }
    case "release":
      URL.revokeObjectURL(message.url);
      return {};
    case "releaseArchive":
      PixivPrepare.releaseUgoiraArchive(message.url);
      return {};
    default:
      throw new Error(`Unknown offscreen message: ${message.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== "pixiv-offscreen") return false;
  if (message.language) PixivI18n.setPreference(message.language);
  handle(message).then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: PixivPrepare.serializeError(error) })
  );
  return true;
});
