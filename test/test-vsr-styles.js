import assert from 'node:assert';
import fs from 'node:fs';

console.log('--- 测试: VSR 兼容样式红线 ---');

const cssPath = new URL('../entrypoints/content/overlay-styles.ts', import.meta.url);
const css = fs.readFileSync(cssPath, 'utf8');

// NVIDIA RTX VSR 在页面存在 backdrop-filter 时会失效（窗口化必现）。
// 该断言防止后续改动重新引入毛玻璃导致 VSR 回归。
assert.ok(
  !/-?webkit-backdrop-filter\s*:|backdrop-filter\s*:/i.test(css),
  'overlay-styles.ts 禁止使用 backdrop-filter / -webkit-backdrop-filter（会关闭 RTX VSR）'
);

assert.ok(
  !/filter\s*:\s*(blur|drop-shadow)/i.test(css),
  'overlay-styles.ts 禁止在视频上层使用 filter: blur/drop-shadow（会强制离屏合成）'
);

// 字幕容器必须有不透明背景兜底，避免去掉毛玻璃后文字不可读
assert.ok(/\.subtitle-box\s*\{/.test(css), '缺少 .subtitle-box 样式');
assert.ok(/\.original-text\s*\{[\s\S]*?text-shadow/.test(css), '原文缺少 text-shadow 可读性兜底');
assert.ok(/\.translated-text\s*\{[\s\S]*?text-shadow/.test(css), '译文缺少 text-shadow 可读性兜底');

console.log('✓ 浮层样式无 backdrop-filter / filter 合成风险，文字有阴影兜底');
console.log('所有 VSR 兼容样式测试通过！');
