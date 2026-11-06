/**
 * 场景配置 / 场景提示词守卫测试
 *
 * 注意：本文件沿用 console.assert 约定——断言失败**不改变退出码**，
 * 必须以正文输出（末尾汇总 + ✗ 行）为准，不能只看 EXIT=0。
 *
 * 任务二（翻译场景与提示词）的六类诊断问题各有对应规则条款，这里做「规则仍在」的
 * 宽松关键词守卫：只要求语义条款存在，不锁定具体措辞，便于后续重写 prompt 时不被误伤。
 */
import { DEFAULT_SETTINGS } from '../types/index.ts';
import { BUILTIN_SCENES, BUILTIN_GLOSSARY_PACKS } from '../utils/packs.ts';

console.log('--- 测试: 场景与模型推理程度配置 ---');

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

// ── 1. 默认配置 ────────────────────────────────────────────────
console.assert(DEFAULT_SETTINGS.scenario === 'vtuber', '默认场景应该是 vtuber');
console.assert(DEFAULT_SETTINGS.reasoningEffort === 'low', '默认推理程度应该是 low');

console.log('✓ 默认配置项校验通过:');
console.log(`- 翻译场景: ${DEFAULT_SETTINGS.scenario}`);
console.log(`- 推理程度: ${DEFAULT_SETTINGS.reasoningEffort}`);

check('默认场景 id 指向内置场景（不是悬空 id）', BUILTIN_SCENES.some((s) => s.id === DEFAULT_SETTINGS.scenario));
check('场景取值仍含 vtuber / general', BUILTIN_SCENES.some((s) => s.id === 'vtuber') && BUILTIN_SCENES.some((s) => s.id === 'general'));

// ── 2. 提示词体量（对照资料库记录的 698 / 110 旧基线）──────────
console.log(`- 场景提示词体量：vtuber ${vtuber.length} 字 / general ${general.length} 字（资料库诊断期基线：约 698 / 110）`);
check('vtuber 提示词非空且未被截断', vtuber.length > 100, `${vtuber.length} 字`);
check('general 提示词非空且未被截断', general.length > 100, `${general.length} 字`);
check('两个场景提示词内容不相同', vtuber !== general);

// ── 3. 六类诊断问题的规则守卫 ──────────────────────────────────
// 1) 一人称无映射 → わし 被译成「老夫」
check('vtuber 含一人称映射（含 わし）', /一人称/.test(vtuber) && /わし/.test(vtuber));
// 2) 敬语对象泛化 → 打赏者被泛化成「大家」
check('vtuber 含敬语分层（SC / 观众道谢）', /敬语/.test(vtuber) && /SC/.test(vtuber));
// 3) 方言逐批漂移 → 关西弁无统一策略
check('vtuber 含方言处理策略', /关西|方言/.test(vtuber));
// 4) 填充词全保留
check('vtuber 含填充词折叠策略', /填充词/.test(vtuber));
// 5) ASR 同音误转未授权纠错
check('vtuber 含 ASR 纠错授权（且限定不改写事实）', /ASR/.test(vtuber) && /不得改写事实|不改写事实/.test(vtuber));
// 6) 括注原文（general 侧覆盖；vtuber 侧为已知缺口，见下）
check('general 含禁止括注', /括注/.test(general));

// ── 4. 红线守卫：术语译名不得写死进场景 prompt ─────────────────
const mcPack = BUILTIN_GLOSSARY_PACKS.find((p) => p.id === 'mc');
const mcSamples = (mcPack?.entries || []).filter((e) => ['苦力怕', '末影人', '潜影贝', '下界合金锭'].includes(e.zh));
check('MC 术语库可用于红线抽样', mcSamples.length >= 3, String(mcSamples.length));
const hardcoded = [vtuber, general].some((p) => mcSamples.some((e) => p.includes(e.zh)));
check('场景 prompt 未写死术语库译名（不绕过术语注入）', !hardcoded);

// ── 5. 已知缺口（不计入失败，待 B 类拍板）──────────────────────
const gaps = [];
if (!/括注/.test(vtuber)) gaps.push('vtuber prompt 无「禁止括注原文」条款');
if (!/值得注意的是|AI 腔|机翻腔/.test(vtuber + general)) gaps.push('两个场景均无 AI 腔禁用清单');
if (gaps.length > 0) {
  console.warn('⚠ 已知缺口（未落地，等拍板后才改 prompt）：');
  for (const g of gaps) console.warn(`  ⚠ ${g}`);
}

console.log(`\n汇总: ${passed} 通过, ${failed} 失败（console.assert 约定：不改变退出码）`);
if (failed === 0) {
  console.log('\n所有测试项验证通过！');
} else {
  console.error('\n存在失败项，请查看上面的 ✗ 行（本文件不改变退出码，EXIT=0 不代表通过）');
}
