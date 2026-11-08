/**
 * 提示词分层模型守卫（任务二 · 数据与函数层）
 *
 * 守三件事：
 *  1) **字节等价**：`assemblePromptLayers(buildPromptLayers(...))` 必须与改造前的
 *     `composeSystemPrompt` 逐字节一致（改一个字节 = 全量用户的缓存键都变）。
 *     这里直接内联一份「旧拼装」参考实现做对照，288 组参数全比。
 *  2) **结构契约**：层顺序 / key 集合 / 只有 scene 可编辑 / title & summary 非空且 ≤40 字。
 *  3) **选项联动**：annotation 层随 glossaryAnnotation 变、asr 层随 asrCorrection 变、
 *     glossary 层只在传入术语块时出现且位于 output 之前。
 *
 * 断言口径与其他测试一致：check() 计数，末尾发现失败即 assert.fail（进程非零退出）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../types/index.ts';
import { BUILTIN_SCENES } from '../utils/packs.ts';
import {
  buildPromptLayers,
  assemblePromptLayers,
  PROMPT_LAYER_ORDER,
  PROMPT_SKELETON_LAYERS,
  ANNOTATION_OVERRIDE,
  COMMON_RULES,
  buildAnnotationRule,
  buildAsrRule,
  buildReasoningGuidance,
  buildOutputContract
} from '../utils/prompt-layers.ts';
import {
  composeSystemPrompt,
  buildPromptSkeleton,
  COMMON_RULES as COMMON_RULES_FROM_TRANSLATOR
} from '../utils/translator.ts';

console.log('--- 测试: 提示词分层模型（prompt-layers） ---');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ' => ' + detail : ''}`);
  }
}

const promptOf = (id) => BUILTIN_SCENES.find((s) => s.id === id)?.prompt || '';
const vtuber = promptOf('vtuber');
const general = promptOf('general');
const customPersona = '你是一位播客字幕译者，要求口语化、保留语气词，不添加原文没有的信息。';
const fakeGlossary =
  '\n【术语库·必须严格采用以下译名，专有名词不得音译或加注原文】\n- ときのそら → 时乃空（主播）\n- スパチャ → SC（醒目留言）（用语）';

const base = { ...DEFAULT_SETTINGS };

/* ── 0. 旧拼装参考实现（照抄改造前的 composeSystemPrompt，用于字节比对）─────
 * 刻意保留旧写法：先 filter 空层、单换行连接，再把「术语块（含括注覆盖声明）」整体拼进去。
 * 这段代码不是生产路径，只在测试里当标尺；改它等于改标尺，必须同时说明理由。
 */
function legacyCompose(persona, settings, targetLang, glossaryBlock = '') {
  const layers = [
    persona,
    COMMON_RULES,
    buildAnnotationRule(settings.glossaryAnnotation === 'on' ? 'on' : 'off'),
    buildAsrRule(settings.asrCorrection === 'strict' ? 'strict' : 'normal'),
    buildReasoningGuidance(settings.reasoningEffort)
  ].filter((part) => !!part && !!part.trim());

  const head = layers.join('\n');
  const annotationOverride =
    settings.glossaryAnnotation === 'on' && glossaryBlock ? '\n' + ANNOTATION_OVERRIDE : '';
  const block = glossaryBlock ? `${annotationOverride}\n\n${glossaryBlock.trim()}\n\n` : '\n\n';
  return `${head}${block}${buildOutputContract(targetLang)}`;
}

/* ── 1. 字节等价：288 组参数逐字节比对 ─────────────────────────── */
const personas = [
  ['vtuber', vtuber],
  ['general', general],
  ['自定义场景', customPersona],
  ['空文案', '']
];
const glossaries = [['无术语块', ''], ['有术语块', fakeGlossary], ['纯空白术语块', '   ']];
const langs = ['zh-CN', 'en'];
const matrix = [];
for (const [pName, persona] of personas) {
  for (const glossaryAnnotation of ['off', 'on']) {
    for (const asrCorrection of ['normal', 'strict']) {
      for (const reasoningEffort of ['none', 'low', 'high']) {
        for (const [gName, glossaryBlock] of glossaries) {
          for (const lang of langs) {
            matrix.push({
              label: `${pName} / ${glossaryAnnotation} / ${asrCorrection} / ${reasoningEffort} / ${gName} / ${lang}`,
              persona,
              lang,
              glossaryBlock,
              settings: { ...base, glossaryAnnotation, asrCorrection, reasoningEffort }
            });
          }
        }
      }
    }
  }
}

let layerMismatch = null;
let composeMismatch = null;
for (const c of matrix) {
  const assembled = assemblePromptLayers(buildPromptLayers(c.persona, c.settings, c.lang, c.glossaryBlock));
  const expected = legacyCompose(c.persona, c.settings, c.lang, c.glossaryBlock);
  if (!layerMismatch && assembled !== expected) layerMismatch = c.label;
  // 生产路径（composeSystemPrompt）同样逐个比
  const viaCompose = composeSystemPrompt(c.persona, c.settings, c.lang, c.glossaryBlock);
  if (!composeMismatch && viaCompose !== expected) composeMismatch = c.label;
}
console.log(`- 字节等价矩阵：${matrix.length} 组（场景 4 × 括注 2 × ASR 2 × 推理 3 × 术语 3 × 语言 2）`);
check(`分层装配与旧拼装逐字节一致（${matrix.length}/${matrix.length}）`, layerMismatch === null, `首个不一致：${layerMismatch}`);
check(`composeSystemPrompt 与旧拼装逐字节一致（${matrix.length}/${matrix.length}）`, composeMismatch === null, `首个不一致：${composeMismatch}`);

// 静态骨架（= 缓存指纹输入）三档对照：自带 persona 的两档必须与 composeSystemPrompt 同源
check('buildPromptSkeleton 走同一套分层装配（vtuber）', buildPromptSkeleton(base, 'zh-CN') === composeSystemPrompt(vtuber, base, 'zh-CN'));
check('buildPromptSkeleton 走同一套分层装配（general）', buildPromptSkeleton({ ...base, scenario: 'general' }, 'zh-CN') === composeSystemPrompt(general, { ...base, scenario: 'general' }, 'zh-CN'));
check('静态骨架不含按批变化的术语块', !/【术语库/.test(buildPromptSkeleton(base, 'zh-CN')));

/* ── 2. 层顺序 / key 序列 ─────────────────────────────────────── */
const keysOf = (layers) => layers.map((l) => l.key);
const NO_GLOSSARY = ['scene', 'common', 'annotation', 'asr', 'reasoning', 'output'];
const WITH_GLOSSARY = ['scene', 'common', 'annotation', 'asr', 'reasoning', 'glossary', 'output'];

const samples = [
  { label: 'vtuber + off + normal', persona: vtuber, settings: { ...base }, expect: NO_GLOSSARY },
  { label: 'vtuber + on + strict', persona: vtuber, settings: { ...base, glossaryAnnotation: 'on', asrCorrection: 'strict', reasoningEffort: 'high' }, expect: NO_GLOSSARY },
  { label: 'general + off + normal', persona: general, settings: { ...base, scenario: 'general', reasoningEffort: 'none' }, expect: NO_GLOSSARY },
  { label: '自定义 persona', persona: customPersona, settings: { ...base, glossaryAnnotation: 'on' }, expect: NO_GLOSSARY },
  { label: '自定义 persona + 术语块', persona: customPersona, settings: { ...base }, glossaryBlock: fakeGlossary, expect: WITH_GLOSSARY }
];
for (const s of samples) {
  const keys = keysOf(buildPromptLayers(s.persona, s.settings, 'zh-CN', s.glossaryBlock));
  check(`层 key 序列正确（${s.label}）`, keys.join(',') === s.expect.join(','), keys.join(','));
}

const orderAll = buildPromptLayers(customPersona, base, 'zh-CN', fakeGlossary).map((l) => l.key);
const orderNoGlossary = buildPromptLayers(customPersona, base, 'zh-CN').map((l) => l.key);
check('PROMPT_LAYER_ORDER 覆盖全部 7 个 key', PROMPT_LAYER_ORDER.length === 7 && new Set(PROMPT_LAYER_ORDER).size === 7, String(PROMPT_LAYER_ORDER.length));
check('实际层顺序是 PROMPT_LAYER_ORDER 的子序列（按序）', orderAll.every((k, i) => PROMPT_LAYER_ORDER.indexOf(k) >= (i > 0 ? PROMPT_LAYER_ORDER.indexOf(orderAll[i - 1]) : 0)));
check('无术语块时只是缺 glossary 一层，其余层一个不少', orderNoGlossary.join(',') === NO_GLOSSARY.join(','));
check('骨架层常量 = 除 glossary 外的全部层', PROMPT_SKELETON_LAYERS.join(',') === NO_GLOSSARY.join(','));

// 「层正文 join 起来 == 拼装结果」：前 5 层单换行连接后必须原样出现在完整 prompt 开头
const multiLayer = buildPromptLayers(vtuber, base, 'zh-CN');
const headJoined = multiLayer
  .filter((l) => PROMPT_SKELETON_LAYERS.slice(0, 5).includes(l.key) && l.body.trim())
  .map((l) => l.body)
  .join('\n');
const full = composeSystemPrompt(vtuber, base, 'zh-CN');
check('按序 join 层正文 == 完整 prompt 的骨架段（前缀一致）', full.startsWith(headJoined) && full.slice(headJoined.length).startsWith('\n\n'), `prefix=${full.startsWith(headJoined)}`);
check('骨架段之后紧跟输出契约（无术语块时空一行）', full.slice(headJoined.length) === '\n\n' + buildOutputContract('zh-CN'));

/* ── 3. 只有场景层可编辑 ─────────────────────────────────────── */
const editableLayers = buildPromptLayers(vtuber, base, 'zh-CN', fakeGlossary).filter((l) => l.editable);
check('只有 scene 层 editable === true', editableLayers.length === 1 && editableLayers[0].key === 'scene', editableLayers.map((l) => l.key).join(','));
check('editable 一律是布尔值（不是 undefined）', buildPromptLayers(vtuber, base, 'zh-CN').every((l) => typeof l.editable === 'boolean'));

/* ── 4. 每层 title / summary / detail 可用 ───────────────────── */
const allLayers = buildPromptLayers(vtuber, { ...base, glossaryAnnotation: 'on' }, 'zh-CN', fakeGlossary);
check('每层 title 非空', allLayers.every((l) => typeof l.title === 'string' && l.title.trim().length > 0));
check('每层 summary 非空', allLayers.every((l) => typeof l.summary === 'string' && l.summary.trim().length > 0));
check('每层 summary ≤ 40 字（界面一行放得下）', allLayers.every((l) => l.summary.length <= 40), allLayers.filter((l) => l.summary.length > 40).map((l) => `${l.key}=${l.summary.length}`).join(','));
check('每层 detail 非空（能回答「改了会怎样」）', allLayers.every((l) => typeof l.detail === 'string' && l.detail.trim().length > 0));
check('title 各不相同（界面分区标题不撞车）', new Set(allLayers.map((l) => l.title)).size === allLayers.length);

const byKey = (layers) => Object.fromEntries(layers.map((l) => [l.key, l]));
const L = byKey(allLayers);
check('scene 层 title = 场景人设', L.scene.title === '场景人设', L.scene.title);
check('common 层 title = 通用硬规则', L.common.title === '通用硬规则', L.common.title);
check('annotation 层 title = 专名括注', L.annotation.title === '专名括注', L.annotation.title);
check('asr 层 title = ASR 纠错授权', L.asr.title === 'ASR 纠错授权', L.asr.title);
check('reasoning 层 title = 推理深度', L.reasoning.title === '推理深度', L.reasoning.title);
check('glossary 层 title = 本批命中术语', L.glossary.title === '本批命中术语', L.glossary.title);
check('output 层 title = 输出契约', L.output.title === '输出契约', L.output.title);
// 说明要能回答「我改了会怎样」：括注两档、ASR 两档的措辞都得出现在说明里
check('annotation 说明覆盖两档口径（关＝只给译名 / 开＝译名（日文原文））', /关/.test(L.annotation.summary + L.annotation.detail) && /开/.test(L.annotation.summary + L.annotation.detail) && /日文原文/.test(L.annotation.summary + L.annotation.detail));
check('annotation 说明点名受哪个设置项控制', /专有名词括注原文/.test(L.annotation.detail));
check('asr 说明覆盖两档口径（常规可改 / 严格需确证）', /常规/.test(L.asr.summary + L.asr.detail) && /严格/.test(L.asr.summary + L.asr.detail) && /确证/.test(L.asr.summary + L.asr.detail));
check('asr 说明点名受哪个设置项控制', /ASR 纠错授权/.test(L.asr.detail));
check('common 说明强调「含自定义场景都继承」且不可改', /自定义场景/.test(L.common.detail) && /不可修改|无条件/.test(L.common.detail));
check('glossary 说明说明「只注入本批命中、不进指纹」', /本批/.test(L.glossary.detail) && /不进缓存指纹/.test(L.glossary.detail));
check('output 说明声明不可修改', /不可修改/.test(L.output.summary + L.output.detail));
check('reasoning 说明点明随档位切换、不可单独编辑', /不可单独编辑/.test(L.reasoning.detail));

/* ── 5. 层正文与规则函数同源（不是另写一份）───────────────────── */
check('common 层正文 === COMMON_RULES', L.common.body === COMMON_RULES);
check('annotation 层正文 === buildAnnotationRule(on)', L.annotation.body === buildAnnotationRule('on'));
check('asr 层正文 === buildAsrRule(normal)', L.asr.body === buildAsrRule('normal'));
check('reasoning 层正文 === buildReasoningGuidance(low)', L.reasoning.body === buildReasoningGuidance(base.reasoningEffort));
check('output 层正文 === buildOutputContract(targetLang)', L.output.body === buildOutputContract('zh-CN'));
check('scene 层正文 === 传入的 persona 原文', L.scene.body === vtuber);
check('translator 仍在转发 COMMON_RULES（老 import 路径可用）', COMMON_RULES_FROM_TRANSLATOR === COMMON_RULES);

/* ── 6. glossary 层：只在传术语块时出现、位于 output 之前 ─────── */
check('未传术语块时没有 glossary 层', !buildPromptLayers(vtuber, base, 'zh-CN').some((l) => l.key === 'glossary'));
const withGlossary = buildPromptLayers(vtuber, { ...base, glossaryAnnotation: 'on' }, 'zh-CN', fakeGlossary);
check('传入术语块时出现 glossary 层', withGlossary.some((l) => l.key === 'glossary'));
check('glossary 层位于 output 之前', keysOf(withGlossary).indexOf('glossary') < keysOf(withGlossary).indexOf('output'));
check('glossary 层不可编辑', byKey(withGlossary).glossary.editable === false);
check('glossary 层正文含术语块本体（原样，未改写）', byKey(withGlossary).glossary.body.includes('ときのそら → 时乃空'));
check('on 档：括注覆盖声明落在 glossary 层正文开头', byKey(withGlossary).glossary.body.startsWith(ANNOTATION_OVERRIDE));
check('on 档：覆盖声明在术语块之前（就近声明优先级）', byKey(withGlossary).glossary.body.indexOf(ANNOTATION_OVERRIDE) < byKey(withGlossary).glossary.body.indexOf('【术语库'));
const withGlossaryOff = buildPromptLayers(vtuber, base, 'zh-CN', fakeGlossary);
check('off 档：不出现括注覆盖声明（无冲突不必多说）', !byKey(withGlossaryOff).glossary.body.includes(ANNOTATION_OVERRIDE));
check('off 档：glossary 层正文 === 术语块 trim 后原文', byKey(withGlossaryOff).glossary.body === fakeGlossary.trim());

/* ── 7. 选项联动：annotation / asr 层正文随设置变化 ───────────── */
const annOff = byKey(buildPromptLayers(vtuber, { ...base, glossaryAnnotation: 'off' }, 'zh-CN')).annotation.body;
const annOn = byKey(buildPromptLayers(vtuber, { ...base, glossaryAnnotation: 'on' }, 'zh-CN')).annotation.body;
check('annotation 层正文随 glossaryAnnotation 变化', annOff !== annOn && annOff === buildAnnotationRule('off') && annOn === buildAnnotationRule('on'));
const asrNormal = byKey(buildPromptLayers(vtuber, { ...base, asrCorrection: 'normal' }, 'zh-CN')).asr.body;
const asrStrict = byKey(buildPromptLayers(vtuber, { ...base, asrCorrection: 'strict' }, 'zh-CN')).asr.body;
check('asr 层正文随 asrCorrection 变化', asrNormal !== asrStrict && asrNormal === buildAsrRule('normal') && asrStrict === buildAsrRule('strict'));
check('annotation 层不受 asrCorrection 影响', byKey(buildPromptLayers(vtuber, { ...base, asrCorrection: 'strict' }, 'zh-CN')).annotation.body === annOff);
check('asr 层不受 glossaryAnnotation 影响', byKey(buildPromptLayers(vtuber, { ...base, glossaryAnnotation: 'on' }, 'zh-CN')).asr.body === asrNormal);
const reasonings = ['none', 'low', 'high'].map((e) => byKey(buildPromptLayers(vtuber, { ...base, reasoningEffort: e }, 'zh-CN')).reasoning.body);
check('reasoning 层正文随档位变化（三档互不相同）', new Set(reasonings).size === 3);

/* ── 8. 空层口径：不剔除，body 为空串；装配时被安全跳过 ───────── */
const emptyReasoning = buildPromptLayers(vtuber, base, 'zh-CN').map((l) =>
  l.key === 'reasoning' ? { ...l, body: '' } : l
);
check('空正文的层仍保留在数组里（界面按 body 判空隐藏）', emptyReasoning.some((l) => l.key === 'reasoning' && l.body === ''));
const expectedWithoutReasoning =
  [vtuber, COMMON_RULES, buildAnnotationRule('off'), buildAsrRule('normal')].filter((p) => !!p && !!p.trim()).join('\n') +
  '\n\n' +
  buildOutputContract('zh-CN');
check(
  '空层不留下多余换行（装配结果 = 跳过后重拼，逐字节一致）',
  assemblePromptLayers(emptyReasoning) === expectedWithoutReasoning
);
check('空 persona 也不会产生前导空行', composeSystemPrompt('', base, 'zh-CN') === legacyCompose('', base, 'zh-CN'));
check('空 persona 时首层就是公共层', composeSystemPrompt('', base, 'zh-CN').startsWith(COMMON_RULES));

/* ── 9. 纯函数：无副作用、可重复调用 ─────────────────────────── */
const a1 = buildPromptLayers(customPersona, base, 'zh-CN', fakeGlossary);
const a2 = buildPromptLayers(customPersona, base, 'zh-CN', fakeGlossary);
check('同输入两次调用结果深度相等（无内部状态）', JSON.stringify(a1) === JSON.stringify(a2));
check('返回的是新数组（调用方可安全修改）', a1 !== a2);
const src = readFileSync(new URL('../utils/prompt-layers.ts', import.meta.url), 'utf8');
check('prompt-layers 不依赖 chrome / 存储（设置页可直接调用）', !/chrome\.\s*storage/.test(src) && !/from '\.\/(storage|packs|translator)/.test(src));
check('prompt-layers 唯一的运行时依赖是 types（其余都是本文件常量）', (src.match(/^import /gm) || []).length === 1);

console.log(`\n汇总: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  assert.fail(`提示词分层守卫有 ${failed} 项失败，详见上方 ✗ 行`);
}
console.log('\n所有测试项验证通过！');
