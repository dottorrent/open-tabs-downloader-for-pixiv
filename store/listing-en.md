# Store listing (public edition, English)

The add-on's default locale is English (`default_locale: "en"`), so AMO uses this as the main listing. Add the Chinese text from `listing-zh.md` as the zh-CN translation of the listing.

## Name

Open Tabs Downloader for Pixiv

## Summary (≤ 250 characters)

Download the original images of every pixiv artwork tab you have open, in one click. Sort them into folders by tag, write tags, artist and link into the image's properties, skip small images, and save animations as GIF, lossless APNG or original frames. Not made by pixiv.

## Description

Open the pixiv artwork pages you want to keep (`pixiv.net/artworks/<number>`), click the toolbar button, and every one of them is downloaded at original resolution. Multi-page works are saved page by page.

**Features**

- **Batch download open artworks**: scans the tabs in every window, removes duplicates, and downloads the originals.
- **Folders by tag**: on the rules page, map tags to folders, e.g. save artworks tagged "原神" or "Genshin Impact" to `Pixiv/Genshin/`. Rules are checked in order and match both the original tag and pixiv's translation. You can also create a rule by clicking a tag in the popup.
- **Image properties**: writes tags, the artist's name and the artwork link into the XMP metadata of JPG / PNG files. Windows Explorer shows them under Properties → Details as Tags / Authors / Comments, so you can search by tag.
- **Size filter**: separate settings for images and animations. Skip anything whose long and short sides, or total pixel count, fall below your threshold.
- **Animations (ugoira)**: save as GIF (with a palette tuned for each animation), APNG (lossless, full color) or a ZIP of the original frames with their timings. Pick one or more.
- **Reliable downloads**: network errors and rate limits are retried automatically. Files are checked before saving, so error pages or half-downloaded images are never stored. Failed items can be retried with one click.
- **Progress you don't lose**: downloads keep running after the popup closes. Reopen it to see the progress or the last result, and the toolbar icon shows progress too.
- **Chinese and English**: the interface follows your browser language and can be switched manually.

**Notes**

- You need to be logged in to pixiv. The extension uses your current session to read artwork information, just like opening the pages yourself.
- Files are saved inside Firefox's download folder, in a `Pixiv` folder by default. You can change that folder (subfolders allowed) or save straight into the download folder from the popup. To use another drive, change Firefox's default download folder.
- The extension only talks to pixiv.net and pximg.net. It collects and sends no data. Settings such as tag rules stay in your browser and can be exported from the rules page.

**Disclaimer**

This extension only helps you save artworks you can already view on pixiv, and is not made by pixiv. Artworks belong to their creators. Downloads are for personal viewing and collecting only. Get the artist's permission before reposting, redistributing or using them commercially, and follow pixiv's Terms of Use. You are responsible for any copyright dispute arising from your use of this extension.

The extension's source code is released under the MIT License. The license covers the code only and grants no rights to any downloaded artwork.

## Category and tags

- Category: Download Management
- Tags: pixiv, download, image, illustration, ugoira

## Screenshots

Same set as in `listing-zh.md`. For the English listing, switch the popup to English with the language menu in its top-right corner before taking them.
