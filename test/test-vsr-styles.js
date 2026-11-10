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

/* ══════════════════════════════════════════════════════════════════════════
 * v0.5.0 歌词轨卡拉OK：逐字点亮只许用 color / opacity / text-shadow
 * ----------------------------------------------------------------------------
 * 这几条是「新增声明需要计数」的补充：上面两条断言只保证**本文件**没有滤镜声明，
 * 这里进一步锁住卡拉OK那几块的具体写法，防止后续用「发光」当借口引入 blur 类效果。
 * ========================================================================== */
const karaokeBlock = css.slice(css.indexOf('歌词轨卡拉OK'), css.indexOf('.sentence-ai-badge'));
assert.ok(karaokeBlock.length > 200, '缺少歌词轨卡拉OK样式块');

// 三态色必须走 CSS 变量（复用用户配色），不允许写死单一颜色
for (const v of ['--k-done', '--k-cur', '--k-pend']) {
  assert.ok(
    new RegExp(`var\\(${v}`).test(karaokeBlock),
    `卡拉OK三态色缺少变量 ${v}（应由浮层按用户配色注入，不写死）`
  );
}

// 过渡只作用于 color / opacity，且时长控制在 120ms 级别
assert.ok(
  /\.k-char\s*\{[\s\S]*?transition:\s*color\s+120ms[^;]*;/.test(karaokeBlock),
  '逐字 span 缺少 120ms 的颜色过渡（过硬的颜色跳变会造成闪烁感）'
);
assert.ok(
  !/\.k-char\s*\{[\s\S]{0,200}?(?:transform|scale|blur)/.test(karaokeBlock),
  '逐字 span 的过渡不得引入 transform / blur（会额外占用合成层）'
);

// 当前字的「发光」只能用 text-shadow（它不是滤镜，不会触发离屏合成）
assert.ok(
  /\.k-char\.k-cur\s*\{[\s\S]*?text-shadow/.test(karaokeBlock),
  '当前字的高亮必须用 text-shadow，不得用滤镜类效果'
);

// 无障碍：减少动态效果时过渡与淡入必须归零
assert.ok(
  /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.k-char\s*\{[\s\S]*?transition:\s*none/.test(css),
  '缺少 prefers-reduced-motion 下逐字过渡归零'
);

// 整句淡入分支也只能动 opacity（用 animation，不用滤镜）
assert.ok(
  /\.k-whole\s*\{[\s\S]*?animation-name/.test(karaokeBlock) && /@keyframes\s+k-fade-in/.test(css),
  '译文远短于原文时的整句淡入分支缺失（或未使用 opacity 动画）'
);

console.log(
  `  声明计数：backdrop-filter（含 -webkit-）= ${backdropDecls.length}，` +
    `filter（含 -webkit-filter）= ${filterDecls.length}`
);
console.log('✓ 浮层样式无 backdrop-filter / filter 合成风险，文字有阴影兜底');
console.log('所有 VSR 兼容样式测试通过！');
