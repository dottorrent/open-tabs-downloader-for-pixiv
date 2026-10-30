# Chrome / Edge 版说明

`node build.js chrome` 生成 `dist/*-chrome.zip`，Chrome 和 Edge 用同一个包（Manifest V3）。

## 本地安装（不经过商店）

浏览器不能直接安装 zip，要先解压：

1. 把 `open-tabs-downloader-for-pixiv-<版本>-public-chrome.zip` 解压到一个固定的文件夹（之后不要删除或移动）。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
3. 打开“开发者模式”，点“加载解压缩的扩展”（Edge：“加载解压缩的扩展”），选刚才的文件夹。

## 上架

- **Edge 外接程序**（Microsoft Partner Center）：注册免费。直接上传 zip。
- **Chrome 网上应用店**（Chrome Web Store Developer Dashboard）：需要一次性支付 5 美元注册费。直接上传 zip。

商店说明可以沿用 `listing-zh.md` / `listing-en.md`，但要把“Firefox 的下载目录”改成“浏览器的下载目录”。

### 权限说明（Chrome 网上应用店要求逐项填写）

- **单一用途**：Download the original images of the pixiv artwork pages the user has open in the browser.
- `tabs`：Read the URLs of open tabs to find pixiv artwork pages (`pixiv.net/artworks/<id>`).
- `downloads`：Save the images to the user's download folder.
- `storage`：Store the user's settings (tag-to-folder rules, UI language) and the last download result.
- `declarativeNetRequest`：pixiv's image server (i.pximg.net) rejects requests without `Referer: https://www.pixiv.net/`. One session rule sets this header, only for the extension's own requests to pximg.net (`tabIds: [-1]`); web pages are not affected.
- `offscreen`：Service workers cannot create blob URLs. An offscreen document fetches the image, writes metadata / converts animations, and creates the blob URL that is passed to `chrome.downloads`.
- Host permissions `https://www.pixiv.net/*`, `https://*.pximg.net/*`：Read artwork information from pixiv's own JSON endpoints with the user's existing session, and fetch the original images.
- **远程代码**：No. All code is in the package.
- **数据使用**：The extension collects no user data.

## 与 Firefox 版的差异

| | Firefox | Chrome / Edge |
|---|---|---|
| 规范 | Manifest V2 | Manifest V3 |
| 后台 | 常驻后台页 | service worker（下载期间保持活跃，结果存进 `storage.session`） |
| 图片处理 | 后台页里直接处理 | 离屏页 `offscreen.html` |
| Referer | `webRequest` 改请求头 | `declarativeNetRequest` 会话规则 |
| 图标 | SVG | PNG 16 / 32 / 48 / 128 |
