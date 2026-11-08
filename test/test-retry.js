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
  translateSentenceBatchDetailed,
  resolveFallbackCandidates,
  resolveCurrentProviderId,
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

/* ══════════════════════════════════════════════════════════════════════════
 * 9. 逐级降级链（v0.4.2 降级顺序）
 * ----------------------------------------------------------------------------
 * 被测对象：translateSentenceBatchDetailed 的降级分支 + resolveFallbackCandidates。
 * 全程用假 fetch（按 URL 路由），不联网；每条用例的原文都不同 ——
 * 缓存键含原文，共用原文会命中前一用例写下的缓存（那样断言就没意义了）。
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('- 用例 9：逐级降级链（降级顺序）');
{
  let requests = [];
  let responder = null;
  const realFetch = globalThis.fetch;

  function failRes(status, message = 'boom') {
    return {
      ok: false,
      status,
      json: async () => ({ error: { message } }),
      text: async () => JSON.stringify({ error: { message } })
    };
  }
  function okRes(data) {
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
  }
  /** OpenAI 兼容成功：按 payload 条目逐条回译，前缀用来判断「结果来自哪一级」 */
  const llmOk = (tag) => (url, init, body) => {
    const items = JSON.parse(body.messages[1].content);
    return okRes({
      choices: [{ message: { content: JSON.stringify(items.map((it, i) => ({ id: i, translation: `${tag}${it.text}` }))) } }]
    });
  };
  /** Google 免费成功：按行回译（合并请求按行数与输入对齐） */
  const googleOk = (tag) => (url) => {
    const q = new URL(url).searchParams.get('q') || '';
    return okRes([[[q.split('\n').map((l) => `${tag}${l}`).join('\n')]]]);
  };
  const route = (table) => (url, init, body) => {
    for (const [frag, handler] of table) {
      if (url.includes(frag)) return handler(url, init, body);
    }
    return failRes(404, 'no route');
  };

  globalThis.fetch = async (url, init) => {
    const u = String(url);
    let body = null;
    if (init && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    requests.push({ url: u, body, headers: (init && init.headers) || {} });
    if (!responder) return failRes(599, 'no responder');
    return responder(u, init, body);
  };

  const hits = (frag) => requests.filter((r) => r.url.includes(frag));
  const reset = (fn) => {
    requests = [];
    responder = fn;
  };
  const textsOf = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1} 句`);
  const mk = (overrides) => ({
    ...DEFAULT_SETTINGS,
    service: 'openai',
    providerId: 'openai',
    apiKey: 'sk-primary',
    modelName: 'gpt-6.1-sol',
    providerKeys: { openai: 'sk-primary' },
    ...overrides
  });

  try {
    /* 9.1 【最重要】默认行为未变：fallbackOrder 为空 + 允许降级 → 仍然走 Google 免费 */
    {
      const t = textsOf('D1-', 2);
      reset(route([
        ['api.openai.com', () => failRes(400, 'bad key')],
        ['translate.googleapis.com', googleOk('G|')]
      ]));
      const res = await translateSentenceBatchDetailed(t, 'zh-CN', mk({ fallbackOrder: [] }));

      check('9.1 默认行为未变：order 为空仍降级 Google', res.translations.every((x) => x.startsWith('G|')), JSON.stringify(res.translations));
      check('9.1 请求数 = 主通道 1 + Google 1（没有多发的级）', requests.length === 2, JSON.stringify(requests.map((r) => r.url.slice(0, 32))));
      check('9.1 无失败句', res.failed.every((f) => !f), JSON.stringify(res.failed));
      check('9.1 成功结果不标注前缀（不污染译文）', !res.translations.some((x) => x.includes('降级')), JSON.stringify(res.translations));
    }

    /* 9.2 非空顺序且第一级成功 → 只请求第一级，不请求 Google */
    {
      const t = textsOf('D2-', 2);
      reset(route([
        ['api.openai.com', () => failRes(400, 'down')],
        ['api.deepseek.com', llmOk('DS|')]
      ]));
      const res = await translateSentenceBatchDetailed(
        t,
        'zh-CN',
        mk({
          fallbackOrder: ['deepseek'],
          providerKeys: { openai: 'sk-primary', deepseek: 'sk-deep' },
          providerModelSelections: { deepseek: 'deepseek-v4-pro' }
        })
      );

      check('9.2 只请求主通道 + 第一级', requests.length === 2, JSON.stringify(requests.map((r) => r.url.slice(0, 32))));
      check('9.2 完全不请求 Google', hits('translate.googleapis.com').length === 0);
      check('9.2 结果来自第一级', res.translations.every((x) => x.startsWith('DS|')), JSON.stringify(res.translations));
      check('9.2 用该厂牌自己的 Key', String(hits('api.deepseek.com')[0].headers.Authorization) === 'Bearer sk-deep', String(hits('api.deepseek.com')[0].headers.Authorization));
      check('9.2 用该厂牌记住的模型', hits('api.deepseek.com')[0].body.model === 'deepseek-v4-pro', String(hits('api.deepseek.com')[0].body.model));
      check('9.2 用该厂牌的端点（不是主通道的端点）', hits('api.deepseek.com')[0].url.endsWith('/v1/chat/completions'), hits('api.deepseek.com')[0].url);
      check('9.2 无失败句', res.failed.every((f) => !f));
    }

    /* 9.3 前两级失败、第三级成功 → 请求顺序正确，结果来自第三级 */
    {
      const t = textsOf('D3-', 2);
      reset(route([
        ['api.openai.com', () => failRes(400, 'down')],
        ['api.deepseek.com', () => failRes(400, 'down')],
        ['api.moonshot.cn', () => failRes(400, 'down')],
        ['open.bigmodel.cn', llmOk('Z|')]
      ]));
      const res = await translateSentenceBatchDetailed(
        t,
        'zh-CN',
        mk({
          fallbackOrder: ['deepseek', 'kimi', 'zhipu'],
          providerKeys: { openai: 'sk-primary', deepseek: 'sk-d', kimi: 'sk-k', zhipu: 'sk-z' }
        })
      );
      const order = requests.map((r) =>
        r.url.includes('api.openai.com') ? 'openai'
          : r.url.includes('api.deepseek.com') ? 'deepseek'
            : r.url.includes('api.moonshot.cn') ? 'kimi'
              : r.url.includes('open.bigmodel.cn') ? 'zhipu'
                : 'other'
      );
      check('9.3 请求顺序 = 主通道 → deepseek → kimi → zhipu', JSON.stringify(order) === JSON.stringify(['openai', 'deepseek', 'kimi', 'zhipu']), JSON.stringify(order));
      check('9.3 结果来自第三级', res.translations.every((x) => x.startsWith('Z|')), JSON.stringify(res.translations));
      check('9.3 有级成功就不再兜底 Google', hits('translate.googleapis.com').length === 0);
    }

    /* 9.4 全部失败 → 落到 Google；Google 也失败 → [降级失败: …] */
    {
      const t = textsOf('D4-', 1);
      reset(route([
        ['api.openai.com', () => failRes(400, 'primary down')],
        ['api.deepseek.com', () => failRes(400, 'deepseek down')],
        ['translate.googleapis.com', () => failRes(429, 'google down')],
        ['translate.google.com', () => failRes(429, 'google down')],
        ['api.mymemory.translated.net', () => failRes(429, 'mymemory down')]
      ]));
      const res = await translateSentenceBatchDetailed(
        t,
        'zh-CN',
        mk({ fallbackOrder: ['deepseek'], providerKeys: { openai: 'sk-primary', deepseek: 'sk-d' } })
      );

      check('9.4 链路走完后确实试过 Google 兜底', hits('translate.googleapis.com').length > 0);
      check('9.4 每句写 [降级失败: 原因]', res.translations.every((x) => /^\[降级失败: .+\]$/.test(x)), JSON.stringify(res.translations));
      check('9.4 失败掩码全置位', res.failed.every(Boolean), JSON.stringify(res.failed));
    }

    /* 9.5 noFallback: true（测试连接 / AI 深度全篇）→ 一次降级都不发生 */
    {
      const t = textsOf('D5-', 1);
      reset(route([
        ['api.openai.com', () => failRes(400, 'primary down')],
        ['api.deepseek.com', llmOk('DS|')],
        ['translate.googleapis.com', googleOk('G|')]
      ]));
      let thrown = null;
      try {
        await translateSentenceBatchDetailed(
          t,
          'zh-CN',
          mk({ fallbackOrder: ['deepseek'], providerKeys: { openai: 'sk-primary', deepseek: 'sk-d' } }),
          { noFallback: true }
        );
      } catch (e) {
        thrown = e;
      }
      check('9.5 noFallback 抛真实错误（不静默降级）', !!thrown && /HTTP 400|端点响应错误/.test(thrown.message), String(thrown && thrown.message));
      check('9.5 noFallback 时只发主通道 1 次请求', requests.length === 1, JSON.stringify(requests.map((r) => r.url.slice(0, 32))));
    }

    /* 9.6 autoFallbackToGoogle: false（自动降级开关关掉）→ 一次降级都不发生 */
    {
      const t = textsOf('D6-', 1);
      reset(route([
        ['api.openai.com', () => failRes(400, 'primary down')],
        ['api.deepseek.com', llmOk('DS|')],
        ['translate.googleapis.com', googleOk('G|')]
      ]));
      const res = await translateSentenceBatchDetailed(
        t,
        'zh-CN',
        mk({
          autoFallbackToGoogle: false,
          fallbackOrder: ['deepseek'],
          providerKeys: { openai: 'sk-primary', deepseek: 'sk-d' }
        })
      );
      check('9.6 开关关掉时一次降级都不发生', requests.length === 1, JSON.stringify(requests.map((r) => r.url.slice(0, 32))));
      check('9.6 展示该服务真实报错（不是降级占位）', /^\[OPENAI 失败: /.test(res.translations[0]), res.translations[0]);
      check('9.6 失败掩码置位', res.failed[0] === true);
    }

    /* 9.7 候选解析：跳过当前厂牌 / 跳过未配 Key / 丢弃非法 id / 去重 / 免费通道免 Key */
    {
      const cands = resolveFallbackCandidates(
        mk({
          fallbackOrder: ['openai', 'claude', 'kimi', 'kimi', 'evil', 'google-free'],
          providerKeys: { openai: 'sk-primary', kimi: 'sk-k' }
        })
      );
      const ids = cands.map((c) => c.providerId);
      check('9.7 跳过当前正在用的厂牌', !ids.includes('openai'), JSON.stringify(ids));
      check('9.7 跳过未配 Key 的厂牌', !ids.includes('claude'), JSON.stringify(ids));
      check('9.7 丢弃未知 id', !ids.includes('evil'), JSON.stringify(ids));
      check('9.7 重复项只留一次', ids.filter((x) => x === 'kimi').length === 1, JSON.stringify(ids));
      check('9.7 免费通道不需要 Key 也能进链', cands.some((c) => c.providerId === 'google-free' && c.settings.apiKey === ''), JSON.stringify(ids));
      check('9.7 候选保持用户设定的相对顺序', JSON.stringify(ids) === JSON.stringify(['kimi', 'google-free']), JSON.stringify(ids));
      check(
        '9.7 当前厂牌识别：providerId 与 service 对不上时按 service 主厂牌落位',
        resolveCurrentProviderId({ ...DEFAULT_SETTINGS, service: 'gemini', providerId: 'kimi' }) === 'gemini',
        resolveCurrentProviderId({ ...DEFAULT_SETTINGS, service: 'gemini', providerId: 'kimi' })
      );
      check(
        '9.7 当前在免费通道时，当前厂牌是 google-free（providerId 只是上次用过的那家）',
        resolveCurrentProviderId({ ...DEFAULT_SETTINGS, service: 'google', providerId: 'deepseek' }) === 'google-free',
        resolveCurrentProviderId({ ...DEFAULT_SETTINGS, service: 'google', providerId: 'deepseek' })
      );
      check(
        '9.7 免费通道下 providerId 那家**不会**被误当作当前厂牌排除',
        JSON.stringify(
          resolveFallbackCandidates({
            ...DEFAULT_SETTINGS,
            service: 'google',
            providerId: 'deepseek',
            fallbackOrder: ['deepseek', 'google-free'],
            providerKeys: { deepseek: 'sk-d' }
          }).map((c) => c.providerId)
        ) === JSON.stringify(['deepseek']),
        JSON.stringify(
          resolveFallbackCandidates({
            ...DEFAULT_SETTINGS,
            service: 'google',
            providerId: 'deepseek',
            fallbackOrder: ['deepseek', 'google-free'],
            providerKeys: { deepseek: 'sk-d' }
          }).map((c) => c.providerId)
        )
      );
      check(
        '9.7 临时设置里顺序被清空（第二道防递归闸）',
        cands.every((c) => Array.isArray(c.settings.fallbackOrder) && c.settings.fallbackOrder.length === 0)
      );

      /* 全链验证：未配 Key 的 claude 一个请求都不该发 */
      const t = textsOf('D7-', 1);
      reset(route([
        ['api.openai.com', () => failRes(400, 'down')],
        ['api.anthropic.com', llmOk('C|')],
        ['api.moonshot.cn', llmOk('K|')]
      ]));
      const res = await translateSentenceBatchDetailed(
        t,
        'zh-CN',
        mk({ fallbackOrder: ['claude', 'kimi'], providerKeys: { openai: 'sk-primary', kimi: 'sk-k' } })
      );
      check('9.7 未配 Key 的 claude 没被请求', hits('api.anthropic.com').length === 0, String(hits('api.anthropic.com').length));
      check('9.7 直接落到有 Key 的 kimi', res.translations[0].startsWith('K|'), res.translations[0]);
    }

    /* 9.8 不递归：四级候选全失败 + Google 也失败 → 降级级数 = 候选数 + 1，每个厂牌只碰 1 次 */
    {
      const t = textsOf('D8-', 1);
      const order = ['deepseek', 'kimi', 'zhipu', 'gemini'];
      reset(route([
        ['api.openai.com', () => failRes(400, 'down')],
        ['api.deepseek.com', () => failRes(400, 'down')],
        ['api.moonshot.cn', () => failRes(400, 'down')],
        ['open.bigmodel.cn', () => failRes(400, 'down')],
        ['generativelanguage.googleapis.com', () => failRes(400, 'down')],
        ['translate.googleapis.com', () => failRes(429, 'down')],
        ['translate.google.com', () => failRes(429, 'down')],
        ['api.mymemory.translated.net', () => failRes(429, 'down')]
      ]));
      const res = await translateSentenceBatchDetailed(
        t,
        'zh-CN',
        mk({
          fallbackOrder: order,
          providerKeys: { openai: 'sk-primary', deepseek: 'sk-d', kimi: 'sk-k', zhipu: 'sk-z', gemini: 'sk-g' }
        })
      );
      const perProvider = {
        openai: hits('api.openai.com').length,
        deepseek: hits('api.deepseek.com').length,
        kimi: hits('api.moonshot.cn').length,
        zhipu: hits('open.bigmodel.cn').length,
        gemini: hits('generativelanguage.googleapis.com').length
      };
      check('9.8 每个厂牌最多被请求 1 次（不来回弹）', Object.values(perProvider).every((n) => n <= 1), JSON.stringify(perProvider));
      check('9.8 主通道只发 1 次（不在降级里重试主通道）', perProvider.openai === 1, JSON.stringify(perProvider));
      const levels = order.reduce((s, k) => s + (perProvider[k] > 0 ? 1 : 0), 0) + (hits('translate.googleapis.com').length > 0 ? 1 : 0);
      check('9.8 降级级数 ≤ 候选数 + 1', levels <= order.length + 1, String(levels));
      check('9.8 降级级数 = 候选数 + 1（四级 + Google 兜底都在同一条链上）', levels === order.length + 1, String(levels));
      check('9.8 全失败仍按 [降级失败: …] 收尾', res.translations.every((x) => /^\[降级失败: .+\]$/.test(x)), JSON.stringify(res.translations));
    }

    /* 9.9 一级部分成功即采用该级结果：不做失败句逐句重试（请求量不随句数放大） */
    {
      const t = textsOf('D9-', 3);
      reset(route([
        ['api.openai.com', () => failRes(400, 'down')],
        ['api.deepseek.com', (url, init, body) => {
          const items = JSON.parse(body.messages[1].content);
          return okRes({
            choices: [{ message: { content: JSON.stringify(items.slice(0, 2).map((it, i) => ({ id: i, translation: `DS|${it.text}` }))) } }]
          });
        }]
      ]));
      const res = await translateSentenceBatchDetailed(
        t,
        'zh-CN',
        mk({ fallbackOrder: ['deepseek'], providerKeys: { openai: 'sk-primary', deepseek: 'sk-d' } })
      );
      check('9.9 该级只发 1 次请求（noSentenceRetry：失败句不逐句重试）', hits('api.deepseek.com').length === 1, String(hits('api.deepseek.com').length));
      check('9.9 拿到的两句用该级译文', res.translations[0].startsWith('DS|') && res.translations[1].startsWith('DS|'), JSON.stringify(res.translations));
      check('9.9 缺条目那句按降级占位', /^\[降级失败: /.test(res.translations[2]), res.translations[2]);
      check('9.9 只有缺条目那句标失败', JSON.stringify(res.failed) === JSON.stringify([false, false, true]), JSON.stringify(res.failed));
      check('9.9 有级成功就不兜底 Google', hits('translate.googleapis.com').length === 0);
    }

    /* 9.10 缓存不分叉：降级成功的译文写回主路径缓存键，第二次 0 请求 */
    {
      const t = textsOf('D10-', 2);
      reset(route([
        ['api.openai.com', () => failRes(400, 'down')],
        ['api.deepseek.com', llmOk('DS|')]
      ]));
      const s = mk({ fallbackOrder: ['deepseek'], providerKeys: { openai: 'sk-primary', deepseek: 'sk-d' } });
      const first = await translateSentenceBatchDetailed(t, 'zh-CN', s);
      const spent = requests.length;
      const second = await translateSentenceBatchDetailed(t, 'zh-CN', s);

      check('9.10 降级成功的译文写回主路径缓存键（第二次 0 新请求）', requests.length === spent, `${spent} → ${requests.length}`);
      check('9.10 第二次直接复用同一批译文', JSON.stringify(second.translations) === JSON.stringify(first.translations), JSON.stringify(second.translations));
      check('9.10 复用时不标失败', second.failed.every((f) => !f), JSON.stringify(second.failed));
    }

    /* 9.11 当前就是 Google 免费通道：失败是「句级失败」，不是传输级抛错 → 不进入降级分支
     * （v0.4.1 就是这个语义，本轮不改：translateWithGoogle 把错误吞成逐句 errors，
     *   所以免费通道当主通道时 fallbackOrder 不会生效 —— 这是刻意保留的既有行为） */
    {
      const t = textsOf('D11-', 1);
      reset(route([
        ['translate.googleapis.com', () => failRes(429, 'down')],
        ['translate.google.com', () => failRes(429, 'down')],
        ['api.mymemory.translated.net', () => failRes(429, 'down')],
        ['api.deepseek.com', llmOk('DS|')]
      ]));
      const res = await translateSentenceBatchDetailed(
        t,
        'zh-CN',
        mk({ service: 'google', providerId: 'google-free', apiKey: '', modelName: '', fallbackOrder: [] })
      );
      check('9.11 免费通道 + 空顺序 → 不降级（保持 v0.4.1：写句级占位）', /^\[翻译失败: /.test(res.translations[0]), res.translations[0]);
      check('9.11 没去请求任何大模型厂牌', hits('api.deepseek.com').length === 0);
    }

    /* 9.12 免费通道 + order 非空：同样不降级（同上，免费通道的失败不上抛）—— 锁定这个既有语义 */
    {
      const t = textsOf('D12-', 1);
      reset(route([
        ['translate.googleapis.com', () => failRes(429, 'down')],
        ['translate.google.com', () => failRes(429, 'down')],
        ['api.mymemory.translated.net', () => failRes(429, 'down')],
        ['api.deepseek.com', llmOk('DS|')]
      ]));
      const res = await translateSentenceBatchDetailed(
        t,
        'zh-CN',
        mk({
          service: 'google',
          providerId: 'google-free',
          apiKey: '',
          modelName: '',
          fallbackOrder: ['deepseek'],
          providerKeys: { deepseek: 'sk-d' }
        })
      );
      check('9.12 免费通道当主通道时顺序不生效（既有语义，未在本轮改写）', !res.translations[0].startsWith('DS|'), res.translations[0]);
      check('9.12 顺序里的厂牌一个请求都没发', hits('api.deepseek.com').length === 0, String(hits('api.deepseek.com').length));
    }
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(`\n汇总: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  assert.fail(`失败句局部重试 / 降级链守卫有 ${failed} 项失败，详见上方 ✗ 行`);
}
console.log('\n所有测试项验证通过！');
