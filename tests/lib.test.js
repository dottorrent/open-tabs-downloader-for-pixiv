"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../src/lib.js");

const tags = (...pairs) => pairs.map(([name, translation = ""]) => ({ name, translation }));

test("artworkTags 读取原始标签与译名并去重", () => {
  const info = {
    tags: {
      tags: [
        { tag: "原神", translation: { en: "Genshin Impact" } },
        { tag: "女の子", translation: { en: "女孩子" } },
        { tag: "R-18" },
        { tag: "原神", translation: { en: "Genshin Impact" } },
        { tag: "風景", translation: { en: "風景" } }
      ]
    }
  };
  assert.deepEqual(lib.artworkTags(info), [
    { name: "原神", translation: "Genshin Impact" },
    { name: "女の子", translation: "女孩子" },
    { name: "R-18", translation: "" },
    { name: "風景", translation: "" }
  ]);
  assert.deepEqual(lib.artworkTags({}), []);
});

test("normalizeRules 拆分标签、去重并丢弃不完整规则", () => {
  assert.deepEqual(lib.normalizeRules([
    { folder: " 原神 ", tags: "原神, Genshin Impact\ngenshinimpact，原神" },
    { folder: "", tags: ["风景"] },
    { folder: "空", tags: "" },
    { folder: "a/../b:c", tags: ["x"] }
  ]), [
    { folder: "原神", tags: ["原神", "Genshin Impact"] },
    { folder: "a/b_c", tags: ["x"] }
  ]);
  assert.deepEqual(lib.normalizeRules(null), []);
});

test("matchRule 按顺序取第一条，并匹配译名、忽略大小写全半角空格", () => {
  const rules = lib.normalizeRules([
    { folder: "风景", tags: ["風景"] },
    { folder: "原神", tags: ["genshin impact"] }
  ]);
  assert.equal(lib.matchRule(rules, tags(["原神", "Genshin Impact"])).folder, "原神");
  assert.equal(lib.matchRule(rules, tags(["ＧｅｎｓｈｉｎＩｍｐａｃｔ"])).folder, "原神");
  assert.equal(lib.matchRule(rules, tags(["原神", "Genshin Impact"], ["風景"])).folder, "风景");
  assert.equal(lib.matchRule(rules, tags(["オリジナル"])), null);
  assert.equal(lib.matchRule(rules, []), null);
});

test("resolveTagFolder 处理自动、强制根目录和手动指定", () => {
  const rules = lib.normalizeRules([{ folder: "原神", tags: ["原神"] }]);
  const artworkTags = tags(["原神"]);
  assert.equal(lib.resolveTagFolder(rules, artworkTags), "原神");
  assert.equal(lib.resolveTagFolder(rules, artworkTags, "auto"), "原神");
  assert.equal(lib.resolveTagFolder(rules, artworkTags, "root"), "");
  assert.equal(lib.resolveTagFolder(rules, artworkTags, "收藏/精选"), "收藏/精选");
  assert.equal(lib.resolveTagFolder(rules, tags(["别的"])), "");
});

test("buildDownloadPath 命中标签时平铺到标签文件夹，否则沿用原有方式", () => {
  const base = { artworkId: "123", title: "标题", filename: "123_p0.png" };
  assert.equal(lib.buildDownloadPath({ ...base, folderMode: "artwork", tagFolder: "原神" }), "Pixiv/原神/123_p0.png");
  assert.equal(lib.buildDownloadPath({ ...base, folderMode: "flat", tagFolder: "原神/角色" }), "Pixiv/原神/角色/123_p0.png");
  assert.equal(lib.buildDownloadPath({ ...base, folderMode: "artwork", tagFolder: "../.." }), "Pixiv/123 - 标题/123_p0.png");
  assert.equal(lib.buildDownloadPath({ ...base, folderMode: "artwork" }), "Pixiv/123 - 标题/123_p0.png");
  assert.equal(lib.buildDownloadPath({ ...base, folderMode: "flat" }), "Pixiv/123_p0.png");
});

test("sanitizeFolderPath 去掉非法字符和上级目录", () => {
  assert.equal(lib.sanitizeFolderPath("原神\\角色/"), "原神/角色");
  assert.equal(lib.sanitizeFolderPath("/../a?b/./c. "), "a_b/c");
  assert.equal(lib.sanitizeFolderPath(""), "");
});

test("addTagToRules 追加别名、新建规则，并把标签从其他规则移走", () => {
  let rules = lib.addTagToRules([], "原神", "原神");
  assert.deepEqual(rules, [{ folder: "原神", tags: ["原神"] }]);
  rules = lib.addTagToRules(rules, "GenshinImpact", "原神");
  assert.deepEqual(rules, [{ folder: "原神", tags: ["原神", "GenshinImpact"] }]);
  rules = lib.addTagToRules(rules, "風景", "风景");
  assert.deepEqual(rules.map((rule) => rule.folder), ["原神", "风景"]);
  rules = lib.addTagToRules(rules, "genshin impact", "游戏/原神");
  assert.deepEqual(rules, [
    { folder: "原神", tags: ["原神"] },
    { folder: "风景", tags: ["風景"] },
    { folder: "游戏/原神", tags: ["genshin impact"] }
  ]);
  rules = lib.addTagToRules(rules, "原神", "游戏/原神");
  assert.deepEqual(rules, [
    { folder: "风景", tags: ["風景"] },
    { folder: "游戏/原神", tags: ["genshin impact", "原神"] }
  ]);
});

test("normalizeSizeFilter 规范化设置并给出默认值", () => {
  assert.deepEqual(lib.normalizeSizeFilter(null), { enabled: false, mode: "dimensions", width: 1920, height: 1080 });
  assert.deepEqual(lib.normalizeSizeFilter({ enabled: 1, mode: "pixels", width: "2560.7", height: "-3" }),
    { enabled: true, mode: "pixels", width: 2560, height: 1080 });
});

test("passesSizeFilter：长短边模式不区分横竖，像素模式比较面积，尺寸未知时放行", () => {
  const dims = { enabled: true, mode: "dimensions", width: 1920, height: 1080 };
  const pixels = { ...dims, mode: "pixels" };
  assert.equal(lib.passesSizeFilter(dims, 1920, 1080), true);
  assert.equal(lib.passesSizeFilter(dims, 1080, 1920), true);
  assert.equal(lib.passesSizeFilter(dims, 1919, 1080), false);
  assert.equal(lib.passesSizeFilter(dims, 1600, 1400), false);
  assert.equal(lib.passesSizeFilter(dims, 4000, 1000), false, "短边不够");
  assert.equal(lib.passesSizeFilter(pixels, 1600, 1400), true);
  assert.equal(lib.passesSizeFilter(pixels, 1920, 1079), false);
  assert.equal(lib.passesSizeFilter(pixels, 4000, 1000), true);
  assert.equal(lib.passesSizeFilter(dims, 0, 0), true);
  assert.equal(lib.passesSizeFilter(dims, undefined, 500), true);
  assert.equal(lib.passesSizeFilter({ ...dims, enabled: false }, 10, 10), true);
  // 阈值写成竖向（1080×1920）效果一样。
  assert.equal(lib.passesSizeFilter({ ...dims, width: 1080, height: 1920 }, 1920, 1080), true);
});

test("normalizeSizeFilters：新格式分别规范化；旧的单套设置同时用于静态图和动图", () => {
  assert.deepEqual(lib.normalizeSizeFilters({ image: { enabled: true, width: 2560, height: 1440 }, ugoira: { enabled: true, mode: "pixels", width: 600, height: 600 } }), {
    image: { enabled: true, mode: "dimensions", width: 2560, height: 1440 },
    ugoira: { enabled: true, mode: "pixels", width: 600, height: 600 }
  });
  const legacy = lib.normalizeSizeFilters({ enabled: true, mode: "pixels", width: 1920, height: 1080 });
  assert.deepEqual(legacy.image, { enabled: true, mode: "pixels", width: 1920, height: 1080 });
  assert.deepEqual(legacy.ugoira, legacy.image);
  assert.notEqual(legacy.ugoira, legacy.image, "两份设置互不影响");
  assert.deepEqual(lib.normalizeSizeFilters(null).ugoira, { enabled: false, mode: "dimensions", width: 1920, height: 1080 });
  assert.deepEqual(lib.normalizeSizeFilters({ ugoira: { enabled: true } }).image.enabled, false);
});

test("保存文件夹：默认 Pixiv，可多级，留空直接存在下载目录，非法字符和上级目录被清理", () => {
  const base = { artworkId: "7", title: "标题", filename: "7_p0.png" };
  assert.equal(lib.normalizeDownloadRoot(undefined), "Pixiv");
  assert.equal(lib.normalizeDownloadRoot(null), "Pixiv");
  assert.equal(lib.normalizeDownloadRoot(""), "");
  assert.equal(lib.normalizeDownloadRoot(" 插画\\Pixiv/ "), "插画/Pixiv");
  assert.equal(lib.normalizeDownloadRoot("../../a:b"), "a_b");
  assert.equal(lib.buildDownloadPath({ ...base, folderMode: "artwork" }), "Pixiv/7 - 标题/7_p0.png");
  assert.equal(lib.buildDownloadPath({ ...base, root: "插画/Pixiv", folderMode: "artwork" }), "插画/Pixiv/7 - 标题/7_p0.png");
  assert.equal(lib.buildDownloadPath({ ...base, root: "", folderMode: "flat" }), "7_p0.png");
  assert.equal(lib.buildDownloadPath({ ...base, root: "", tagFolder: "原神" }), "原神/7_p0.png");
});
