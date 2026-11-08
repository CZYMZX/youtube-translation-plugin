import assert from 'node:assert';
import { sanitizeSettings } from '../utils/storage.ts';
import { DEFAULT_SETTINGS } from '../types/index.ts';

console.log('--- 测试: 设置项校验与清洗 ---');

const dirty = sanitizeSettings({
  service: 'evil',
  scenario: 'unknown',
  reasoningEffort: 'ultra',
  displayMode: 'weird',
  layoutOrder: 'x',
  fontSize: 999,
  bgOpacity: -20,
  offsetY: 500,
  pauseThreshold: 1,
  syncOffsetMs: 99999,
  bgColor: 'red',
  transColor: '#12',
  targetLang: '   ',
  apiKey: undefined
});

assert.strictEqual(dirty.service, 'google', '非法 service 应回退 google');
// v0.2.9 起 scenario 支持自定义场景包 id：'unknown' 属合法 id 形式，应原样保留
assert.strictEqual(dirty.scenario, 'unknown', '自定义场景 id 应保留（不再强制枚举）');
// 真正非法的 id（含空格/符号）才回退到内置默认场景
assert.strictEqual(
  sanitizeSettings({ scenario: 'bad id!' }).scenario,
  'vtuber',
  '非法 scenario 应回退内置默认 vtuber'
);
assert.strictEqual(sanitizeSettings({}).scenario, 'vtuber', '缺省 scenario 应为 vtuber');
assert.strictEqual(dirty.reasoningEffort, 'low', '非法 reasoning 应回退 low');
assert.strictEqual(dirty.displayMode, 'bilingual', '非法 displayMode 应回退 bilingual');
assert.strictEqual(dirty.layoutOrder, 'translation_top', '非法 layoutOrder 应回退默认');
assert.strictEqual(dirty.fontSize, 48, 'fontSize 应被夹到上限 48');
assert.strictEqual(dirty.bgOpacity, 0, 'bgOpacity 应被夹到 0');
assert.strictEqual(dirty.offsetY, 94, 'offsetY 应被夹到 94');
assert.strictEqual(dirty.pauseThreshold, 120, 'pauseThreshold 应被夹到下限 120');
assert.strictEqual(dirty.syncOffsetMs, 2000, 'syncOffsetMs 应被夹到 2000');
assert.strictEqual(dirty.bgColor, DEFAULT_SETTINGS.bgColor, '非法背景色应回退默认');
assert.strictEqual(dirty.transColor, DEFAULT_SETTINGS.transColor, '非法译文色应回退默认');
assert.strictEqual(dirty.targetLang, DEFAULT_SETTINGS.targetLang, '空目标语言应回退默认');
assert.strictEqual(dirty.apiKey, '', 'undefined apiKey 应归一为空串');

const normal = sanitizeSettings({ fontSize: 22, bgColor: '#112233', enabled: false });
assert.strictEqual(normal.fontSize, 22);
assert.strictEqual(normal.bgColor, '#112233');
assert.strictEqual(normal.enabled, false);

console.log('✓ 非法枚举、越界数值、非法颜色、空语言、自定义场景 id 均被正确清洗');

/* ══════════════════════════════════════════════════════════════════════════
 * 隐私修复（「Key 仅保存到本地」）：非敏感设置走 sync，Key 只落 local
 * ----------------------------------------------------------------------------
 * 用两个独立的内存对象模拟 chrome.storage.sync / local，验证四件事：
 *   1. 保存后 sync 里**不含**任何密钥字段，密钥只在 local 的独立键里；
 *   2. 普通设置（端点、开关）仍写 sync —— 跨设备同步没有被一刀切砍掉；
 *   3. 老数据（Key 还写在 sync 里）首次读取会搬到 local，并把 sync 抹干净；
 *   4. 迁移幂等（第二次读取不再写盘），「恢复默认」能同时清掉本地密钥。
 * ══════════════════════════════════════════════════════════════════════════ */
const SETTINGS_KEY = 'yt_sub_translator_settings';
const SECRETS_KEY = 'yt_sub_translator_secrets';
const memory = { sync: {}, local: {} };
/** 记录每次 set 落在哪个区、写了哪些键：用来证明「迁移只做一次」 */
const writes = [];

globalThis.chrome = {
  storage: {
    sync: makeArea('sync'),
    local: makeArea('local')
  },
  runtime: {}
};

function makeArea(name) {
  return {
    get(keys, cb) {
      const out = {};
      for (const key of [].concat(keys)) {
        if (key in memory[name]) out[key] = memory[name][key];
      }
      queueMicrotask(() => cb(out));
    },
    set(items, cb) {
      writes.push({ area: name, keys: Object.keys(items) });
      Object.assign(memory[name], items);
      queueMicrotask(() => cb && cb());
    }
  };
}

const { getStoredSettings, saveStoredSettings } = await import('../utils/storage.ts');

/* 1. 保存：Key 只落 local，sync 里一个密钥字段都没有 */
const saved = await saveStoredSettings({
  service: 'deepseek',
  providerId: 'deepseek',
  modelName: 'deepseek-v3.8',
  apiKey: 'sk-local-only',
  enabled: false
});
const syncAfterSave = memory.sync[SETTINGS_KEY];
assert.ok(syncAfterSave, 'sync 里应有普通设置');
for (const field of ['apiKey', 'providerKeys', 'serviceKeys']) {
  assert.ok(!(field in syncAfterSave), `sync 里不应出现 ${field}`);
}
assert.strictEqual(syncAfterSave.service, 'deepseek', '非敏感设置仍写 sync');
assert.strictEqual(syncAfterSave.enabled, false, '非敏感设置仍写 sync');
assert.strictEqual(memory.local[SECRETS_KEY].apiKey, 'sk-local-only', 'Key 应落在 local 的独立键');
assert.strictEqual(memory.local[SECRETS_KEY].providerKeys.deepseek, 'sk-local-only', '按厂牌分格的 Key 同样只落 local');
assert.strictEqual(saved.apiKey, 'sk-local-only', '保存返回值仍是合并后的完整设置（调用方无感）');
console.log('✓ 保存：sync 无密钥 / local 有密钥，端点与开关仍在 sync');

/* 2. 读回：合并 sync 设置 + local 密钥，调用方拿到的还是同一份设置 */
const reread = await getStoredSettings();
assert.strictEqual(reread.apiKey, 'sk-local-only');
assert.strictEqual(reread.modelName, 'deepseek-v3.8');
assert.strictEqual(reread.enabled, false);
console.log('✓ 读取：sync 设置 + local 密钥合并，Key 覆盖生效');

/* 非敏感端点照旧写 sync（跨设备同步保留） */
await saveStoredSettings({ apiBaseUrl: 'https://relay.example.com/v1' });
assert.strictEqual(memory.sync[SETTINGS_KEY].apiBaseUrl, 'https://relay.example.com/v1');
assert.ok(!('apiBaseUrl' in (memory.local[SECRETS_KEY] || {})));
console.log('✓ Base URL 等非敏感字段仍在 sync，不被塞进密钥键');

/* 3. 迁移：老用户（v0.4.1 及以前）的 Key 还写在 sync 里 */
memory.sync[SETTINGS_KEY] = {
  ...DEFAULT_SETTINGS,
  service: 'openai',
  providerId: 'claude',
  apiKey: 'sk-legacy',
  /* 更老的残留：按服务商分的格 */
  serviceKeys: { openai: 'sk-openai-legacy' },
  providerKeys: { claude: 'sk-claude-legacy' }
};
delete memory.local[SECRETS_KEY];
writes.length = 0;

const migrated = await getStoredSettings();
assert.strictEqual(migrated.apiKey, 'sk-legacy', '升级后 Key 不能丢');
assert.strictEqual(migrated.providerKeys.claude, 'sk-legacy', '当前厂牌那一格以 apiKey 为准');
assert.strictEqual(migrated.providerKeys.openai, 'sk-openai-legacy', '老 serviceKeys 迁成厂牌分格');
const syncAfterMigrate = memory.sync[SETTINGS_KEY];
for (const field of ['apiKey', 'providerKeys', 'serviceKeys']) {
  assert.ok(!(field in syncAfterMigrate), `迁移后 sync 里不应再有 ${field}`);
}
assert.strictEqual(memory.local[SECRETS_KEY].apiKey, 'sk-legacy', 'Key 已搬到 local');
assert.strictEqual(memory.local[SECRETS_KEY].providerKeys.claude, 'sk-legacy');
assert.strictEqual(memory.local[SECRETS_KEY].providerKeys.openai, 'sk-openai-legacy');
console.log('✓ 迁移：sync 里的 Key 搬到 local，且 sync 被抹干净（老用户不丢 Key）');

/* 4. 幂等：第二次读取不再写盘 */
writes.length = 0;
const second = await getStoredSettings();
assert.strictEqual(second.apiKey, 'sk-legacy');
assert.strictEqual(writes.length, 0, `迁移应幂等，第二次读取写了 ${JSON.stringify(writes)}`);
console.log('✓ 迁移幂等：第二次读取零写入');

/* 5. 恢复默认：同时清掉本地密钥（与「恢复默认就是全清」语义一致） */
await saveStoredSettings({ ...DEFAULT_SETTINGS });
assert.deepStrictEqual(memory.local[SECRETS_KEY], {}, '恢复默认应清空 local 密钥');
assert.ok(!('apiKey' in memory.sync[SETTINGS_KEY]), '恢复默认后 sync 仍不含密钥');
const afterReset = await getStoredSettings();
assert.strictEqual(afterReset.apiKey, '', '恢复默认后读回空 Key');
console.log('✓ 恢复默认：local 密钥被清空，读回空 Key');

/* 6. 就算调用方（老弹窗）还在 patch 里塞 serviceKeys，也不会写进 sync */
await saveStoredSettings({ apiKey: 'sk-2', serviceKeys: { deepseek: 'sk-2' } });
assert.ok(!('serviceKeys' in memory.sync[SETTINGS_KEY]), 'serviceKeys 不得写进 sync');
assert.strictEqual(memory.local[SECRETS_KEY].apiKey, 'sk-2');
console.log('✓ 兜底：patch 里的 serviceKeys 残留不会漏进 sync');

/* 7. 按厂牌记住的模型（v0.4.2 问题 1）：普通设置，走 sync，不落密钥键 */
await saveStoredSettings({ providerModelSelections: { deepseek: 'deepseek-v4-pro' } });
assert.deepStrictEqual(
  (await getStoredSettings()).providerModelSelections,
  { deepseek: 'deepseek-v4-pro' },
  'providerModelSelections 应原样落盘并被读回'
);
assert.ok(
  !('providerModelSelections' in (memory.local[SECRETS_KEY] || {})),
  'providerModelSelections 不是敏感字段，不该写进 local 的密钥键'
);
assert.strictEqual(
  memory.sync[SETTINGS_KEY].providerModelSelections.deepseek,
  'deepseek-v4-pro',
  '它应跟着普通设置写 sync（跨设备也要记得住）'
);
/* 老数据（v0.4.1 及更早）没有这一项：读取时落成空对象，不抛错、不整份重置 */
delete memory.sync[SETTINGS_KEY].providerModelSelections;
const legacySelection = await getStoredSettings();
assert.deepStrictEqual(legacySelection.providerModelSelections, {}, '老数据缺这一项时应落成空对象');
assert.strictEqual(legacySelection.apiKey, 'sk-2', '缺这一项不影响其余设置（Key 仍在）');
console.log('✓ 按厂牌记忆的模型：随普通设置落 sync，老数据缺项不报错');

/* ══════════════════════════════════════════════════════════════════════════
 * 8. 降级顺序（v0.4.2 fallbackOrder）
 * ----------------------------------------------------------------------------
 * 口径：只保留合法 providerId（PROVIDERS 白名单）、去重、上限 8；
 * 缺项 / 形状不对 → []（= 保持 v0.4.1「失败直接降级 Google」），不抛错。
 * ══════════════════════════════════════════════════════════════════════════ */
assert.deepStrictEqual(DEFAULT_SETTINGS.fallbackOrder, [], '默认降级顺序必须是空数组（= 现有行为）');
assert.deepStrictEqual(sanitizeSettings({}).fallbackOrder, [], '缺项时应落成空数组');
assert.deepStrictEqual(legacySelection.fallbackOrder, [], '老数据缺这一项时同样落成空数组');
assert.deepStrictEqual(sanitizeSettings({ fallbackOrder: 'deepseek' }).fallbackOrder, [], '不是数组 → 空数组');
assert.deepStrictEqual(sanitizeSettings({ fallbackOrder: { 0: 'deepseek' } }).fallbackOrder, [], '对象 → 空数组（只有数组才认）');

const cleanedOrder = sanitizeSettings({
  fallbackOrder: [' deepseek ', 'evil', 'kimi', 'deepseek', 42, null, '', 'kimi', 'google-free']
}).fallbackOrder;
assert.deepStrictEqual(
  cleanedOrder,
  ['deepseek', 'kimi', 'google-free'],
  `非法 id / 非字符串 / 空串丢弃、重复项只留一次、trim 生效，实际 ${JSON.stringify(cleanedOrder)}`
);
assert.deepStrictEqual(
  sanitizeSettings({ fallbackOrder: ['openai', 'gemini', 'claude', 'qwen', 'kimi', 'zhipu', 'deepseek', 'google-free'] })
    .fallbackOrder.length,
  8,
  '恰好 8 个合法厂牌应全部保留'
);
assert.strictEqual(
  sanitizeSettings({ fallbackOrder: ['openai', 'gemini', 'claude', 'qwen', 'kimi', 'zhipu', 'deepseek', 'google-free', 'openai'] })
    .fallbackOrder.length,
  8,
  '上限 8 = 厂牌总数，重复项丢弃后仍为 8（合法 id 造不出更长的列表，故截断分支由「去重」等价兜住）'
);
assert.strictEqual(
  sanitizeSettings({ fallbackOrder: ['deepseek', 'evil', 'kimi', 'deepseek'] }).fallbackOrder.length,
  2,
  '被丢弃的项不占上限名额'
);
console.log('✓ 降级顺序：非法 id / 重复 / 超长被丢弃，缺项落空数组（默认行为不变）');

/* 顺序随普通设置写 sync（不是敏感字段），并且能原样读回 */
await saveStoredSettings({ fallbackOrder: ['deepseek', 'kimi'] });
assert.deepStrictEqual(memory.sync[SETTINGS_KEY].fallbackOrder, ['deepseek', 'kimi'], '降级顺序应写进 sync');
assert.ok(
  !('fallbackOrder' in (memory.local[SECRETS_KEY] || {})),
  '降级顺序不是敏感字段，不该写进 local 的密钥键'
);
assert.deepStrictEqual((await getStoredSettings()).fallbackOrder, ['deepseek', 'kimi'], '降级顺序应能原样读回');
console.log('✓ 降级顺序随普通设置落 sync 并原样读回（跨设备同一份优先级）');

console.log('所有设置项校验测试通过！');
