/* global chrome */
"use strict";

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const headers = details.requestHeaders || [];
    const existing = headers.find((header) => header.name.toLowerCase() === "referer");
    if (existing) existing.value = "https://www.pixiv.net/";
    else headers.push({ name: "Referer", value: "https://www.pixiv.net/" });
    return { requestHeaders: headers };
  },
  { urls: ["https://*.pximg.net/*"] },
  ["blocking", "requestHeaders"]
);
