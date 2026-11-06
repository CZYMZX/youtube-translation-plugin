import assert from 'node:assert';
import fs from 'node:fs';

console.log('--- 测试: v0.3.0 UI 动效与视觉规范 ---');

const css = fs.readFileSync(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../entrypoints/popup/index.html', import.meta.url), 'utf8');
const ts = fs.readFileSync(new URL('../entrypoints/popup/main.ts', import.meta.url), 'utf8');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
};

// ── 1. 动效令牌：时长必须分级，不能用一套 0.2s 走天下（design-slop B3） ──
for (const token of ['--dur-instant', '--dur-fast', '--dur-base', '--dur-slow']) {
  check(`定义时长令牌 ${token}`, css.includes(token));
}

const durations = new Set(
  [...css.matchAll(/--dur-[a-z]+:\s*(\d+)ms/g)].map((m) => m[1])
);
check('时长至少 4 个不同档位', durations.size >= 4, [...durations].join('/') + 'ms');

// ── 2. 缓动词典：至少 4 条曲线，且含弹簧 linear() ──
const easings = new Set([...css.matchAll(/cubic-bezier\([^)]+\)/g)].map((m) => m[0]));
check('缓动曲线 ≥ 4 条', easings.size >= 4, `${easings.size} 条`);
check('使用 linear() 弹簧曲线', /linear\(\s*0\s*,/.test(css));

// ── 3. 性能：禁止 transition: all（会连布局属性一起过渡） ──
const allTransitions = [...css.matchAll(/transition:\s*all\b/g)];
check('无 transition: all', allTransitions.length === 0, `${allTransitions.length} 处`);

// ── 4. 无障碍地板（baseline-ui §1 / §3） ──
check('提供 prefers-reduced-motion 降级', /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css));
check('降级分支把入场动画归零', /animation:\s*none\s*!important/.test(css));
check('提供 :focus-visible 焦点环', /:focus-visible/.test(css));
check('焦点环有 outline 宽度', /outline:\s*2px\s*solid/.test(css));

// ── 5. 页签可访问性（components.md §12：tablist + 方向键） ──
check('页签容器为 role=tablist', /role="tablist"/.test(html));
check('四个页签均为 role=tab', (html.match(/role="tab"/g) || []).length === 4);
check('面板为 role=tabpanel', (html.match(/role="tabpanel"/g) || []).length === 4);
check('页签用 aria-selected 表达状态', /aria-selected="(true|false)"/.test(html));
check('页签支持方向键导航', /ArrowLeft/.test(ts) && /ArrowRight/.test(ts));
check('切换时同步 aria-selected', /setAttribute\('aria-selected'/.test(ts));

// ── 6. 反 AI 味（design-slop A4 / B1） ──
check('无紫罗兰/靛蓝渐变（A4）', !/#6366f1|#a855f7|#8b5cf6/i.test(css));
check('可点选卡片不使用统一 translateY 上浮（B1）', !/\.pack-card:hover\s*\{[^}]*translateY/.test(css));
check('hover 用语义化左标线替代整体位移', /\.pack-card::before/.test(css));
check('卡片不同时叠表面+边框+阴影', !/\.card\s*\{[^}]*box-shadow:\s*0\s+4px/.test(css));

// ── 7. 页签滑块与内容入场走弹簧/分级时长 ──
const gliderBlock = (css.match(/\.smooth-tabs \.tab-glider\s*\{[^}]*\}/) || [''])[0];
check('页签滑块使用弹簧曲线', gliderBlock.includes('var(--spring-soft)'), gliderBlock.slice(0, 60));
check('页签滑块不再用 elastic 硬编码', !/transition:\s*transform\s*0\.3\d?s\s*var\(--ease-elastic\)/.test(css));
check('页签内容入场分两级（容器 + 子项错峰）', /@keyframes\s+tabEnter/.test(css) && /@keyframes\s+itemEnter/.test(css));
check('子项错峰有 delay 阶梯', /nth-child\(n\+6\)\s*\{\s*animation-delay/.test(css));

// ── 8. 圆角收敛为三档（page-design §5：小调色板/少变量） ──
const radii = new Set([...css.matchAll(/--radius-[a-z]+:\s*(\d+px|999px)/g)].map((m) => m[1]));
check('圆角档位 ≤ 4 种', radii.size <= 4, [...radii].join('/'));

// ── 9. VSR 红线不受影响：popup 的毛玻璃不得泄漏到内容脚本 ──
const overlay = fs.readFileSync(new URL('../entrypoints/content/overlay-styles.ts', import.meta.url), 'utf8');
check('内容脚本仍无 backdrop-filter', !/backdrop-filter\s*:/i.test(overlay));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log('UI 规范测试通过！');
