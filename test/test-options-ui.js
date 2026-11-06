import assert from 'node:assert';
import fs from 'node:fs';

console.log('--- 测试: v0.4.0 高级设置页结构 ---');

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = read('../entrypoints/options/index.html');
const css = read('../entrypoints/options/style.css');
const ts = read('../entrypoints/options/main.ts');
const popupCss = read('../entrypoints/popup/style.css');
const popupHtml = read('../entrypoints/popup/index.html');
const popupTs = read('../entrypoints/popup/main.ts');
const wxt = read('../wxt.config.ts');

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

/* ── 1. 信息架构：7 个分区，tablist + tabpanel 成对 ── */
const navLabels = [...html.matchAll(/class="navitem-label">([^<]+)</g)].map((m) => m[1]);
const expected = ['常规', '服务与模型', '术语库', '断句引擎', '字幕样式', '同步与缓存', '关于'];
check('分区数量为 7', navLabels.length === 7, navLabels.join('/'));
check('分区名称与设计一致', JSON.stringify(navLabels) === JSON.stringify(expected), navLabels.join('/'));

check('导航使用 role=tablist', /role="tablist"/.test(html));
check('每个分区都有 role=tabpanel', (html.match(/role="tabpanel"/g) || []).length === 7);
check('导航项带 aria-selected', (html.match(/aria-selected="/g) || []).length >= 7);
check('每个面板有 aria-labelledby', (html.match(/aria-labelledby="nav-/g) || []).length === 7);

/* ── 2. 复杂配置落位：术语库编辑器该有的控件 ── */
for (const id of ['gloss-search', 'gloss-category', 'btn-add-entry', 'btn-export-pack', 'btn-import-pack', 'btn-clone-pack', 'gloss-tbody']) {
  check(`术语库控件存在 #${id}`, html.includes(`id="${id}"`));
}
check('术语库为两栏（包列表 + 编辑区）', /class="gloss-layout"/.test(html) && /class="pack-rail"/.test(html));
check('表格含 日文/中文/英文/分类 列', ['日文', '中文', '英文', '分类'].every((h) => html.includes(`>${h}<`)));

/* ── 3. 细粒度选项：比弹窗多出的项 ── */
const optionKeys = [...html.matchAll(/data-setting="([a-zA-Z]+)"/g)].map((m) => m[1]);
const uniqueKeys = [...new Set(optionKeys)];
check('绑定设置项 ≥ 18 个', uniqueKeys.length >= 18, `${uniqueKeys.length} 个`);
for (const key of ['maxWordsPerSentence', 'autoPunctuation', 'mergeShortFragments', 'offsetY', 'origColor', 'syncOffsetMs', 'autoHideNativeSubtitles']) {
  check(`细粒度项存在 ${key}`, uniqueKeys.includes(key));
}

/* ── 4. 单一数据源：不自己写 localStorage，统一走 storage/packs ── */
check('导入 settings 存储层', /from '\.\.\/\.\.\/utils\/storage'/.test(ts));
check('导入术语库包管理', /from '\.\.\/\.\.\/utils\/packs'/.test(ts));
check('未直接使用 localStorage', !/localStorage\./.test(ts));
check('监听 storage.onChanged 与弹窗同步', /chrome\.storage\.onChanged\.addListener/.test(ts));

/* ── 5. 视觉一致性：与弹窗共用同一套令牌（防漂移） ── */
const tokenMap = (source) => {
  const root = source.slice(source.indexOf(':root {'), source.indexOf('}', source.indexOf(':root {')));
  const map = new Map();
  for (const m of root.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
};
const popupTokens = tokenMap(popupCss);
const optionsTokens = tokenMap(css);

const shared = ['--bg-primary', '--text-main', '--text-muted', '--dur-fast', '--dur-base', '--ease-out-expo', '--spring-soft', '--radius-lg', '--radius-pill'];
const drift = shared.filter((k) => popupTokens.get(k) !== optionsTokens.get(k));
check('关键令牌与弹窗完全一致', drift.length === 0, drift.map((k) => `${k}: ${popupTokens.get(k)} vs ${optionsTokens.get(k)}`).join(' | '));

/* ── 6. 动效规范（沿用 v0.3.0 的地板） ── */
check('无 transition: all', !/transition:\s*all\b/.test(css));
check('使用 linear() 弹簧', /linear\(\s*0\s*,/.test(css));
check('导航滑块走弹簧', /\.nav-marker[\s\S]{0,240}?var\(--spring-(soft|snappy)\)/.test(css));
check('分区入场有错峰', /nth-child\(n \+ 6\)\s*\{\s*animation-delay/.test(css));
check('提供 prefers-reduced-motion', /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css));
check('提供 :focus-visible 焦点环', /:focus-visible/.test(css));
check('无紫罗兰/靛蓝渐变', !/#6366f1|#a855f7/i.test(css));

/* ── 7. 响应式：窄屏降级为横向导航 ── */
check('有移动端断点', /@media\s*\(max-width:\s*880px\)/.test(css));

/* ── 8. 注册与入口：独立标签页打开，弹窗有入口 ── */
check('options_ui 声明为独立标签页', /open_in_tab:\s*true/.test(wxt) || /name="manifest\.open_in_tab"\s+content="true"/.test(html));
check('弹窗提供高级设置入口', popupHtml.includes('id="btn-open-options"'));
check('入口调用 openOptionsPage', /openOptionsPage\(\)/.test(popupTs));

/* ── 9. VSR 红线不受影响 ── */
const overlay = read('../entrypoints/content/overlay-styles.ts');
check('内容脚本仍无 backdrop-filter', !/backdrop-filter\s*:/i.test(overlay));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log('高级设置页测试通过！');
