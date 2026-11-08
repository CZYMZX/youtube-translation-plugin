import type { AiContextSentence, ExtensionSettings, ModelOption } from '../types';
import {
  getCachedSentencesBatch,
  setCachedSentencesBatch,
  buildSentenceCacheKey
} from './db-cache';
import { findGlossaryMatches, buildGlossaryPromptBlock } from './glossary';
/* 只读消费：厂牌白名单 / 默认端点 / 默认模型都只有一份，在 utils/models.ts */
import { getProvider, resolveProviderByService } from './models';
import {
  loadCustomPacks,
  resolveScenePrompt,
  hashPrompt,
  collectGlossaryEntries,
  buildGlossaryTag,
  DEFAULT_GLOSSARY_PACKS,
  type CustomPacks
} from './packs';
import { buildPromptLayers, assemblePromptLayers } from './prompt-layers';

export interface TranslationOptions {
  bypassCache?: boolean;
  noFallback?: boolean; // 为 true 时大模型失败严禁回退到 Google 翻译，直接抛出真实错误

  /* ── 需求 7：AI 精翻续翻的「上文参考」 ──────────────────────────────
   * 只拼进 **user 消息**，不碰 system prompt 骨架、不进缓存键、不计入输出条目。
   * 为什么单独放这里而不是塞进 texts：texts 会进 buildSentenceCacheKey，
   * 一旦把上文并进待译文本，同一句在不同批次下就会算出不同的 key，缓存直接失效。
   */
  contextBefore?: AiContextSentence[];

  /* ── 降级链内部标记（v0.4.2 降级顺序）────────────────────────────
   * 两个字段都**只由降级链自己写**，外部调用方不需要也不应该传：
   * - fallbackDepth：>0 表示「本次请求已经在降级链里」，任何一层都不许再触发降级，
   *   否则 A→B→A 会来回弹（防递归的唯一闸口）。
   * - noSentenceRetry：这一级只发一次请求，不做「失败句逐句重试」，
   *   否则 3 级降级 × N 句失败会放大成 3N 次请求。
   */
  fallbackDepth?: number;
  noSentenceRetry?: boolean;
}

/* ═══════════════ 失败句局部重试（v0.4.3） ═══════════════
 * 需求原话：「检测翻译失败的语句，对其前后语句一同分析，尽量减少整轨同译，减少 token 消耗。」
 *
 * 三条口径：
 *   1) 失败判定：一次请求内某句没拿到可用译文（**条目缺失 / 译文为空 / 响应不是合法 JSON 数组**）
 *      → 该句标 failed，其余句照常落库；不因一句失败重发整批，更不整轨重译。
 *   2) 带前后文重试：失败句**单独**发一次请求，payload 里带 ±1 句邻居原文当
 *      context_before / context_after；输出契约要求「只输出 id=0 这一条」，
 *      上下文只帮模型判断指代与语气，不产出、不落库。
 *   3) 上限与退避：单句最多重试 MAX_SENTENCE_RETRIES(=2) 次；重试有总时间预算，
 *      超预算立即放弃剩余句，不阻塞翻译队列。
 *
 * 缓存口径：成功即写（内存 + IndexedDB），失败一律不写 —— 不写空值、不写占位译文，
 * 下次播放/下次批次会重新尝试。
 */

/** 单句最多重试次数（不含首轮那次），「第二次重试也失败就放弃」 */
export const MAX_SENTENCE_RETRIES = 2;
/** 一批失败句的重试总时间预算：超了就不再试，避免把队列的超时兜底拖爆 */
export const RETRY_TIME_BUDGET_MS = 8000;
/** 重试时向两侧各取 1 句原文作上下文 */
export const RETRY_CONTEXT_WINDOW = 1;

/** 重试请求项：待译句 + 前后各 1 句原文（上下文不参与产出） */
export interface RetryItem {
  text: string;
  before?: string;
  after?: string;
}

/** 模型返回的原始条目（解析后、对齐前） */
export interface RawItem {
  id: number | string;
  translation?: string;
}

/**
 * 单句补译契约：**只在重试请求里追加**，刻意不进 buildPromptSkeleton()，
 * 所以不改缓存指纹、不会让用户已翻内容失效。
 */
export const RETRY_CONTRACT = `【本次只补一句译文】
下面 JSON 数组里只有一个元素：text 是待译句，必须翻译；context_before / context_after 是它的前后各一句原文，仅用于判断指代、人称与语气 —— 不得翻译、不得输出、不得并入译文。
只输出 [{"id": 0, "translation": "..."}] 这一个元素，不要输出上下文句的译文，不要解释。`;

/* ═══════════ 续翻「上文参考」（需求 7） ═══════════
 * 用户原话：「翻译一半导致后续未翻译的句子继续进行时上下文语境问题」。
 *
 * 三条口径：
 *   1) 只进 **user 消息**：system prompt 骨架（buildPromptSkeleton）一个字不动，
 *      否则缓存指纹变、全量已有译文作废（红线）。
 *   2) 只带「紧邻上文最多 2 句」的原文 + 已有译文：够判指代与人称，token 增幅可忽略。
 *   3) 明确约束 + 条数校验：上下文句不带 id（不在 JSON 数组里），另起一段；
 *      并要求输出条数严格等于输入条目数，数量不符由既有的句级重试路径兜底。
 */
export const RESUME_CONTEXT_HEADER = '【上文参考（仅用于理解指代、人称与语气，不要翻译、不要输出）】';
export const RESUME_CONTEXT_MAX_ITEMS = 2;

/** 把上文参考拼成一段（无上下文时返回空串，让老请求体逐字节不变） */
export function buildContextBlock(contextBefore?: AiContextSentence[]): string {
  if (!Array.isArray(contextBefore) || contextBefore.length === 0) return '';
  const picked = contextBefore
    .filter((c) => c && typeof c.text === 'string' && c.text.trim())
    .slice(-RESUME_CONTEXT_MAX_ITEMS);
  if (picked.length === 0) return '';
  const lines = picked.map((c, i) => {
    const translation = typeof c.translation === 'string' ? c.translation.trim() : '';
    return translation
      ? `${i + 1}. 原文：${c.text} / 已有译文：${translation}`
      : `${i + 1}. 原文：${c.text}`;
  });
  return `${RESUME_CONTEXT_HEADER}
${lines.join('\n')}
以上仅作参考：不要翻译、不要输出、不要计入输出条目；只输出下面 JSON 数组中每一条的译文，输出条数必须与输入条目数严格一致，id 从 0 连续编号。`;
}

/** 端点级故障特征：命中就停止剩余重试（单句重试不会有不同结果，只会白烧 token） */
const TRANSPORT_ERROR_PATTERN = /HTTP\s*\d{3}|超时|timeout|Failed to fetch|NetworkError|Load failed|无法连接|socket|ECONN|ETIMEDOUT/i;

export interface RetryCallOptions {
  /** 本批原文（按顺序）——失败句与上下文的唯一来源 */
  texts: string[];
  /** 首轮失败的句下标（相对 texts） */
  failedIdx: number[];
  /** 单次往返：返回该句译文；返回空串 / null 视为失败；抛出视为请求失败 */
  requestSingle: (item: RetryItem) => Promise<string | null>;
  maxRetries?: number;
  budgetMs?: number;
  /** 测试可注入空实现跳过退避等待 */
  sleep?: (ms: number) => Promise<void>;
  onTransportAbort?: (reason: string) => void;
}

export interface RetryOutcome {
  /** idx → 成功的译文（只有这些能落库/写缓存） */
  filled: Map<number, string>;
  /** 2 次重试后仍失败的下标 */
  gaveUp: number[];
  /** 本轮实际额外发出的请求数（全批成功时应为 0） */
  requests: number;
  /** 是否因端点级故障提前停止 */
  aborted: boolean;
}

/**
 * 取失败句的上下文：两侧各 window 句（默认 1）。批首/批尾只有单侧，按实际存在的句子给。
 * 只读 texts（本批原文），不引入任何额外网络信息。
 */
export function buildRetryItem(texts: string[], idx: number, window = RETRY_CONTEXT_WINDOW): RetryItem {
  const item: RetryItem = { text: texts[idx] ?? '' };
  const before = texts.slice(Math.max(0, idx - window), idx).filter((t) => !!t && !!t.trim());
  const after = texts.slice(idx + 1, Math.min(texts.length, idx + 1 + window)).filter((t) => !!t && !!t.trim());
  if (before.length > 0) item.before = before.join(' / ');
  if (after.length > 0) item.after = after.join(' / ');
  return item;
}

/**
 * 按 id 把模型返回的条目对齐到「待译句槽位」。
 * 纪律：**只认 0..count-1 的 id**，越界 id、重复 id（后者覆盖前者之外的一律忽略）都进不了槽位；
 * 缺条目 / 译文为空 → null（= 失败），由上层决定重试还是放弃。
 */
export function mapRawItemsToSlots(raw: RawItem[], count: number): Array<string | null> {
  const byId = new Map<number, string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const id = Number(item?.id);
    if (!Number.isInteger(id) || id < 0) continue;
    const value = typeof item?.translation === 'string' ? item.translation.trim() : '';
    if (value) byId.set(id, value);
  }
  const slots: Array<string | null> = [];
  for (let i = 0; i < count; i++) slots.push(byId.get(i) ?? null);
  return slots;
}

/**
 * 解析单句补译的返回。**防串写的第一道闸**：
 * 必须恰好一条 id=0；模型把上下文句也翻译出来（id=1/2）一律忽略，
 * 吐出多条 id=0（无法判断哪条对应失败句）直接判失败，宁可再试也不猜。
 */
export function parseRetrySingle(raw: RawItem[] | null): string | null {
  if (!Array.isArray(raw)) return null;
  const hits = raw.filter((it) => it && Number(it.id) === 0);
  if (hits.length !== 1) return null;
  const value = typeof hits[0].translation === 'string' ? hits[0].translation.trim() : '';
  return value || null;
}

/**
 * 失败句局部重试调度：逐句单发（带上下文），最多 maxRetries 轮，带退避与总时间预算。
 * 全批成功时不会走到这里 ⇒ 零额外请求。
 */
export async function retryFailedSentences(opts: RetryCallOptions): Promise<RetryOutcome> {
  const maxRetries = opts.maxRetries ?? MAX_SENTENCE_RETRIES;
  const budgetMs = opts.budgetMs ?? RETRY_TIME_BUDGET_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const startedAt = Date.now();
  const filled = new Map<number, string>();
  let requests = 0;
  let aborted = false;
  let pending = [...new Set(opts.failedIdx)].filter((i) => i >= 0 && i < opts.texts.length);

  for (let round = 1; round <= maxRetries && pending.length > 0; round++) {
    const stillFailed: number[] = [];

    for (let k = 0; k < pending.length; k++) {
      const idx = pending[k];
      // 时间预算耗尽：剩余句直接放弃，不拖住队列（下轮循环开头也会命中同一个判断）
      if (Date.now() - startedAt > budgetMs) {
        stillFailed.push(idx);
        continue;
      }
      requests++;
      try {
        const value = await opts.requestSingle(buildRetryItem(opts.texts, idx));
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (trimmed) {
          filled.set(idx, trimmed);
          continue;
        }
        stillFailed.push(idx);
      } catch (err: any) {
        const reason = err?.message || String(err);
        if (TRANSPORT_ERROR_PATTERN.test(reason)) {
          // 端点级故障：单句重试不会有不同结果，立即停手（避免 N 句 × 2 轮的空请求）
          aborted = true;
          opts.onTransportAbort?.(reason);
          stillFailed.push(...pending.slice(k));
          break;
        }
        stillFailed.push(idx);
      }
    }

    pending = [...new Set(stillFailed)];
    if (aborted) break;
    if (pending.length > 0 && round < maxRetries) await sleep(250 * Math.pow(2, round - 1));
  }

  return { filled, gaveUp: pending, requests, aborted };
}

/**
 * 翻译结果内存缓存
 * key 实际形态（v0.4.2 起，与 db-cache.buildSentenceCacheKey 同源）：
 * `${service}:${model}:${s2.scenarioId#promptHash}:${reasoning}:${targetLang}:${text}[:${glossaryTag}]`
 * - `s2.scenarioId#promptHash`：场景 id + **整段静态 system prompt 指纹**（场景包 + 公共层 +
 *   选项层 + 推理档位 + 输出契约），改任意一层文案、或切换 glossaryAnnotation / asrCorrection
 *   都会让旧译文自动失效；
 * - `glossaryTag`：术语库版本 / 启用包 / 自定义包指纹，术语变更后旧译文自动失效。
 *
 * 指纹口径演进：
 * - s1（v0.2.9，无前缀）：只 hash 场景包 prompt → 公共层文案改了不会失效（本次修的就是这个）；
 * - s2（v0.4.2）：hash 整段静态骨架 → 公共层 / 选项层改动同样失效。
 * 骨架**不含**按批变化的术语块（只注入本批命中条目），否则同一句在不同批次会算出不同的键。
 */
const translationCache = new Map<string, string>();

/** v0.2.9：自定义术语库 / 场景包（chrome.storage.local），10 秒 TTL 缓存 */
let activeCustomPacks: CustomPacks = { glossaries: [], scenes: [] };
let packsLoadedAt = 0;

async function refreshPacksIfStale(force = false): Promise<void> {
  if (!force && Date.now() - packsLoadedAt < 10000) return;
  try {
    activeCustomPacks = await loadCustomPacks();
    packsLoadedAt = Date.now();
  } catch {
    activeCustomPacks = { glossaries: [], scenes: [] };
  }
}

/**
 * v0.4.1：术语库缓存标记 —— 由 utils/packs.ts#buildGlossaryTag() 提供，按**内容指纹**判定
 * （内置包各自内容 hash + 自定义包 `id:内容hash`）。签名与调用点不变，
 * 只把实现搬进 packs.ts，好让它和包数据放在一起、可被 test-packs.js 直接断言。
 */
function getGlossaryTag(settings: ExtensionSettings): string {
  if (settings.glossaryEnabled === false) return '';
  return buildGlossaryTag(settings.glossaryPacks, activeCustomPacks);
}

/**
 * 场景标签（参与缓存键）：`s2.{场景id}#{整段静态 prompt 指纹}`
 *
 * v0.4.2：指纹从「只覆盖场景包 prompt」改为「覆盖整段静态骨架」，见 buildPromptSkeleton()。
 * 不覆盖的部分只有按批变化的术语块 —— 它由 findGlossaryMatches 逐批决定，
 * 若纳入指纹会导致同一句在不同批次算出不同键、缓存永久不命中。
 */
export function buildScenarioTag(settings: ExtensionSettings, targetLang: string): string {
  const scenarioId = settings.scenario || 'vtuber';
  return `s2.${scenarioId}#${hashPrompt(buildPromptSkeleton(settings, targetLang))}`;
}

function getCacheKey(
  targetLang: string,
  text: string,
  scenario = 'general',
  reasoning = 'low',
  service = 'google',
  modelName = '',
  glossaryTag = ''
): string {
  return buildSentenceCacheKey(targetLang, text, scenario, reasoning, service, modelName, glossaryTag);
}

interface BatchPlan {
  results: Array<string | null>;
  uncachedIndices: number[];
  uncachedTexts: string[];
}

/**
 * 统一的“先查内存缓存 → 收集未命中”逻辑，避免三个翻译通道各写一遍
 */
function planBatch(
  texts: string[],
  targetLang: string,
  settings: ExtensionSettings,
  bypassCache: boolean
): BatchPlan {
  const {
    scenario = 'general',
    reasoningEffort = 'low',
    service = 'google',
    modelName = ''
  } = settings;
  const glossaryTag = getGlossaryTag(settings);

  const results: Array<string | null> = bypassCache
    ? texts.map(() => null)
    : texts.map(
        (t) =>
          translationCache.get(
            getCacheKey(targetLang, t, buildScenarioTag(settings, targetLang), reasoningEffort, service, modelName, glossaryTag)
          ) ?? null
      );

  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (results[i] === null) {
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i]);
    }
  }
  return { results, uncachedIndices, uncachedTexts };
}

/**
 * 统一的“回填未命中结果 + 写回内存缓存”逻辑
 *
 * v0.4.3：freshTranslations 允许 null（= 该句最终失败）。
 * 失败项**不写缓存、也不拿原文顶替**，保持「失败」与「已译」在数据上可区分。
 */
function commitBatch(
  plan: BatchPlan,
  freshTranslations: Array<string | null>,
  texts: string[],
  targetLang: string,
  settings: ExtensionSettings,
  bypassCache: boolean
): Array<string | null> {
  const {
    scenario = 'general',
    reasoningEffort = 'low',
    service = 'google',
    modelName = ''
  } = settings;
  const glossaryTag = getGlossaryTag(settings);

  for (let i = 0; i < plan.uncachedTexts.length; i++) {
    const originalText = plan.uncachedTexts[i];
    const trans = freshTranslations[i] || null;
    plan.results[plan.uncachedIndices[i]] = trans;
    if (trans && !bypassCache) {
      translationCache.set(
        getCacheKey(targetLang, originalText, buildScenarioTag(settings, targetLang), reasoningEffort, service, modelName, glossaryTag),
        trans
      );
    }
  }

  return plan.results.slice();
}

/**
 * 一个翻译通道的返回：与输入等长的槽位（null = 该句最终失败，不得落库 / 写缓存）
 */
export interface SliceResult {
  /** 与输入 texts 等长；null = 失败 */
  translations: Array<string | null>;
  /** 与输入 texts 等长；失败原因（诊断用，成功为 null） */
  errors: Array<string | null>;
  /** 本批额外发出的重试请求数（全批成功 = 0） */
  retryRequests: number;
  /** 失败句下标（相对输入 texts） */
  failedIdx: number[];
}

/**
 * 通道收尾：回填 + 只缓存成功项 + 汇总失败掩码。
 * errors 按 uncached 顺序传入，这里换算成输入下标，避免调用方再拼一次。
 */
function finishSlice(
  plan: BatchPlan,
  fresh: Array<string | null>,
  errors: Array<string | null>,
  texts: string[],
  targetLang: string,
  settings: ExtensionSettings,
  bypassCache: boolean,
  retryRequests: number
): SliceResult {
  const merged = commitBatch(plan, fresh, texts, targetLang, settings, bypassCache);

  const errorsGlobal: Array<string | null> = texts.map(() => null);
  for (let i = 0; i < plan.uncachedIndices.length; i++) {
    errorsGlobal[plan.uncachedIndices[i]] = errors[i] ?? null;
  }

  const failedIdx: number[] = [];
  merged.forEach((value, i) => {
    if (!value) failedIdx.push(i);
  });

  return { translations: merged, errors: errorsGlobal, retryRequests, failedIdx };
}

/**
 * 带指数退避与随机抖动 (Jitter) 的重试包装器
 */
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      if (attempt > maxRetries) {
        throw err;
      }
      const isRateLimit =
        err?.message?.includes('429') ||
        err?.message?.includes('rate limit') ||
        err?.message?.includes('RESOURCE_EXHAUSTED');
      // 遇 429 或限流加大等待时间，其他网络问题短暂重试
      const baseDelay = isRateLimit ? 1500 : 800;
      const delay = Math.round(baseDelay * Math.pow(1.5, attempt) + Math.random() * 400);
      console.warn(
        `[Translator] 请求遇到波动，准备重试 (${attempt}/${maxRetries}, 退避等待 ${delay}ms):`,
        err?.message
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/* ═══════════════════ 提示词装配（v0.4.2 分层 · 任务二提到 prompt-layers） ═══════════════════
 * 每层文案与「层模型」统一在 utils/prompt-layers.ts（纯函数、零副作用，设置页可直接调用）；
 * 本文件只做装配与请求，不再自己拼文案 —— 一处定义、两处消费，界面看到的与真正发出的同源。
 *
 * 层顺序（= 注入顺序）：scene → common → annotation → asr → reasoning →（glossary）→ output
 *   1) 场景层：场景包 prompt（内置 vtuber/general，或用户上传的自定义场景）
 *   2) 公共层：COMMON_RULES —— 所有场景无条件继承（含自定义场景），因此**不能**写在场景包里
 *   3) 选项层：glossaryAnnotation（专名括注）、asrCorrection（ASR 纠错授权）
 *   4) 推理层：reasoningEffort 档位
 *   + 术语块：按批变化（只注入本批命中条目），拼在骨架中间，**不进指纹**
 * 1~4 层 + 输出契约构成「静态骨架」，整体参与缓存指纹（buildScenarioTag）。
 */

/** 层文案定义在 prompt-layers.ts，此处原样转发，既有 import 路径与语义不变 */
export {
  COMMON_RULES,
  buildAnnotationRule,
  buildAsrRule,
  buildReasoningGuidance
} from './prompt-layers';

/**
 * 纯装配函数：persona（场景文案）+ 公共层 + 选项层 + 推理层 +（术语块）+ 输出契约。
 *
 * 任务二起不再自己拼文案：层内容与顺序都由 utils/prompt-layers.ts 定义，
 * 这里是 `buildPromptLayers → assemblePromptLayers` 的一行组合（一处定义、两处消费）。
 * 导出是为了让测试能直接喂「自定义场景文案」验证公共层确实被继承（不依赖 chrome 存储）。
 * **输出与改造前逐字节一致**（见 test/test-prompt-layers.js 的等价性断言）。
 */
export function composeSystemPrompt(
  persona: string,
  settings: ExtensionSettings,
  targetLang: string,
  glossaryBlock = ''
): string {
  return assemblePromptLayers(buildPromptLayers(persona, settings, targetLang, glossaryBlock));
}

/**
 * 静态骨架（= buildSystemPrompt 去掉按批变化的术语块）：缓存指纹的唯一输入。
 * 公共层 / 选项层 / 推理层 / 输出契约改一个字，这里就变，旧译文随之失效。
 */
export function buildPromptSkeleton(settings: ExtensionSettings, targetLang: string): string {
  const persona = resolveScenePrompt(settings.scenario || 'vtuber', activeCustomPacks).prompt;
  return composeSystemPrompt(persona, settings, targetLang);
}

/**
 * 构造完整的 System Prompt（骨架 + 本批命中的术语块）
 */
function buildSystemPrompt(settings: ExtensionSettings, targetLang: string, texts: string[] = []): string {
  const persona = resolveScenePrompt(settings.scenario || 'vtuber', activeCustomPacks).prompt;

  // v0.2.8 术语库：仅注入本批文本实际命中的术语，控制 prompt 体积
  // v0.2.9：按用户启用的术语库包（内置 + 上传）汇总匹配
  const glossaryBlock =
    settings.glossaryEnabled !== false
      ? buildGlossaryPromptBlock(
          findGlossaryMatches(
            texts,
            40,
            collectGlossaryEntries(settings.glossaryPacks || DEFAULT_GLOSSARY_PACKS, activeCustomPacks)
          )
        )
      : '';

  return composeSystemPrompt(persona, settings, targetLang, glossaryBlock);
}

/**
 * 带超时的 fetch 包装
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`请求超时 (${timeoutMs}ms)`);
    }
    throw err;
  }
}

/**
 * 多端点 Google 翻译，支持自动降级
 */
async function translateWithGoogleEndpoints(text: string, targetLang: string): Promise<string> {
  const endpoints = [
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`,
    `https://translate.google.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`
  ];

  let lastError: any = null;
  for (const url of endpoints) {
    try {
      const response = await fetchWithTimeout(url, {}, 5000);
      if (!response.ok) continue;
      const data = await response.json();
      let trans = '';
      if (Array.isArray(data) && Array.isArray(data[0])) {
        for (const seg of data[0]) {
          if (seg && seg[0]) trans += seg[0];
        }
      }
      if (trans.trim()) {
        return trans.trim();
      }
    } catch (err) {
      lastError = err;
    }
  }

  // 备用兜底：MyMemory 免费公开翻译 API
  try {
    const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${encodeURIComponent(targetLang)}`;
    const response = await fetchWithTimeout(myMemoryUrl, {}, 5000);
    if (response.ok) {
      const data = await response.json();
      if (data?.responseData?.translatedText) {
        return data.responseData.translatedText;
      }
    }
  } catch (err) {
    // 忽略备用错误
  }

  throw lastError || new Error('所有免费翻译服务均无法访问，可能受当前网络环境限制');
}

/**
 * 批量使用 Google 翻译
 *
 * v0.4.3：失败项不再写占位符进缓存（旧实现会把 `[翻译失败: …]` 当译文缓存，导致下次播放
 * 直接命中一条假译文）。合并请求失败 → 逐句单发一次 → 仍失败的进「失败句局部重试」。
 * 注意：Google 通道没有 system prompt，重试时**用不上**前后文（那只是省 token 的 LLM 手段）。
 */
async function translateWithGoogle(
  texts: string[],
  targetLang: string,
  settings: ExtensionSettings,
  options?: TranslationOptions
): Promise<SliceResult> {
  const bypassCache = !!options?.bypassCache;
  const plan = planBatch(texts, targetLang, settings, bypassCache);
  const uncachedTexts = plan.uncachedTexts;

  if (uncachedTexts.length === 0) {
    return {
      translations: plan.results.slice(),
      errors: texts.map(() => null),
      retryRequests: 0,
      failedIdx: []
    };
  }

  const fresh: Array<string | null> = new Array(uncachedTexts.length).fill(null);
  const errors: Array<string | null> = new Array(uncachedTexts.length).fill(null);
  const batchSize = 8;

  for (let i = 0; i < uncachedTexts.length; i += batchSize) {
    const chunkTexts = uncachedTexts.slice(i, i + batchSize);

    const combinedText = chunkTexts.join('\n');
    let batchSuccess = false;

    try {
      const transCombined = await translateWithGoogleEndpoints(combinedText, targetLang);
      const lines = transCombined.split('\n').map((l) => l.trim()).filter(Boolean);

      if (lines.length === chunkTexts.length) {
        for (let j = 0; j < chunkTexts.length; j++) {
          fresh[i + j] = lines[j];
        }
        batchSuccess = true;
      }
    } catch (e) {
      // 降级为单句
    }

    if (!batchSuccess) {
      await Promise.all(
        chunkTexts.map(async (text, subIdx) => {
          try {
            fresh[i + subIdx] = await translateWithGoogleEndpoints(text, targetLang);
          } catch (err: any) {
            console.error('[YT-Sub-Translator] Single translate failed:', err);
            errors[i + subIdx] = err?.message || '网络连接超时';
          }
        })
      );
    }
  }

  const failedIdx = fresh.map((t, i) => (t ? -1 : i)).filter((i) => i >= 0);
  let retryRequests = 0;
  /* 降级链里的一级只发一次请求（noSentenceRetry）：失败直接进下一级，不在这里对整批做二次重试 */
  if (failedIdx.length > 0 && !options?.noSentenceRetry) {
    const outcome = await retryFailedSentences({
      texts: uncachedTexts,
      failedIdx,
      // 无 prompt 通道：上下文不参与请求，只借用「最多 2 次 + 退避 + 时间预算」这套上限
      requestSingle: (item) => translateWithGoogleEndpoints(item.text, targetLang),
      onTransportAbort: (reason) =>
        console.warn('[Translator] Google 单句重试遇到端点级故障，停止剩余重试:', reason)
    });
    retryRequests = outcome.requests;
    for (const [idx, value] of outcome.filled) {
      fresh[idx] = value;
      errors[idx] = null;
    }
    for (const idx of outcome.gaveUp) {
      errors[idx] = errors[idx] || '重试 2 次仍失败';
    }
  }

  return finishSlice(plan, fresh, errors, texts, targetLang, settings, bypassCache, retryRequests);
}

/* ── LLM 通道：单次往返的「原始调用」+ 通用的「首轮整批 → 失败句局部重试」编排 ──
 *
 * 拆成两层是为了把「怎么发一次请求」和「失败后怎么补」解耦：
 *   - 原始调用（callOpenAiRaw / callGeminiRaw）：只管一次往返，返回解析后的原始条目；
 *     响应拿到但不是合法 JSON 数组 → 返回 null（句级失败），网络/HTTP 故障 → 抛错（传输级失败）。
 *   - 通用编排（translateWithLlmChannel）：首轮整批一次 → 句级失败逐句带前后文重试 → 收尾落库。
 * 这样「批内 1 句缺失」「重试 2 次仍失败」「全批成功」三条路径都能用假通道单测（test/test-retry.js）。
 */

/** 一次 LLM 往返需要的上下文（不进缓存指纹，只决定这一次请求的 prompt 与 payload） */
export interface LlmCallContext {
  targetLang: string;
  settings: ExtensionSettings;
  /** 本次要译的句子（术语块只按这些句子匹配；上下文句不参与产出，也不参与术语匹配） */
  translatable: string[];
  /** 追加在输出契约之后的临时指令（目前只有单句补译契约 RETRY_CONTRACT） */
  extraInstruction?: string;
  /** 续翻时紧邻上文的原文+已有译文（只进 user 消息，不进 system prompt、不进缓存键） */
  contextBefore?: AiContextSentence[];
}

/** 通道签名：返回解析后的原始条目；响应拿到但不是合法 JSON 数组 → null（= 句级失败） */
export type LlmChannel = (items: RetryItem[], ctx: LlmCallContext) => Promise<RawItem[] | null>;

/** 从模型输出里抠出 JSON 数组；抠不出 → null（交给局部重试，不整批重发） */
function parseModelJsonArray(rawContent: string): RawItem[] | null {
  if (!rawContent || !rawContent.trim()) return null;
  const cleaned = rawContent.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try {
    const match = cleaned.match(/\[[\s\S]*\]/);
    const parsed = match ? JSON.parse(match[0]) : JSON.parse(cleaned);
    return Array.isArray(parsed) ? (parsed as RawItem[]) : null;
  } catch {
    return null;
  }
}

/** 把「待译句 + 上下文」拼成 payload 条目：首轮无上下文，重试才带 context_before / context_after */
function buildPayloadItems(items: RetryItem[]): Array<Record<string, unknown>> {
  return items.map((item, id) => {
    const row: Record<string, unknown> = { id, text: item.text };
    if (item.before) row.context_before = item.before;
    if (item.after) row.context_after = item.after;
    return row;
  });
}

/** 单句补译契约只追加在这里：不改 buildPromptSkeleton() ⇒ 缓存指纹不变、老译文不失效 */
function composeLlmSystemPrompt(ctx: LlmCallContext): string {
  const base = buildSystemPrompt(ctx.settings, ctx.targetLang, ctx.translatable);
  return ctx.extraInstruction ? `${base}\n\n${ctx.extraInstruction}` : base;
}

/**
 * OpenAI / DeepSeek 等兼容接口：一次往返
 */
async function callOpenAiRaw(items: RetryItem[], ctx: LlmCallContext): Promise<RawItem[] | null> {
  const { apiKey, apiBaseUrl, service, modelName, reasoningEffort = 'low' } = ctx.settings;
  if (!apiKey) {
    throw new Error('未配置 API Key，请在插件设置中填入');
  }

  let baseUrl = apiBaseUrl?.trim();
  if (!baseUrl) {
    if (service === 'deepseek') {
      baseUrl = 'https://api.deepseek.com/v1';
    } else {
      baseUrl = 'https://api.openai.com/v1';
    }
  }
  baseUrl = baseUrl.replace(/\/+$/, '');
  const endpoint = baseUrl.endsWith('/chat/completions')
    ? baseUrl
    : `${baseUrl}/chat/completions`;

  /* 兜底型号跟 utils/models.ts 的预设首项保持一致：用已下架的型号兜底等于必然 404 */
  const model = modelName?.trim() || (service === 'deepseek' ? 'deepseek-flash' : 'gpt-6.1-sol');

  const payloadItems = buildPayloadItems(items);
  const systemPrompt = composeLlmSystemPrompt(ctx);
  // 上文参考只拼进 user 消息；无上下文时与原请求体逐字节一致
  const contextBlock = buildContextBlock(ctx.contextBefore);
  const userContent = contextBlock
    ? `${contextBlock}\n\n待翻译内容：\n${JSON.stringify(payloadItems)}`
    : JSON.stringify(payloadItems);

  const requestBody: any = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature: 0.3
  };

  // 若模型是支持 reasoning_effort 的专用推理模型 (如 o1, o3-mini)
  if (model.includes('o1') || model.includes('o3') || model.includes('reasoner')) {
    if (reasoningEffort === 'high' || reasoningEffort === 'low') {
      requestBody.reasoning_effort = reasoningEffort;
    }
  }

  let response: Response;
  try {
    response = await callWithRetry(async () => {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody)
        },
        20000
      );
      if (res.status === 429 || res.status >= 500) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      return res;
    }, 2);
  } catch (netErr: any) {
    const rawMsg = netErr.message || '网络连接异常';
    if (rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError') || rawMsg.includes('Load failed')) {
      throw new Error(`无法连接到代理端点 (${endpoint})，请检查自用代理是否已启动、端口与局域网网络连通性`);
    }
    throw new Error(`连接代理端点超时或中断 (${endpoint}): ${rawMsg}`);
  }

  if (!response.ok) {
    const errText = await response.text();
    let detailMsg = errText;
    try {
      const errJson = JSON.parse(errText);
      detailMsg = errJson.error?.message || errJson.message || errText;
    } catch {}
    throw new Error(`代理端点响应错误 (HTTP ${response.status}): ${detailMsg}`);
  }

  const data = await response.json();
  return parseModelJsonArray(data.choices?.[0]?.message?.content || '');
}

/**
 * LLM 通用编排：首轮整批一次 → 句级失败逐句带前后文重试（≤2 次）→ 只落库/缓存成功项。
 *
 * 为什么首轮出问题不整批重发：整批重放等于把已经成功的句子再付一次 token，而句级失败通常只有 0~1 句；
 * 逐句带上下文单发，输入是「骨架 + 3 句原文」，输出只有 1 句，cost 与失败句数成正比、与批大小无关。
 * 传输级故障（网络 / HTTP）不上抛给这里重放：callWithRetry 已在网络层退避重试过，
 * 内容层再重放整批只会放大消耗，交回 translateSentenceBatch 既有的降级 / 报错路径。
 */
export async function translateWithLlmChannel(
  texts: string[],
  targetLang: string,
  settings: ExtensionSettings,
  options: TranslationOptions | undefined,
  channel: LlmChannel
): Promise<SliceResult> {
  const bypassCache = !!options?.bypassCache;
  const plan = planBatch(texts, targetLang, settings, bypassCache);
  const uncachedTexts = plan.uncachedTexts;

  if (uncachedTexts.length === 0) {
    return {
      translations: plan.results.slice(),
      errors: texts.map(() => null),
      retryRequests: 0,
      failedIdx: []
    };
  }

  const fresh: Array<string | null> = new Array(uncachedTexts.length).fill(null);
  const errors: Array<string | null> = new Array(uncachedTexts.length).fill(null);

  // 首轮：一次请求送全部未命中句（与旧行为一致，不额外加请求）
  // 续翻场景把「上文参考」随首轮一起送；重试路径仍走自己的 context_before/after
  const raw = await channel(
    uncachedTexts.map((text) => ({ text })),
    {
      targetLang,
      settings,
      translatable: uncachedTexts,
      contextBefore: options?.contextBefore
    }
  );

  if (raw === null) {
    // 响应拿到但不是合法 JSON 数组：整批按句级失败处理，落在下面的逐句重试里
    uncachedTexts.forEach((_, i) => {
      errors[i] = '响应不是合法 JSON 数组';
    });
    console.warn('[Translator] 模型响应无法解析为 JSON 数组，转入失败句逐句重试');
  } else {
    const slots = mapRawItemsToSlots(raw, uncachedTexts.length);
    // 条数校验：有上文参考时模型更容易「顺手把上下文也翻了」，
    // 结果就是条目数/槽位对不上 —— 缺槽位一律走既有逐句重试，不猜、不补位。
    const filled = slots.filter((t) => !!t).length;
    if (filled < uncachedTexts.length) {
      console.warn(
        `[Translator] 本批 ${uncachedTexts.length} 句只拿到 ${filled} 条可用译文` +
          (options?.contextBefore?.length ? '（疑似上文参考被误译或条目缺失）' : '（条目缺失）') +
          /* 降级链里的这一级不做逐句重试：日志别写成「转入逐句重试」，否则排障时会被误导 */
          (options?.noSentenceRetry ? '，降级链内不重试（失败即进下一级）' : '，转入逐句重试')
      );
    }
    for (let i = 0; i < uncachedTexts.length; i++) {
      fresh[i] = slots[i];
      if (!slots[i]) errors[i] = '返回条目缺失或译文为空';
    }
  }

  const failedIdx = fresh.map((t, i) => (t ? -1 : i)).filter((i) => i >= 0);
  let retryRequests = 0;

  /* 降级链里的一级只发一次请求（noSentenceRetry）：失败直接进下一级，不做逐句重试 */
  if (failedIdx.length > 0 && !options?.noSentenceRetry) {
    console.log(`[Translator] 批内 ${failedIdx.length}/${uncachedTexts.length} 句未拿到译文，开始带前后文逐句重试`);
    const outcome = await retryFailedSentences({
      texts: uncachedTexts,
      failedIdx,
      requestSingle: async (item) => {
        const retryRaw = await channel([item], {
          targetLang,
          settings,
          // 术语只按待译句匹配：上下文句不产出，没必要为它注入术语
          translatable: [item.text],
          extraInstruction: RETRY_CONTRACT
        });
        return parseRetrySingle(retryRaw);
      },
      onTransportAbort: (reason) =>
        console.warn('[Translator] 单句重试遇到端点级故障，停止剩余重试:', reason)
    });

    retryRequests = outcome.requests;
    for (const [idx, value] of outcome.filled) {
      fresh[idx] = value;
      errors[idx] = null;
    }
    for (const idx of outcome.gaveUp) {
      errors[idx] = errors[idx] || '重试 2 次仍失败';
    }
  }

  return finishSlice(plan, fresh, errors, texts, targetLang, settings, bypassCache, retryRequests);
}

/**
 * OpenAI / DeepSeek 等兼容接口批量翻译
 */
async function translateWithOpenAICompatible(
  texts: string[],
  targetLang: string,
  settings: ExtensionSettings,
  options?: TranslationOptions
): Promise<SliceResult> {
  return translateWithLlmChannel(texts, targetLang, settings, options, callOpenAiRaw);
}

/**
 * Gemini API：一次往返
 */
async function callGeminiRaw(items: RetryItem[], ctx: LlmCallContext): Promise<RawItem[] | null> {
  const { apiKey, modelName } = ctx.settings;
  if (!apiKey) {
    throw new Error('未配置 Gemini API Key，请在插件设置中填入');
  }

  const model = modelName?.trim() || 'gemini-3.8-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payloadItems = buildPayloadItems(items);
  const systemPrompt = composeLlmSystemPrompt(ctx);
  const contextBlock = buildContextBlock(ctx.contextBefore);

  const fullPrompt = contextBlock
    ? `${systemPrompt}

${contextBlock}

待翻译内容：
${JSON.stringify(payloadItems)}`
    : `${systemPrompt}

待翻译内容：
${JSON.stringify(payloadItems)}`;

  let response: Response;
  try {
    response = await callWithRetry(async () => {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json'
            }
          })
        },
        20000
      );
      if (res.status === 429 || res.status >= 500) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      return res;
    }, 2);
  } catch (netErr: any) {
    const rawMsg = netErr.message || '网络连接异常';
    if (rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError')) {
      throw new Error(`无法直连 Google Gemini API 官方端点，请检查网络代理环境是否能正常访问 Google 服务`);
    }
    throw new Error(`请求 Gemini API 超时或中断: ${rawMsg}`);
  }

  if (!response.ok) {
    const errText = await response.text();
    let detailMsg = errText;
    try {
      const errJson = JSON.parse(errText);
      detailMsg = errJson.error?.message || errText;
    } catch {}
    throw new Error(`Gemini API 响应错误 (HTTP ${response.status}): ${detailMsg}`);
  }

  const data = await response.json();
  return parseModelJsonArray(data.candidates?.[0]?.content?.parts?.[0]?.text || '');
}

/**
 * Gemini API 翻译
 */
async function translateWithGemini(
  texts: string[],
  targetLang: string,
  settings: ExtensionSettings,
  options?: TranslationOptions
): Promise<SliceResult> {
  return translateWithLlmChannel(texts, targetLang, settings, options, callGeminiRaw);
}

/* ═══════════════ 逐级降级链（v0.4.2 · 降级顺序） ═══════════════
 * 需求原话：「默认保持现有行为，即用户未主动选择时可直接降级至谷歌免费翻译；
 * 开启自动降级后允许用户为已配置的厂牌设置优先级顺序」。
 *
 * 语义（`settings.fallbackOrder`，providerId 数组，顺序即优先级）：
 *   - `[]`（默认）→ 与 v0.4.1 **完全一致**：主通道失败直接降级 Google 免费；
 *   - 非空 → 按用户顺序逐级尝试，每级用**该厂牌自己的 Key / 端点 / 模型**译同一批文本；
 *     全部失败后再落 Google 免费；Google 也失败才写 `[降级失败: …]`。
 *
 * 三条纪律（均有单测）：
 *   1) **不递归**：链内调用带 `fallbackDepth > 0`，任何一层都不许再触发降级；
 *   2) **不放大请求**：每级只发一次请求（`noSentenceRetry`），失败直接进下一级 ——
 *      与「端点级故障只发 1 次就停手」同一个判定口径，别让 3 级降级变成 3×N 次请求；
 *   3) **缓存不分叉**：降级成功的译文仍由主路径的 cacheKeys 写回（同一 targetLang +
 *      同一场景指纹），不存在「降级专用」的第二份缓存。
 */

/** 请求层真正支持的协议出口；PROVIDERS 里若出现新协议而这里没跟上，就跳过该级（防御） */
const SUPPORTED_CHANNEL_SERVICES: readonly string[] = ['google', 'gemini', 'openai', 'deepseek'];

/** 一级降级候选：厂牌 + 该级要用的临时设置 */
export interface FallbackCandidate {
  providerId: string;
  service: ExtensionSettings['service'];
  /** 临时设置：只换 service / providerId / apiKey / apiBaseUrl / modelName，其余（场景、语言…）沿用主设置 */
  settings: ExtensionSettings;
}

/**
 * 「当前正在用的厂牌」：与 sanitizeSettings 的落位口径一致。降级链要把这一级排除掉 ——
 * 让刚失败的那个厂牌再试一遍同一批文本没有意义。
 *
 * 两处容易搞错的地方：
 * - `service === 'google'` 时**当前通道就是免费通道**（`google-free`），此时 `providerId`
 *   只是「上次用过的那个厂牌」（sanitizeSettings 在免费通道下不覆盖它），不能当当前厂牌排除；
 * - 其余情况 providerId 与 service 对不上（弹窗只改了 service / 老数据）就按 service 主厂牌落位。
 */
export function resolveCurrentProviderId(settings: ExtensionSettings): string {
  const service = settings.service || 'google';
  if (service === 'google') return resolveProviderByService('google').id;
  const provider = getProvider(typeof settings.providerId === 'string' ? settings.providerId : '');
  if (provider && provider.service === service) return provider.id;
  return resolveProviderByService(service).id;
}

/**
 * 把 `fallbackOrder` 解析成**可执行**的候选序列（顺序即优先级）。四类跳过：
 *   1. 非法 / 未知厂牌 id（存储层已清洗，这里再挡一次，防调用方绕过 sanitize 直接传给翻译入口）；
 *   2. 当前正在用的厂牌（自己重试自己没意义）；
 *   3. 未配 Key 的厂牌（`providerKeys[pid]` 为空且不是免费通道）—— 试也必然是 401；
 *   4. 请求层不支持的 service（防御未来新增协议）。
 *
 * 免费通道（Google 免费翻译）允许出现在顺序里：不需要 Key / 模型，端点固定。
 */
export function resolveFallbackCandidates(settings: ExtensionSettings): FallbackCandidate[] {
  const order = Array.isArray(settings.fallbackOrder) ? settings.fallbackOrder : [];
  const seen = new Set<string>([resolveCurrentProviderId(settings)]);
  const out: FallbackCandidate[] = [];

  for (const raw of order) {
    if (typeof raw !== 'string') continue;
    const provider = getProvider(raw.trim());
    if (!provider) continue;
    if (seen.has(provider.id)) continue;
    seen.add(provider.id);

    const isFree = provider.service === 'google';
    const apiKey = (settings.providerKeys?.[provider.id] || '').trim();
    if (!isFree && !apiKey) continue;
    if (!SUPPORTED_CHANNEL_SERVICES.includes(provider.service)) continue;

    out.push({
      providerId: provider.id,
      service: provider.service,
      settings: {
        ...settings,
        service: provider.service,
        providerId: provider.id,
        apiKey: isFree ? '' : apiKey,
        /* 端点：用户为该厂牌覆盖过就用覆盖值，否则用 PROVIDERS 的官方端点
           （Gemini 的 defaultBaseUrl 是空串，请求层走官方 SDK 路径，不要自己拼） */
        apiBaseUrl: isFree ? '' : (settings.providerBaseUrls?.[provider.id] || provider.defaultBaseUrl || ''),
        /* 模型：该厂牌「上次选的」，没选过就用清单首个（与界面切换厂牌的口径一致） */
        modelName: isFree ? '' : (settings.providerModelSelections?.[provider.id] || provider.models[0]?.id || ''),
        /* 临时设置里把顺序清空：万一链内又绕回 translateSentenceBatchDetailed，
           也不会带着同一份顺序再走一遍（第二道防递归闸；第一道是 fallbackDepth）。 */
        fallbackOrder: []
      }
    });
  }

  return out;
}

/** 按 service 派发到具体通道。**不经过 translateSentenceBatchDetailed** ⇒ 通道本身不具备降级能力 */
function runChannel(
  service: string,
  texts: string[],
  targetLang: string,
  settings: ExtensionSettings,
  options?: TranslationOptions
): Promise<SliceResult> {
  switch (service) {
    case 'deepseek':
    case 'openai':
      return translateWithOpenAICompatible(texts, targetLang, settings, options);
    case 'gemini':
      return translateWithGemini(texts, targetLang, settings, options);
    case 'google':
    default:
      return translateWithGoogle(texts, targetLang, settings, options);
  }
}

/** 这一级是否至少拿到一句可用译文（拿到即采用该级结果，剩余失败句由占位符兜底） */
function hasAnyTranslation(slice: SliceResult): boolean {
  return slice.translations.some((t) => !!t);
}

interface FallbackChainOutcome {
  /** 有可用结果的某一级（可能部分成功）；undefined = 全部失败 */
  slice?: SliceResult;
  /** 全部失败时的最后一个错误（沿用 `[降级失败: 原因]` 文案） */
  error: any;
  /** 实际尝试的级数（不含主通道那次） */
  attempts: number;
}

/**
 * 逐级降级：用户顺序 → Google 免费兜底。每级只发一次请求，抛错即进下一级。
 *
 * 两个刻意的不重复：
 * - 当前本身就在 Google 免费通道（`allowFinalGoogle === false`）：不再把同一个请求发第二遍；
 * - 顺序里已经试过 Google 免费（`googleTried`）：兜底那一步跳过，避免同一级试两次。
 */
async function runFallbackChain(
  texts: string[],
  targetLang: string,
  settings: ExtensionSettings,
  options: TranslationOptions | undefined,
  candidates: FallbackCandidate[],
  allowFinalGoogle: boolean,
  primaryError: any
): Promise<FallbackChainOutcome> {
  /* 链内唯一的选项来源：只加两个内部标记，`bypassCache` / `contextBefore` 等沿主路径语义 */
  const chainOptions: TranslationOptions = {
    ...options,
    fallbackDepth: (options?.fallbackDepth ?? 0) + 1,
    noSentenceRetry: true
  };

  let lastError: any = primaryError;
  let attempts = 0;
  let googleTried = false;

  for (const candidate of candidates) {
    attempts++;
    if (candidate.service === 'google') googleTried = true;
    try {
      const slice = await runChannel(candidate.service, texts, targetLang, candidate.settings, chainOptions);
      if (hasAnyTranslation(slice)) {
        console.log(`[YT-Sub-Translator] 降级成功：第 ${attempts} 级（${candidate.providerId}）`);
        return { slice, error: null, attempts };
      }
      lastError = new Error(slice.errors.find((e) => !!e) || `${candidate.providerId} 未返回可用译文`);
    } catch (err: any) {
      lastError = err;
    }
    console.warn(
      `[YT-Sub-Translator] 降级第 ${attempts} 级（${candidate.providerId}）失败，进入下一级:`,
      lastError?.message || lastError
    );
  }

  if (allowFinalGoogle && !googleTried) {
    attempts++;
    console.log('[YT-Sub-Translator] 降级链用尽，最后尝试 Google 免费翻译通道...');
    try {
      const slice = await translateWithGoogle(texts, targetLang, settings, chainOptions);
      return { slice, error: null, attempts };
    } catch (err: any) {
      lastError = err;
    }
  }

  return { slice: undefined, error: lastError, attempts };
}

/**
 * 一批翻译的明细：让调用方（以及测试）能区分「已译」与「最终失败」
 * - translations：与输入等长；失败句填 `[翻译失败: …]` 占位，保持浮层的既有显示行为
 * - failed：与输入等长的失败掩码。**失败句绝不写缓存**，下次播放会重新尝试
 * - retryRequests：本批额外发出的重试请求数（全批成功 = 0，可自查有没有偷偷整批重发）
 */
export interface TranslateBatchDetail {
  translations: string[];
  failed: boolean[];
  retryRequests: number;
}

/**
 * 统一分发翻译入口（明细版）(整合 IndexedDB 持久化缓存与可控降级)
 *
 * v0.4.3 起的失败口径：
 * - 批内某句没拿到译文 → 只有该句进「带前后文重试」，其余句照常落库；
 * - 重试 2 次仍失败 → 记 failed，填占位符，不写缓存，队列不阻塞（本批照常返回）；
 * - 传输级故障（网络 / HTTP / 整批降级失败）仍是既有语义：noFallback 抛错，否则降级。
 *
 * v0.4.2 降级顺序：传输级故障后的降级**不再是「直接 Google」这一条硬编码**，
 * 而是「用户顺序（fallbackOrder）逐级 → Google 免费兜底」；顺序为空时与 v0.4.1 完全一致。
 */
export async function translateSentenceBatchDetailed(
  texts: string[],
  targetLang: string,
  settings: ExtensionSettings,
  options?: TranslationOptions
): Promise<TranslateBatchDetail> {
  if (texts.length === 0) return { translations: [], failed: [], retryRequests: 0 };

  // v0.2.9：翻译前刷新自定义术语库 / 场景包（10s TTL，避免每批读存储）
  await refreshPacksIfStale();

  const service = settings.service || 'google';
  const bypassCache = !!options?.bypassCache;

  // 1. 尝试从内存 + IndexedDB 持久化缓存中快速匹配已翻译的句子
  const cacheKeys = texts.map((t) =>
    buildSentenceCacheKey(
      targetLang,
      t,
      buildScenarioTag(settings, targetLang),
      settings.reasoningEffort,
      service,
      settings.modelName,
      getGlossaryTag(settings)
    )
  );

  let cachedMap = new Map<string, string>();
  if (!bypassCache) {
    try {
      cachedMap = await getCachedSentencesBatch(cacheKeys);
    } catch {
      // 容错降级
    }
  }

  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];
  const finalResults: Array<string | null> = new Array(texts.length).fill(null);
  const failed: boolean[] = texts.map(() => false);

  for (let i = 0; i < texts.length; i++) {
    const key = cacheKeys[i];
    if (cachedMap.has(key)) {
      finalResults[i] = cachedMap.get(key)!;
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i]);
    }
  }

  // 若全部命中持久化缓存，直接返回 (0 API 消耗、毫秒级响应)
  if (uncachedTexts.length === 0) {
    return {
      translations: finalResults.map((v, i) => v ?? texts[i]),
      failed,
      retryRequests: 0
    };
  }

  /**
   * 收尾：回填成功项 + 只把成功项写进持久化缓存 + 失败项填占位符。
   * 「只写成功项」是硬约束：写空值或占位译文会让下次播放直接命中一条假译文。
   */
  const applySlice = (slice: SliceResult, placeholderPrefix: string, retryRequests: number): TranslateBatchDetail => {
    const toCacheEntries: Array<{ key: string; translation: string }> = [];
    for (let i = 0; i < uncachedTexts.length; i++) {
      const globalIdx = uncachedIndices[i];
      const trans = slice.translations[i];
      if (trans) {
        finalResults[globalIdx] = trans;
        if (!bypassCache) {
          toCacheEntries.push({ key: cacheKeys[globalIdx], translation: trans });
        }
      } else {
        failed[globalIdx] = true;
        finalResults[globalIdx] = `${placeholderPrefix}${slice.errors[i] || '重试后仍无结果'}]`;
      }
    }

    if (!bypassCache && toCacheEntries.length > 0) {
      setCachedSentencesBatch(toCacheEntries).catch((e) =>
        console.warn('[Translator] 异步写入持久化缓存异常:', e)
      );
    }

    return {
      translations: finalResults.map((v, i) => v ?? texts[i]),
      failed,
      retryRequests
    };
  };

  try {
    const slice = await runChannel(service, uncachedTexts, targetLang, settings, options);

    // noFallback（测试连接 / AI 深度全篇）：整批一句都没拿到译文时如实抛错，不静默吞掉。
    // 部分成功则照常返回 —— 已经翻好的句子没必要因为一句失败全部作废。
    if (options?.noFallback && slice.failedIdx.length === uncachedTexts.length) {
      throw new Error(slice.errors.find((e) => !!e) || '模型未返回任何可用译文');
    }

    return applySlice(slice, '[翻译失败: ', slice.retryRequests);
  } catch (error: any) {
    console.warn(`[YT-Sub-Translator] ${service} 翻译发生错误:`, error);

    // 关键防御：如果指定了 noFallback (如测试连接/AI深度全篇字幕)，严禁静默回退，直接抛出真实错误！
    if (options?.noFallback) {
      throw error;
    }

    /* ══════════════ 降级链（v0.4.2 降级顺序） ══════════════
     * 判定顺序（与需求逐条对应）：
     *   1. noFallback → 已在上方抛错（测试连接 / AI 深度全篇一律不降级）；
     *   2. autoFallbackToGoogle === false → 不降级（这就是「自动降级」开关）；
     *   3. fallbackDepth > 0 → 已在降级链内部，一律不降级（防递归）；
     *   4. 否则：用户顺序逐级试 → Google 免费兜底 → 仍失败才写 `[降级失败: 原因]`。
     * 当前本身就是 Google 免费通道时不做「最后兜底」那一步（同一个请求不必发两遍）；
     * 只有在这种情况下（顺序也空 / 顺序都不适用）才回落到「展示该服务真实报错」的老路径。
     */
    const canDegrade = settings.autoFallbackToGoogle !== false && (options?.fallbackDepth ?? 0) === 0;
    const candidates = canDegrade ? resolveFallbackCandidates(settings) : [];
    const allowFinalGoogle = canDegrade && service !== 'google';

    if (candidates.length === 0 && !allowFinalGoogle) {
      // 用户未开启降级 / 当前就是 Google 免费 / 已处于降级链内部：明确向用户展示该服务真实报错
      for (let i = 0; i < uncachedTexts.length; i++) {
        failed[uncachedIndices[i]] = true;
        finalResults[uncachedIndices[i]] = `[${service.toUpperCase()} 失败: ${error.message || '调用失败'}]`;
      }
      return {
        translations: finalResults.map((v, i) => v ?? texts[i]),
        failed,
        retryRequests: 0
      };
    }

    console.log(
      `[YT-Sub-Translator] ${service} 异常，开始逐级降级：` +
        `${candidates.length} 个候选（${candidates.map((c) => c.providerId).join(' → ') || '无'}）` +
        `${allowFinalGoogle ? ' → Google 免费' : ''}`
    );

    const outcome = await runFallbackChain(
      uncachedTexts,
      targetLang,
      settings,
      options,
      candidates,
      allowFinalGoogle,
      error
    );

    if (outcome.slice) {
      // 降级结果同样只写成功的那些，避免把失败占位符当译文缓存；
      // 缓存键仍是主路径的 cacheKeys（见 applySlice）⇒ 不产生「降级专用」的第二份缓存。
      return applySlice(outcome.slice, '[降级失败: ', outcome.slice.retryRequests);
    }

    console.warn('[YT-Sub-Translator] 降级链全部失败:', outcome.error?.message || outcome.error);
    for (let i = 0; i < uncachedTexts.length; i++) {
      failed[uncachedIndices[i]] = true;
      finalResults[uncachedIndices[i]] = `[降级失败: ${outcome.error?.message || '翻译失败'}]`;
    }
    return {
      translations: finalResults.map((v, i) => v ?? texts[i]),
      failed,
      retryRequests: 0
    };
  }
}

/**
 * 统一分发翻译入口（兼容旧签名：只返回译文数组，行为与 v0.4.2 一期一致）
 */
export async function translateSentenceBatch(
  texts: string[],
  targetLang: string,
  settings: ExtensionSettings,
  options?: TranslationOptions
): Promise<string[]> {
  const detail = await translateSentenceBatchDetailed(texts, targetLang, settings, options);
  return detail.translations;
}

/**
 * 从 API 接口动态拉取可用模型列表
 */
export async function fetchAvailableModels(settings: ExtensionSettings): Promise<ModelOption[]> {
  const { service, apiKey, apiBaseUrl } = settings;
  if (!apiKey && service !== 'google') {
    throw new Error('未配置 API Key，请先在上方填入 Key');
  }

  // 1. Google Gemini 官方 API
  if (service === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetchWithTimeout(url, { method: 'GET' }, 8000);
    if (!res.ok) {
      const err = await res.text();
      let msg = err;
      try {
        const j = JSON.parse(err);
        msg = j.error?.message || err;
      } catch {}
      throw new Error(`Gemini 模型拉取失败 (HTTP ${res.status}): ${msg}`);
    }
    const data = await res.json();
    const list: ModelOption[] = [];
    if (Array.isArray(data.models)) {
      for (const m of data.models) {
        if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) {
          continue;
        }
        const id = m.name?.replace(/^models\//, '') || m.name;
        list.push({
          id,
          name: m.displayName || id,
          description: m.description
        });
      }
    }
    if (list.length === 0) {
      throw new Error('Gemini API 未返回任何支持文本生成的模型');
    }
    return list;
  }

  // 2. OpenAI / DeepSeek / Antigravity Tools / 自定义端点
  let baseUrl = apiBaseUrl?.trim();
  if (!baseUrl) {
    if (service === 'deepseek') {
      baseUrl = 'https://api.deepseek.com/v1';
    } else {
      baseUrl = 'https://api.openai.com/v1';
    }
  }

  // 清洗 baseUrl，去除结尾的 /chat/completions 或斜杠
  baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
  const endpoint = baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`;

  let res: Response;
  try {
    res = await fetchWithTimeout(
      endpoint,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      },
      8000
    );
  } catch (err: any) {
    throw new Error(`连接端点失败 (${endpoint}): ${err.message || '网络连接超时'}`);
  }

  // 智能容错：如果 /models 返回 404，且原地址没带 /v1，尝试补充 /v1/models
  if (res.status === 404 && !baseUrl.includes('/v1')) {
    try {
      const retryUrl = `${baseUrl}/v1/models`;
      const retryRes = await fetchWithTimeout(
        retryUrl,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`
          }
        },
        8000
      );
      if (retryRes.ok) {
        res = retryRes;
      }
    } catch {}
  }

  if (!res.ok) {
    const errText = await res.text();
    let detailMsg = errText;
    try {
      const errJson = JSON.parse(errText);
      detailMsg = errJson.error?.message || errJson.message || errText;
    } catch {}
    throw new Error(`API 响应错误 (HTTP ${res.status}): ${detailMsg}`);
  }

  const data = await res.json();
  const list: ModelOption[] = [];
  const rawList = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);

  for (const m of rawList) {
    if (m && m.id) {
      list.push({
        id: m.id,
        name: m.display_name || m.name || m.id
      });
    }
  }

  if (list.length === 0) {
    throw new Error('API 返回的数据格式中未找到模型列表');
  }

  // 排序：常用/推荐模型前置
  list.sort((a, b) => {
    const isRecommendedA = a.id.includes('flash') || a.id.includes('mini') || a.id.includes('chat') || a.id.includes('sonnet');
    const isRecommendedB = b.id.includes('flash') || b.id.includes('mini') || b.id.includes('chat') || b.id.includes('sonnet');
    if (isRecommendedA && !isRecommendedB) return -1;
    if (!isRecommendedA && isRecommendedB) return 1;
    return a.id.localeCompare(b.id);
  });

  return list;
}
