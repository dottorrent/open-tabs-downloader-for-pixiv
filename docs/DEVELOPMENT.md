# 开发说明

按版本记录各功能的实现方式和设计取舍。使用说明见根目录的 [README](../README.md)。

## 目录结构
- `src/` 扩展源码（即安装包内容）
- `tests/` 单元测试与后台流程测试；`tests/preview/` 用模拟的 chrome API 在普通网页里预览弹窗和规则页
- `build.js` 打包脚本，输出到 `dist/`（私人版 / 公开版）
- `store/` 公开版的商店页面资料（`listing-zh.md` / `listing-en.md`）和给审核员的说明（`reviewer-notes.md`）

## 常用命令
```
node --test tests/*.test.js
node build.js          # 两个版本都打包
node build.js public   # 只打包公开版
```

## 标签文件夹规则（1.3.0）
- 规则存在 `storage.local` 的 `tagRules` 中，格式 `[{ folder, tags: [] }]`，从上到下匹配，命中第一条即停止。
- 标签同时与原始标签和 Pixiv 译名比较，忽略大小写、全半角、空格。
- 命中规则的作品平铺保存到 `Pixiv/<folder>/`；未命中的按弹窗里“每作品文件夹 / 平铺”选项保存。
- 弹窗里点击标签即可新建规则或把标签移到别的文件夹；下拉框只临时改变本次下载中单个作品的去向。

## 图片元数据（1.4.0）
- `src/metadata.js` 以 XMP 写入：`dc:subject` + `MicrosoftPhoto:LastKeywordXMP`（标签原名与译名）、`dc:creator`（作者）、`dc:source` / `dc:identifier` / `exif:UserComment`（作品链接）。
- JPG：XMP APP1 段；PNG：iTXt `XML:com.adobe.xmp`；GIF 动图：`XMP DataXMP` 应用扩展。已有的 XMP 会被替换，像素数据不变。
- Windows 11 资源管理器实测：JPG、PNG 的“标记 / 作者 / 备注”均可显示；GIF 不显示（Windows 不读 GIF 元数据）。
- 开启时插件先取回图片、写入后再保存，并等待每个文件保存完成；关闭时与 1.3.0 相同，直接交给浏览器下载。

## 失败重试（1.5.0）
- 每个文件单独计失败，多页作品中一页失败不影响其他页；每个文件都等待浏览器保存完成。
- 可重试的错误（网络错误、HTTP 408/429/5xx、NETWORK_* 下载中断）立即最多试 3 次，429 限流等待更久。
- 不可重试的错误（HTTP 404/403、作品已删除、FILE_* 磁盘错误、用户取消、动图帧损坏）直接记为失败。
- 全部任务结束后等 10 秒，把仍可重试的失败项统一再补一轮。
- 弹窗显示最终失败项和“重试失败项”按钮（沿用原来的文件夹与元数据设置）；元数据写入失败的文件已保存，单独列为警告。

## 保存前完整性检查（1.5.1）
- 所有图片都先取回内存检查，再保存（元数据开关关闭时保存与原图相同的字节）。
- 以下情况算可重试的下载失败，不会保存：内容不是 JPG/PNG/GIF（如服务器返回网页）、收到的字节数与 Content-Length 不符、缺少结尾标志（JPG 的 EOI、PNG 的 IEND、GIF 的 0x3B）。
- JPG 检查会逐段走完压缩数据（支持渐进式和 EOI 之后的附加数据）；动图压缩包检查大小是否与声明一致。
- 实测本机 446 张真实图片无误判，截断副本全部识别。

## 标签过多时的精简（1.5.2）
- JPG 的 XMP 只能放进单个约 64 KB 的 APP1 段；PNG / GIF 没有这个限制，不做精简。
- 超限时依次尝试：去掉重复的 `MicrosoftPhoto:LastKeywordXMP`（实测 Windows 只靠 `dc:subject` 也能显示“标记”）→ 按组（原名 + 译名）从末尾删标签，二分查找能保留的最多组数。
- 作者和链接始终保留；删了标签时弹窗“元数据未完整写入”里提示“标签过多，已省略最后 N 个标签”。
- Pixiv 每个作品最多 10 个标签，正常情况下不会触发。

## 尺寸筛选（1.6.0）
- 宽高来自 Pixiv 接口（`/pages` 每页的 width/height，动图用作品信息），下载前就能判断，跳过的图不发请求。
- 两种模式：长边和短边都达到阈值（横竖都算，1080×1920 也满足 1920×1080）；或宽×高达到阈值的像素数。
- 多页作品按页判断；接口没给尺寸时不跳过。跳过的图不算失败，结果里单独列在“已跳过的小图”。
- 设置保存在弹窗的 localStorage（`pixiv-size-filter`），默认关闭。
- 1.12.0 起静态图片和动图分开设置：`pixiv-size-filter` 存 `{ image, ugoira }`，弹窗里用“静态图片 / 动图”两个标签页编辑；旧的单套设置会同时用于两者。动图被跳过时所选的所有格式一起跳过，也不下载压缩包。
- 1.6.1 起“图片元数据”和“尺寸筛选”在弹窗里是折叠面板，标题右侧显示当前设置；展开状态记在 `pixiv-open-panels`，默认收起。

## 任务状态、进度窗口与角标（1.7.0 / 1.8.0）
- Firefox 的工具栏弹窗一失焦就关闭，扩展无法阻止。1.8.0 起不再自动开窗口：下载在后台继续，重新点图标时弹窗顶部的任务状态卡片显示进度或上次结果（包括全部成功），进行中会收起作品列表；卡片右上角 × 关掉结果（同时清除失败角标）。
- 卡片里的“在独立窗口中查看”会打开 `popup.html?view=window` 的独立小窗口（type: popup），点别处不会关闭。
- 窗口已开着就切到前台；被关掉后下次重新打开。窗口里发起的下载不再开新窗口。
- 工具栏角标：进行中显示百分比，收尾重试时显示“重试”，结束后有失败显示红色失败数，全部成功清除。
- Firefox Android 没有 windows API，只更新角标。

## 动图 GIF 画质（1.9.0）
- 旧版用固定 3-3-2 调色板（所有动图共用 256 色）且不抖动，渐变和肤色有明显色带。
- 现在两遍处理：第一遍统计所有帧颜色（5-5-5 位直方图，最多采样约 200 万像素），中位切分选 256 色并做 3 轮 k-means 微调；第二遍 Floyd–Steinberg 蛇形误差扩散抖动（强度 0.5）后编码。
- 实测（ffmpeg 解码后与原帧比 PSNR）：照片缩放 22.0 → 37.0 dB，渐变 22.2 → 48.8 dB；1920×1080×30 帧约 2 秒。
- 代价是文件变大（高质量 GIF 的正常大小）：800×600×24 帧照片 1.9 → 5.2 MB，1080p×30 帧 1.9 → 14 MB。

## 动图保存格式（1.10.0 / 1.11.0）
- 弹窗“动图格式”面板三选一（`pixiv-ugoira-format`）：
  - GIF（默认）：1.9.0 的专属调色板 + 抖动，文件名 `ID_p0.gif`。
  - APNG：自写 PNG 编码（逐行自适应滤波 + CompressionStream zlib），每帧完整写入、无限循环；不透明用 RGB，有透明用 RGBA；实测逐像素无损。文件名 `ID_p0.png`，同样写入 XMP。
  - 原始帧压缩包：帧原样存储 + `animation.json`（帧时长、标题、作者、标签、链接），文件名 `ID_ugoira.zip`，不写 XMP。
- 12 帧 600×400 实测：GIF 792 KB / 326 ms，APNG 922 KB / 553 ms，压缩包 181 KB / 15 ms。
- 1.11.0 起可多选（`pixiv-ugoira-formats`，JSON 数组，兼容旧的单选键），面板里有“全选”，至少保留一种。每种格式各存一个文件、各自计失败和重试；同一动图的原始压缩包只下载一次，各格式共用，处理完即释放。

## 图标（1.12.1）
- `src/icons/icon.svg`：白色圆角底 + 橙色粗体字母 P（自绘，不是 Pixiv 官方 Logo），用于附加组件管理页和工具栏按钮；1.12.2 起弹窗和规则页左上角的标志也直接使用这个 SVG。
- 1.12.3 起界面主色改为橙色：按钮 `#c2410c`（白字对比度 5.2:1，符合 AA），悬停 `#9a3412`；进度条、焦点框用图标橙 `#ff7a00`；背景、边框、灰色文字改为暖色调。失败的红色、“已有规则”标签的青绿色保持不变；“将跳过”改为中性灰，避免和橙色混淆。工具栏角标：进度橙色、重试灰色、失败红色。`tests/preview/icon.html` 可预览各尺寸在浅色/深色背景下的效果。

## 私人版与公开版（1.13.0）
- 两个版本共用 `src/`，差异只在 `build.js` 的 `EDITIONS` 里打包时套用：
  - 私人版：沿用 `src/manifest.json` 的名称“Pixiv 已打开作品下载器”和 ID `pixiv-open-tabs-downloader@local`（AMO 上仅自己可见），保留 Android 声明。
  - 公开版：名称“已打开作品批量下载器 for Pixiv”，新 ID `{834e8355-938e-4b17-b870-17a16a64c422}`，作为新的扩展提交并公开展示；不含个人路径。`gecko_android` 保留（数据收集声明要求 Android ≥ 142），商店是否标为兼容 Android 由提交时的勾选决定。
- 提交前检查：`npx web-ext lint --source-dir <解压后的公开版目录>`（1.13.0 实测 0 错误、0 警告）。
- 两个 ID 不同，可以同时安装；各自的标签规则互不相通，可在规则页导出 / 导入。
- 1.13.0 同时删除了为 Chrome/Edge（MV3）准备、但在 Firefox 中永远不会执行的代码分支。

## 许可证与免责声明（1.13.1）
- 源代码以 MIT 许可证开源，全文见根目录 `LICENSE`，打包时会放进两个版本的安装包。许可证末尾注明：只适用于代码，不授予对任何下载作品的权利；本扩展与 pixiv 无关。版权行写的是“Open Tabs Downloader for Pixiv contributors”。
- 免责声明：弹窗底部放简短版，规则页底部和商店页面资料（`store/listing-zh.md`）放完整版。

## 中英文界面（1.14.0）
- `src/i18n.js`：中英对照表 + 语言设置。设置存在 `storage.local` 的 `uiLanguage`（`auto` / `zh` / `en`），弹窗、规则页、后台共用；`auto` 时浏览器语言以 zh 开头显示中文，否则英文。弹窗和规则页右上角可以手动切换，切换后立即生效。
- 页面静态文字用 `data-i18n` / `data-i18n-html` / `data-i18n-title` 等属性标记；带 `<code>` / `<strong>` 的文案由 `renderMarkup` 生成 DOM 节点，不使用 innerHTML（web-ext lint 会报 UNSAFE_VAR_ASSIGNMENT）。
- 失败原因、警告等由后台和处理模块生成的提示也按当前语言生成（Node 测试里默认中文）。
- 扩展名称、简介、工具栏提示用 Firefox 的 `_locales`（en / zh_CN / zh_TW，`default_locale: "en"`），随浏览器语言显示，不受手动切换影响；公开版的名称在 `build.js` 里覆盖。

## 保存文件夹（1.15.0）
- Firefox 只允许扩展把文件存进默认下载目录（`downloads.download` 的 filename 必须是相对路径），所以无法直接改到任意磁盘位置；想换磁盘只能在 Firefox 设置里改默认下载目录。
- 能改的是下载目录里的保存文件夹：弹窗“保存位置”里设置，默认 `Pixiv`，可以写多级（`插画/Pixiv`），留空则直接存在下载目录。存在弹窗的 localStorage（`pixiv-download-root`），随下载消息传给后台；失败重试沿用当时的设置。
- “打开下载目录”按钮调用 `downloads.showDefaultFolder()`（Android 上没有这个接口，按钮隐藏）。
- 弹窗、规则页里显示的路径都跟随这个设置（翻译文案里用 `{root}` / `{path}` 占位）。

## Chrome / Edge 版（1.16.0）
- 同一份 `src/`，`build.js` 的 `TARGETS` 决定浏览器：firefox 输出 Manifest V2 的 `.xpi`，chrome 输出 Manifest V3 的 `.zip`（Chrome 和 Edge 通用）。`src/chrome/` 里的文件只进 Chrome 包，并放到包根目录；`firefox-referer.js` 只进 Firefox 包。
- 后台差异通过 `background.js` 里的 `platform` 对象隔离：`prepare(file)` → `{ url, warnings }`、`release`、`releaseArchive`，以及可选的 `keepAlive` / `saveState` / `loadState`。Firefox 用本地实现（后台页直接调用 `prepare.js` 并创建 blob 地址）；Chrome 用 `platform-chrome.js`。
- 取图、完整性检查、写元数据、动图转换都在 `prepare.js` 里，两种浏览器共用。Chrome 的 service worker 不能创建 blob 地址，所以 `prepare.js` 在离屏页 `offscreen.html` 里运行；离屏页只能用 `chrome.runtime`，界面语言随消息带过去，错误用 `serializeError` / `deserializeError` 传回，保留是否可重试。
- Referer：declarativeNetRequest 会话规则，条件 `requestDomains: ["pximg.net"]` + `tabIds: [-1]`，只改扩展自己的请求。
- service worker 闲置约 30 秒会被关闭：任务进行中每 20 秒调用一次 `runtime.getPlatformInfo` 保持活跃；结果和失败项存进 `storage.session`，重启后恢复。
- Chrome 不支持 SVG 扩展图标，`src/chrome/icons/` 里是 16 / 32 / 48 / 128 的 PNG。Chrome 要求简介不超过 132 个字符。
- 实测（Edge 156，临时配置 + DevTools 协议加载解压后的公开版）：单图、3 页作品、动图（GIF + APNG + 原始帧）共 7 个文件全部保存成功，14 秒；元数据写入、APNG/GIF 各 38 帧与原始帧一致。Edge 156 已不支持 `--load-extension` 命令行参数，测试改用 DevTools 的 `Extensions.loadUnpacked`（需 `--enable-unsafe-extension-debugging`）。

## 签名与发布
- `dist/` 里的 xpi 未签名。正式版 Firefox 只能通过 `about:debugging` 临时加载；Firefox Developer Edition / Nightly 把 `xpinstall.signatures.required` 设为 false 后可以直接安装。
- 公开版在 addons.mozilla.org 以“在本站上”（listed）方式提交；私人版以“自行分发”（unlisted）方式签名。两个版本 ID 不同，各自在自己的条目下上传新版本。
