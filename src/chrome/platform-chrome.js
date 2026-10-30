/* global chrome, PixivI18n, PixivPrepare */
"use strict";

// Chrome / Edge 的平台实现，供 background.js 使用（挂在 globalThis.PixivPlatform 上）。
// - service worker 不能创建 blob 地址：取图、写元数据、转换动图交给离屏页 offscreen.html，后台只拿回地址去下载。
// - pximg.net 要求 Referer：用 declarativeNetRequest 会话规则，只改扩展自己发出的请求（tabIds: [-1]）。
// - service worker 闲置约 30 秒会被关掉：下载期间定时调用扩展接口保持活跃；结果存进 storage.session，重启后恢复。
(function () {
  const OFFSCREEN_URL = "offscreen.html";
  const MESSAGE_TARGET = "pixiv-offscreen";
  const STATE_KEY = "pixivLastRun";
  const REFERER_RULE_ID = 1;

  const refererReady = chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [REFERER_RULE_ID],
    addRules: [{
      id: REFERER_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "Referer", operation: "set", value: "https://www.pixiv.net/" }]
      },
      condition: {
        requestDomains: ["pximg.net"],
        tabIds: [-1],
        resourceTypes: ["xmlhttprequest", "other"]
      }
    }]
  }).catch((error) => console.error("Referer rule failed:", error));

  let creating = null;

  async function hasOffscreenDocument() {
    if (typeof chrome.runtime.getContexts !== "function") return false;
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
    });
    return contexts.length > 0;
  }

  async function ensureOffscreen() {
    if (await hasOffscreenDocument()) return;
    if (!creating) {
      creating = chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ["BLOBS"],
        justification: "Create blob URLs for downloaded images, write their metadata and convert pixiv animations."
      }).catch((error) => {
        // 并发创建时另一个调用已经建好了，忽略这个错误。
        if (!/single offscreen/i.test(String(error && error.message))) throw error;
      }).finally(() => {
        creating = null;
      });
    }
    await creating;
  }

  async function callOffscreen(message) {
    await refererReady;
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({ ...message, target: MESSAGE_TARGET, language: PixivI18n.language() });
    if (!response) throw new Error("The offscreen document did not respond");
    if (!response.ok) throw PixivPrepare.deserializeError(response.error);
    return response;
  }

  let keepAliveTimer = null;

  globalThis.PixivPlatform = {
    async prepare(file) {
      const response = await callOffscreen({ type: "prepare", file });
      return { url: response.url, warnings: response.warnings || [] };
    },
    async release(prepared) {
      if (prepared) await callOffscreen({ type: "release", url: prepared.url });
    },
    releaseArchive(url) {
      callOffscreen({ type: "releaseArchive", url }).catch(() => {});
    },
    keepAlive(active) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = active ? setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000) : null;
    },
    saveState(snapshot) {
      if (chrome.storage.session) chrome.storage.session.set({ [STATE_KEY]: snapshot }).catch(() => {});
    },
    async loadState() {
      if (!chrome.storage.session) return null;
      const items = await chrome.storage.session.get(STATE_KEY);
      return items[STATE_KEY] || null;
    }
  };
})();
