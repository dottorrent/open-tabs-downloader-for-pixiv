/* global importScripts */
"use strict";

// Chrome / Edge（Manifest V3）的 service worker 入口：按顺序加载共用模块。
// 图片处理（ugoira.js / metadata.js）不在这里加载，而是在离屏页 offscreen.html 里运行。
importScripts("i18n.js", "lib.js", "prepare.js", "platform-chrome.js", "background.js");
