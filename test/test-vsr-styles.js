import assert from 'node:assert';
import fs from 'node:fs';

console.log('--- 测试: VSR 兼容样式红线 ---');

const cssPath = new URL('../entrypoints/content/overlay-styles.ts', import.meta.url);
const css = fs.readFileSync(cssPath, 'utf8');

// 判定口径：数「样式声明数」，不数关键词出现次数。
// 本文件头注释有 2 行（共 3 次出现）用文字解释这条红线，属说明文字、不带冒号，
// 不会被下面的声明正则命中；朴素 grep 计数会误报，不能拿它当红线结论。
const DECL_RE = /(?:^|[;{\s])((?:-webkit-)?(?:backdrop-)?filter)\s*:/gim;

const decls = [...css.matchAll(DECL_RE)].map((m) => m[1].toLowerCase());
const backdropDecls = decls.filter((name) => name.endsWith('backdrop-filter'));
const filterDecls = decls.filter((name) => !name.endsWith('backdrop-filter'));

// NVIDIA RTX VSR 在页面存在 backdrop-filter 时会失效（窗口化必现）。
// 该断言防止后续改动重新引入毛玻璃导致 VSR 回归。
assert.equal(
  backdropDecls.length,
  0,
  `overlay-styles.ts 禁止使用 backdrop-filter / -webkit-backdrop-filter（会关闭 RTX VSR），` +
    `实际声明数 = ${backdropDecls.length}`
);

// 视频上层禁止任何 filter：blur / drop-shadow / grayscale 都会强制离屏合成。
assert.equal(
  filterDecls.length,
  0,
  `overlay-styles.ts 禁止在视频上层使用 filter / -webkit-filter（blur / drop-shadow / grayscale 均会强制离屏合成），` +
    `实际声明数 = ${filterDecls.length}${filterDecls.length ? `（${filterDecls.join(', ')}）` : ''}`
);

// 字幕容器必须有不透明背景兜底，避免去掉毛玻璃后文字不可读
assert.ok(/\.subtitle-box\s*\{/.test(css), '缺少 .subtitle-box 样式');
assert.ok(/\.original-text\s*\{[\s\S]*?text-shadow/.test(css), '原文缺少 text-shadow 可读性兜底');
assert.ok(/\.translated-text\s*\{[\s\S]*?text-shadow/.test(css), '译文缺少 text-shadow 可读性兜底');

console.log(
  `  声明计数：backdrop-filter（含 -webkit-）= ${backdropDecls.length}，` +
    `filter（含 -webkit-filter）= ${filterDecls.length}`
);
console.log('✓ 浮层样式无 backdrop-filter / filter 合成风险，文字有阴影兜底');
console.log('所有 VSR 兼容样式测试通过！');
