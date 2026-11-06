import assert from 'node:assert';
import fs from 'node:fs';
import { DEFAULT_SETTINGS } from '../types/index.ts';
import { sanitizeSettings } from '../utils/storage.ts';

console.log('--- 测试: v0.4.0 高级设置页结构 ---');

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = read('../entrypoints/options/index.html');
const css = read('../entrypoints/options/style.css');
const ts = read('../entrypoints/options/main.ts');
const popupCss = read('../entrypoints/popup/style.css');
const popupHtml = read('../entrypoints/popup/index.html');
const popupTs = read('../entrypoints/popup/main.ts');
const wxt = read('../wxt.config.ts');
const storageTs = read('../utils/storage.ts');

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

/* ── 3.5 v0.4.2 两个新选项的界面承载（glossaryAnnotation / asrCorrection） ── */
const paneOf = (id) => {
  const start = html.indexOf(`id="pane-${id}"`);
  if (start < 0) return '';
  const next = html.indexOf('<section class="pane"', start + 10);
  return html.slice(start, next < 0 ? html.length : next);
};
const servicePane = paneOf('service');
const glossaryPane = paneOf('glossary');
const segValues = (pane, key) =>
  [...pane.matchAll(new RegExp(`data-setting="${key}" data-value="([^"]+)"`, 'g'))].map((m) => m[1]);

check('括注控件落在术语库分区', /data-setting="glossaryAnnotation"/.test(glossaryPane) && !/data-setting="glossaryAnnotation"/.test(servicePane));
check('ASR 控件落在服务与模型分区', /data-setting="asrCorrection"/.test(servicePane) && !/data-setting="asrCorrection"/.test(glossaryPane));
check('括注取值恰好 off/on', JSON.stringify(segValues(glossaryPane, 'glossaryAnnotation')) === '["off","on"]', segValues(glossaryPane, 'glossaryAnnotation').join('/'));
check('ASR 取值恰好 normal/strict', JSON.stringify(segValues(servicePane, 'asrCorrection')) === '["normal","strict"]', segValues(servicePane, 'asrCorrection').join('/'));

// 复用既有分段控件（.seg + .seg-glider + --seg-index），不自造开关
const segBlock = (pane, key) => {
  const i = pane.indexOf(`data-seg="${key}"`);
  return i < 0 ? '' : pane.slice(Math.max(0, i - 120), i + 420);
};
check('括注复用 .seg 分段控件', /class="seg seg-2[^"]*" data-seg="glossaryAnnotation"/.test(glossaryPane) && /seg-glider/.test(segBlock(glossaryPane, 'glossaryAnnotation')));
check('ASR 复用 .seg 分段控件', /class="seg seg-2[^"]*" data-seg="asrCorrection"/.test(servicePane) && /seg-glider/.test(segBlock(servicePane, 'asrCorrection')));
check('二元分段用固定宽度修饰类（不撑满整行）', /\.seg-compact\s*\{[^}]*width:\s*132px/.test(css));
check('括注说明含「中文译名（日文原文）」格式', /中文译名（日文原文）/.test(glossaryPane));
check('括注辅注提示会重译一次', /重译一次/.test(glossaryPane));
check('ASR 辅注说明 token 消耗无差别', /token/.test(servicePane) && /几乎无差别/.test(servicePane));
check('辅注样式复用既有 --text-dim 令牌', /\.row-note\s*\{[\s\S]{0,200}?var\(--text-dim\)/.test(css));

// 默认值只有一个来源（types/index.ts）；控件默认项必须落在可点取值内
check('默认 glossaryAnnotation=off 且为控件可选项', DEFAULT_SETTINGS.glossaryAnnotation === 'off' && segValues(glossaryPane, 'glossaryAnnotation').includes('off'), String(DEFAULT_SETTINGS.glossaryAnnotation));
check('默认 asrCorrection=normal 且为控件可选项', DEFAULT_SETTINGS.asrCorrection === 'normal' && segValues(servicePane, 'asrCorrection').includes('normal'), String(DEFAULT_SETTINGS.asrCorrection));
check('设置页不持有第二份默认值', !/glossaryAnnotation\s*[:=]\s*'/.test(ts) && !/asrCorrection\s*[:=]\s*'/.test(ts));

// 切换后写盘：控件能点出的每个值都必须被存储层原样接受（否则一点就被改回默认）
const roundTrip = (key, values) =>
  values.every((v) => sanitizeSettings({ ...DEFAULT_SETTINGS, [key]: v })[key] === v);
check('括注每个可点值都能原样落盘', roundTrip('glossaryAnnotation', ['off', 'on']));
check('ASR 每个可点值都能原样落盘', roundTrip('asrCorrection', ['normal', 'strict']));

// 非法值回落（兜底在 utils/storage.ts，不在页面里各写一遍）
check('非法括注值回落 off', sanitizeSettings({ ...DEFAULT_SETTINGS, glossaryAnnotation: 'maybe' }).glossaryAnnotation === 'off');
check('非法 ASR 值回落 normal', sanitizeSettings({ ...DEFAULT_SETTINGS, asrCorrection: 'lenient' }).asrCorrection === 'normal');
check('非字符串值回落默认', sanitizeSettings({ ...DEFAULT_SETTINGS, glossaryAnnotation: 1, asrCorrection: null }).glossaryAnnotation === 'off'
  && sanitizeSettings({ ...DEFAULT_SETTINGS, glossaryAnnotation: 1, asrCorrection: null }).asrCorrection === 'normal');

// 绑定与同步：data-setting 通用绑定 + onChanged 反向刷新，无控件专属代码
check('分段按钮点击走既有 update() 落盘', /update\(\{ \[key\]: el\.dataset\.value \}/.test(ts));
check('点击后立即重绘，不等存储回声', /update\(\{ \[key\]: el\.dataset\.value \}[\s\S]{0,200}?reflectSettings\(\)/.test(ts));
check('onChanged 回调调用 reflectSettings（弹窗改完本页同步）', /onChanged\.addListener[\s\S]{0,700}?reflectSettings\(\)/.test(ts));
check('分段选中态与滑块统一由 reflectSettings 写入', /el\.classList\.toggle\('active', on\)/.test(ts) && /--seg-index/.test(ts));
check('分段按钮向读屏暴露选中态（aria-pressed）', /setAttribute\('aria-pressed'/.test(ts));
check('防抖窗口内多次改动累积落盘（不会只剩最后一项）', /pendingPatch/.test(ts) && /saveStoredSettings\(toSave\)/.test(ts));

// 与弹窗同一份存储：弹窗经 background 的 GET/SAVE_SETTINGS 转调 utils/storage，
// 设置页直接调 utils/storage；键名只在 storage.ts 里出现一份。
const backgroundTs = read('../entrypoints/background.ts');
check('设置页直连 utils/storage 的读写函数',
  /import \{[^}]*getStoredSettings[^}]*saveStoredSettings[^}]*\} from '\.\.\/\.\.\/utils\/storage'/.test(ts));
check('弹窗经 background 走同一个 utils/storage',
  /chrome\.runtime\.sendMessage\(\{ type: 'GET_SETTINGS'/.test(popupTs)
  && /import \{[^}]*getStoredSettings[^}]*\} from '\.\.\/utils\/storage'/.test(backgroundTs)
  && /case 'GET_SETTINGS'/.test(backgroundTs) && /case 'SAVE_SETTINGS'/.test(backgroundTs));
// 键名只定义一份：页面里最多出现 onChanged 守卫那一处引用，不许再定义副本
check('存储键只在 utils/storage.ts 定义',
  !/(?:const|let|var)\s+\w+\s*=\s*['"]yt_sub_translator_settings['"]/.test(ts)
  && !popupTs.includes('yt_sub_translator_settings')
  && !backgroundTs.includes('yt_sub_translator_settings')
  && (storageTs.match(/'yt_sub_translator_settings'/g) || []).length === 1
  && (ts.match(/yt_sub_translator_settings/g) || []).length <= 1);

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

// 新控件不许开新的令牌（否则就是样式分叉的起点）
const rootClose = css.indexOf('}', css.indexOf(':root {'));
const strayTokens = [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)]
  .filter((m) => m.index > rootClose)
  .map((m) => m[1]);
check('未新增自定义属性令牌（:root 之外无声明）', strayTokens.length === 0, strayTokens.join(', '));

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
