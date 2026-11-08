import assert from 'node:assert';
import fs from 'node:fs';

console.log('--- 测试: v0.4.1 完整配置版弹窗 + UI 动效与视觉规范 ---');

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

// ── 10. 回退锁定（v0.4.2）：弹窗回到 v0.4.1 的「完整配置版」 ──
// 精简版把 4 页签压成 2 页签、把配置类控件整体搬去设置页。本轮回退后，
// 下面 4 条锁住回退后的形态，避免精简口径的结构/文案再被引回来。
const tabIds = [...html.matchAll(/role="tab"[^>]*data-tab="([a-z]+)"/g)].map((m) => m[1]);
check('四个页签齐全，顺序为 常规 / 包 / 断句 / 样式',
  tabIds.join(',') === 'general,packs,segmentation,style', tabIds.join(','));

const configControlIds = [
  'api-key', 'api-base-url', 'btn-fetch-models', 'model-name',
  'pause-threshold', 'max-words', 'max-chars', 'max-duration',
  'trans-color-input', 'font-size', 'btn-upload-scene', 'btn-upload-glossary'
];
const missingIds = configControlIds.filter((id) => !new RegExp(`id="${id}"`).test(html));
check('12 个配置类控件 id 全部留在弹窗内', missingIds.length === 0, missingIds.join(', '));

check('测试连通性没被精简掉：#btn-test-api 仍在且已绑定',
  /id="btn-test-api"/.test(html) && /btnTestApi\.addEventListener\('click', handleTestApi\)/.test(ts));

const slimOnlyTexts = ['快捷选择 · 复杂配置在详细设置', '>翻译选择<', '遥控器', '工作台'];
const slimResidue = slimOnlyTexts.filter((t) => html.includes(t));
check('精简版「两页签 + 遥控器职责」文案已彻底消失',
  slimResidue.length === 0 && html.includes('ASR 断句拆分 · 语义标点 · 双语翻译'),
  slimResidue.join(' | ') || '头部副标题未回到 v0.4.1 文案');

// ── 11. 选项与设置页同步（v0.4.2）：8 通道 / 按厂牌 Key 与端点 / 模型不混装 ──
// 口径：唯一权威清单是 utils/models.ts#PROVIDERS。弹窗不再自带 PRESET_MODELS 副本。
// 注意：注释里会提到旧型号与旧常量名，所以「不含 X」类断言先剥注释再匹配。
const tsCode = ts
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const htmlCode = html.replace(/<!--[\s\S]*?-->/g, '');

check('弹窗从 utils/models 取厂牌清单（与设置页同源，无本地副本）',
  /from '\.\.\/\.\.\/utils\/models'/.test(ts)
  && /PROVIDERS/.test(ts)
  && !/const PRESET_MODELS/.test(tsCode));

check('服务下拉由 PROVIDERS 动态填充，HTML 里不再硬编码 4 个 option',
  /function renderServiceOptions/.test(ts)
  && /PROVIDERS\.filter\(\(p\) => p\.id !== free\.id\)/.test(ts)
  && /<select id="service-select" class="form-select"><\/select>/.test(htmlCode)
  && !/<option value="(google|deepseek|openai|gemini)">/.test(htmlCode));

check('首项是 Google 免费翻译，其余按 PROVIDERS 顺序（= 8 通道）',
  /const ordered = \[free, \.\.\.PROVIDERS/.test(ts)
  && /FREE_PROVIDER_ID/.test(ts)
  && /option\.value = provider\.id/.test(ts));

check('切换厂牌一次性换 providerId / service / modelName / apiKey / apiBaseUrl', (() => {
  const block = ts.slice(ts.indexOf('function applyProviderSelection'), ts.indexOf('function updateAiAccordionState'));
  return /providerKeyOf\(provider\)/.test(block)
    && /providerBase\(provider\)/.test(block)
    && /providerHasModel\(provider\.id/.test(block)
    && /apiKeyInput\.value =/.test(block)
    && /apiBaseUrlInput\.value =/.test(block)
    && /modelNameInput\.value =/.test(block);
})(), '切厂牌没有把 Key / 端点 / 模型一起换掉');

check('Key 输入写回 providerKeys[providerId]（请求层的 apiKey 同步）', (() => {
  const block = ts.slice(ts.indexOf('function persistSettings'), ts.indexOf("window.addEventListener('pagehide'"));
  return /providerKeys\[active\.id\] = typedKey/.test(block)
    && /providerBaseUrls\[active\.id\] = typedBase/.test(block)
    && /apiKey: isFree \? .* : typedKey/.test(block)
    && /providerId: providerIdForPersist\(\)/.test(block)
    && /service: active\.service/.test(block);
})(), 'Key / 端点没有按厂牌分格存');

check('保存仍发整份 settings（providerKeys / providerBaseUrls 原样带出）', (() => {
  const block = ts.slice(ts.indexOf('function persistSettings'), ts.indexOf("window.addEventListener('pagehide'"));
  return /providerKeys,/.test(block) && /providerBaseUrls,/.test(block)
    && /type: 'SAVE_SETTINGS'/.test(ts);
})(), '整份下发改成 patch 会把别家 Key 清掉');

check('模型下拉不再用厂牌参考清单补位（v0.4.2 问题 2：预置型号退出任何下拉）',
  /function buildModelChoices\(online: ModelChoice\[\], currentModel: string\)/.test(ts)
  && !/for \(const model of provider\.models\)/.test(ts)
  && !/trustOnline/.test(ts)
  && !/PRESET_MODELS\[service\]/.test(tsCode));

check('下拉数据源 = 在线缓存 ∪ 当前设置那一行，没获取过时只多一行禁用提示',
  /const online: ModelChoice\[\]/.test(ts)
  && /const seen = new Set<string>\(\)/.test(ts)
  && /name: `当前设置：\$\{current\}`/.test(ts)
  && /点右侧「获取模型列表」拉取可用模型/.test(ts)
  && /hint\.disabled = true/.test(ts));

check('缓存键按厂牌，且兼容旧的 cached_models_<service>', (() => {
  const block = ts.slice(ts.indexOf('function loadModelOptionsForCurrentProvider'), ts.indexOf('/**\n * 将配置填入表单控件'));
  return /cachedModelsKey\(provider\.id\)/.test(block)
    && /cachedModelsKey\(provider\.service\)/.test(block)
    && /Array\.isArray\(own\) && own\.length > 0/.test(block);
})(), '旧缓存没有回退读取，老用户升级会白丢一次拉取结果');

check('拉取模型用当前厂牌的 Key 与端点，缓存写 cached_models_<providerId>',
  /const apiBaseUrl = apiBaseUrlInput\.value\.trim\(\) \|\| provider\.defaultBaseUrl/.test(ts)
  && /chrome\.storage\.local\.set\(\{ \[cachedModelsKey\(provider\.id\)\]: res\.models \}\)/.test(ts)
  && !/cached_models_\$\{/.test(tsCode));

const staleModelIds = ['gpt-4o-mini', 'gpt-4o', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp', 'claude-sonnet-4-6', 'deepseek-chat', 'deepseek-reasoner'];
const staleInPopup = staleModelIds.filter((id) => tsCode.includes(id) || htmlCode.includes(id));
check('弹窗里彻底没有下架型号', staleInPopup.length === 0, staleInPopup.join(', '));

check('测试连接的显示名按厂牌名 + 当前模型，Google 仍是「Google 翻译」',
  /let serviceLabel = 'Google 翻译'/.test(ts)
  && /serviceLabel = activeModelName \? `\$\{provider\.name\} \[\$\{activeModelName\}\]` : provider\.name/.test(ts)
  && !/OpenAI代理/.test(tsCode));

check('弹窗 :root 补上 color-scheme: dark（8 个 option 的深色可读性）',
  (() => {
    const popupRoot = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
    return /color-scheme:\s*dark/.test(popupRoot) && /\.form-select option\s*\{[^}]*background:\s*#18181b/.test(css);
  })());

check('选中厂牌图标只出现在显示区（option 里不放 SVG）',
  /id="service-icon"/.test(htmlCode)
  && /serviceIconEl\.innerHTML = providerIconHtml\(provider\.iconKey, provider\.name\)/.test(ts)
  && !/opt\.innerHTML/.test(ts));

// ── 12. 按厂牌记住上次选的模型（v0.4.2 问题 1） ──
const switchBlock = ts.slice(ts.indexOf('function applyProviderSelection'), ts.indexOf('function updateAiAccordionState'));
check('切走前把旧厂牌当前型号留底（providerModelSelections[旧 providerId]）',
  /selections\[previousId\] = previousModel/.test(switchBlock));
check('切到新厂牌三级取值：记住的 → 本就属于该厂牌 → 厂牌默认模型',
  /const remembered = \(selections\[provider\.id\] \|\| ''\)\.trim\(\)/.test(switchBlock)
  && /const nextModel = remembered \|\| \(keepModel/.test(switchBlock));
check('恢复时不校验是否还在清单里（手填 / 已下架的手选也要能找回来）',
  !/providerHasModel\(provider\.id, remembered/.test(switchBlock));
check('手选 / 手填也写进记忆，整份保存带上 providerModelSelections', (() => {
  const block = ts.slice(ts.indexOf('function persistSettings'), ts.indexOf("window.addEventListener('pagehide'"));
  return /providerModelSelections\[active\.id\] = typedModel/.test(block)
    && /providerModelSelections,/.test(block);
})());

// ── 13. 「翻译场景」「术语库」改为可折叠（v0.4.2 问题 3） ──
check('两个折叠分区：section.pack-section + button.section-toggle（aria-expanded / aria-controls）',
  (htmlCode.match(/class="pack-section"/g) || []).length === 2
  && /id="section-scene-toggle"\s*aria-expanded="false" aria-controls="section-scene-body"/.test(htmlCode)
  && /id="section-glossary-toggle"\s*aria-expanded="false" aria-controls="section-glossary-body"/.test(htmlCode));
check('默认收起（内容区带 hidden，HTML 初值即终值）',
  /id="section-scene-body" hidden/.test(htmlCode) && /id="section-glossary-body" hidden/.test(htmlCode)
  && /const packSectionOpen: Record<PackSectionKey, boolean> = \{ scene: false, glossary: false \}/.test(ts));
check('收起态摘要：场景名 + 共 N 个；术语库 注入状态 + N 条 + M 个库',
  ['scene-active-badge', 'scene-section-count', 'glossary-section-state', 'glossary-total-badge', 'glossary-pack-count']
    .every((id) => htmlCode.includes(`id="${id}"`))
  && /sceneSectionCountEl\.textContent = `共 \$\{scenes\.length\} 个`/.test(ts)
  && /glossaryPackCountEl\.textContent = `\$\{packs\.length\} 个库`/.test(ts));
check('展开动画与设置页两个 .fold 同口径（0fr → 1fr + opacity，300ms）',
  /\.section-body\s*\{[\s\S]{0,220}?grid-template-rows:\s*0fr[\s\S]{0,240}?transition:\s*grid-template-rows var\(--dur-base\) var\(--spring-soft\)/.test(css)
  && /\.pack-section\.is-open > \.section-body\s*\{\s*grid-template-rows:\s*1fr/.test(css)
  && /\.section-body\[hidden\]\s*\{\s*display:\s*none/.test(css));
check('箭头只转 transform', /\.pack-section\.is-open \.section-chevron\s*\{[^}]*transform:\s*rotate\(90deg\)/.test(css)
  && /\.section-chevron\s*\{[\s\S]{0,240}?transition:\s*transform var\(--dur-base\)/.test(css));
check('收起态内容不可聚焦（inert，不是只靠视觉隐藏）', /body\.inert = !open/.test(ts));
check('折叠状态存 local 的独立键，且不进设置对象 / 不走保存链路',
  /const PACK_SECTIONS_KEY = 'yt_sub_popup_pack_sections'/.test(ts)
  && /chrome\.storage\.local\.set\(\{ \[PACK_SECTIONS_KEY\]/.test(ts)
  && !/packSectionOpen[\s\S]{0,60}sendSettingsSave/.test(ts));
check('功能一项没少：上传按钮 / 注入开关 / 两个列表容器 / 两份规范说明都还在',
  ['btn-upload-scene', 'btn-upload-glossary', 'glossary-enabled', 'scene-list', 'glossary-pack-list']
    .every((id) => htmlCode.includes(`id="${id}"`))
  && (htmlCode.match(/class="spec-details"/g) || []).length === 2);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log('UI 规范测试通过！');
