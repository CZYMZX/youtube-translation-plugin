import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { DEFAULT_SETTINGS } from '../types/index.ts';
import { sanitizeSettings } from '../utils/storage.ts';
import { buildPromptLayers, PROMPT_LAYER_ORDER } from '../utils/prompt-layers.ts';
import {
  FREE_PROVIDER_ID,
  LEGACY_ICON_KEYS,
  MAX_CUSTOM_MODELS,
  PRESET_MODELS,
  PROVIDERS,
  PROVIDER_IDS,
  cachedModelsKey,
  findProviderByModelId,
  getProvider,
  isModelIconKey,
  providerHasModel,
  resolveProviderByService
} from '../utils/models.ts';
import { PROVIDER_ICON_KEYS } from '../utils/provider-icons.ts';
import { validateGlossaryPack, validateScenePack } from '../utils/packs.ts';

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

/* ── 1. 信息架构：8 个分区，tablist + tabpanel 成对 ── */
const navLabels = [...html.matchAll(/class="navitem-label">([^<]+)</g)].map((m) => m[1]);
const expected = ['常规', '服务与模型', '翻译场景', '术语库', '断句引擎', '字幕样式', '同步与缓存', '关于'];
check('分区数量为 8', navLabels.length === 8, navLabels.join('/'));
check('分区名称与设计一致', JSON.stringify(navLabels) === JSON.stringify(expected), navLabels.join('/'));
// 本轮需求一：翻译场景是独立分区，且必须夹在「服务与模型」与「术语库」之间
check('翻译场景紧接在术语库之前', navLabels.indexOf('翻译场景') === navLabels.indexOf('术语库') - 1
  && navLabels.indexOf('翻译场景') === 2, navLabels.join('/'));

check('导航使用 role=tablist', /role="tablist"/.test(html));
check('每个分区都有 role=tabpanel', (html.match(/role="tabpanel"/g) || []).length === 8);
check('导航项带 aria-selected', (html.match(/aria-selected="/g) || []).length >= 8);
check('每个面板有 aria-labelledby', (html.match(/aria-labelledby="nav-/g) || []).length === 8);

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

/* ══════════════════════════════════════════════════════════════════════════
 * 10. 服务与模型：厂牌一级 / 模型二级（任务四 · 需求二）
 * ══════════════════════════════════════════════════════════════════════════ */
const modelsTs = read('../utils/models.ts');
const iconsTs = read('../utils/provider-icons.ts');

check('厂牌列表容器在服务分区', servicePane.includes('id="provider-list"'));
check('免 Key 区单独一块，且排在厂牌列表之前',
  servicePane.indexOf('id="btn-free-google"') > -1
  && servicePane.indexOf('id="btn-free-google"') < servicePane.indexOf('id="provider-list"'),
  String(servicePane.indexOf('id="btn-free-google"')));
check('免 Key 区写明不用 Key、不用选模型', /不用 Key/.test(servicePane) && /不用选模型/.test(servicePane));
// 需求 7：「连通性测试」已从服务分区那一行迁进每个厂牌展开面板的工具条，
// 旧的全局按钮 #btn-test-service / 延迟位 #service-latency 已删除（不是搬走后留个空壳）。
check('降级开关 / ASR 仍在服务分区，连通性测试已迁入厂牌面板',
  ['autoFallbackToGoogle', 'asrCorrection'].every((k) => servicePane.includes(k))
  && ts.includes('testBtn.id = `btn-test-provider-${provider.id}`')
  && !html.includes('btn-test-service') && !html.includes('service-latency')
  && !ts.includes('btn-test-service'));
check('旧的全局 Key / Base URL / 手填 model 输入框已移除（Key 改由厂牌行承载）',
  !/data-setting="apiKey"/.test(html) && !/data-setting="apiBaseUrl"/.test(html)
  && !/data-setting="modelName"/.test(html) && !html.includes('id="model-list"'));
check('旧的按服务商分组的渲染入口已移除', !/renderModelList/.test(ts));

check('厂牌行是展开按钮（aria-expanded + aria-controls 指向面板）',
  /row\.setAttribute\('aria-expanded', String\(open\)\)/.test(ts)
  && /row\.setAttribute\('aria-controls', `provider-panel-\$\{provider\.id\}`\)/.test(ts));
check('默认只展开当前在用的厂牌',
  /expandedProviderId = settings\.providerId \|\| ''/.test(ts)
  && /const open = expandedProviderId === provider\.id/.test(ts));
check('其余厂牌折叠（面板 hidden：不可聚焦、不进 tab 序列）', /panel\.hidden = !open/.test(ts));
check('点整行展开 / 收起', /function toggleProviderPanel/.test(ts) && /expandedProviderId === providerId \? '' : providerId/.test(ts));

check('厂牌图标来自 providerIconHtml（LobeHub 原始路径），页面里没有第二套图标数据',
  /providerIconHtml\(provider\.iconKey, provider\.name\)/.test(ts) && !/MODEL_ICONS/.test(ts));
check('模型行缩进在厂牌面板里，且不再逐个画图标',
  /\.provider-panel\s*\{[^}]*margin:\s*0 0 0 24px/.test(css) && !/\.model-icon/.test(css));
check('厂牌行露出 Key 状态与模型数',
  /keyState\.textContent = providerKeyOf\(provider\) \? '已配置 Key' : '未配置 Key'/.test(ts)
  && /count\.textContent = `· \$\{rows\.length\} 个模型`/.test(ts));
check('模型行 ＝ 显示名 + 等宽 id + 定位 note + 使用中',
  /className = 'model-label'/.test(ts) && /className = 'model-id'/.test(ts)
  && /className = 'model-note'/.test(ts) && /state\.textContent = '使用中'/.test(ts));
check('使用中的行标注「使用中」且不可再点',
  /if \(current\) return;/.test(ts) && /setAttribute\('aria-disabled', 'true'\)/.test(ts));

check('点模型一次性写 providerId / modelName / service / apiBaseUrl / apiKey',
  /providerId: provider\.id,/.test(ts) && /modelName: modelId,/.test(ts)
  && /service: provider\.service,/.test(ts) && /apiBaseUrl: providerBase\(provider\),/.test(ts)
  && /apiKey: key/.test(ts) && /await update\(\{/.test(ts));
check('Key 输入框与该厂牌绑定（写 providerKeys[厂牌]，当前厂牌同步 apiKey）',
  /dataset\.providerKey = provider\.id/.test(ts)
  && /if \(settings\.providerId === providerId\) patch\.apiKey = trimmed/.test(ts));
check('切厂牌看到的是那一家自己的 Key（值取 providerKeys[provider.id]）',
  /settings\.providerKeys \|\| \{\}\)\[provider\.id\]/.test(ts));
check('Base URL 收进「高级」折叠区（details/summary，默认收起）',
  /createElement\('details'\)/.test(ts) && /summary\.textContent = '高级：Base URL'/.test(ts));
check('Base URL 覆盖值按厂牌存，空 = 回落官方端点',
  /dataset\.providerBase = provider\.id/.test(ts) && /providerBaseOverride\(provider\) \|\| provider\.defaultBaseUrl/.test(ts));

check('获取模型作用于传进来的厂牌，结果只并进它的列表',
  /function fetchModels\(providerId: string\)/.test(ts) && /onlineModels\[provider\.id\] = res\.models/.test(ts)
  && /\[cachedModelsKey\(provider\.id\)\]: res\.models/.test(ts));
// v0.4.2 问题 2 改口径：**参考清单彻底退出 UI 列表**。`provider.models` 只服务默认值、
// providerHasModel / findProviderByModelId 归属判断；设置页的模型行只剩
// 在线缓存 ∪ 自定义模型 ∪ 当前在用的那一行（空则出空态提示）。
check('模型列表不再渲染厂牌参考清单（参考清单只作默认值 / 归属判断）',
  !/for \(const model of provider\.models\)/.test(ts)
  && !/hiddenReferenceCount/.test(ts)
  && !/trustOnline/.test(ts));
check('列表 = 在线缓存 ∪ 自定义 ∪ 当前在用的那一行（按 id 去重）',
  /for \(const item of onlineModels\[provider\.id\] \|\| \[\]\)/.test(ts)
  && /seen\.has\(item\.id\)/.test(ts) && /entry\.providerId !== provider\.id/.test(ts)
  && /onlineModels\[provider\.id\] \|\| \[\]\)\.length > 0/.test(ts));
check('没有缓存时的空态提示指向「获取模型」（不再拿预置型号兜底）',
  /还没获取过模型列表/.test(ts) && /provider-empty/.test(ts));
check('拉取期间按钮禁用并显示进度', /btn\.textContent = '获取中…'/.test(ts) && /btn\.disabled = true/.test(ts));
check('拉取失败给出可读原因', /获取失败：\$\{res\?\.error/.test(ts));
check('未填 Key 先提示并聚焦该厂牌的 Key 输入',
  /请先填写 \$\{provider\.name\} 的 API Key/.test(ts) && /data-fk="key:\$\{provider\.id\}"/.test(ts));
check('Google 免 Key 通道跳过拉取', /service === 'google'[\s\S]{0,80}?无需选择模型/.test(ts));
check('自定义模型入口在厂牌面板里', /dataset\.addCustom = provider\.id/.test(ts) && /＋ 自定义模型/.test(ts));

check('手填 / 已下架的旧型号仍显示为一行并保持选中',
  /当前设置：\$\{currentId\}/.test(ts) && /当前设置 · 未在列表/.test(ts));
check('列表支持 ↑↓/Home/End 在可见模型行间移动',
  /'#provider-list \.provider-group\.is-open \.provider-panel \.model-hit'/.test(ts));
check('hover 用左侧标线而不是整体上浮',
  /\.model-hit::before/.test(css) && /\.provider-row::before/.test(css)
  && !/\.provider-row:hover\s*\{[^}]*translateY/.test(css));
check('重绘后把焦点还回去（不把键盘用户甩回页顶）',
  /focusKeyAfterRender/.test(ts) && /\[data-fk="\$\{fk\}"\]/.test(ts) && /setSelectionRange/.test(ts));
check('Key 输入走 silent 更新（重绘不换掉正在输入的框）',
  /void update\(patch, \{ silent: true \}\)/.test(ts) && /silent\?: boolean/.test(ts));

// v0.4.2 本轮：弹窗的选项已与设置页对齐（8 通道 / 按厂牌 Key / 模型不混装）。
// 口径：唯一权威清单在 utils/models.ts，弹窗**只读引用**它，不再留兜底副本。
check('弹窗与设置页同源：两边都从 utils/models 取 PROVIDERS',
  /export const PRESET_MODELS/.test(modelsTs) && !/const PRESET_MODELS/.test(ts)
  && /from '\.\.\/\.\.\/utils\/models'/.test(ts) && /from '\.\.\/\.\.\/utils\/models'/.test(popupTs));
check('弹窗的服务下拉由 PROVIDERS 动态填充（HTML 里不再硬编码 4 项）',
  /function renderServiceOptions/.test(popupTs)
  && /PROVIDERS\.filter\(\(p\) => p\.id !== free\.id\)/.test(popupTs)
  && /<select id="service-select" class="form-select"><\/select>/.test(popupHtml)
  && PROVIDERS.length === 8);
check('弹窗按厂牌读在线缓存 + 当前设置（不再按 service 读清单、也不拿预设补位）',
  /function buildModelChoices\(online: ModelChoice\[\], currentModel: string\)/.test(popupTs)
  && !/for \(const model of provider\.models\)/.test(popupTs)
  && !/PRESET_MODELS\[service\]/.test(popupTs.replace(/\/\*[\s\S]*?\*\//g, '')));
check('缓存键口径同一套：utils/models 生成一份，弹窗按 providerId + 兼容旧 service 键',
  /export function cachedModelsKey/.test(modelsTs)
  && cachedModelsKey('service') === 'cached_models_service'
  && cachedModelsKey('claude') === 'cached_models_claude'
  && /cachedModelsKey\(provider\.id\)/.test(popupTs)
  && /cachedModelsKey\(provider\.service\)/.test(popupTs)
  && !/`cached_models_\$\{/.test(ts));
check('弹窗按厂牌存 Key / 端点（providerKeys / providerBaseUrls），整份 settings 下发',
  /providerKeys\[active\.id\] = typedKey/.test(popupTs)
  && /providerBaseUrls\[active\.id\] = typedBase/.test(popupTs)
  && /providerId: providerIdForPersist\(\)/.test(popupTs)
  && /providerKeys,/.test(popupTs) && /providerBaseUrls,/.test(popupTs));

/* ── 11. 图标：全部来自 LobeHub 官方包，页面不自己绘制 ── */
check('图标来源写明 LobeHub 官方 SVG 包（MIT）',
  /lobehub/i.test(iconsTs) && /icons-static-svg/.test(iconsTs) && /MIT/.test(iconsTs));
check('图标 key 与厂牌对得上（8 个厂牌 = 7 个官方图标 + 1 个字母兜底）',
  PROVIDER_ICON_KEYS.length === 8 && PROVIDERS.filter((p) => p.iconKey).length === 7,
  `${PROVIDER_ICON_KEYS.length}/${PROVIDERS.filter((p) => p.iconKey).length}`);
check('每个有图标的厂牌 iconKey 都在图标白名单里',
  PROVIDERS.filter((p) => p.iconKey).every((p) => PROVIDER_ICON_KEYS.includes(p.iconKey)),
  PROVIDERS.map((p) => p.iconKey).join('/'));
check('免 Key 厂牌不冒充别家品牌（iconKey 留空 → 字母兜底）', getProvider(FREE_PROVIDER_ID).iconKey === '');
check('models.ts 不再存任何自绘 SVG 路径（品牌图标数据只剩在 provider-icons.ts）',
  !/<path|<svg/.test(modelsTs) && !/MODEL_ICONS|inferModelIcon/.test(ts));
check('历史 icon 值仍可被清洗接受（升级不抹值，也不失为新厂牌 key）',
  LEGACY_ICON_KEYS.every((k) => isModelIconKey(k)) && isModelIconKey('zhipu') && !isModelIconKey('brand-x'));
check('厂牌圆底 28px / 图标 18px 由 providerIconHtml 统一决定',
  /providerIconHtml\(provider\.iconKey, provider\.name\)/.test(ts) && /size = 18/.test(iconsTs));

/* ══════════════════════════════════════════════════════════════════════════
 * 12. 自定义模型：挂在厂牌下，字段收敛为 显示名 + model id
 * ══════════════════════════════════════════════════════════════════════════ */
check('弹层收敛为 显示名 + model id（服务商与图标跟随厂牌）',
  html.includes('id="cm-label"') && html.includes('id="cm-id"')
  && !html.includes('id="cm-service"') && !html.includes('id="cm-icon-grid"'));
check('弹层写明这条挂在哪个厂牌下', html.includes('id="cm-provider-name"') && /这个厂牌下/.test(html));
check('新增入口由厂牌面板委托触发（不再有全局按钮）',
  /btn\.dataset\.addCustom/.test(ts) && !/id="btn-add-custom-model"/.test(html));
check('保存写入 customModels 且带 providerId', /providerId: provider\.id/.test(ts) && /list\.push\(entry\)/.test(ts));
check('编辑改写同一下标', /list\[wasEditing\] = entry/.test(ts));
check('删除前确认并落盘', /删除「\$\{providerName\}」下的自定义模型/.test(ts) && /list\.splice\(index, 1\)/.test(ts));
check('上限 20 条（页面拦截）', /list\.length >= MAX_CUSTOM_MODELS/.test(ts) && MAX_CUSTOM_MODELS === 20);
check('model id 有格式与长度校验', /\^\[A-Za-z0-9\._:\/-\]\{1,120\}\$/.test(ts));
check('删除正在使用中的条目回退到该厂牌默认模型',
  /settings\.modelName === entry\.id[\s\S]{0,240}?const fallback = provider\.models\[0\]/.test(ts));
check('改 id 时同步 modelName 与该厂牌的模型记忆（不留悬空引用）',
  /settings\.modelName === before\.id[\s\S]{0,160}?withModelSelection\(\{ modelName: id \}, provider\.id, id\)/.test(ts));
check('同名去重按「厂牌 + id」', /\(m\.providerId \|\| ''\) === provider\.id && m\.id === id/.test(ts));

const customOk = sanitizeSettings({
  ...DEFAULT_SETTINGS,
  customModels: [
    { id: 'gpt-6.1-sol', label: '我的 sol', service: 'openai', icon: 'openai', providerId: 'openai' },
    { id: '', label: '空 id', service: 'openai', icon: 'openai' },
    { id: 'x-1', label: '', service: 'nope', icon: 'chatgpt' },
    { id: 'x-2', label: '', service: 'custom', icon: 'evil-logo' }
  ]
}).customModels;
check('非法条目单条丢弃、合法条目保留（不整份重置）',
  customOk.length === 2 && customOk[0].id === 'gpt-6.1-sol' && customOk[1].id === 'x-2',
  JSON.stringify(customOk.map((m) => m.id)));
check('非法图标回落 generic', customOk[1].icon === 'generic');
check('label 缺省回落 id', customOk[1].label === 'x-2');
check('老条目没有 providerId 时按 service 的主厂牌补上', customOk[1].providerId === 'openai', String(customOk[1].providerId));
check('providerId 非法时也回落主厂牌', sanitizeSettings({
  ...DEFAULT_SETTINGS,
  customModels: [{ id: 'm', label: 'M', service: 'deepseek', icon: 'deepseek', providerId: 'evil' }]
}).customModels[0].providerId === 'deepseek');
check('同一 id 在两个厂牌下是两条不同的配置', sanitizeSettings({
  ...DEFAULT_SETTINGS,
  customModels: [
    { id: 'dup', label: 'A', service: 'openai', icon: 'openai', providerId: 'openai' },
    { id: 'dup', label: 'B', service: 'openai', icon: 'openai', providerId: 'claude' }
  ]
}).customModels.length === 2);
check('同厂牌同 id 才去重', sanitizeSettings({
  ...DEFAULT_SETTINGS,
  customModels: [
    { id: 'dup', label: 'A', service: 'openai', icon: 'openai', providerId: 'claude' },
    { id: 'dup', label: 'B', service: 'openai', icon: 'openai', providerId: 'claude' }
  ]
}).customModels.length === 1);
check('非法 customModels（非数组）落回空数组', Array.isArray(sanitizeSettings({ customModels: 'x' }).customModels)
  && sanitizeSettings({ customModels: 'x' }).customModels.length === 0);
check(`超限截断到 ${MAX_CUSTOM_MODELS} 条`, sanitizeSettings({
  ...DEFAULT_SETTINGS,
  customModels: Array.from({ length: 30 }, (_, i) => ({ id: `m-${i}`, label: `M${i}`, service: 'openai', icon: 'openai', providerId: 'openai' }))
}).customModels.length === MAX_CUSTOM_MODELS);
check('自定义条目往返不丢字段', JSON.stringify(sanitizeSettings({
  ...DEFAULT_SETTINGS,
  customModels: [{ id: 'glm-5.3', label: 'GLM 5.3', service: 'openai', icon: 'zhipu', providerId: 'zhipu' }]
}).customModels[0]) === JSON.stringify({ id: 'glm-5.3', label: 'GLM 5.3', service: 'openai', icon: 'zhipu', providerId: 'zhipu' }));

/* ══════════════════════════════════════════════════════════════════════════
 * 13. 跨厂牌切换：providerKeys / providerBaseUrls 往返 + 老数据迁移
 * ══════════════════════════════════════════════════════════════════════════ */
const keyed = sanitizeSettings({
  ...DEFAULT_SETTINGS,
  service: 'deepseek',
  providerId: 'deepseek',
  apiKey: 'sk-deepseek',
  providerKeys: { deepseek: 'sk-deepseek', openai: '  sk-openai  ', claude: '', evil: 'sk-x', gemini: 1 }
});
check('providerKeys 只保留厂牌白名单里的键',
  Object.keys(keyed.providerKeys).sort().join(',') === 'deepseek,openai', JSON.stringify(keyed.providerKeys));
check('providerKeys 值会 trim', keyed.providerKeys.openai === 'sk-openai');
check('当前厂牌那一格与 apiKey 一致', keyed.providerKeys.deepseek === 'sk-deepseek');
check('非字符串 / 空串 / 未知键都不占格',
  !('claude' in keyed.providerKeys) && !('evil' in keyed.providerKeys) && !('gemini' in keyed.providerKeys));
check('切换厂牌后 Key 与端点互不串（两格各存各的）', (() => {
  const r = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    service: 'openai',
    providerId: 'claude',
    apiKey: 'sk-claude',
    apiBaseUrl: 'https://api.anthropic.com/v1',
    providerKeys: { claude: 'sk-claude', openai: 'sk-openai' },
    providerBaseUrls: { claude: 'https://api.anthropic.com/v1', openai: 'https://my-relay/v1' }
  });
  return r.providerId === 'claude'
    && r.providerKeys.claude === 'sk-claude' && r.providerKeys.openai === 'sk-openai'
    && r.providerBaseUrls.claude === 'https://api.anthropic.com/v1'
    && r.providerBaseUrls.openai === 'https://my-relay/v1';
})());
check('service 也是 openai 的厂牌不会被「按 service 归一」冲掉（claude 仍是 claude）',
  sanitizeSettings({ ...DEFAULT_SETTINGS, service: 'openai', providerId: 'claude', apiKey: 'sk-c' }).providerId === 'claude');

check('老用户升级：只有 apiKey 时按 service 的主厂牌落到 providerKeys', (() => {
  const up = sanitizeSettings({ ...DEFAULT_SETTINGS, service: 'gemini', apiKey: 'sk-legacy' });
  return up.apiKey === 'sk-legacy' && up.providerId === 'gemini' && up.providerKeys.gemini === 'sk-legacy';
})());
check('迁移旧 serviceKeys → providerKeys（已有值不被覆盖）', (() => {
  const r = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    service: 'deepseek',
    apiKey: 'sk-new',
    serviceKeys: { deepseek: 'sk-old', openai: 'sk-openai', gemini: 'sk-gemini' },
    providerKeys: { openai: 'sk-keep' }
  });
  return r.providerKeys.deepseek === 'sk-new' && r.providerKeys.openai === 'sk-keep' && r.providerKeys.gemini === 'sk-gemini';
})());
check('迁移旧 baseUrls → providerBaseUrls（已有值不被覆盖）', (() => {
  const r = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    service: 'deepseek',
    apiBaseUrl: 'https://api.deepseek.com/v1',
    baseUrls: { deepseek: 'https://old/v1', openai: 'https://relay/v1' },
    providerBaseUrls: { openai: 'https://keep/v1' }
  });
  return r.providerBaseUrls.deepseek === 'https://api.deepseek.com/v1'
    && r.providerBaseUrls.openai === 'https://keep/v1';
})());
check('旧字段迁完不再写回（serviceKeys / baseUrls 从输出里消失）',
  !('serviceKeys' in keyed)
  && !('baseUrls' in sanitizeSettings({ ...DEFAULT_SETTINGS, baseUrls: { deepseek: 'https://x/v1' } })));
check('清空 apiKey 会清掉当前厂牌那一格，别的厂牌不受影响', (() => {
  const cleared = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    service: 'deepseek',
    providerId: 'deepseek',
    apiKey: '',
    providerKeys: { deepseek: 'sk-old', openai: 'sk-keep' }
  });
  return cleared.apiKey === '' && !('deepseek' in cleared.providerKeys) && cleared.providerKeys.openai === 'sk-keep';
})());
check('Key 与 apiKey 共用同一个长度上限（400）', (() => {
  const long = 'k'.repeat(500);
  const r = sanitizeSettings({ ...DEFAULT_SETTINGS, service: 'openai', providerId: 'openai', apiKey: long });
  return r.apiKey.length === 400 && r.providerKeys.openai.length === 400;
})());
check('Google 免费通道不把 Key 写进免 Key 那一格', (() => {
  const r = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    service: 'google',
    providerId: 'deepseek',
    apiKey: 'sk-x',
    providerKeys: { deepseek: 'sk-x' }
  });
  return r.providerId === 'deepseek' && !(FREE_PROVIDER_ID in r.providerKeys);
})());
check('service 变了但 providerId 没跟着变（弹窗只改 service）时按 service 重新落位', (() => {
  const r = sanitizeSettings({ ...DEFAULT_SETTINGS, service: 'openai', providerId: 'deepseek', apiKey: 'sk-o' });
  return r.providerId === 'openai' && !('deepseek' in r.providerKeys) && r.providerKeys.openai === 'sk-o';
})());
check('切换通道时把 Key / 端点 / 模型一起搬（不留跨厂牌的悬空引用）',
  /providerId: provider\.id[\s\S]{0,220}?apiKey: providerKeyOf\(provider\)/.test(ts)
  && /apiBaseUrl: providerBase\(provider\)/.test(ts)
  && /const nextModel = nextModelFor\(provider\)/.test(ts));
check('取不回 Key 时给一行提示', /还没有保存 Key/.test(ts) && /未配置 Key/.test(ts) && /syncServiceChrome/.test(ts));
check('默认值只在 types 定义一份（页面不另存）', DEFAULT_SETTINGS.customModels.length === 0
  && JSON.stringify(DEFAULT_SETTINGS.providerKeys) === '{}'
  && DEFAULT_SETTINGS.providerId === 'deepseek'
  && !/customModels\s*:\s*\[/.test(ts) && !/providerKeys\s*:\s*\{\}/.test(ts));


/* ── 14. 需求二：原生下拉在深色下的可读性 ── */
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
check('设置页 :root 声明 color-scheme: dark（原生 popup 跟随深色）', /color-scheme:\s*dark/.test(rootBlock));
check('全仓 .ctl-select 的 option 配色有兜底', /\.ctl-select option[\s\S]{0,120}?background-color:\s*#14151a/.test(css)
  && /\.ctl-select option[\s\S]{0,120}?color:\s*var\(--text-main\)/.test(css));
check('行内编辑的分类下拉（select.gloss-input）一并覆盖', /select\.gloss-input option/.test(css));
check('弹窗 .form-select 的 option 配色已在仓库内', /\.form-select option\s*\{[^}]*background:\s*#18181b/.test(popupCss)
  && /\.form-select option\s*\{[^}]*color:\s*#ffffff/.test(popupCss));

/* ══════════════════════════════════════════════════════════════════════════
 * 15. 需求一：独立「翻译场景」分区（提示词分层展示 + 可编辑）
 * ══════════════════════════════════════════════════════════════════════════ */
const scenarioPane = paneOf('scenario');
const packsTs = read('../utils/packs.ts');

check('独立场景面板存在且与其余分区同一套 tab 写法',
  /role="tab" class="navitem" id="nav-scenario" aria-controls="pane-scenario" data-pane="scenario" aria-selected="false" tabindex="-1"/.test(html)
  && /id="pane-scenario" role="tabpanel" aria-labelledby="nav-scenario"/.test(html));
check('翻译场景已进期望数组（不是放宽断言）', expected.includes('翻译场景') && expected[2] === '翻译场景');

check('场景分区为两栏（场景列表 + 详情），复用术语库的 .pack-rail', /class="scenario-layout"/.test(scenarioPane)
  && /class="pack-rail"/.test(scenarioPane)
  && /id="scene-list"/.test(scenarioPane) && /id="scene-detail"/.test(scenarioPane));
check('两栏栅格与 .gloss-layout 同一条规则（不另造视觉语言）',
  /\.gloss-layout,\s*\.scenario-layout\s*\{[^}]*grid-template-columns:\s*218px minmax\(0,\s*1fr\)/.test(css));
check('场景列表是 listbox/option 语义', /id="scene-list" role="listbox" aria-label="翻译场景列表"/.test(scenarioPane));

/* 数据源：分层模型与场景包解析都在 utils，页面不留第二份文案 */
check('场景数据来自 getAllScenes（内置 + 自定义全列）', /const scenes = \(\): ScenePack\[\] => getAllScenes\(customPacks\)/.test(ts));
check('分层数据来自 buildPromptLayers（与真正注入同源，页面不自己拼）',
  /buildPromptLayers\(resolved\.prompt, settings, targetLang\)/.test(ts) && !/COMMON_RULES/.test(ts) && !/禁 AI 腔/.test(ts));
check('层顺序取自 PROMPT_LAYER_ORDER', /for \(const key of PROMPT_LAYER_ORDER\)/.test(ts));
check('层序号取 PROMPT_LAYER_ORDER 的位置（术语层留位时输出契约仍是第 7 层）',
  /PROMPT_LAYER_ORDER\.indexOf\(key\) \+ 1/.test(ts));
check('场景层文案走 resolveScenePrompt（占位场景才不会看成空）', /resolveScenePrompt\(scene\.id, customPacks\)/.test(ts));

/* 每层的「由什么控制」标注 */
const ownerBlock = (ts.match(/const LAYER_OWNERS[\s\S]*?\n\};/) || [''])[0];
check('PROMPT_LAYER_ORDER 的每一层都有控制方标注',
  PROMPT_LAYER_ORDER.every((k) => new RegExp(`${k}:\\s*'`).test(ownerBlock)), ownerBlock.slice(0, 60));
for (const label of ['场景自带', '全局固定', '受「专有名词括注原文」设置控制', '受「ASR 纠错授权」控制', '受推理档位控制', '格式契约不可改']) {
  check(`控制方文案含「${label}」`, ownerBlock.includes(label));
}
check('控制方标在卡片右上角（.layer-owner + margin-left:auto）',
  /className = 'layer-owner'/.test(ts) && /\.layer-owner\s*\{[^}]*margin-left:\s*auto/.test(css));

/* 只有 scene 层可编辑 */
check('数据层口径：editable 只在 scene 层为真',
  buildPromptLayers('场景人设文案占位', DEFAULT_SETTINGS, 'zh-CN').filter((l) => l.editable).map((l) => l.key).join(',') === 'scene');
check('渲染按 layer.editable 分支，只有那一层出「编辑」按钮',
  /if \(layer\.editable && sceneEditing\)/.test(ts) && /id = 'btn-edit-scene-prompt'/.test(ts));

/* 空壳处理 */
check('术语层不预览空壳，只留说明位', /此处不预览/.test(ts) && /按本批命中的术语动态生成/.test(ts));
check('空正文层按 body 判空隐藏', /if \(!layer \|\| !layer\.body\.trim\(\)\) continue;/.test(ts));

check('顶层总说明写明「实际注入的 system prompt，从上到下拼接」',
  /这是实际注入给翻译模型的 system prompt，从上到下依次拼接/.test(ts)
  && /除「场景人设」外都不能在此修改/.test(ts));

/* 查看 vs 使用：点列表只换查看对象 */
const sceneClickBlock = (ts.match(/btn\.addEventListener\('click', \(\) => \{\n\s*viewingSceneId[\s\S]*?\n\s*\}\);/) || [''])[0];
check('点列表只切「查看」，不改正在使用的场景',
  sceneClickBlock.includes('viewingSceneId = scene.id') && !sceneClickBlock.includes('update('), sceneClickBlock.slice(0, 60));
check('当前查看项用 aria-current 标记', /setAttribute\('aria-current', 'true'\)/.test(ts));
check('列表项同时标出「使用中」那一项', /pill pill-ok/.test(ts) && /scene\.id === settings\.scenario/.test(ts));
check('「使用此场景」是显式按钮，写 scenario 并落盘',
  /id = 'btn-use-scene'/.test(ts) && /update\(\{ scenario: scene\.id \}\)/.test(ts));
check('每个场景都标来源（内置 / 自定义）', /scene\.builtIn \? '内置' : '自定义'/.test(ts));

/* 编辑器 */
check('编辑态用 textarea，且有 label',
  /createElement\('textarea'\)/.test(ts) && /id = 'scene-prompt-input'/.test(ts) && /label\.htmlFor = 'scene-prompt-input'/.test(ts));
check('textarea 等宽 + 固定约 240px 带滚动',
  /\.scene-editor\s*\{[^}]*min-height:\s*240px/.test(css) && /\.scene-editor\s*\{[^}]*ui-monospace/.test(css)
  && /\.scene-editor\s*\{[^}]*overflow:\s*auto/.test(css));
check('保存 / 取消都是真按钮',
  /save\.type = 'button'/.test(ts) && /cancel\.type = 'button'/.test(ts)
  && /id = 'btn-save-scene-prompt'/.test(ts) && /id = 'btn-cancel-scene-prompt'/.test(ts));
check('长度口径与 PACK-UPLOAD-SPEC 一致（20~4000）',
  /SCENE_PROMPT_MIN = 20/.test(ts) && /SCENE_PROMPT_MAX = 4000/.test(ts)
  && /prompt\.length < 20/.test(packsTs) && /prompt\.length > 4000/.test(packsTs));
check('超限给行内错误，不静默截断',
  /setAttribute\('role', 'alert'\)/.test(ts) && /不会自动截断/.test(ts)
  && /sceneError = message/.test(ts) && !/slice\(0, SCENE_PROMPT_MAX\)/.test(ts));
check('编辑器有行内错误样式（复用语义错误色）', /\.field-error\s*\{[^}]*var\(--state-error\)/.test(css));

/* 两条落库路径 */
check('内置场景保存 = 另存为自定义副本',
  /if \(scene\.builtIn\)[\s\S]{0,160}?buildSceneCopy\(scene, text\)/.test(ts)
  && /custom-scene-/.test(ts) && /· 自定义/.test(ts));
check('副本 id 唯一（撞号加后缀重试）', /function uniqueSceneId/.test(ts) && /while \(taken\.has\(candidate\)\)/.test(ts));
check('副本建好即切换为使用中', /if \(copied\) await update\(\{ scenario: targetId \}\)/.test(ts));
check('自定义场景原地更新 prompt', /pack\.prompt = text/.test(ts));
check('两条路径都只写 saveScenePacks（没有第二份存储）',
  /saveScenePacks\(customPacks\.scenes\)/.test(ts) && /saveScenePacks/.test(read('../utils/packs.ts')));
check('保存成功必须提示「已有字幕会按新文案重译一次」', /该场景已更新，已有字幕会按新文案重译一次/.test(ts));
check('另存副本时提示「已另存为自定义场景」', /已另存为自定义场景/.test(ts));

/* 长正文折叠：不能一次渲几百行 DOM */
check('正文默认最多 8 行（CSS 按行高折算，不是拍一个 em 值）',
  /\.layer-body\s*\{[^}]*max-height:\s*calc\(1\.6em \* 8 \+ 22px\)/.test(css) && /LAYER_VISIBLE_LINES = 8/.test(ts));
check('超出折叠 +「展开全文」，展开后可收起',
  /展开全文/.test(ts) && /is-clamped/.test(ts)
  && /\.layer-card\.is-clamped \.layer-more/.test(css) && /textContent = open \? '收起' : '展开全文'/.test(ts));
check('折叠判定先估算、可见后用真实高度校正（隐藏面板量不出高度）',
  /estimateLayerLines/.test(ts) && /syncLayerClamp/.test(ts) && /body\.offsetParent === null/.test(ts));

/* ══════════════════════════════════════════════════════════════════════════
 * 16. 需求二：术语库「新建术语库」入口 + 空包
 * ══════════════════════════════════════════════════════════════════════════ */
/* 需求二：术语库「新建 / 导入 / 模板」三个入口（本轮把原来的整页正则收窄到 glossary 分区，
   否则会先匹配到同结构、同 class 的「翻译场景」栏底部） */
const railFoot = (pane) => (pane.match(/<div class="pack-rail-foot">[\s\S]*?<\/div>/) || [''])[0];
const glossRailFoot = railFoot(glossaryPane);
const sceneRailFoot = railFoot(scenarioPane);

check('新建术语库按钮在「导入 JSON」之上',
  glossRailFoot.indexOf('id="btn-new-pack"') > -1
  && glossRailFoot.indexOf('id="btn-new-pack"') < glossRailFoot.indexOf('id="btn-import-pack"'),
  glossRailFoot.replace(/\s+/g, ' ').slice(0, 80));
check('两个按钮同宽同高（都走 .btn + .btn-block）',
  /class="btn btn-quiet btn-block" id="btn-new-pack"/.test(html)
  && /class="btn btn-quiet btn-block" id="btn-import-pack"/.test(html));
check('包列表底部竖排（否则两个 block 按钮会挤成一行）',
  /\.pack-rail-foot\s*\{[^}]*flex-direction:\s*column/.test(css));
check('新建弹层复用 .modal 的写法与样式',
  /<dialog class="modal" id="new-pack-dialog" aria-labelledby="np-title">/.test(html)
  && /class="modal-foot"/.test(html)
  && /\.modal\s*\{[\s\S]{0,320}?border-radius:\s*var\(--radius-lg\)/.test(css));
check('弹层收名称（必填 ≤40）与描述（选填 ≤120）',
  /id="np-name" maxlength="40"/.test(html) && /id="np-desc" maxlength="120"/.test(html));
check('用 dialog.showModal（Esc 可关、焦点内置）', /openNewPackDialog/.test(ts) && /showModal\(\)/.test(ts));
check('名称重复被拦（行内错误，不静默改名）',
  /已经有同名的术语库/.test(ts) && /id="np-error" role="alert"/.test(html) && /setNewPackError/.test(ts));
check('id 唯一（custom- 前缀 + 撞号重试，避开内置 id）',
  /custom-glossary-\$\{slug\}-\$\{Date\.now\(\)\.toString\(36\)\}/.test(ts) && /function uniquePackId/.test(ts));
check('空包走内部构造，不经过 validateGlossaryPack（那里要求 entries 非空）',
  /entries: \[\]/.test(ts) && /不经过 validateGlossaryPack/.test(ts) && /entries 必须是非空数组/.test(packsTs));
check('创建后自动选中新包并写盘', /activePackId = pack\.id/.test(ts) && /persistGlossary\(`已创建/.test(ts));
check('创建后清掉筛选条件（否则空包会被误读成「被过滤空」）',
  /searchTerm = ''/.test(ts) && /categoryFilter = 'all'/.test(ts) && /categoryEl\.value = 'all'/.test(ts));
check('写入只走 saveGlossaryPacks（单份存储）', /saveGlossaryPacks\(customPacks\.glossaries\)/.test(ts));
check('空包也能选中并渲染为空表状态', /empty\?\.classList\.toggle\('hidden', rows\.length > 0/.test(ts));

/* ══════════════════════════════════════════════════════════════════════════
 * 17. 两个收尾（弹窗下拉配色 + Base URL 按厂牌分格）
 * ══════════════════════════════════════════════════════════════════════════ */
const popupRootBlock = popupCss.slice(popupCss.indexOf(':root {'), popupCss.indexOf('}', popupCss.indexOf(':root {')));
// v0.4.2 本轮把回退时一并丢掉的 `color-scheme: dark` 补回了弹窗 :root：
// 服务下拉现在有 8 个 option（厂牌名较长），原生下拉面板必须是深色底才读得清。
check('两侧 :root 都声明 color-scheme: dark（弹窗已补回，不再依赖 option 兜底）',
  /color-scheme:\s*dark/.test(rootBlock) && /color-scheme:\s*dark/.test(popupRootBlock));
check('弹窗既有的 .form-select option 兜底仍在', /\.form-select option\s*\{[^}]*background:\s*#18181b/.test(popupCss));

const baseKeyed = sanitizeSettings({
  ...DEFAULT_SETTINGS,
  service: 'deepseek',
  providerId: 'deepseek',
  apiBaseUrl: 'https://relay.example.com/v1',
  providerBaseUrls: {
    deepseek: 'https://old/v1',
    openai: '  https://api.openai.com/v1  ',
    evil: 'https://x',
    gemini: 1
  }
});
check('providerBaseUrls 只保留厂牌白名单里的键',
  Object.keys(baseKeyed.providerBaseUrls).sort().join(',') === 'deepseek,openai', JSON.stringify(baseKeyed.providerBaseUrls));
check('providerBaseUrls 值会 trim', baseKeyed.providerBaseUrls.openai === 'https://api.openai.com/v1');
check('当前厂牌那一格与 apiBaseUrl 强制一致', baseKeyed.providerBaseUrls.deepseek === 'https://relay.example.com/v1');
check('非字符串 / 未知键不占格', !('gemini' in baseKeyed.providerBaseUrls) && !('evil' in baseKeyed.providerBaseUrls));
check('老用户升级：没有 providerBaseUrls 时 apiBaseUrl 不被历史值覆盖', (() => {
  const up = sanitizeSettings({ ...DEFAULT_SETTINGS, service: 'deepseek', apiBaseUrl: 'https://api.deepseek.com/v1' });
  return up.apiBaseUrl === 'https://api.deepseek.com/v1'
    && up.providerBaseUrls.deepseek === 'https://api.deepseek.com/v1';
})());
check('清空 apiBaseUrl 会清掉当前厂牌那一格（回落官方端点）', (() => {
  const cleared = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    service: 'deepseek',
    providerId: 'deepseek',
    apiBaseUrl: '',
    providerBaseUrls: { deepseek: 'https://relay/v1', claude: 'https://api.anthropic.com/v1' }
  });
  return cleared.apiBaseUrl === '' && !('deepseek' in cleared.providerBaseUrls)
    && cleared.providerBaseUrls.claude === 'https://api.anthropic.com/v1';
})());
check('Base URL 与 apiBaseUrl 共用长度上限（300）', (() => {
  const long = `https://x.example.com/${'a'.repeat(400)}`;
  const r = sanitizeSettings({ ...DEFAULT_SETTINGS, service: 'openai', providerId: 'openai', apiBaseUrl: long });
  return r.apiBaseUrl.length === 300 && r.providerBaseUrls.openai.length === 300;
})());
check('非法 providerBaseUrls（非对象）落回空对象', JSON.stringify(sanitizeSettings({ providerBaseUrls: 'x' }).providerBaseUrls) === '{}');
check('服务分段控件也走同一套切换（不只剩模型行会换端点）',
  /key === 'service'[\s\S]{0,240}?serviceSwitchPatch\(target\)/.test(ts));
check('默认端点只在 utils/models 声明一份（页面不另存）',
  JSON.stringify(DEFAULT_SETTINGS.providerBaseUrls) === '{}' && !/providerBaseUrls\s*:\s*\{\}/.test(ts)
  && /providerBaseUrls\?: Record<string, string>/.test(read('../types/index.ts')));
check('清洗函数用「厂牌白名单 + 值 trim + 长度上限」',
  /function sanitizeProviderMap/.test(storageTs) && /if \(!PROVIDER_IDS\.includes\(key\)\) continue;/.test(storageTs)
  && /MAX_BASE_URL_LENGTH/.test(storageTs) && /MAX_SECRET_LENGTH/.test(storageTs));
check('旧 serviceKeys / baseUrls 标为「仅迁移用」',
  /@deprecated/.test(read('../types/index.ts')) && /迁移输入/.test(storageTs) && /delete merged\.serviceKeys/.test(storageTs));

/* ══════════════════════════════════════════════════════════════════════════
 * 18. 模型清单口径：8 个厂牌、过时型号已移除、PRESET_MODELS 与 PROVIDERS 一致
 * ══════════════════════════════════════════════════════════════════════════ */
check('PROVIDERS 有 8 个厂牌', PROVIDERS.length === 8 && PROVIDER_IDS.length === 8, PROVIDER_IDS.join(','));
check('厂牌顺序与文档一致',
  PROVIDER_IDS.join(',') === 'deepseek,openai,gemini,claude,qwen,kimi,zhipu,google-free', PROVIDER_IDS.join(','));
check('每个厂牌字段齐全',
  PROVIDERS.every((p) => p.id && p.name && typeof p.iconKey === 'string'
    && ['google', 'gemini', 'openai', 'deepseek'].includes(p.service)
    && typeof p.defaultBaseUrl === 'string' && typeof p.keyHint === 'string' && Array.isArray(p.models)));
check('除免 Key 厂牌外都有模型与官网 Key 入口',
  PROVIDERS.filter((p) => p.service !== 'google')
    .every((p) => p.models.length > 0 && /^https:\/\//.test(p.keyHint)));
check('模型条目是 { id, label, note? }，note 只写定位',
  PROVIDERS.every((p) => p.models.every((m) => typeof m.id === 'string' && m.id
    && typeof m.label === 'string' && m.label
    && (m.note === undefined || (m.note.length > 0 && m.note.length <= 12)))));
check('同一厂牌内 model id 唯一',
  PROVIDERS.every((p) => new Set(p.models.map((m) => m.id)).size === p.models.length));
check('Gemini 默认端点留空（走官方 SDK 路径）', getProvider('gemini').defaultBaseUrl === '');
check('Claude / 通义 / Kimi / GLM 走 openai 协议但各有自己的端点',
  ['claude', 'qwen', 'kimi', 'zhipu'].every((id) => getProvider(id).service === 'openai'
    && /^https:\/\//.test(getProvider(id).defaultBaseUrl)));

const staleIds = [
  'deepseek-chat', 'deepseek-reasoner', 'gpt-4o', 'gpt-4o-mini',
  'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp', 'claude-sonnet-4-6'
];
check('过时型号已从预设结构里移除',
  staleIds.every((id) => !PROVIDERS.some((p) => p.models.some((m) => m.id === id))));
check('过时型号也不在派生的 PRESET_MODELS 里',
  staleIds.every((id) => !JSON.stringify(PRESET_MODELS).includes(`"${id}"`)));
check('PRESET_MODELS 仍非空且按 service 列出',
  Object.keys(PRESET_MODELS).sort().join(',') === 'deepseek,gemini,openai'
  && Object.values(PRESET_MODELS).every((list) => list.length > 0),
  Object.keys(PRESET_MODELS).join(','));
check('PRESET_MODELS 与 PROVIDERS 完全一致（id 与顺序同源、无重复）', (() => {
  for (const [service, list] of Object.entries(PRESET_MODELS)) {
    const expected = PROVIDERS.filter((p) => p.service === service).flatMap((p) => p.models.map((m) => m.id));
    if (JSON.stringify(list.map((m) => m.id)) !== JSON.stringify([...new Set(expected)])) return false;
    if (new Set(list.map((m) => m.id)).size !== list.length) return false;
  }
  return true;
})());
check('PRESET_MODELS 条目带 name（兼容仍按 service 读清单的调用方）',
  Object.values(PRESET_MODELS).every((list) => list.every((m) => typeof m.name === 'string' && m.name.length > 0)));
check('弹窗也按厂牌列模型（不再按 service 读 PRESET_MODELS，同一 service 下不混装）',
  /function buildModelChoices\(online: ModelChoice\[\], currentModel: string\)/.test(popupTs)
  && !/for \(const model of provider\.models\)/.test(popupTs)
  && !/PRESET_MODELS\[service\]/.test(popupTs.replace(/\/\*[\s\S]*?\*\//g, ''))
  && !/const PRESET_MODELS/.test(popupTs.replace(/\/\*[\s\S]*?\*\//g, '')));
check('缓存键模板只由 utils/models 生成一份（现只服务设置页的厂牌内拉取）',
  /export function cachedModelsKey/.test(modelsTs)
  && cachedModelsKey('claude') === 'cached_models_claude'
  && cachedModelsKey('openai') === 'cached_models_openai');
check('按 id 反查厂牌 / 按 service 反查主厂牌可用',
  findProviderByModelId('claude-sonnet-5-5').id === 'claude'
  && findProviderByModelId('deepseek-flash').id === 'deepseek'
  && findProviderByModelId('nope-model') === undefined
  && resolveProviderByService('openai').id === 'openai'
  && resolveProviderByService('google').id === FREE_PROVIDER_ID
  && resolveProviderByService('gemini').id === 'gemini'
  && providerHasModel('qwen', 'qwen3.8-max')
  && !providerHasModel('qwen', 'qwen-max'));
check('免费区不受 Key 约束（免 Key 厂牌没有模型也没有 Key 入口）',
  getProvider(FREE_PROVIDER_ID).models.length === 0 && getProvider(FREE_PROVIDER_ID).keyHint === '');
check('转接器兜底型号不再是已下架的 id',
  !/deepseek-chat|gpt-4o|gemini-1\.5/.test(read('../utils/translator.ts').replace(/\/\*[\s\S]*?\*\//g, '')));
check('文档：厂牌与模型清单有单独一份口径', fs.existsSync(new URL('../docs/PROVIDER-MODELS.md', import.meta.url)));


/* ══════════════════════════════════════════════════════════════════════════
 * 19. 需求四：翻译场景的新建 / 导入 / 文件格式规范
 * ══════════════════════════════════════════════════════════════════════════ */
/* 本轮的 details 多了一个 data-details-motion 属性（高度过渡的包装层），
   所以选择器放宽成「任意附加属性」，仍然要求它是 .spec-block#scene-spec 那一个 */
const specBlock = (scenarioPane.match(/<details class="spec-block" id="scene-spec"[^>]*>[\s\S]*?<\/details>/) || [''])[0];

check('场景栏底部三个入口齐全（新建 / 导入 / 模板）',
  ['btn-new-scene', 'btn-import-scene', 'btn-scene-template'].every((id) => sceneRailFoot.includes(`id="${id}"`)),
  sceneRailFoot.replace(/\s+/g, ' ').slice(0, 90));
check('场景入口顺序：新建 → 导入 → 模板',
  sceneRailFoot.indexOf('btn-new-scene') > -1
  && sceneRailFoot.indexOf('btn-new-scene') < sceneRailFoot.indexOf('btn-import-scene')
  && sceneRailFoot.indexOf('btn-import-scene') < sceneRailFoot.indexOf('btn-scene-template'));
check('场景入口与术语库同一套按钮（.btn.btn-quiet.btn-block，同宽竖排）',
  ['btn-new-scene', 'btn-import-scene', 'btn-scene-template']
    .every((id) => new RegExp(`class="btn btn-quiet btn-block" id="${id}"`).test(sceneRailFoot))
  && /\.pack-rail-foot\s*\{[^}]*flex-direction:\s*column/.test(css));
check('场景导入用隐藏 file input（accept JSON）',
  /id="file-import-scene" accept="\.json,application\/json" class="hidden"/.test(sceneRailFoot));

/* 规范说明：可折叠、默认收起 */
check('规范说明可折叠且默认收起（details 无 open）',
  /<details class="spec-block" id="scene-spec"[^>]*>/.test(scenarioPane) && specBlock.length > 0
  && !/<details[^>]*id="scene-spec"[^>]*\bopen\b/.test(scenarioPane));
check('规范说明含 5 个顶层字段（version / name / description / hint / prompt）',
  ['name', 'prompt', 'description', 'hint', 'version'].every((f) => specBlock.includes(`<td>${f}</td>`)));
check('规范说明写明「不允许未知字段」', /不允许未知字段/.test(specBlock));
check('规范说明给出可直接复制的完整示例', /<pre class="spec-code">\{/.test(specBlock));

/* 与 docs/PACK-UPLOAD-SPEC.md 逐字一致：字段表 / 示例 JSON / 常见错误 */
const specDoc = read('../docs/PACK-UPLOAD-SPEC.md');
const docSection = (from, to) => {
  const start = specDoc.indexOf(from);
  const end = specDoc.indexOf(to, start + from.length);
  return start < 0 ? '' : specDoc.slice(start, end < 0 ? specDoc.length : end);
};
/** 文档表格行 → 单元格数组（去掉 markdown 反引号与加粗，界面里是纯文本） */
const tidyCell = (cell) => cell.replace(/`/g, '').replace(/\*\*/g, '').trim();
const docRows = (text) => [...text.matchAll(/^\|(.+)\|$/gm)]
  .map((m) => m[1].split('|').map(tidyCell))
  .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c) || c === ''));
const rowLine = (cells) => `| ${cells.join(' | ')} |`;

const docFieldRows = docRows(docSection('### 2.1 文件结构', '### 2.2'));
const docErrorRows = docRows(docSection('### 2.4 常见错误', '## 三、生效与缓存'));
/* 表头行只用于和界面的 thead 比对，模板比对要排除 */
const docFieldBody = docFieldRows.slice(1);

/** 界面表格行 → 单元格数组（按 th/td 拆，去掉标签） */
const htmlTables = [...specBlock.matchAll(/<table class="spec-table">([\s\S]*?)<\/table>/g)].map((m) =>
  [...m[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t\1>/g)]
      .map((cell) => cell[2].replace(/<[^>]+>/g, '').trim())));

check('界面规范说明有两张表（字段表 + 常见错误）', htmlTables.length === 2);
check('字段表与文档逐字一致（值、限制、说明一字不差）',
  htmlTables[0].length === docFieldRows.length
  && htmlTables[0].every((cells, i) => JSON.stringify(cells) === JSON.stringify(docFieldRows[i])),
  `${htmlTables[0].length} vs ${docFieldRows.length}`);
check('常见错误表与文档逐字一致',
  htmlTables[1].length === docErrorRows.length
  && htmlTables[1].every((cells, i) => JSON.stringify(cells) === JSON.stringify(docErrorRows[i])),
  `${htmlTables[1].length} vs ${docErrorRows.length}`);

const exampleInHtml = (specBlock.match(/<pre class="spec-code">([\s\S]*?)<\/pre>/) || ['', ''])[1].trim();
const exampleInDoc = (specDoc.match(/### 2\.1 文件结构[\s\S]*?```json\n([\s\S]*?)```/) || ['', ''])[1].trim();
check('示例 JSON 与文档逐字一致', exampleInHtml.length > 0 && exampleInHtml === exampleInDoc);
check('示例 JSON 能被 JSON.parse（且过 validateScenePack）', (() => {
  try {
    const raw = JSON.parse(exampleInHtml);
    const r = validateScenePack(raw);
    return r.ok && r.pack.name === '科普视频';
  } catch {
    return false;
  }
})());

for (const [label, needle] of [
  ['缺 prompt', '缺少字段 prompt（场景提示词）'],
  ['prompt 超短', 'prompt 少于 20 字，无法有效指导翻译'],
  ['prompt 超长', 'prompt 超过 4000 字'],
  ['非对象', '文件内容不是 JSON 对象'],
  ['version 不符', 'version 写成了 2']
]) {
  check(`常见错误覆盖「${label}」`, specBlock.includes(needle));
}

/* 新建场景：弹层 + 校验 + 落库 */
const newSceneBlock = (ts.match(/async function createScenePack\(\): Promise<void> \{[\s\S]*?\n\}/) || [''])[0];
const importSceneBlock = (ts.match(/async function importScenePack\(input: HTMLInputElement\): Promise<void> \{[\s\S]*?\n\}/) || [''])[0];

check('新建场景弹层收 名称 / 描述 / 提示词',
  /id="ns-name" maxlength="40"/.test(html) && /id="ns-desc" maxlength="120"/.test(html)
  && /<textarea class="ctl scene-editor" id="ns-prompt" rows="9"/.test(html));
check('新建弹层 aria-labelledby 与行内错误区齐备',
  /<dialog class="modal modal-wide" id="new-scene-dialog" aria-labelledby="ns-title">/.test(html)
  && /id="ns-error" role="alert"/.test(html));
check('提示词框等宽多行（复用 .scene-editor）', /\.scene-editor\s*\{[^}]*ui-monospace/.test(css));
check('新建时预填一段能过校验的最小提示词（非空框）', (() => {
  const m = ts.match(/const SCENE_PROMPT_SEED = '([^']+)'/);
  return Boolean(m) && m[1].trim().length >= 20
    && /if \(prompt\) prompt\.value = SCENE_PROMPT_SEED/.test(ts);
})(), 'seed 缺失或不足 20 字');
check('新建走 validateScenePack（与导入同一条校验路径）',
  /const result = validateScenePack\(\{ version: 1, name, description, hint: '', prompt \}\)/.test(newSceneBlock));
check('新建校验不过只出错误、不落库（先校验后写）',
  newSceneBlock.indexOf('setNewSceneError(result.errors.join') > -1
  && newSceneBlock.indexOf('setNewSceneError(result.errors.join') < newSceneBlock.indexOf('customPacks.scenes ='));
check('新建只写 saveScenePacks（单份存储，无页面级副本）',
  /customPacks\.scenes = \[\.\.\.customPacks\.scenes, pack\][\s\S]{0,120}?saveScenePacks\(customPacks\.scenes\)/.test(newSceneBlock)
  && !/localStorage/.test(newSceneBlock));
check('新建后自动选中新场景，但不擅自切换正在使用的场景',
  /viewingSceneId = pack\.id;/.test(newSceneBlock) && !/update\(\{ scenario/.test(newSceneBlock));
check('新建重名被拦（行内错误，不静默改名）', /已经有同名的场景/.test(ts));
check('新建场景 id 唯一（撞号加后缀）',
  /id: uniqueSceneId\(result\.pack\.id\)/.test(newSceneBlock) && /function uniqueSceneId/.test(ts));
check('种子提示词本身能过 validateScenePack（不会一创建就报错）', (() => {
  const m = ts.match(/const SCENE_PROMPT_SEED = '([^']+)'/);
  return Boolean(m) && validateScenePack({ version: 1, name: '种子', prompt: m[1] }).ok;
})());
check('共用的校验口径挡得住缺 prompt / 超短 / 超长 / 未知字段', (() => {
  const long = 'a'.repeat(4001);
  return !validateScenePack({ version: 1, name: 'X' }).ok
    && !validateScenePack({ version: 1, name: 'X', prompt: '太短了' }).ok
    && !validateScenePack({ version: 1, name: 'X', prompt: long }).ok
    && !validateScenePack({ version: 1, name: 'X', prompt: 'a'.repeat(30), promt: 'x' }).ok
    && validateScenePack({ version: 1, name: 'X', prompt: 'a'.repeat(30) }).ok;
})());

/* 导入：复用同一条校验，失败不入库、逐条列原因 */
check('导入复用 validateScenePack', /const result = validateScenePack\(raw\)/.test(importSceneBlock));
check('导入失败逐条列出原因（字段级）',
  /showSceneImportReport\('导入失败：校验未通过（未写入任何内容）', result\.errors\)/.test(importSceneBlock)
  && /import-report-list/.test(ts) && /id="scene-import-report" role="alert"/.test(scenarioPane));
check('文件不是合法 JSON 时给可读原因（同样不入库）',
  /JSON\.parse 报错/.test(importSceneBlock));
check('不合法文件绝不半入库（失败分支在写库之前 return）',
  importSceneBlock.indexOf('if (!result.ok || !result.pack)') > -1
  && importSceneBlock.indexOf('return;', importSceneBlock.indexOf('if (!result.ok || !result.pack)'))
    < importSceneBlock.indexOf('customPacks.scenes ='));
check('导入成功才入库并选中', /customPacks\.scenes = \[\.\.\.customPacks\.scenes\.filter/.test(importSceneBlock)
  && /viewingSceneId = pack\.id;/.test(importSceneBlock));
check('导入与内置场景同名时加「（自定义）」后缀（不覆盖）',
  /\$\{pack\.name\}（自定义）/.test(importSceneBlock));

/* ══════════════════════════════════════════════════════════════════════════
 * 20. 需求五：两个分区各一个「用 AI 生成模板」入口 + 两份不同的模板
 * ══════════════════════════════════════════════════════════════════════════ */
const tplSrcOf = (name) => {
  const start = ts.indexOf(`export function ${name}()`);
  if (start < 0) return '';
  const next = ts.indexOf('export function', start + 10);
  return ts.slice(start, next < 0 ? ts.length : next);
};
const glossTpl = tplSrcOf('glossaryTemplatePrompt');
const sceneTpl = tplSrcOf('sceneTemplatePrompt');
const headerSrc = (ts.match(/const TEMPLATE_HEADER = \[[\s\S]*?\]\.join\('\\n'\);/) || [''])[0];

check('模板正文不写死在 HTML 里（只在 main.ts 的常量函数里）',
  !html.includes('不要解释') && !html.includes('不要 markdown 代码块围栏')
  && !/\| ja \| ✅ \| 1~60 字 \|/.test(html)
  && glossTpl.length > 0 && sceneTpl.length > 0);
check('模板首行是留空的「# 需求：」',
  /const TEMPLATE_HEADER = \[\s*'# 需求：'/.test(headerSrc)
  && /return \[\s*TEMPLATE_HEADER/.test(glossTpl) && /return \[\s*TEMPLATE_HEADER/.test(sceneTpl));
check('模板要求「只输出 JSON、不要解释、不要 markdown 代码块」',
  /只输出 JSON/.test(headerSrc) && /不要解释/.test(headerSrc) && /不要 markdown 代码块围栏/.test(headerSrc));
check('模板要求输出必须能被 JSON.parse 直接解析', /输出必须能被 JSON\.parse 直接解析/.test(headerSrc));

const docGlossaryRows = [
  ...docRows(docSection('### 1.1 文件结构', '### 1.2')),
  ...docRows(docSection('### 1.2 条目字段', '### 1.3'))
].filter((cells) => cells[0] !== '字段' && cells[0] !== '现象');
const missingGlossRows = docGlossaryRows.filter((cells) => !glossTpl.includes(rowLine(cells)));
check('术语库模板的字段表与文档一致（4 个顶层 + 6 个条目字段）',
  docGlossaryRows.length === 10 && missingGlossRows.length === 0,
  `${docGlossaryRows.length} 行 / 缺 ${missingGlossRows.map(rowLine).join(' / ').slice(0, 120)}`);
const missingSceneRows = docFieldBody.filter((cells) => !sceneTpl.includes(rowLine(cells)));
check('翻译场景模板的字段表与文档一致', docFieldBody.length === 5 && missingSceneRows.length === 0,
  missingSceneRows.map(rowLine).join(' / ').slice(0, 120));

check('两份模板确实是两份（术语库 entries / 场景 hint + prompt 不得互串）',
  /entries/.test(glossTpl) && !/entries/.test(sceneTpl)
  && /hint/.test(sceneTpl) && !/\bhint\b/.test(glossTpl)
  && /ja \| ✅/.test(glossTpl) && !/ja \| ✅/.test(sceneTpl));
check('两份模板都带一个最小可用的输出示例',
  /"entries":\[\{/.test(glossTpl) && /"prompt":"你是一位/.test(sceneTpl));
check('两份模板的示例 JSON 都能被 JSON.parse', (() => {
  const pull = (src) => {
    const m = src.match(/^\s*'(\{"version":1,.*\})',$/m);
    if (!m) return null;
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  };
  const gloss = pull(glossTpl);
  const scene = pull(sceneTpl);
  if (!gloss || !scene) return false;
  return Array.isArray(gloss.entries) && gloss.entries.length > 0
    && validateScenePack(scene).ok && validateGlossaryPack(gloss).ok;
})());

check('两个分区各挂一个模板入口（术语库在「导入 JSON」下方，场景在同一位置）',
  glossRailFoot.indexOf('id="btn-glossary-template"') > glossRailFoot.indexOf('id="btn-import-pack"')
  && sceneRailFoot.indexOf('id="btn-scene-template"') > sceneRailFoot.indexOf('id="btn-import-scene"')
  && /#btn-glossary-template'\)\?\.addEventListener\('click', \(\) => openTemplateDialog\('glossary'\)\)/.test(ts)
  && /#btn-scene-template'\)\?\.addEventListener\('click', \(\) => openTemplateDialog\('scene'\)\)/.test(ts));
check('模板入口文案能看出用途', /用 AI 生成模板/.test(glossRailFoot) && /用 AI 生成模板/.test(sceneRailFoot));

check('复制走 navigator.clipboard.writeText',
  /const clip = navigator\.clipboard;/.test(ts) && /clip\.writeText\(text\)/.test(ts));
check('复制失败降级：选中 textarea 全部内容并提示手动复制',
  /body\.select\(\);/.test(ts) && /按 Ctrl\+C 手动复制/.test(ts));
check('模板弹层 aria-labelledby 齐备、正文可聚焦（打开即进入正文）',
  /<dialog class="modal modal-wide" id="template-dialog" aria-labelledby="tpl-title">/.test(html)
  && /id="tpl-body"/.test(html) && /body\.focus\(\);/.test(ts));
check('模板弹层是原生 dialog（Esc 可关、焦点内置）',
  /dialog\.showModal\(\)/.test(ts) && /#tpl-close'\)\?\.addEventListener/.test(ts));
check('模板正文等宽可滚动', /\.tpl-body\s*\{[^}]*ui-monospace/.test(css) && /\.tpl-body\s*\{[^}]*overflow:\s*auto/.test(css));

/* ══════════════════════════════════════════════════════════════════════════
 * 21. 隐私修复：Key 只落 local（静态侧；运行时行为在 test-settings.js）
 * ══════════════════════════════════════════════════════════════════════════ */
check('敏感字段用独立的 local 键（不进 sync）',
  /const SECRETS_KEY = 'yt_sub_translator_secrets'/.test(storageTs)
  && /SECRET_FIELDS = \['apiKey', 'providerKeys', 'serviceKeys'\]/.test(storageTs));
check('保存时先从 sync 那份里删掉敏感字段',
  /for \(const field of SECRET_FIELDS\) delete plain\[field\]/.test(storageTs)
  && /writeAreaKey\('sync', STORAGE_KEY, plain\)/.test(storageTs));
check('读取时合并 local 密钥（密钥覆盖 sync）',
  /sanitizeSettings\(\{ \.\.\.base, \.\.\.\(localSecrets \|\| \{\}\) \}\)/.test(storageTs));
check('老数据迁移：搬走 + 抹掉 sync 里的密钥（幂等，失败不影响读取）',
  /hasSecretFields/.test(storageTs) && /async function stripSecrets/.test(storageTs)
  && /const baseArea: 'sync' \| 'local' = syncValue \? 'sync' : 'local';/.test(storageTs));
check('迁移后重写失败只记日志，不抛错',
  /if \(!ok\) console\.warn\(`\[Storage\] 迁移后重写/.test(storageTs));
check('先写 local 再写 sync（避免回读时读到旧 Key）',
  storageTs.indexOf("await writeSecrets({") < storageTs.indexOf("writeAreaKey('sync', STORAGE_KEY, plain)"));


/* ══════════════════════════════════════════════════════════════════════════
 * 22. 任务四 · 需求一：详细设置页可读性（字号 / 行高 / 间距 / 对比度）
 * ══════════════════════════════════════════════════════════════════════════ */
/** 去掉注释后的样式源码：解析过渡属性时不能把注释里的示例文字当成真声明 */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
/** 取某个选择器的规则体（`sel { ... }`），找不到返回 '' */
const ruleOf = (selector, source = cssCode) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hit = source.search(new RegExp(`${escaped}\\s*\\{`));
  if (hit < 0) return '';
  const open = source.indexOf('{', hit);
  return source.slice(open + 1, source.indexOf('}', open));
};
/* 取字号：本轮起基准与几个关键尺寸改成了 clamp() 流体写法（任务四 · 需求八），
   先按 var(--令牌) 解析到 :root 里的取值，再取 clamp 的**下限**作为比较值 ——
   下限才是「窄窗口下的可读性地板」，也正是上一轮那批断言真正想守的东西。
   固定 px 的写法仍原样取 px。 */
const fontPx = (body) => {
  const decl = body.match(/font-size:\s*([^;]+);/);
  if (!decl) return NaN;
  let value = decl[1].trim();
  const alias = value.match(/^var\((--[a-z0-9-]+)\)$/);
  if (alias) value = optionsTokens.get(alias[1]) || '';
  const px = value.match(/^([\d.]+)px/);
  if (px) return Number(px[1]);
  const clamped = value.match(/^clamp\(\s*([\d.]+)px/);
  return clamped ? Number(clamped[1]) : NaN;
};
const fontOf = (selector) => fontPx(ruleOf(selector));
const lineHeightOf = (selector) => {
  const m = ruleOf(selector).match(/line-height:\s*([\d.]+)/);
  return m ? Number(m[1]) : NaN;
};

/* body 单独取：上面还有一条 `html, body { min-height }` 的合写，会先撞上；
   取第一条真正带 font-size 的 body 规则 */
const bodyBlock = ([...cssCode.matchAll(/\nbody\s*\{[^}]*\}/g)]
  .map((m) => m[0])
  .find((block) => /font-size:/.test(block))) || '';
const bodyFont = fontPx(bodyBlock);
check('基准字号 13 → 14px', bodyFont === 14, String(bodyFont));
check('行标题 13.5~14px', fontOf('.row-title') >= 13.5 && fontOf('.row-title') <= 14, String(fontOf('.row-title')));
check('说明文字 12.5px（且不低于 12）', fontOf('.row-desc') === 12.5, String(fontOf('.row-desc')));
check('辅注（.row-note）不再低于 12px', fontOf('.row-note') >= 12, String(fontOf('.row-note')));
for (const sel of ['.pane-head p', '.scene-intro', '.layer-detail', '.provider-keyhint', '.editor-count', '.pack-item-meta']) {
  check(`说明类文字 ${sel} ≥ 12px`, fontOf(sel) >= 12, String(fontOf(sel)));
}
check('说明文字行高 1.6~1.65', lineHeightOf('.row-desc') >= 1.6 && lineHeightOf('.row-desc') <= 1.65, String(lineHeightOf('.row-desc')));
check('辅注行高 1.6~1.65', lineHeightOf('.row-note') >= 1.6 && lineHeightOf('.row-note') <= 1.65, String(lineHeightOf('.row-note')));

/* 行距：靠 padding 撑开，不再叠 margin */
const rowPadding = Number((ruleOf('.row').match(/padding:\s*([\d.]+)px/) || [0, 0])[1]);
check('行距每侧 +2~4px（14 → 16~18，用 padding）',
  rowPadding >= 16 && rowPadding <= 18, String(rowPadding));
check('行距不靠 margin 叠加', !/\.row\s*\{[^}]*margin:/.test(css));

check('分区标题层级仍高于正文（h1 > 行标题）',
  fontOf('.pane-head h1') > fontOf('.row-title') + 5, `${fontOf('.pane-head h1')} > ${fontOf('.row-title')}`);

/* 等宽内容：模型 id / 代码块 / JSON / 提示词正文 */
for (const sel of ['.model-id', '.spec-code', '.layer-body', '.tpl-body', '.scene-editor', '.mono']) {
  check(`等宽内容 ${sel} ≥ 12px`, fontOf(sel) >= 12, String(fontOf(sel)));
}
check('等宽 model id 行高 ≥ 1.5', lineHeightOf('.model-id') >= 1.5, String(lineHeightOf('.model-id')));

/* 术语库表格 */
check('表头字号 ≥ 12.5px', fontOf('.gloss-table thead th') >= 12.5, String(fontOf('.gloss-table thead th')));
check('单元格字号 ≥ 12.5px', fontOf('.gloss-table td') >= 12.5, String(fontOf('.gloss-table td')));
/* 行高下限：td 上下内边距 + 最高单元格的内容高度。
   图表里的「操作」列是按钮（padding + 1px 边框），它通常比纯文字行更高，
   所以取两者的较大值，避免只算文字行得出偏低的结论。 */
const cellPadY = Number((ruleOf('.gloss-table td').match(/padding:\s*([\d.]+)px/) || [0, 0])[1]);
const cellLh = lineHeightOf('.gloss-table td') || 1.5;
const textRow = cellPadY * 2 + fontOf('.gloss-table td') * cellLh;
const opPadY = Number((ruleOf('.op-btn').match(/padding:\s*([\d.]+)px/) || [0, 0])[1]);
const opButtonRow = cellPadY * 2 + fontOf('.op-btn') * 1.55 + opPadY * 2 + 2;
check('表格行高 ≥ 34px（td 内边距 + 最高单元格内容）',
  Math.max(textRow, opButtonRow) >= 34, `${Math.max(textRow, opButtonRow).toFixed(1)}px`);

/* 对比度：用 CSS 里的固定色值按 WCAG 公式算，不依赖浏览器 */
const relLum = (hex) => {
  const n = hex.replace('#', '').trim();
  const chan = (i) => parseInt(n.slice(i, i + 2), 16);
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(chan(0)) + 0.7152 * lin(chan(2)) + 0.0722 * lin(chan(4));
};
const contrastOf = (a, b) => {
  const l1 = relLum(a);
  const l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const bgHex = optionsTokens.get('--bg-primary');
const tierNames = ['--text-main', '--text-body', '--text-muted', '--text-dim'];
const tierRatios = tierNames.map((name) => [name, contrastOf(optionsTokens.get(name), bgHex)]);
for (const [name, value] of tierRatios) {
  check(`${name} 对 ${bgHex} 达到 AA（≥4.5:1）`, value >= 4.5, value.toFixed(2));
}
check('文字仍是四级层次（逐级递减，没有拉平成同一个亮度）',
  tierRatios.every(([, v], i) => i === 0 || v < tierRatios[i - 1][1]),
  tierRatios.map(([n, v]) => `${n}=${v.toFixed(2)}`).join(' '));
check('弱化层仍明显暗于次要层（差值 ≥ 1.5:1）',
  tierRatios[2][1] - tierRatios[3][1] >= 1.5,
  (tierRatios[2][1] - tierRatios[3][1]).toFixed(2));

/* 不靠 overflow: hidden 掩盖换行 */
for (const sel of ['.row', '.row-text', '.row-control', '.input-with-btn', '.editor-bar']) {
  check(`${sel} 没有用 overflow: hidden 掩盖换行`, !/overflow(-\w+)?:\s*hidden/.test(ruleOf(sel)), ruleOf(sel).slice(0, 60));
}
check('行控制区允许换行且可收缩（min-width: 0）',
  /flex-wrap:\s*wrap/.test(ruleOf('.row-control')) && /min-width:\s*0/.test(ruleOf('.row-control')));

/* ══════════════════════════════════════════════════════════════════════════
 * 23. 任务四 · 需求六：补齐缺失的过渡 / 动效
 * ══════════════════════════════════════════════════════════════════════════ */

/* 1) 分段控件滑块：transform + 弹簧 + 时长令牌 */
check('分段滑块走 transform + --spring-soft + --dur-base',
  /transform:\s*translateX\(calc\(var\(--seg-index, 0\) \* 100%\)\)/.test(ruleOf('.seg-glider'))
  && /transition:\s*transform var\(--dur-base\) var\(--spring-soft\)/.test(ruleOf('.seg-glider')));
check('每处分段控件都有滑块（HTML 里 .seg 与 .seg-glider 一一对应）',
  (html.match(/class="seg seg-/g) || []).length === (html.match(/class="seg-glider"/g) || []).length
  && (html.match(/class="seg seg-/g) || []).length >= 5);

/* 2) 厂牌展开 / 收起：grid-template-rows 过渡 + 收起不可聚焦 */
check('厂牌面板用 0fr → 1fr 过渡（不是 display 硬切）',
  /grid-template-rows:\s*0fr/.test(ruleOf('.provider-panel'))
  && /transition:[^;]*grid-template-rows var\(--dur-base\) var\(--spring-soft\)/.test(ruleOf('.provider-panel')));
check('展开态把网格行推到 1fr',
  /\.provider-group\.is-open > \.provider-panel\s*\{[^}]*grid-template-rows:\s*1fr/.test(css));
check('内层负责 overflow: hidden 与 min-height: 0（高度才收得回去）',
  /overflow:\s*hidden/.test(ruleOf('.provider-panel-inner')) && /min-height:\s*0/.test(ruleOf('.provider-panel-inner')));
check('收起态用 inert（不可聚焦、不进 tab 序列），不只靠视觉隐藏',
  /panel\.inert = !open/.test(ts) && (ts.match(/\.inert = !open/g) || []).length >= 2);
check('展开 / 收起就地切换，不重绘整块列表（重绘会让过渡永远从终态开始）',
  /function syncProviderGroupState/.test(ts)
  && /syncProviderGroupState\(expandedProviderId\)/.test(ts)
  && !/expandedProviderId = expandedProviderId === providerId \? '' : providerId;[\s\S]{0,120}?renderProviderList\(\)/.test(ts));
check('展开箭头随状态旋转（已有）',
  /\.provider-group\.is-open \.provider-chevron\s*\{[^}]*transform:\s*rotate\(90deg\)/.test(css));

/* 3) 原生 details：标记旋转 + 内容高度渐变（问题 5 统一口径） */
check('summary 关掉原生标记（::marker 无法旋转）',
  /\.provider-advanced > summary,\s*\.spec-block > summary\s*\{[^}]*list-style:\s*none/.test(cssCode)
  && /::-webkit-details-marker\s*\{\s*display:\s*none/.test(cssCode));
check('自绘标记带 transform 过渡（时长与内容同为 --dur-base）',
  /summary::before\s*\{[^}]*transform:\s*rotate\(0deg\)[^}]*transition:\s*transform var\(--dur-base\) var\(--ease-out-expo\)/.test(cssCode));
check('展开时标记转 90°',
  /\.provider-advanced\[open\] > summary::before,\s*\.spec-block\[open\] > summary::before\s*\{[^}]*transform:\s*rotate\(90deg\)/.test(cssCode));
check('details 内容包一层 .details-body，走 0fr → 1fr + opacity（不再只有淡入）',
  /\.details-body\s*\{\s*display:\s*grid;\s*grid-template-rows:\s*1fr;[\s\S]{0,200}?transition:\s*grid-template-rows var\(--dur-base\) var\(--spring-soft\),\s*opacity var\(--dur-base\)/.test(cssCode)
  && /\.is-motion > \.details-body\s*\{\s*grid-template-rows:\s*0fr/.test(cssCode)
  && /\.is-motion > \.details-body\.is-open\s*\{\s*grid-template-rows:\s*1fr/.test(cssCode));
check('details 的 is-open 由 toggle 事件驱动（原生 details 自己做不到高度过渡）',
  /function attachDetailsMotion/.test(ts) && /addEventListener\('toggle'/.test(ts)
  && /classList\.add\('is-open'\)/.test(ts) && /classList\.remove\('is-open'\)/.test(ts));
check('静态 details 也挂了高度过渡（HTML 的 data-details-motion + 按该属性绑定，不按 class 猜）',
  /data-details-motion="true"/.test(specBlock) && /details\[data-details-motion\]/.test(ts)
  && /advanced\.dataset\.detailsMotion = 'true'/.test(ts));
check('旧的 detailsReveal 淡入动画已删除（统一走 transition）',
  !/detailsReveal/.test(cssCode) && !/summary ~ \*/.test(cssCode));

/* 4) 弹层：入场 + 遮罩淡入 + 关闭反向 */
check('弹层入场仍是 scale + opacity', /@keyframes modalEnter[\s\S]{0,160}?scale\(0\.985\)/.test(css));
check('遮罩淡入', /\.modal::backdrop\s*\{[^}]*animation:\s*backdropEnter var\(--dur-base\)/.test(css));
check('关闭走反向动画（.is-closing + --dur-fast）',
  /\.modal\.is-closing\s*\{[^}]*animation:\s*modalExit var\(--dur-fast\)/.test(css)
  && /@keyframes modalExit/.test(css));
check('JS 关闭统一走 closeDialogAnimated（四个弹层）',
  /function closeDialogAnimated/.test(ts)
  && (ts.match(/closeDialogAnimated\(/g) || []).length >= 5
  && !/\$\('#(?:new-pack|new-scene|template)-dialog'\)[^\n]*\?\.close\(\)/.test(ts));
check('关闭动画时长从 --dur-* 令牌读，不在 JS 里硬编码',
  /tokenDurationMs\('--dur-fast'/.test(ts) && !/setTimeout\([^,]+,\s*1[0-9]{2}\)/.test(ts));
check('Esc 关闭也走同一套反向动画', /addEventListener\('cancel'/.test(ts) && /bindDialogMotion/.test(ts));

/* 5) 术语库 / 场景列表的选中切换 */
check('选中项有左侧标线（scaleY 生长）',
  /\.pack-item::before\s*\{[\s\S]{0,240}?transform:\s*scaleY\(0\.3\)/.test(css)
  && /\.pack-item\.active::before\s*\{[^}]*transform:\s*scaleY\(1\)/.test(css));
check('选中高亮本身有过渡（背景 + 边框 + 颜色）',
  /transition:\s*background-color var\(--dur-fast\)[^;]*border-color/.test(ruleOf('.pack-item')));
check('点列表就地换选中态，不重建列表（否则过渡播不出来）',
  /function syncPackSelection/.test(ts) && /function syncSceneSelection/.test(ts)
  && !/activePackId = pack\.id;[\s\S]{0,120}?renderPackList\(\)/.test(ts)
  && !/viewingSceneId = scene\.id;[\s\S]{0,160}?renderScenePane\(\)/.test(ts));

/* 6) 复制反馈：按钮状态过渡，不弹窗 */
check('复制成功给按钮一次状态反馈（.is-copied，1.2s 后还原）',
  /function flashCopied/.test(ts) && /classList\.add\('is-copied'\)/.test(ts)
  && /classList\.remove\('is-copied'\)/.test(ts) && /\.btn\.is-copied/.test(css));
check('复制按钮宽度锁定（文案变长不推走旁边的按钮）', /#tpl-copy\s*\{[^}]*min-width:\s*88px/.test(css));

/* 7) .preview-sub：bottom 过渡是死代码，已删（不改动 top） */
check('.preview-sub 不再过渡 bottom（该过渡永不触发）',
  !/transition:[^;]*\bbottom\b/.test(ruleOf('.preview-sub')) && /background-color var\(--dur-fast\)/.test(ruleOf('.preview-sub')));

/* 8) 全局自查：过渡属性只说允许的那几个 */
const ALLOWED_TRANSITION_PROPS = new Set([
  'none', 'transform', 'opacity', 'grid-template-rows', 'max-height',
  'background-color', 'border-color', 'color',
  /* 既有（本轮未新增）：控件阴影、预览字号 */
  'box-shadow', 'font-size'
]);
const transitionDecls = [...cssCode.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1].trim());
const transitionProps = transitionDecls
  .flatMap((value) => value.split(','))
  .map((part) => part.trim().split(/\s+/)[0])
  .filter((p) => /^[a-z-]+$/.test(p));
const illegal = [...new Set(transitionProps.filter((p) => !ALLOWED_TRANSITION_PROPS.has(p)))];
check('过渡只作用于允许的属性', illegal.length === 0, illegal.join(','));
check('过渡里不出现几何属性（宽高 / 定位 / 内外边距）',
  !transitionProps.some((p) => /^(width|height|top|left|right|bottom|margin|padding|inset)/.test(p)),
  transitionProps.join(','));
check('仍未出现 transition: all', !/transition:\s*all\b/.test(cssCode));

/* 9) prefers-reduced-motion：新增动画一个都不能留 */
const reducedBlock = cssCode.slice(cssCode.indexOf('@media (prefers-reduced-motion: reduce)'));
for (const sel of ['.provider-panel', '.fold-panel', '.details-body', '.seg-glider', '.pack-item::before', '.btn.is-copied',
  '.provider-advanced > summary::before', '.spec-block > summary::before', '.modal.is-closing', '.modal::backdrop']) {
  check(`reduced-motion 关掉 ${sel} 的过渡/动画`,
    reducedBlock.includes(sel), sel);
}
check('reduced-motion 下面板 / details 仍以终态呈现（不留 0fr 卡住）',
  /\.provider-panel\s*\{\s*opacity:\s*1 !important/.test(reducedBlock)
  && /\.provider-group:not\(\.is-open\) > \.provider-panel\s*\{\s*opacity:\s*0 !important/.test(reducedBlock)
  && /\.details-body\s*\{\s*opacity:\s*1 !important/.test(reducedBlock)
  && /\.is-motion > \.details-body:not\(\.is-open\)\s*\{\s*opacity:\s*0 !important/.test(reducedBlock));

/* ══════════════════════════════════════════════════════════════════════════
 * 20. 需求五：「常规」的「翻译服务」改成可折叠厂牌选择器（数据源 PROVIDERS）
 * ══════════════════════════════════════════════════════════════════════════ */
const generalPane = paneOf('general');

check('常规页不再保留硬编码四服务分段（data-seg="service" 已移除）',
  !/data-seg="service"/.test(html) && !/data-setting="service"/.test(html));
check('常规页四个服务名只剩折叠块里的数据驱动渲染（没有 data-value 硬编码）',
  !/data-value="(google|deepseek|openai|gemini)"/.test(generalPane),
  (generalPane.match(/data-value="[a-z]+"/g) || []).join(','));
check('其余分段控件一处未少（8 处 data-seg）',
  (html.match(/data-seg="/g) || []).length === 8, String((html.match(/data-seg="/g) || []).length));
check('seg-4 只剩 aiCacheTtlHours 一处（不是把分段控件一起删了）',
  (html.match(/class="seg seg-4"/g) || []).length === 1);

check('翻译服务改由折叠块承载（toggle + 面板 + 列表）',
  generalPane.includes('id="provider-fold"') && generalPane.includes('id="btn-provider-fold"')
  && generalPane.includes('id="provider-fold-panel"') && generalPane.includes('id="provider-fold-list"'));
check('收起态摘要四件套：厂牌图标 / 厂牌名 / 当前模型 id / 箭头',
  ['fold-provider-icon', 'fold-provider-name', 'fold-provider-model', 'fold-chevron'].every((id) => generalPane.includes(id)));
check('折叠按钮带 aria-expanded / aria-controls，面板默认 hidden（收起不可聚焦）',
  /id="btn-provider-fold"\s*\n?\s*aria-expanded="false" aria-controls="provider-fold-panel"/.test(generalPane)
  && /id="provider-fold-panel" hidden/.test(generalPane));
check('收起态由 PROVIDERS 决定（免费通道 vs 当前厂牌，不写死名字）',
  /function syncProviderFoldSummary/.test(ts)
  && /const provider = freeInUse\(\) \? freeProvider\(\) : \(getProvider\(settings\.providerId\) \|\| freeProvider\(\)\)/.test(ts));
check('摘要图标走 providerIconHtml（与「服务与模型」同一份厂牌图标）',
  /function syncProviderFoldSummary[\s\S]{0,500}?providerIconHtml\(provider\.iconKey, provider\.name\)/.test(ts));
check('当前模型 id 用等宽字形（.fold-mono → ui-monospace）',
  /\.fold-sub\.fold-mono\s*\{[^}]*ui-monospace/.test(css));

check('展开列表是 PROVIDERS 全量（免费在最上 + 其余按声明顺序，共 8 个）',
  /const ordered = \[free, \.\.\.PROVIDERS\.filter\(\(p\) => p\.id !== free\.id\)\]/.test(ts)
  && PROVIDERS.length === 8);
check('每行复用 .provider-row（等高、同一套 hover 与左侧标线）',
  /btn\.className = 'provider-row'/.test(ts));
check('每行带厂牌图标 + Key 小标 + 模型数',
  /function renderProviderFold[\s\S]{0,1600}?providerIconHtml\(provider\.iconKey, provider\.name\)/.test(ts)
  && /keyState\.textContent = providerKeyOf\(provider\) \? '已配置 Key' : '未配置 Key'/.test(ts)
  && /count\.textContent = isFree \? '· 不需要模型' : `· \$\{rows\.length\} 个模型`/.test(ts));
check('免费通道不要求 Key（写明免 Key / 不需要模型）',
  /keyState\.textContent = '免 Key'/.test(ts) && /· 不需要模型/.test(ts));
check('当前项标「使用中」并暴露给读屏（aria-pressed / aria-current）',
  /flag\.textContent = '使用中'/.test(ts) && /btn\.setAttribute\('aria-pressed', String\(inUse\)\)/.test(ts)
  && /if \(inUse\) btn\.setAttribute\('aria-current', 'true'\)/.test(ts));
check('折叠块里的「使用中」也有左侧标线（没有 .provider-group 可挂）',
  /\.fold-list \.provider-row\[aria-pressed="true"\]::before\s*\{[^}]*scaleY\(1\)/.test(css));

check('点一行写回 providerId / service / modelName / apiKey / apiBaseUrl（一份实现）',
  /function providerSwitchPatch\(providerId: string\)/.test(ts)
  && /providerId: provider\.id,/.test(ts) && /service: provider\.service,/.test(ts)
  && /apiKey: providerKeyOf\(provider\),/.test(ts) && /apiBaseUrl: providerBase\(provider\),/.test(ts)
  && /modelName: nextModel,/.test(ts) && /providerModelSelections: selections/.test(ts));
check('modelName 走 nextModelFor：记忆 → 本就属于它 → 厂牌默认模型',
  /const nextModel = nextModelFor\(provider\)/.test(ts)
  && /function nextModelFor\(provider: Provider\)/.test(ts)
  && /providerHasModel\(provider\.id, current\)/.test(ts));
check('切走前留底旧厂牌、切到新厂牌后记下本次结果',
  /selections\[previousId\] = previousModel/.test(ts) && /selections\[provider\.id\] = nextModel/.test(ts));
check('「服务与模型」的粗粒度切换也调同一份补丁（没有第二份切换逻辑）',
  /function serviceSwitchPatch[\s\S]{0,300}?return providerSwitchPatch\(resolveProviderByService\(target\)\.id\)/.test(ts));
check('未配置 Key 的厂牌也允许点：先完成切换，再提示去「服务与模型」填',
  /await update\(providerSwitchPatch\(provider\.id\)\)[\s\S]{0,600}?还没保存 Key，去「服务与模型」填写/.test(ts));
check('Google 免费通道切换不带 Key / 模型的提示',
  /if \(provider\.service === 'google'\)[\s\S]{0,120}?已切换到 Google 免费翻译/.test(ts));

check('展开区底部有细字链接指向「服务与模型」',
  /id="btn-provider-fold-more">更多模型与自定义模型 → 服务与模型</.test(generalPane));
check('点该链接切到服务分区（复用 activatePane）',
  /#btn-provider-fold-more'\)\?\.addEventListener[\s\S]{0,240}?activatePane\('service', false\)/.test(ts));
check('点厂牌即收起（选完不必再点一次标题）',
  /providerFoldOpen = false;\s*\n\s*syncProviderFoldState\(\);/.test(ts));

/* 折叠语义与「服务与模型」一致 */
check('折叠状态只写 aria-expanded + hidden + inert（与厂牌面板同一套）',
  /toggle\.setAttribute\('aria-expanded', String\(open\)\)/.test(ts)
  && /panel\.hidden = false;/.test(ts) && /panel\.inert = !open;/.test(ts));
check('展开面板走 grid-template-rows 0fr → 1fr（不碰 height）',
  /\.fold-panel\s*\{\s*display:\s*grid;\s*grid-template-rows:\s*0fr;/.test(css)
  && /\.fold\.is-open > \.fold-panel\s*\{\s*grid-template-rows:\s*1fr/.test(css)
  && /\.fold-panel\s*\{\s*display:\s*grid;[\s\S]{0,200}?transition:\s*grid-template-rows var\(--dur-base\) var\(--spring-soft\)/.test(css));
check('箭头只转 transform（0° → 90°）',
  /\.fold-chevron\s*\{[^}]*transform:\s*rotate\(0deg\)[^}]*transition:\s*transform var\(--dur-base\) var\(--ease-out-expo\)/.test(cssCode)
  && /\.fold\.is-open \.fold-chevron\s*\{[^}]*transform:\s*rotate\(90deg\)/.test(cssCode));
check('收起面板被 hidden 显式 display:none（否则 grid 会一直展开）',
  /\.fold-panel\[hidden\]\s*\{\s*display:\s*none/.test(cssCode));
check('折叠块收起态整行可点（min-height 44px，点的是同一行摘要）',
  /\.fold-toggle\s*\{[^}]*min-height:\s*44px/.test(cssCode));
check('Key 状态变化会顺带刷新收起态摘要',
  /for \(const item of PROVIDERS\)[\s\S]{0,900}?syncProviderFoldSummary\(\)/.test(ts));
check('厂牌列表重绘时折叠块一起刷新（两处永远同一份数据）',
  /function renderProviderList[\s\S]{0,700}?renderProviderFold\(\)/.test(ts));
check('折叠状态不落盘（局部变量，不进设置对象）',
  /let providerFoldOpen = false;/.test(ts) && !/providerFoldOpen[\s\S]{0,60}saveStoredSettings/.test(ts)
  && !/yt_sub_[a-z_]*fold/i.test(ts));

/* ══════════════════════════════════════════════════════════════════════════
 * 21. 需求六：「翻译场景」折叠（卡片网格原样搬进面板）
 * ══════════════════════════════════════════════════════════════════════════ */
check('场景折叠块存在，且 .scenario-grid 在它的面板里',
  generalPane.includes('id="scenario-fold"')
  && /id="scenario-fold-panel"[\s\S]{0,400}?id="scenario-grid"/.test(generalPane));
check('场景折叠默认收起（aria-expanded=false + panel hidden，HTML 初值即终值）',
  /id="btn-scenario-fold"\s*\n?\s*aria-expanded="false" aria-controls="scenario-fold-panel"/.test(generalPane)
  && /id="scenario-fold-panel" hidden/.test(generalPane)
  && /let scenarioFoldOpen = false;/.test(ts));
check('场景卡片网格与卡片样式一个像素未改',
  /\.scenario-grid\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(168px,\s*1fr\)\);\s*gap:\s*8px/.test(cssCode)
  && /\.scenario-card\s*\{[^}]*padding:\s*10px 12px/.test(cssCode));
check('渲染仍然只走 renderScenarios（没有为折叠另写一套卡片）',
  (ts.match(/className = 'scenario-card'/g) || []).length === 1);
check('收起态摘要 = 当前场景名 + 一句说明 + 场景总数',
  /function syncScenarioFoldSummary[\s\S]{0,700}?name\.textContent = current \? current\.name/.test(ts)
  && /hint\.textContent = sceneHintOf\(current\)/.test(ts)
  && /count\.textContent = `\$\{all\.length\} 个`/.test(ts));
check('说明文字取 description 或 hint（与卡片上那句同源）',
  /return scene\.hint \|\| scene\.description \|\| ''/.test(ts));
check('摘要随场景切换刷新（update 里改 scenario 会重画）',
  /if \(patch\.scenario\)[\s\S]{0,120}?renderScenarios\(\)/.test(ts) && /syncScenarioFoldSummary\(scenes\)/.test(ts));
check('场景折叠状态不持久化（纯视觉收纳，不新增设置项）',
  !/scenarioFoldOpen[\s\S]{0,60}(saveStoredSettings|chrome\.storage)/.test(ts)
  && !/yt_sub_[a-z_]*fold/i.test(ts));
check('场景变多也不占满首屏（收起只留一行）',
  /\.fold-toggle\s*\{[^}]*min-height:\s*44px/.test(cssCode)
  && /\.fold-title\s*\{[^}]*white-space:\s*nowrap/.test(cssCode));

/* ══════════════════════════════════════════════════════════════════════════
 * 22. 需求八：设置页自适应缩放（宽度 / 流体字号 / 三档断点）
 * ══════════════════════════════════════════════════════════════════════════ */
const tokenValue = (name) => optionsTokens.get(name) || '';
const clampMinOf = (value) => Number((value.match(/clamp\(\s*([\d.]+)px/) || [])[1]);
const clampMaxOf = (value) => Number((value.match(/,\s*([\d.]+)px\s*\)/) || [])[1]);

check('基准字号改为 clamp 流体写法', /clamp\(/.test(tokenValue('--font-base')), tokenValue('--font-base'));
check('基准字号下限 ≥14px（上一轮的可读性地板，不许回退）',
  clampMinOf(tokenValue('--font-base')) >= 14, String(clampMinOf(tokenValue('--font-base'))));
check('基准字号上限 16px（超宽屏也不无限放大）',
  clampMaxOf(tokenValue('--font-base')) === 16, String(clampMaxOf(tokenValue('--font-base'))));
check('body 用流体基准（不是再写死一个 px）',
  /font-size:\s*var\(--font-base\)/.test(bodyBlock));
check('流体只作用于基准与少数关键尺寸（--font-* 不超过 8 个）',
  [...optionsTokens.keys()].filter((k) => k.startsWith('--font-')).length <= 8,
  String([...optionsTokens.keys()].filter((k) => k.startsWith('--font-')).length));
check('关键尺寸也都是 clamp（行标题 / 说明 / 辅注 / h1 / 分区说明）',
  ['--font-title', '--font-desc', '--font-note', '--font-h1', '--font-lead']
    .every((k) => /^clamp\(\s*\d+(\.\d+)?px/.test(tokenValue(k))),
  ['--font-title', '--font-desc', '--font-note', '--font-h1', '--font-lead'].map(tokenValue).join(' | '));

const contentMax = Number((tokenValue('--content-max').match(/([\d.]+)px/) || [])[1]);
check('主内容宽度上限落在 1040~1120px', contentMax >= 1040 && contentMax <= 1120, String(contentMax));
check('.pane 用 --content-max 且水平居中（吃掉超宽屏的留白）',
  /\.pane\s*\{[^}]*max-width:\s*var\(--content-max\)/.test(cssCode)
  && /\.pane\s*\{[^}]*margin:\s*0 auto/.test(cssCode));
check('侧栏宽度令牌改为 218px（与「服务与模型」一致的口径）',
  /--nav-width:\s*218px/.test(css));

check('档 2（1024–1279）：侧栏收窄到 180px + 主区 min ≥720',
  /@media\s*\(min-width:\s*1024px\)\s*and\s*\(max-width:\s*1279px\)\s*\{[\s\S]{0,300}?grid-template-columns:\s*180px minmax\(0,\s*1fr\)/.test(cssCode)
  && /\.panes\s*\{\s*min-width:\s*720px/.test(cssCode));
check('档 3（≤1023）：侧栏变顶部横向滚动页签 + 主区单列',
  /@media\s*\(max-width:\s*1023px\)\s*\{[\s\S]{0,400}?\.shell\s*\{\s*grid-template-columns:\s*1fr/.test(cssCode)
  && /\.sidenav\s*\{[^}]*flex-direction:\s*row[^}]*overflow-x:\s*auto/.test(cssCode));
check('档 3 主区不再限宽（单列铺满，不靠 overflow 掩盖）',
  /\.pane\s*\{\s*padding:\s*20px 16px 48px;\s*max-width:\s*none;\s*margin:\s*0/.test(cssCode));
check('窄屏（≤880）行改竖排的既有降级仍在',
  /@media\s*\(max-width:\s*880px\)\s*\{[\s\S]{0,200}?\.row\s*\{\s*flex-direction:\s*column/.test(cssCode));
check('两栏工作区在档 3 降为单列（minmax 兜住，不出横向滚动条）',
  /\.gloss-layout,\s*\.scenario-layout\s*\{[^}]*grid-template-columns:\s*218px minmax\(0,\s*1fr\)/.test(cssCode)
  && /@media\s*\(max-width:\s*1023px\)[\s\S]{0,1200}?\.gloss-layout,\s*\n?\s*\.scenario-layout\s*\{\s*grid-template-columns:\s*1fr/.test(cssCode),
  '');
check('场景网格用 auto-fill + minmax（自适应列数，不撑破容器）',
  /\.scenario-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(168px,\s*1fr\)\)/.test(cssCode));
check('自适应不用 transform: scale 硬缩（避免糊字 / 坏热区）',
  !/\.(shell|panes|pane|rows|row)\s*\{[^}]*transform:\s*scale/.test(cssCode));
check('新增的自适应令牌都在 :root 里（没有第二条自定义属性来源）',
  ['--content-max', '--font-base', '--font-title', '--font-desc', '--font-note', '--pad-pane']
    .every((k) => optionsTokens.has(k)));

/* ── 14. 需求 7 收尾 / v0.4.2 问题 1 + 2：模型行只放「真正可用的」+ 按厂牌记忆 ────
 * 断言不照注释重写逻辑：把 main.ts 里那一段真实源码（providerKeyOf … modelRowEl 之前，
 * 含 modelRowsFor / nextModelFor / withModelSelection / hasModelInfo）切出来，
 * 用 TypeScript 转译后在 Node 里执行，跑的就是页面真正会跑的那段代码。
 * 动态渲染部分（真 Chrome + chrome 桩）另见 D:\edge\_ui\fix5 的端到端夹具。
 */
const requireTs = createRequire(import.meta.url);
const tsCompiler = requireTs('typescript');
const rowLogicSrc = ts.slice(ts.indexOf('const providerKeyOf = '), ts.indexOf('function modelRowEl('));
const rowLogicJs = tsCompiler.transpileModule(rowLogicSrc, {
  compilerOptions: { target: tsCompiler.ScriptTarget.ES2022, module: tsCompiler.ModuleKind.None }
}).outputText;
/* providerHasModel 是模块级 import，切片里是自由变量 —— 当参数传进去（与页面同一实现） */
const makeRowLogic = (settingsSnapshot, onlineSnapshot) =>
  new Function('settings', 'onlineModels', 'providerHasModel',
    `${rowLogicJs}\nreturn { modelRowsFor, nextModelFor, withModelSelection, hasModelInfo, providerInUse };`
  )(settingsSnapshot, onlineSnapshot, providerHasModel);
check('模型行 / 记忆逻辑取自 main.ts 真实源码（切片可转译执行）',
  rowLogicSrc.includes('function modelRowsFor') && rowLogicSrc.includes('function nextModelFor')
  && rowLogicJs.includes('function modelRowsFor')
  && typeof makeRowLogic({ service: 'google', providerId: '', modelName: '', customModels: [] }, {})
    .modelRowsFor === 'function');

const ds = PROVIDERS.find((p) => p.id === 'deepseek');
/* 参考清单里的两个 id 只当样本用（模拟「当前设置」与「在线缓存」里的型号），
   本轮起它们不再可能凭空出现在列表里 —— 这正是不再用它兜底的意义 */
const [refA, refB] = ds.models.map((m) => m.id);
const customs = [
  { id: 'my-model-1', label: '我的模型 1', providerId: 'deepseek', service: 'deepseek', icon: 'generic' },
  { id: 'my-model-2', label: '我的模型 2', providerId: 'deepseek', service: 'deepseek', icon: 'generic' }
];
const settingsFor = (patch = {}) => ({
  service: 'deepseek', providerId: 'deepseek', modelName: refA,
  customModels: [], providerKeys: {}, providerBaseUrls: {}, ...patch
});
const rowsFor = (online, patch = {}) => makeRowLogic(settingsFor(patch), online).modelRowsFor(ds);
const idsOf = (rows) => rows.map((r) => r.id);

/* ① 无缓存：只剩「当前设置」那一行 */
const noCacheRows = rowsFor({});
check('无缓存时只显示当前在用的那一行（参考清单不再兜底）',
  idsOf(noCacheRows).length === 1 && idsOf(noCacheRows)[0] === refA, idsOf(noCacheRows).join(','));
check('那一行标成「当前设置：<id>」+「当前设置 · 未在列表」',
  noCacheRows[0].label === `当前设置：${refA}` && noCacheRows[0].note === '当前设置 · 未在列表');

/* ② 有缓存：列表 = 缓存（参考清单里不在缓存中的型号一个都不出现） */
const cacheRows = rowsFor({ deepseek: [{ id: refA }, { id: 'new-online-x' }] });
check('有缓存时列表 = 缓存 ∪ 当前设置行（refA 已在缓存里，不重复）',
  idsOf(cacheRows).includes('new-online-x') && cacheRows.length === 2, idsOf(cacheRows).join(','));
check('参考清单里不在缓存中的型号（refB）不渲染', !idsOf(cacheRows).includes(refB));

/* ③ 当前型号与缓存无关时，补一行在最前（不能让用户看不到自己在用什么） */
const legacyRows = rowsFor({ deepseek: [{ id: 'new-online-x' }] }, { modelName: 'legacy-custom-x' });
check('当前使用中的型号不在缓存里时补一行并排在最前',
  idsOf(legacyRows)[0] === 'legacy-custom-x' && idsOf(legacyRows).includes('new-online-x'));
check('当前型号已在缓存里时不额外补行', (() => {
  const rows = rowsFor({ deepseek: [{ id: refA }] }, { modelName: refA });
  return rows.filter((r) => r.id === refA).length === 1 && !rows.some((r) => r.label.startsWith('当前设置'));
})());

/* ④ 缓存为 []：与「没缓存」同口径（接口抽风一次不会变出参考型号） */
check('缓存为 [] 时不渲染参考型号（与无缓存同口径）',
  idsOf(rowsFor({ deepseek: [] })).length === 1 && !idsOf(rowsFor({ deepseek: [] })).includes(refB));

check('不是正在用的厂牌不补「当前设置」行（providerInUse 守着）',
  makeRowLogic(settingsFor({ providerId: 'openai' }), { deepseek: [{ id: 'x-1' }] })
    .modelRowsFor(ds).every((r) => !r.label.startsWith('当前设置')));
check('hasModelInfo 只在有缓存时为真（空态文案据此分流）', (() => {
  const empty = makeRowLogic(settingsFor(), {});
  const cached = makeRowLogic(settingsFor(), { deepseek: [{ id: 'a' }] });
  return empty.hasModelInfo(ds) === false && cached.hasModelInfo(ds) === true;
})());

/* 自定义模型：与缓存无关，始终渲染，排在在线列表之后 */
const withCustom = rowsFor({ deepseek: [{ id: 'new-online-x' }] }, { customModels: customs });
check('自定义模型始终渲染（不受缓存 / 参考清单影响）',
  idsOf(withCustom).includes('my-model-1') && idsOf(withCustom).includes('my-model-2'));
check('自定义模型排在在线列表之后，且带 customIndex（可编辑 / 删除）',
  withCustom.filter((r) => r.customIndex >= 0).length === 2
  && idsOf(withCustom).indexOf('my-model-1') > idsOf(withCustom).indexOf('new-online-x'));
check('自定义 id 与缓存重复时去重（不出现两行同名）',
  idsOf(rowsFor({ deepseek: [{ id: refA }] },
    { customModels: [customs[0], { ...customs[1], id: refA }] }))
    .filter((id) => id === refA).length === 1);
check('别厂牌的自定义条目不串进本厂牌列表',
  !idsOf(rowsFor({ deepseek: [{ id: refA }] },
    { customModels: [{ ...customs[0], providerId: 'openai' }] })).includes('my-model-1'));

/* 厂牌行「N 个模型」计数：直接取同一个 rows.length，三档各一 */
check('厂牌行计数直接取同一个 rows.length（与面板渲染同源，没有另算一份）',
  ts.includes('count.textContent = `· ${rows.length} 个模型`')
  && /const rows = modelRowsFor\(provider\);/.test(ts)
  && ts.includes('inner.append(providerConfigEl(provider), providerModelsEl(provider, rows), providerToolbarEl(provider))'));
for (const [label, online, expectedN] of [
  ['无缓存（只剩当前设置行）', {}, 1],
  ['有缓存 3 条（含当前型号）', { deepseek: [{ id: refA }, { id: 'new-x' }, { id: 'new-y' }] }, 3],
  ['缓存为 []', { deepseek: [] }, 1]
]) {
  const actual = rowsFor(online).length;
  check(`厂牌行「N 个模型」计数 = 实际渲染行数（${label}）`,
    actual === expectedN && `· ${actual} 个模型` === `· ${rowsFor(online).length} 个模型`, `${label}: ${actual}`);
}

/* ── 问题 1：按厂牌记住上次选的模型（nextModelFor / withModelSelection） ── */
const logicOf = (patch = {}) => makeRowLogic(settingsFor(patch), {});
check('nextModelFor 优先取该厂牌记住的型号', (() => {
  const p = ds.models[1].id;
  return logicOf({ modelName: refA, providerModelSelections: { deepseek: p } }).nextModelFor(ds) === p;
})(), '没按记忆取值');
check('记住的型号即使不在参考清单里也照用（手填 / 已下架的能恢复）',
  logicOf({ modelName: refA, providerModelSelections: { deepseek: 'my-private-deploy' } })
    .nextModelFor(ds) === 'my-private-deploy');
check('没记过时看当前型号是否本来就属于该厂牌',
  logicOf({ modelName: refB, providerModelSelections: {} }).nextModelFor(ds) === refB);
check('既没记过、当前型号也不属于它 → 回落该厂牌默认模型',
  logicOf({ modelName: 'gpt-x', providerModelSelections: {} }).nextModelFor(ds) === ds.models[0].id);
check('withModelSelection 只改目标厂牌那一格，别家的记忆原样保留', (() => {
  const patch = logicOf({ providerModelSelections: { claude: 'claude-x' } })
    .withModelSelection({ modelName: 'm-1' }, 'deepseek', 'm-1');
  return patch.providerModelSelections.deepseek === 'm-1'
    && patch.providerModelSelections.claude === 'claude-x' && patch.modelName === 'm-1';
})());
check('withModelSelection 传空 id = 删掉这条记忆（删掉自定义模型时用）', (() => {
  const patch = logicOf({ providerModelSelections: { deepseek: 'gone' } })
    .withModelSelection({}, 'deepseek', '');
  return !('deepseek' in patch.providerModelSelections);
})());

/* 测试按钮的位置与旧全局按钮的移除 */
const toolbarCode = ts.slice(ts.indexOf('function providerToolbarEl('), ts.indexOf('function providerGroupEl('));
const latencyCode = ts.slice(ts.indexOf('function latencyQueryFor('), ts.indexOf('function toggleProviderPanel('));
const modelRowCode = ts.slice(ts.indexOf('function modelRowEl('), ts.indexOf('function providerModelsEl('));
check('测试按钮在厂牌面板工具条里（btn-test-provider-<厂牌>）',
  toolbarCode.includes('testBtn.id = `btn-test-provider-${provider.id}`')
  && toolbarCode.includes('bar.append(fetchBtn, addBtn, testBtn, status, testHint)')
  && ts.includes('inner.append(providerConfigEl(provider), providerModelsEl(provider, rows), providerToolbarEl(provider))'));
check('测试按钮带 data-testProvider，且没配 Key 时禁用',
  toolbarCode.includes('testBtn.dataset.testProvider = provider.id')
  && toolbarCode.includes('testBtn.disabled = !hasKey'));
check('旧全局测试按钮 / 延迟位 / 说明行已从 HTML 与 TS 彻底移除',
  !['btn-test-service', 'service-latency', 'service-test-desc']
    .some((k) => html.includes(k) || ts.includes(k)));
check('「翻译通道」行里已没有全局连通性测试按钮',
  !/btn-test-service|service-latency|service-test-desc/.test(servicePane));

/* 测速口径：一句样例真实翻译一次，不走 /models */
check('测速走 TRANSLATE_BATCH + 一句样例',
  latencyCode.includes("type: 'TRANSLATE_BATCH'")
  && latencyCode.includes('texts: [LATENCY_PROBE_TEXT]'));
check('测速带 noFallback + bypassCache（不偷偷回退 / 不命中缓存）',
  latencyCode.includes('noFallback: true') && latencyCode.includes('bypassCache: true'));
check('测速链路不再出现 /models 端点或 FETCH_MODELS（列表测速已废除）',
  !/['"`][^'"`]*\/models/.test(latencyCode)
  && !/FETCH_MODELS/.test(latencyCode) && !/fetchAvailableModels/.test(latencyCode));
check('工具条与注释都写明「不走模型列表」的测速口径',
  toolbarCode.includes('不走模型列表') && html.includes('不再用 /models 列表测速'));

/* 串行 / 超时 / 不落盘 */
check('超时 15s（LATENCY_TIMEOUT_MS = 15000），超时按失败处理',
  /const LATENCY_TIMEOUT_MS = 15000;/.test(ts)
  && latencyCode.includes('LATENCY_TIMEOUT_MS)') && latencyCode.includes('ok: false'));
check('串行：for 循环里逐个 await，无 Promise.all 并发',
  /for \(let i = 0; i < modelIds\.length; i \+= 1\)/.test(latencyCode)
  && latencyCode.includes('await translatePing(') && !/Promise\.all/.test(latencyCode));
check('runToken 失效保护：旧循环发现 token 变了就停手（两处校验）',
  latencyCode.includes('const token = ++latencyRunToken')
  && (latencyCode.match(/token !== latencyRunToken/g) || []).length >= 2);
check('latencyQueryFor 只造临时 settings（展开当前设置、只换 modelName）',
  /function latencyQueryFor\(/.test(ts) && latencyCode.includes('...settings')
  && latencyCode.includes('modelName: modelId'));
check('测速不落盘：整段不出现 chrome.storage / saveStoredSettings / update(',
  !/chrome\.storage/.test(latencyCode) && !/saveStoredSettings\(/.test(latencyCode)
  && !/\bupdate\(/.test(latencyCode));
check('结果只存内存 latencyResults（会话内有效，不污染用户选择）',
  /const latencyResults: Record<string, LatencyResult> = \{\}/.test(ts)
  && latencyCode.includes('latencyResults[latencyKey(provider.id, modelIds[i])] = result'));

/* 延迟徽标：位置、阈值、失败显示 */
check('延迟徽标挂在模型名后（.model-main 里是名字，.model-tail 里追加徽标）',
  modelRowCode.includes('main.append(label, idText)')
  && modelRowCode.includes('const latencyBadge = latencyBadgeFor(provider.id, row.id)')
  && modelRowCode.includes('tail.appendChild(latencyBadge)')
  && modelRowCode.includes('hit.append(main, tail)'));
check('延迟徽标排在「使用中」之前（insertBefore）',
  latencyCode.includes('if (state) tail.insertBefore(badge, state);'));
check('重绘后由内存结果把徽标补回（不会一重绘就丢）',
  modelRowCode.includes('latencyBadgeFor(provider.id, row.id)') && ts.includes('function latencyBadgeFor('));
check('阈值 600 / 1800 三档 + 失败独立一档',
  /result\.ms < 600/.test(ts) && /result\.ms < 1800/.test(ts)
  && ["'is-fast'", "'is-medium'", "'is-slow'", "'is-error'"].every((c) => ts.includes(c)));
check('成功显示 `${ms} ms`，失败显示「失败」',
  ts.includes("result.ok ? `${result.ms} ms` : '失败'"));
check('CSS 有 .model-latency 与四档配色（三档 + 失败）',
  /\.model-latency\s*\{/.test(css)
  && ['.model-latency.is-fast', '.model-latency.is-medium', '.model-latency.is-slow', '.model-latency.is-error']
    .every((s) => css.includes(s)));

/* ══════════════════════════════════════════════════════════════════════════
 * 23. 任务四 · 需求一：弹窗 / 设置页「两处一致」的两项共有设置项
 *     - glossaryEnabled：本轮补到术语库分区（弹窗的「注入」开关原本就有）
 *     - mergeShortFragments：复核发现设置页早已有（盘点里的 mergeFragments 是名字误差），
 *       不重复加控件，只守住它的落位与默认值口径。
 * ══════════════════════════════════════════════════════════════════════════ */
const segmentPane = paneOf('segment');
check('注入术语库总开关落在术语库分区', /data-setting="glossaryEnabled"/.test(glossaryPane)
  && !/data-setting="glossaryEnabled"/.test(segmentPane));
check('注入开关走 data-setting 通用绑定（无控件专属代码）',
  /<label class="switch" aria-label="注入术语库">[\s\S]{0,200}?data-setting="glossaryEnabled"/.test(glossaryPane)
  && !/getElementById\(['"]glossary-enabled['"]\)/.test(ts));
check('注入开关说明写清「关闭后所有已选术语库都不再注入，但包与条目保留」',
  /关闭后所有已选术语库都不再注入，但包与条目保留/.test(glossaryPane));
check('注入开关与弹窗同源（说明写明双向同步）', /双向同步/.test(glossaryPane));
check('默认 glossaryEnabled=true 且弹窗初值也是勾选',
  DEFAULT_SETTINGS.glossaryEnabled === true && /id="glossary-enabled" checked/.test(popupHtml));
check('短碎片合并仍在断句引擎分区（复核盘点偏差：字段名是 mergeShortFragments）',
  /data-setting="mergeShortFragments"/.test(segmentPane)
  && !/data-setting="mergeFragments"/.test(html));
check('默认 mergeShortFragments=true 且存储层非法值回落 true',
  DEFAULT_SETTINGS.mergeShortFragments === true
  && sanitizeSettings({ ...DEFAULT_SETTINGS, mergeShortFragments: null }).mergeShortFragments === true
  && sanitizeSettings({ ...DEFAULT_SETTINGS, glossaryEnabled: null }).glossaryEnabled === true);
check('两项都不在页面里另写第二份默认值',
  !/(glossaryEnabled|mergeShortFragments)\s*[:=]\s*(true|false)/.test(ts));
check('两项都走 onChanged → getStoredSettings → reflectSettings 的同一条同步链',
  /onChanged\.addListener[\s\S]{0,900}?getStoredSettings\(\)[\s\S]{0,300}?reflectSettings\(\)/.test(ts)
  && /function reflectSettings[\s\S]{0,500}?settings\[key\]/.test(ts));
// 弹窗回退后不再监听 onChanged（v0.4.1 形态）：同步链变成「弹窗写 → 设置页 onChanged 刷新」单向，
// 反向依赖用户重开弹窗时重新 GET_SETTINGS。这是回退的已知代价，如实断言而不是假装双向。
check('同步链为单向：设置页监听 onChanged 刷新，弹窗回退后不再回读',
  /chrome\.storage\.onChanged\.addListener/.test(ts)
  && !/chrome\.storage\.onChanged\.addListener/.test(popupTs)
  && !/function reloadFromStorage/.test(popupTs));
check('弹窗 persistSettings 发整份 settings（不是只写选择类字段的 patch）', (() => {
  const block = popupTs.slice(popupTs.indexOf('function persistSettings'), popupTs.indexOf("window.addEventListener('pagehide'"));
  const keys = [...block.matchAll(/^\s{4}([a-zA-Z]+):/gm)].map((m) => m[1]);
  // 这些是精简版会从 payload 里剔掉的「配置类」字段，回退后必须全部回来
  const configKeys = [
    'apiKey', 'apiBaseUrl', 'modelName', 'pauseThreshold', 'maxWordsPerSentence', 'maxCharsPerSentence',
    'maxDurationMs', 'segmentationLanguage', 'autoPunctuation', 'mergeShortFragments',
    'displayMode', 'layoutOrder', 'transColor', 'origColor', 'bgColor', 'aiIconColor',
    'fontSize', 'bgOpacity', 'autoHideNativeSubtitles', 'autoFallbackToGoogle'
  ];
  const missing = configKeys.filter((k) => !keys.includes(k));
  return missing.length === 0 && keys.length >= configKeys.length;
})(), '弹窗 payload 少写了配置类字段');

/* ══════════════════════════════════════════════════════════════════════════
 * 19. 弹窗回退不影响设置页（v0.4.2 本轮只回退弹窗）
 * ══════════════════════════════════════════════════════════════════════════ */
check('设置页与弹窗都是厂牌 8 通道（同源 PROVIDERS，弹窗不再是 4 项服务列表）',
  PROVIDERS.length === 8
  && /for \(const provider of PROVIDERS\)/.test(ts)
  && !/PRESET_MODELS\[service\]/.test(ts)
  && /function renderServiceOptions/.test(popupTs)
  && /PROVIDERS\.filter\(\(p\) => p\.id !== free\.id\)/.test(popupTs),
  `${PROVIDERS.length}`);
check('glossaryEnabled 在设置页仍存在（设置页不回退）',
  /data-setting="glossaryEnabled"/.test(glossaryPane) && DEFAULT_SETTINGS.glossaryEnabled === true);

/* ══════════════════════════════════════════════════════════════════════════
 * 24. v0.4.2 问题 5：设置页所有可展开容器的「展开」过渡统一成一条口径
 * ══════════════════════════════════════════════════════════════════════════ */
/* 取「display: grid 的那条规则体」——reduced-motion 块里同名选择器只是覆盖，
   不能拿它当基准（ruleOf 取的是首次出现，会先撞上覆盖块） */
const panelBody = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hit = cssCode.match(new RegExp(`\\n\\s*${escaped}\\s*\\{\\s*display:\\s*grid;([\\s\\S]*?)\\n\\}`));
  return hit ? hit[1] : '';
};
const PANEL_DECL = /transition:\s*grid-template-rows var\(--dur-base\) var\(--spring-soft\),\s*\n?\s*opacity var\(--dur-base\) var\(--ease-out-expo\)/;
check('三类面板（.fold-panel / .provider-panel / .details-body）的过渡声明逐字相同',
  PANEL_DECL.test(panelBody('.fold-panel')) && PANEL_DECL.test(panelBody('.provider-panel'))
  && PANEL_DECL.test(panelBody('.details-body')),
  ['.fold-panel', '.provider-panel', '.details-body'].map((s) => (panelBody(s).match(/transition:[^;]+/) || ['(无)'])[0]).join(' | '));
check('五个 disclosure 都以 grid-template-rows 0fr 为收起态（不靠 height）',
  /grid-template-rows:\s*0fr/.test(panelBody('.fold-panel'))
  && /grid-template-rows:\s*0fr/.test(panelBody('.provider-panel'))
  && /\.is-motion > \.details-body\s*\{\s*grid-template-rows:\s*0fr/.test(cssCode));
check('箭头与内容同一档时长（.provider-chevron / .fold-chevron / summary::before 都是 --dur-base）',
  /\.provider-chevron\s*\{[\s\S]{0,240}?transition:\s*transform var\(--dur-base\)/.test(cssCode)
  && /\.fold-chevron\s*\{[\s\S]{0,240}?transition:\s*transform var\(--dur-base\)/.test(cssCode)
  && /summary::before\s*\{[\s\S]{0,320}?transition:\s*transform var\(--dur-base\)/.test(cssCode));
check('翻译场景的分层卡片「展开全文」是 max-height 夹取（不是 0 → 内容），同为 --dur-base 且暴露 aria-expanded',
  /\.layer-body\s*\{[\s\S]{0,420}?transition:\s*max-height var\(--dur-base\)/.test(cssCode)
  && /more\.setAttribute\('aria-expanded', 'false'\)/.test(ts));
check('全部可展开件仍是 aria-expanded / details，没有自造控件',
  (ts.match(/aria-expanded/g) || []).length >= 4
  && (html.match(/aria-expanded="/g) || []).length === 2);

/* ══════════════════════════════════════════════════════════════════════════
 * 25. providerModelSelections（问题 1）：清洗口径与默认值
 * ══════════════════════════════════════════════════════════════════════════ */
const selectionSettings = sanitizeSettings({
  ...DEFAULT_SETTINGS,
  providerModelSelections: { deepseek: ' deepseek-v4-pro ', claude: '', evil: 'x', gemini: 1 }
});
check('providerModelSelections 只留厂牌白名单键、值 trim、空串不占格',
  JSON.stringify(selectionSettings.providerModelSelections) === JSON.stringify({ deepseek: 'deepseek-v4-pro' }),
  JSON.stringify(selectionSettings.providerModelSelections));
check('老数据缺这一项时不报错并落成空对象', JSON.stringify(sanitizeSettings({}).providerModelSelections) === '{}');
check('非对象 / 数组落回空对象',
  JSON.stringify(sanitizeSettings({ providerModelSelections: [] }).providerModelSelections) === '{}'
  && JSON.stringify(sanitizeSettings({ providerModelSelections: 'x' }).providerModelSelections) === '{}');
check('手填的自定义 id 原样保留（不按清单白名单过滤）',
  sanitizeSettings({ ...DEFAULT_SETTINGS, providerModelSelections: { deepseek: 'my-private-deploy' } })
    .providerModelSelections.deepseek === 'my-private-deploy');
check('默认值只在 types 定义一份', JSON.stringify(DEFAULT_SETTINGS.providerModelSelections) === '{}');
check('存储层把它当普通对象纳入 sanitize（没被白名单吞掉）',
  /merged\.providerModelSelections = sanitizeProviderModelSelections\(merged\.providerModelSelections\)/.test(storageTs));

/* ══════════════════════════════════════════════════════════════════════════
 * 26. 任务四 · 「自动降级」+ 降级顺序（v0.4.2）
 * ----------------------------------------------------------------------------
 * 口径（与执行链 docs/TRANSLATOR-RETRY.md 一致）：
 *   - 开关就是既有的 autoFallbackToGoogle，**不是**第二个字段；
 *   - fallbackOrder 是唯一数据：顺序 = 优先级（高 → 低），[] = 失败直接降级 Google 免费；
 *   - 页面只读写既有字段，清洗全在 utils/storage.ts，不替用户删条目。
 * ══════════════════════════════════════════════════════════════════════════ */
const tsCode = ts.replace(/\/\*[\s\S]*?\*\//g, '');

/* 1) 开关：标题与说明按需求原话改写，绑定不变 */
check('降级开关改叫「自动降级」（旧标题「失败自动降级」已不存在）',
  servicePane.includes('<span class="row-title">自动降级</span>')
  && !servicePane.includes('失败自动降级'));
check('开关说明写清关闭不降级 + 开启可指定顺序 + 不设置则直接降级 Google',
  /关闭时失败不降级；开启后可指定降级顺序，不设置则直接降级到\s*\n?\s*Google 免费翻译。/.test(servicePane));
check('开关仍绑既有字段 autoFallbackToGoogle，且全页只此一处',
  (html.match(/data-setting="autoFallbackToGoogle"/g) || []).length === 1
  && /aria-label="自动降级"[\s\S]{0,200}?data-setting="autoFallbackToGoogle"/.test(servicePane));
check('开关沿用 .switch + data-setting 通用绑定（无控件专属保存代码）',
  /<label class="switch" aria-label="自动降级">[\s\S]{0,240}?type="checkbox" data-setting="autoFallbackToGoogle"/.test(servicePane)
  && !/autoFallbackToGoogle'\]\)\?\.addEventListener/.test(ts)
  && !/getElementById\(['"][^'"]*fallback[^'"]*['"]\)\?\.addEventListener\(['"]change/.test(ts));
check('开关向读屏暴露开合（aria-controls 指向列表容器）',
  /aria-controls="fallback-order-panel"/.test(servicePane)
  && tsCode.includes("toggle.setAttribute('aria-expanded', String(open))")
  && tsCode.includes("toggle.setAttribute('aria-controls', 'fallback-order-panel')"));

/* 2) 列表结构：紧跟开关、默认收起、末尾固定 Google 兜底 */
const fbRow = html.slice(html.indexOf('id="row-auto-fallback"'), html.indexOf('id="row-auto-fallback"') + 2600);
check('降级顺序列表在开关所在行块内，且排在开关之后',
  fbRow.indexOf('data-setting="autoFallbackToGoogle"') > -1
  && fbRow.indexOf('id="fallback-order-panel"') > fbRow.indexOf('data-setting="autoFallbackToGoogle"')
  && fbRow.includes('id="fallback-order-list"'));
check('列表面板默认 hidden（首次渲染不占位、不进 tab 序列）',
  /id="fallback-order-panel" hidden/.test(html));
check('列表是无序列表语义（role=list + 每行 role=listitem）',
  /id="fallback-order-list" role="list"/.test(html)
  && tsCode.includes("item.setAttribute('role', 'listitem')"));
check('固定兜底行：无手柄 / 无上下移 / draggable=false，写明「最终兜底 · 无需 Key，始终作为最后一级」',
  tsCode.includes("const FALLBACK_FINAL_NOTE = '最终兜底 · 无需 Key，始终作为最后一级';")
  && /item\.className = 'fallback-item is-final'/.test(tsCode)
  && /item\.dataset\.draggable = 'false'/.test(tsCode)
  && /item\.draggable = false/.test(tsCode)
  && !/is-final[\s\S]{0,600}?data-grip/.test(tsCode)
  && !/is-final[\s\S]{0,900}?fallback-move/.test(tsCode));
check('固定兜底行由 freeProvider() 取（不另写一份 Google 文案与图标）',
  /const free = freeProvider\(\);/.test(tsCode)
  && /providerIconHtml\(free\.iconKey, free\.name, 16\)/.test(tsCode));

/* 3) 行内容：手柄 + 厂牌图标 + 名 + 状态 + 序号 + 上/下移 */
check('每行 = 手柄 + 厂牌图标（providerIconHtml）+ 名 + 序号 + 上/下移',
  /className = 'fallback-grip'/.test(tsCode)
  && /providerIconHtml\(provider\.iconKey, provider\.name, 16\)/.test(tsCode)
  && /className = 'fallback-index'/.test(tsCode)
  && /className = 'fallback-move'/.test(tsCode));
check('序号按展示顺序 1..n 编号', /seq\.textContent = String\(index \+ 1\)/.test(tsCode));

/* 4) 展示规则：数组顺序 + 已配 Key 未排序追加；未配 Key 且不在数组里不展示 */
check('行顺序 = fallbackOrder 顺序（数组即优先级）',
  /for \(const id of order\)/.test(tsCode) && /rows\.push\(\{ provider, configured: Boolean\(providerKeyOf\(provider\)\), ordered: true \}\)/.test(tsCode));
check('已配 Key 但不在数组里的厂牌追加在末尾并标「未排序」',
  /if \(!providerKeyOf\(provider\)\) continue;/.test(tsCode)
  && /rows\.push\(\{ provider, configured: true, ordered: false \}\)/.test(tsCode)
  && /state\.textContent = '未排序'/.test(tsCode));
check('未配 Key 且不在数组里 → 不展示（它不参与降级）',
  /未配 Key 且不在数组里的厂牌\*\*不展示\*\*/.test(ts));
check('未配 Key 但在数组里 → 保留并置灰标「未配置 Key · 不生效」（不静默抹掉）',
  /state\.textContent = '未配置 Key · 不生效'/.test(tsCode)
  && /is-unconfigured/.test(tsCode) && /\.fallback-item\.is-unconfigured\s*\{/.test(cssCode));
check('页面不做二次校验 / 不去重 / 不删条目（清洗只在 utils/storage.ts）',
  !tsCode.includes('sanitizeFallbackOrder') && !/fallbackOrder[\s\S]{0,80}?\.filter\(\)/.test(tsCode)
  && /不替用户从数组里删条目/.test(ts));
check('空态提示文案与固定兜底行并存', /还没有可参与降级的厂牌 · 先去上面的厂牌行填写 API Key/.test(tsCode));
check('「未设置顺序」时提示默认行为（不自动填默认顺序）',
  /未设置顺序时，失败会直接降级到 Google 免费翻译/.test(servicePane)
  && /hint\.classList\.toggle\('hidden', ordered\.length > 0\)/.test(tsCode));
check('页面里没有第二份默认顺序（不出现 fallbackOrder: [...] 字面量）',
  !/fallbackOrder:\s*\[/.test(tsCode) && !/fallbackOrder\s*=\s*\[/.test(tsCode));

/* 5) 拖拽：Pointer Events（鼠标 + 触控同一套），行内只动 transform */
check('拖拽用 Pointer Events，四类事件齐全（含 pointercancel）',
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].every((e) => tsCode.includes(`'${e}'`)));
check('没有只写 dragstart（HTML5 DnD 在移动端不触发）',
  !/dragstart/.test(tsCode) && !/draggable = true/.test(tsCode));
check('手柄 touch-action: none（触控按住不滚页面）',
  /\.fallback-grip\s*\{[\s\S]{0,400}?touch-action:\s*none/.test(cssCode));
check('让位只写 transform / 插入线也只写 transform（不碰 top/height）',
  /el\.style\.transform = shift \? `translateY\(\$\{shift\}px\)` : ''/.test(tsCode)
  && /drag\.line\.style\.transform = `translateY/.test(tsCode)
  && /\.fallback-drop\s*\{[\s\S]{0,400}?transition:\s*transform/.test(cssCode));
check('被拖行半透明 + 提升（opacity / box-shadow / 摘掉 transition 跟手）',
  /\.fallback-item\.is-dragging\s*\{[\s\S]{0,300}?transition:\s*none/.test(cssCode)
  && /\.fallback-item\.is-dragging\s*\{[\s\S]{0,300}?opacity:\s*0\.72/.test(cssCode)
  && /\.fallback-item\.is-dragging\s*\{[\s\S]{0,400}?box-shadow/.test(cssCode));
check('位移夹在列表范围内（不会被拖到标题行上）',
  /const visual = Math\.max\(min, Math\.min\(limit, dy\)\)/.test(tsCode));
check('没有引入第三方拖拽库（运行时零依赖）',
  !/sortablejs|dragula|dnd-kit|interact\.js/i.test(tsCode + html)
  && !/"dependencies"\s*:\s*\{\s*\n?\s*"[^"]+"/.test(read('../package.json')));

/* 6) 键盘可达：上移 / 下移按钮 + Alt+↑↓ + 焦点回到被移动的行 */
check('每行有上移 / 下移按钮并带 aria-label',
  /btn\.setAttribute\('aria-label', `\$\{dir === 'up' \? '上移' : '下移'\} \$\{provider\.name\}`\)/.test(tsCode));
check('边界用 aria-disabled（不 disabled，免得连按时焦点掉回 body）',
  /if \(atEdge\) btn\.setAttribute\('aria-disabled', 'true'\)/.test(tsCode)
  && !/btn\.disabled/.test(tsCode.slice(tsCode.indexOf('function fallbackItemEl'), tsCode.indexOf('function fallbackFinalEl')))
  && /\.fallback-move\[aria-disabled="true"\]\s*\{/.test(cssCode));
check('支持 Alt+↑ / ↓ 调顺序',
  /event\.altKey/.test(tsCode) && /moveFallbackRow\(id, event\.key === 'ArrowUp' \? 'up' : 'down'\)/.test(tsCode));
check('重绘后焦点回到被移动的行（含存储回声重绘）',
  /function captureFallbackFocus/.test(tsCode) && /function applyFallbackFocus/.test(tsCode)
  && /const keepFocus = fallbackFocusAfterRender \|\| captureFallbackFocus\(\)/.test(tsCode));
check('拖拽中不重建列表（存储回声会打断手势）',
  /if \(fallbackDrag\) return;/.test(tsCode));

/* 7) 收起：与其它折叠块同一条过渡声明；关闭时不写 fallbackOrder */
check('列表面板过渡与 .fold-panel / .provider-panel 逐字相同（0fr → 1fr + opacity，300ms）',
  (() => {
    const body = (() => {
      const hit = cssCode.match(/\n\s*\.depend-panel\s*\{\s*display:\s*grid;([\s\S]*?)\n\}/);
      return hit ? hit[1] : '';
    })();
    return PANEL_DECL.test(body) && /grid-template-rows:\s*0fr/.test(body);
  })());
check('展开态由 .is-open 推到 1fr，收起态靠 hidden 不占位',
  /\.depend-panel\.is-open\s*\{\s*grid-template-rows:\s*1fr/.test(cssCode)
  && /\.depend-panel\[hidden\]\s*\{\s*display:\s*none/.test(cssCode));
check('收起时面板 inert（不可聚焦、不进 tab 序列）', /panel\.inert = !open/.test(tsCode));
check('开关关闭不写 fallbackOrder（只切展示，顺序留着）',
  (() => {
    const body = tsCode.slice(tsCode.indexOf('function syncFallbackDepend'), tsCode.indexOf('function fallbackItemEl'));
    return body.length > 0 && !/update\(/.test(body) && !/saveStoredSettings/.test(body)
      && !/fallbackOrder:/.test(body);
  })());
check('写回走既有 update()（SAVE_SETTINGS 同一条通路），不额外弹重译提示',
  /await update\(\{ fallbackOrder: withFreeSlot\(ids\) \}\)/.test(tsCode)
  && !/function commitFallbackOrder[\s\S]{0,400}?toast\(/.test(tsCode)
  && !/fallbackOrder[\s\S]{0,120}?重新翻译/.test(tsCode));
check('另一处改动（onChanged）会重画列表', /renderProviderList\(\);[\s\S]{0,200}?renderFallbackOrder\(\);/.test(tsCode));
check('厂牌 Key 变化后重画列表（哪些厂牌能参与降级变了）',
  /if \(patch\.providerKeys !== undefined\) renderFallbackOrder\(\);/.test(tsCode));

/* 8) 视觉口径：行高与厂牌行一致、reduced-motion 覆盖、窄屏不溢出 */
check('行高与 .provider-row 同一口径（min-height: 36px）',
  /\.fallback-item\s*\{[\s\S]{0,400}?min-height:\s*36px/.test(cssCode)
  && /\.provider-row\s*\{[\s\S]{0,400}?min-height:\s*36px/.test(cssCode));
check('手柄 / 上下移命中区 32px（既定取舍：不按 44px 改）',
  /\.fallback-grip\s*\{[\s\S]{0,400}?width:\s*32px/.test(cssCode)
  && /\.fallback-move\s*\{[\s\S]{0,400}?width:\s*32px/.test(cssCode));
check('reduced-motion 下新面板与拖拽过渡全部归零',
  /\.depend-panel\s*\{\s*opacity:\s*1 !important/.test(reducedBlock)
  && /\.depend-panel:not\(\.is-open\)\s*\{\s*opacity:\s*0 !important/.test(reducedBlock)
  && /\.fallback-item,\s*\n?\s*\.fallback-grip,\s*\n?\s*\.fallback-move,\s*\n?\s*\.fallback-drop\s*\{\s*\n?\s*transition:\s*none !important/.test(reducedBlock));
check('窄屏（≤880）下面板不再吃 100% flex-basis（.row 已变 column）',
  /@media \(max-width: 880px\)\s*\{[\s\S]{0,600}?\.row-depend > \.depend-panel\s*\{\s*flex-basis:\s*auto/.test(cssCode));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log('高级设置页测试通过！');
