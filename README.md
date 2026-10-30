<p align="center"><img src="src/icons/icon.svg" width="96" height="96" alt=""></p>

<h1 align="center">Open Tabs Downloader for Pixiv</h1>

<p align="center">
  A Firefox, Chrome and Edge extension that downloads the original images of every pixiv artwork tab you have open.<br>
  一个 Firefox / Chrome / Edge 扩展：一键下载浏览器里所有已打开的 Pixiv 作品页原图。
</p>

<p align="center">
  <a href="https://addons.mozilla.org/firefox/addon/open-tabs-downloader-for-pixiv/">Firefox Add-ons</a> ·
  <a href="#english">English</a> ·
  <a href="#中文">中文</a>
</p>

> Not made by or affiliated with pixiv. / 本扩展不是 Pixiv 官方产品。

---

## English

### Features

- **Batch download open artworks**: scans the tabs in every window, removes duplicates, and downloads the originals. Multi-page works are saved page by page.
- **Folders by tag**: map tags to folders on the rules page, e.g. save artworks tagged "原神" or "Genshin Impact" to `Pixiv/Genshin/`. Rules match both the original tag and pixiv's translation. Click a tag in the popup to create a rule.
- **Image properties**: writes tags, the artist's name and the artwork link into the XMP metadata of JPG / PNG files. Windows Explorer shows them under Properties → Details as Tags / Authors / Comments.
- **Size filter**: separate thresholds for images and animations, by long/short side or by total pixel count.
- **Animations (ugoira)**: save as GIF (palette tuned for each animation), lossless APNG, or a ZIP of the original frames with their timings. Pick one or more.
- **Reliable downloads**: automatic retries for network errors and rate limits; every file is checked before saving, so error pages or half-downloaded images are never stored; one-click retry for failed items.
- **Save location**: choose the folder inside Firefox's download folder (default `Pixiv`, subfolders allowed).
- **Chinese and English UI**: follows the browser language, switchable from the popup.

### Usage

1. Log in to pixiv in your browser.
2. Open the artwork pages you want to keep (`pixiv.net/artworks/12345`).
3. Click the toolbar button, check where each artwork will be saved, and click **Download all open artworks**.

Browsers only let extensions save inside their download folder. To save to another drive, change the browser's default download folder in its settings.

### Development

Uses [Node.js](https://nodejs.org/) (tested with Node.js 24). There are no dependencies to install.

```bash
node --test tests/*.test.js   # run the tests
node build.js public          # build the Firefox .xpi and the Chrome/Edge .zip into dist/
node build.js public chrome   # Chrome/Edge only
```

**Chrome / Edge**: unzip the `-chrome.zip`, open `chrome://extensions` or `edge://extensions`, turn on Developer mode and choose **Load unpacked**. Publishing notes are in [store/chrome-notes.md](store/chrome-notes.md).

**Firefox**: to try an unsigned build, open `about:debugging` → This Firefox → **Load Temporary Add-on…** and pick the `.xpi`, or install it in Firefox Developer Edition with `xpinstall.signatures.required` set to `false`.

`build.js` produces two editions from the same `src/`: **public** (the one on Firefox Add-ons) and **private** (the author's self-distributed copy, with a different name and add-on ID). Implementation notes (in Chinese) are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

### Privacy

The extension only talks to `pixiv.net` and `pximg.net`, using your existing pixiv session. It collects and sends no data. Settings stay in your browser.

### License and disclaimer

The source code is released under the [MIT License](LICENSE). The license covers the code only and grants no rights to any downloaded artwork.

Artworks belong to their creators. Downloads are for personal viewing and collecting only. Get the artist's permission before reposting, redistributing or using them commercially, and follow pixiv's Terms of Use. You are responsible for any copyright dispute arising from your use of this extension.

---

## 中文

### 功能

- **批量下载已打开的作品**：扫描所有窗口的标签页，自动去重，下载原图；多页作品逐页保存。
- **按标签分文件夹**：在规则页设置“标签 → 文件夹”，例如把带“原神”或“Genshin Impact”标签的作品存到 `Pixiv/原神/`。同时比对原始标签和 Pixiv 提供的译名；在弹窗里点一下标签就能新建规则。
- **写入图片属性**：把标签、作者名和作品链接写入 JPG / PNG 的 XMP 元数据，Windows 资源管理器“属性 → 详细信息”里显示为“标记 / 作者 / 备注”。
- **尺寸筛选**：静态图片和动图分别设置，按“长边和短边”或“总像素数”跳过小图。
- **动图（ugoira）**：可存为 GIF（为每个动图生成专属调色板）、无损 APNG，或附带帧时长的原始帧压缩包，可多选。
- **可靠下载**：网络错误和限流自动重试；保存前检查文件完整性，不会把错误页或半张图存下来；失败项可一键重试。
- **保存位置**：可以设置 Firefox 下载目录里的保存文件夹（默认 `Pixiv`，可多级）。
- **中英文界面**：默认跟随浏览器语言，也可以在弹窗里手动切换。

### 使用方法

1. 在浏览器里登录 Pixiv。
2. 打开想保存的作品页（形如 `pixiv.net/artworks/12345`）。
3. 点工具栏按钮，确认每个作品的保存位置，再点“下载所有已打开作品”。

浏览器只允许扩展把文件存进它的下载目录。想存到其他磁盘，请在浏览器设置里修改默认下载目录。

### 开发

需要 [Node.js](https://nodejs.org/)（在 Node.js 24 上测试过），没有需要安装的依赖。

```bash
node --test tests/*.test.js   # 运行测试
node build.js public          # 打包 Firefox 的 .xpi 和 Chrome/Edge 的 .zip 到 dist/
node build.js public chrome   # 只打包 Chrome/Edge
```

**Chrome / Edge**：把 `-chrome.zip` 解压，打开 `chrome://extensions` 或 `edge://extensions`，开启“开发者模式”，点“加载解压缩的扩展”。上架说明见 [store/chrome-notes.md](store/chrome-notes.md)。

**Firefox**：未签名的安装包可以在 `about:debugging` →“此 Firefox”→“临时载入附加组件”里加载；也可以在 Firefox Developer Edition 里把 `xpinstall.signatures.required` 设为 `false` 后直接安装。

`build.js` 用同一份 `src/` 打出两个版本：**公开版**（商店上架的版本）和**私人版**（作者自用，名称和扩展 ID 不同）。各功能的实现说明见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

### 隐私

扩展只和 `pixiv.net`、`pximg.net` 通信，使用你已有的 Pixiv 登录状态，不收集、不上传任何数据。设置只保存在你自己的浏览器里。

### 许可证与免责声明

源代码以 [MIT 许可证](LICENSE)开源。许可证只适用于扩展的代码，不授予对任何下载作品的权利。

作品的著作权归原作者所有，下载的内容仅供个人欣赏与收藏；转载、二次发布或商业使用前，请先取得作者授权，并遵守 Pixiv 使用条款。因使用本扩展产生的版权纠纷，由使用者自行承担。
