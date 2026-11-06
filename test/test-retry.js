/**
 * 失败句局部重试守卫测试（v0.4.3 · 任务二）
 *
 * 被测对象：utils/translator.ts 的
 *   - translateWithLlmChannel（通用编排：首轮整批 → 句级失败逐句带前后文重试 → 收尾落库）
 *   - retryFailedSentences（重试调度：上限 / 退避 / 时间预算 / 端点级故障停手）
 *   - buildRetryItem / mapRawItemsToSlots / parseRetrySingle（上下文取材与防串写）
 *
 * 断言口径与 test-scenario.js 一致：所有用例走 check() 计数器，
 * 末尾按失败数抛 AssertionError，进程以非零码退出。
 *
 * 三条必须具备的行为（对应需求原文）：
 *   1) 批内 1 句缺失 → 只重试该句、上下文送入、结果只写该句；
 *   2) 重试 2 次仍失败 → 放弃且**不写缓存**（再跑一次会重新请求它）；
 *   3) 全批成功 → 不触发重试（零额外请求）。
 */
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../types/index.ts';
import {
  translateWithLlmChannel,
  retryFailedSentences,
  buildRetryItem,
  mapRawItemsToSlots,
  parseRetrySingle,
  RETRY_CONTRACT,
  MAX_SENTENCE_RETRIES,
  buildPromptSkeleton
} from '../utils/translator.ts';

console.log('--- 测试: 失败句局部重试（v0.4.3） ---');

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

const settings = { ...DEFAULT_SETTINGS, service: 'openai', apiKey: 'test-key', modelName: 'fake-model' };
const sleep = async () => {};

/* ── 1. 全批成功：不触发重试，零额外请求 ───────────────────────── */
console.log('- 用例 1：全批成功');
{
  const texts = ['A1 全批成功', 'A2 全批成功', 'A3 全批成功'];
  const calls = [];
  const channel = async (items, ctx) => {
    calls.push({ items, extra: ctx.extraInstruction, translatable: ctx.translatable });
    return items.map((it, id) => ({ id, translation: `译-${it.text.slice(0, 2)}` }));
  };

  const res = await translateWithLlmChannel(texts, 'zh-CN', settings, undefined, channel);

  check('1 次请求搞定（首轮整批）', calls.length === 1, `实际 ${calls.length} 次`);
  check('重试请求数为 0', res.retryRequests === 0, String(res.retryRequests));
  check('没有失败句', res.failedIdx.length === 0, JSON.stringify(res.failedIdx));
  check(
    '译文按槽位对齐',
    JSON.stringify(res.translations) === JSON.stringify(['译-A1', '译-A2', '译-A3']),
    JSON.stringify(res.translations)
  );
  check('首轮不带单句补译契约（省 token）', calls[0].extra === undefined, String(calls[0].extra));
  check(
    '首轮 payload 不带上下文（上下文只在重试时送）',
    calls[0].items.every((it) => it.before === undefined && it.after === undefined)
  );
}

/* ── 2. 批内 1 句缺失：只重试该句 + 上下文送入 + 结果只写该句 ──── */
console.log('- 用例 2：批内 1 句缺失');
{
  const texts = ['B1 第一句', 'B2 缺条目那句', 'B3 第三句', 'B4 第四句'];
  const calls = [];
  const channel = async (items, ctx) => {
    calls.push({ items, extra: ctx.extraInstruction, translatable: ctx.translatable });
    if (items.length > 1) {
      // 首轮：故意只回 3 条，缺 id=1
      return [
        { id: 0, translation: '译B1' },
        { id: 2, translation: '译B3' },
        { id: 3, translation: '译B4' }
      ];
    }
    // 单句补译：故意把"上下文句"也翻译出来（id=1/id=2），验证不会被写进结果
    return [
      { id: 0, translation: '译B2（补译）' },
      { id: 1, translation: '【上下文被误译】' },
      { id: 2, translation: '【上下文被误译2】' }
    ];
  };

  const res = await translateWithLlmChannel(texts, 'zh-CN', settings, undefined, channel);

  check('只多发 1 次请求（不重发整批）', calls.length === 2, `实际 ${calls.length} 次`);
  check('重试请求数 = 1', res.retryRequests === 1, String(res.retryRequests));
  check('重试 payload 只有 1 个条目（token 与批大小无关）', calls[1].items.length === 1, String(calls[1].items.length));
  check('重试的就是那句失败的（B2）', calls[1].items[0].text === texts[1], calls[1].items[0].text);
  check('上下文带入前一句原文', calls[1].items[0].before === texts[0], String(calls[1].items[0].before));
  check('上下文带入后一句原文', calls[1].items[0].after === texts[2], String(calls[1].items[0].after));
  check('重试请求追加了单句补译契约', calls[1].extra === RETRY_CONTRACT);
  check('重试时术语只按待译句匹配（上下文句不注入术语）', JSON.stringify(calls[1].translatable) === JSON.stringify([texts[1]]));

  check(
    '上下文句的译文没有串进结果',
    !res.translations.some((t) => t && t.includes('上下文被误译')),
    JSON.stringify(res.translations)
  );
  check(
    '结果 = 首轮 3 条 + 重试补的第 2 句',
    JSON.stringify(res.translations) === JSON.stringify(['译B1', '译B2（补译）', '译B3', '译B4']),
    JSON.stringify(res.translations)
  );
  check('失败掩码为空（该句已补回）', res.failedIdx.length === 0, JSON.stringify(res.failedIdx));
}

/* ── 3. 重试 2 次仍失败：放弃 + 不写缓存 ─────────────────────── */
console.log('- 用例 3：重试 2 次仍失败');
{
  const texts = ['C1 正常句', 'C2 永远失败句', 'C3 正常句'];
  const calls = [];
  const channel = async (items) => {
    calls.push(items.map((it) => it.text));
    if (items.length > 1) {
      return [
        { id: 0, translation: '译C1' },
        { id: 2, translation: '译C3' }
      ]; // 缺 id=1
    }
    return []; // 单句补译依然没拿到译文
  };

  const res = await translateWithLlmChannel(texts, 'zh-CN', settings, undefined, channel);

  const retryCalls = calls.filter((c) => c.length === 1).length;
  check(`单句重试次数 = ${MAX_SENTENCE_RETRIES}（不大于上限）`, retryCalls === MAX_SENTENCE_RETRIES, `实际 ${retryCalls} 次`);
  check('总请求数 = 1 首轮 + 2 次重试', calls.length === 1 + MAX_SENTENCE_RETRIES, String(calls.length));
  check('失败句留 null（不拿原文顶替）', res.translations[1] === null, String(res.translations[1]));
  check('失败掩码只标该句', JSON.stringify(res.failedIdx) === JSON.stringify([1]), JSON.stringify(res.failedIdx));
  check('失败原因可追溯', /条目缺失|重试/.test(String(res.errors[1])), String(res.errors[1]));

  // 不写缓存验证：同样的三句再跑一次，只应该重新请求失败的那一句
  const calls2 = [];
  const channel2 = async (items) => {
    calls2.push(items.map((it) => it.text));
    return [{ id: 0, translation: '译C2（后来成功）' }];
  };
  const res2 = await translateWithLlmChannel(texts, 'zh-CN', settings, undefined, channel2);

  check('第二次只请求 1 次（成功句命中内存缓存）', calls2.length === 1, `实际 ${calls2.length} 次`);
  check('第二次只请求失败句（说明失败句没被缓存）', JSON.stringify(calls2[0]) === JSON.stringify([texts[1]]), JSON.stringify(calls2[0]));
  check(
    '第二句这次补上，另外两句走缓存',
    JSON.stringify(res2.translations) === JSON.stringify(['译C1', '译C2（后来成功）', '译C3']),
    JSON.stringify(res2.translations)
  );
  check('第二次无失败句', res2.failedIdx.length === 0);
}

/* ── 4. 响应不是合法 JSON：逐句重试，不整批重发 ───────────────── */
console.log('- 用例 4：首轮响应不是合法 JSON');
{
  const texts = ['D1 甲', 'D2 乙'];
  const calls = [];
  const channel = async (items, ctx) => {
    calls.push({ n: items.length, extra: ctx.extraInstruction });
    if (items.length > 1) return null; // 拿不到 JSON 数组
    return [{ id: 0, translation: `译-${items[0].text.slice(0, 2)}` }];
  };

  const res = await translateWithLlmChannel(texts, 'zh-CN', settings, undefined, channel);

  check('没有重发整批（第 2 次起都是单句）', calls.slice(1).every((c) => c.n === 1), JSON.stringify(calls));
  check('两句各重试 1 次就恢复', calls.length === 3, `实际 ${calls.length} 次`);
  check(
    '两句都补回译文',
    JSON.stringify(res.translations) === JSON.stringify(['译-D1', '译-D2']),
    JSON.stringify(res.translations)
  );
}

/* ── 5. retryFailedSentences：上限 / 预算 / 端点级故障停手 ─────── */
console.log('- 用例 5：重试调度器');
{
  // 5.1 每句最多重试 maxRetries 次
  const attempts = new Map();
  const out1 = await retryFailedSentences({
    texts: ['x0', 'x1', 'x2'],
    failedIdx: [1],
    requestSingle: async () => {
      attempts.set('x1', (attempts.get('x1') || 0) + 1);
      return null;
    },
    sleep
  });
  check('单句重试到上限即停', attempts.get('x1') === MAX_SENTENCE_RETRIES, String(attempts.get('x1')));
  check('请求计数与重试次数一致', out1.requests === MAX_SENTENCE_RETRIES, String(out1.requests));
  check('放弃清单含该句', JSON.stringify(out1.gaveUp) === JSON.stringify([1]), JSON.stringify(out1.gaveUp));

  // 5.2 时间预算为 0 → 一次都不发（绝不阻塞队列）
  let budgetCalls = 0;
  const out2 = await retryFailedSentences({
    texts: ['y0', 'y1'],
    failedIdx: [0, 1],
    requestSingle: async () => {
      budgetCalls++;
      return null;
    },
    budgetMs: -1,
    sleep
  });
  check('超预算立即放弃（0 次请求）', budgetCalls === 0, String(budgetCalls));
  check('超预算的句子全部进放弃清单', out2.gaveUp.length === 2, JSON.stringify(out2.gaveUp));

  // 5.3 端点级故障（HTTP 5xx）→ 立刻停手，不再对剩余句空转
  let transportCalls = 0;
  const out3 = await retryFailedSentences({
    texts: ['z0', 'z1', 'z2', 'z3'],
    failedIdx: [0, 1, 2, 3],
    requestSingle: async () => {
      transportCalls++;
      throw new Error('HTTP 503: upstream pool exhausted');
    },
    sleep
  });
  check('端点级故障只发 1 次就停手（避免 N 句 × 2 轮空请求）', transportCalls === 1, String(transportCalls));
  check('停手后剩余句全部记为放弃', out3.gaveUp.length === 4, JSON.stringify(out3.gaveUp));
  check('标记为 aborted', out3.aborted === true, String(out3.aborted));

  // 5.4 成功即回填，不再进下一轮
  let okCalls = 0;
  const out4 = await retryFailedSentences({
    texts: ['w0', 'w1'],
    failedIdx: [1],
    requestSingle: async () => {
      okCalls++;
      return '译好了';
    },
    sleep
  });
  check('成功一次就不再重试', okCalls === 1, String(okCalls));
  check('成功值按 idx 回填', out4.filled.get(1) === '译好了', String(out4.filled.get(1)));
  check('无放弃项', out4.gaveUp.length === 0);
}

/* ── 6. 上下文取材：±1 句，批首/批尾只有单侧 ─────────────────── */
console.log('- 用例 6：上下文取材边界');
{
  const texts = ['S0', 'S1', 'S2', 'S3'];
  const first = buildRetryItem(texts, 0);
  const mid = buildRetryItem(texts, 1);
  const last = buildRetryItem(texts, 3);

  check('批首句没有前文', first.before === undefined, String(first.before));
  check('批首句取后一句', first.after === 'S1', String(first.after));
  check('中间句前后各 1 句', mid.before === 'S0' && mid.after === 'S2', `${mid.before} / ${mid.after}`);
  check('批尾句没有后文', last.after === undefined, String(last.after));
  check('批尾句取前一句', last.before === 'S2', String(last.before));
  check('待译句本身不被写进上下文', !String(mid.before).includes('S1') && !String(mid.after).includes('S1'));
}

/* ── 7. 防串写：槽位对齐与单句返回解析 ───────────────────────── */
console.log('- 用例 7：防串写');
{
  check(
    '缺条目 → 该槽位 null（不是与邻句错位）',
    JSON.stringify(mapRawItemsToSlots([{ id: 0, translation: 'p' }, { id: 2, translation: 'r' }], 3)) ===
      JSON.stringify(['p', null, 'r'])
  );
  check(
    '越界 id 直接丢弃（模型多吐的条目污染不到槽位）',
    JSON.stringify(mapRawItemsToSlots([{ id: 0, translation: 'p' }, { id: 99, translation: '污染' }], 1)) ===
      JSON.stringify(['p'])
  );
  check(
    '空译文算失败（不写空串进槽位）',
    JSON.stringify(mapRawItemsToSlots([{ id: 0, translation: '   ' }], 1)) === JSON.stringify([null])
  );
  check(
    '字符串 id 也能对齐（模型偶尔把 id 写成 "1"）',
    JSON.stringify(mapRawItemsToSlots([{ id: '1', translation: 'q' }], 2)) === JSON.stringify([null, 'q'])
  );

  check('单句返回只认 id=0', parseRetrySingle([{ id: 0, translation: 'ok' }]) === 'ok');
  check('单句返回里混了上下文条目 → 只取 id=0', parseRetrySingle([{ id: 1, translation: '噪声' }, { id: 0, translation: 'ok' }]) === 'ok');
  check('吐了两条 id=0（无法判断对应哪句）→ 判失败', parseRetrySingle([{ id: 0, translation: 'a' }, { id: 0, translation: 'b' }]) === null);
  check('只吐 id=1（全是上下文）→ 判失败', parseRetrySingle([{ id: 1, translation: 'x' }]) === null);
  check('空译文 → 判失败', parseRetrySingle([{ id: 0, translation: '  ' }]) === null);
  check('响应不是数组 → 判失败', parseRetrySingle(null) === null);
}

/* ── 8. 缓存指纹红线：单句补译契约不进骨架（老译文不失效）────── */
console.log('- 用例 8：缓存指纹未被改动');
{
  const skeleton = buildPromptSkeleton(settings, 'zh-CN');
  check('静态骨架不含单句补译契约', !skeleton.includes(RETRY_CONTRACT));
  check('静态骨架不含契约标记文本', !skeleton.includes('【本次只补一句译文】'));
  check('契约文本本身非空（否则上一条断言无意义）', RETRY_CONTRACT.length > 40, String(RETRY_CONTRACT.length));
}

console.log(`\n汇总: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  assert.fail(`失败句局部重试守卫有 ${failed} 项失败，详见上方 ✗ 行`);
}
console.log('\n所有测试项验证通过！');
