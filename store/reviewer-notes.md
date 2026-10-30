# Notes for reviewers

Paste the section below into the "Notes to Reviewer" field when submitting the public edition.

---

**What it does**

Downloads the original images of every pixiv artwork page (`pixiv.net/artworks/<id>`) that is currently open in the browser. Optional features: saving into folders chosen by user-defined tag rules, writing tags/author/source URL into the image's XMP metadata, skipping small images, and converting ugoira (pixiv's frame-based animations) to GIF/APNG or saving the original frames as a ZIP.

**How to test**

1. Log in to pixiv.net and open two or three artwork pages, e.g. `https://www.pixiv.net/artworks/<id>`.
2. Click the toolbar button. The popup lists the open artworks with their tags.
3. Click the orange "下载所有已打开作品" (Download all open artworks) button. Files are saved under `<Downloads>/Pixiv/`.
4. Tag rules are edited on the options page ("管理标签规则" link in the popup).

**Permissions**

- `tabs`: read the URLs of open tabs to find pixiv artwork pages. No other tab data is used.
- `downloads`: save the images.
- `storage`: store the user's tag-to-folder rules locally.
- `webRequest` + `webRequestBlocking`, host `https://*.pximg.net/*`: pixiv's image CDN (i.pximg.net) rejects requests without `Referer: https://www.pixiv.net/`. `firefox-referer.js` sets only that header, only for `*.pximg.net` requests. No other headers or hosts are touched.
- Host `https://www.pixiv.net/*`: call pixiv's own JSON endpoints (`/ajax/illust/<id>`, `/pages`, `/ugoira_meta`) with the user's existing session, the same requests the pixiv website makes.

**Data and code**

- No data is collected or sent anywhere except the requests to pixiv.net / pximg.net listed above (`data_collection_permissions: none`).
- No remote code, no minification, no build step: the package contains the source as written. `build.js` in the source repository only zips `src/`, sets the edition's add-on ID in the manifest and its name/description in `_locales`.
- Image processing (XMP writing, GIF/APNG encoding, ZIP parsing) is implemented in plain JavaScript in `metadata.js` and `ugoira.js`, using only built-in browser APIs (`CompressionStream`, `DecompressionStream`, `OffscreenCanvas`, `createImageBitmap`).
- The UI is available in Chinese and English (`i18n.js`). It follows the browser language by default; the choice is stored in `storage.local`. Translated strings are inserted with `textContent` or created as DOM nodes, never through `innerHTML`.
- Not affiliated with pixiv. The name follows the "<name> for pixiv" pattern for that reason.
