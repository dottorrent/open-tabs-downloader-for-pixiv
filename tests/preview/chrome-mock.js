// 预览用：模拟扩展环境里的 chrome API，让 popup / options 能在普通网页里渲染。
"use strict";
(function () {
  const ARTWORKS = [
    { id: "121000001", title: "璃月港的黄昏", width: 2560, height: 1440, pageCount: 1, tags: [{ name: "原神", translation: "Genshin Impact" }, { name: "風景", translation: "风景" }, { name: "夕焼け", translation: "晚霞" }] },
    { id: "121000002", title: "とても長いタイトルのオリジナルイラスト作品・春の訪れ", width: 1600, height: 1400, pageCount: 1, tags: [{ name: "オリジナル", translation: "原创" }, { name: "女の子", translation: "女孩子" }, { name: "桜", translation: "樱花" }] },
    { id: "121000003", title: "星穹铁道（动图）", width: 600, height: 600, pageCount: 1, isUgoira: true, tags: [{ name: "崩壊スターレイル", translation: "崩坏：星穹铁道" }] },
    { id: "121000004", title: "读取失败的作品", tags: [], error: "Pixiv API 返回 HTTP 429" }
  ];
  const store = { tagRules: JSON.parse(localStorage.getItem("mock-rules") || "null") || [
    { folder: "风景", tags: ["風景"] },
    { folder: "原神", tags: ["原神", "GenshinImpact"] }
  ] };
  const changeListeners = [];
  // ?result=1：上次任务有失败和警告；?result=ok：全部成功；?result=running：进行中。
  const resultMode = new URLSearchParams(location.search).get("result");
  const LAST_STATE = resultMode === "ok" ? {
    running: false, phase: "done", finishedAt: Date.now(), artworkCount: 4, finishedArtworks: 4, queuedFiles: 6,
    failures: [], warnings: [], skipped: [], dismissed: false
  } : resultMode === "running" ? {
    running: true, phase: "downloading", current: "121000003", artworkCount: 4, finishedArtworks: 2, queuedFiles: 3,
    failures: [], warnings: [], skipped: []
  } : resultMode ? {
    running: false, phase: "done", finishedAt: Date.now(), artworkCount: 4, finishedArtworks: 4, queuedFiles: 5,
    failures: [
      { id: "121000003", filename: "121000003_p1.png", message: "图片 返回 HTTP 503" },
      { id: "121000004", filename: "", message: "Pixiv API 返回 HTTP 429" }
    ],
    warnings: [{ id: "121000001", filename: "Pixiv/风景/121000001_p0.jpg", message: "PNG 数据块已损坏" }]
  } : { running: false };
  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        setTimeout(() => {
          if (message.type === "preview") callback({ ok: true, artworks: ARTWORKS });
          else if (message.type === "state") callback({ ok: true, state: LAST_STATE });
          else if (message.type === "dismiss") { LAST_STATE.dismissed = true; callback({ ok: true, state: LAST_STATE }); }
          else if (message.type === "openWindow") callback({ ok: true });
          else callback({ ok: false, error: "mock" });
        }, 150);
      },
      openOptionsPage() { window.open("preview.html?page=options"); }
    },
    windows: {},
    storage: {
      local: {
        get(_key, callback) { callback({ tagRules: store.tagRules }); },
        set(items, callback) {
          const oldValue = store.tagRules;
          Object.assign(store, items);
          localStorage.setItem("mock-rules", JSON.stringify(store.tagRules));
          callback();
          for (const fn of changeListeners) fn({ tagRules: { oldValue, newValue: store.tagRules } }, "local");
        }
      },
      onChanged: { addListener(fn) { changeListeners.push(fn); } }
    }
  };
})();
