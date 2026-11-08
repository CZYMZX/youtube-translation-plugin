/**
 * 厂牌与模型清单（弹窗与高级设置页共用）
 * ----------------------------------------------------------------------------
 * 这一版把「厂牌」提为一级结构（口径见 docs/PROVIDER-MODELS.md）：
 *   - PROVIDERS 是唯一一份真相：厂牌名 / 图标 key / 请求用 service / 默认端点 / 模型清单；
 *   - PRESET_MODELS 由 PROVIDERS 派生，键仍是 service、条目仍是 { id, name }，
 *     弹窗那边一行都不用改（它只认 PRESET_MODELS[service] 与 cachedModelsKey(service)）；
 *   - 厂牌图标不写在这里：统一来自 utils/provider-icons.ts（LobeHub 官方 SVG，MIT），
 *     本文件只存 iconKey，缺图标时由 providerIconHtml 退回字母徽标。
 *
 * 为什么 service 不等于厂牌：请求层（utils/translator.ts）只认 4 个协议出口
 * （google / gemini / openai / deepseek）。Claude、通义、Kimi、GLM 都走 OpenAI 兼容协议，
 * 所以它们的 service 是 'openai'，靠各自的 defaultBaseUrl 区分端点 —— 选模型时必须
 * 把 baseUrl 一起写进设置，否则请求会打到 api.openai.com 上。
 */

import type { ModelOption } from '../types';
import { PROVIDER_ICON_KEYS } from './provider-icons';

/** 请求层真正认的 service（translator.ts / 拉取模型链路按它分流） */
export type ModelRequestService = 'google' | 'gemini' | 'openai' | 'deepseek';

/** 自定义条目可挂的 service（'custom' = 自建 OpenAI 兼容端点，请求时归一到 'openai'） */
export type ModelServiceKey = 'deepseek' | 'openai' | 'gemini' | 'custom';

/** 一个可选模型：id 发给服务商，label 给人看，note 只写定位（推荐 / 最省 / 最强） */
export interface ProviderModel {
  id: string;
  label: string;
  note?: string;
}

export interface Provider {
  id: string;
  name: string;
  /** utils/provider-icons.ts 里的图标 key；没有对应图标时 providerIconHtml 用首字母兜底 */
  iconKey: string;
  /** 真正发请求用的协议出口 */
  service: ModelRequestService;
  /** 默认端点；空串 = 走官方 SDK 自己的路径（Gemini 就是这样，不拼 baseUrl） */
  defaultBaseUrl: string;
  /** Key 申请入口（只给官网地址，不复述申领步骤） */
  keyHint: string;
  models: ProviderModel[];
}

/** 免 Key 厂牌：Google 免费翻译，不选模型、不填 Key，单独一块放在列表最上方 */
export const FREE_PROVIDER_ID = 'google-free';

/**
 * 厂牌清单（2026-11 按各厂商官方文档 / 定价页核对，见 docs/PROVIDER-MODELS.md）。
 * 只放**当前在售**的型号：已下线的（deepseek-chat / deepseek-reasoner / gpt-4o* /
 * gemini-1.5-* / gemini-2.0-flash-exp / claude-sonnet-4-6 …）不留在预设里，
 * 否则用户点了就 404。
 */
export const PROVIDERS: readonly Provider[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    iconKey: 'deepseek',
    service: 'deepseek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    keyHint: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', note: '推荐' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', note: '最强推理' }
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    iconKey: 'openai',
    service: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyHint: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', note: '推荐' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', note: '最快最省' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra', note: '最强' }
    ]
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    iconKey: 'gemini',
    service: 'gemini',
    defaultBaseUrl: '',
    keyHint: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: '推荐' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', note: '最省' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (预览)', note: '最强' },
      { id: 'gemini-3-flash', label: 'Gemini 3 Flash' }
    ]
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    iconKey: 'claude',
    service: 'openai',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    keyHint: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: '推荐' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: '最省' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: '最强' },
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', note: '顶级 · 较贵' }
    ]
  },
  {
    id: 'qwen',
    name: '阿里云通义千问',
    iconKey: 'qwen',
    service: 'openai',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyHint: 'https://bailian.console.aliyun.com/',
    models: [
      { id: 'qwen3.8-flash', label: 'Qwen3.8 Flash', note: '推荐' },
      { id: 'qwen3.7-plus', label: 'Qwen3.7 Plus' },
      { id: 'qwen3.8-max', label: 'Qwen3.8 Max', note: '最强' }
    ]
  },
  {
    id: 'kimi',
    name: 'Moonshot Kimi',
    iconKey: 'kimi',
    service: 'openai',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    keyHint: 'https://platform.moonshot.cn/console/api-keys',
    models: [
      { id: 'kimi-k2.6', label: 'Kimi K2.6', note: '推荐 · 便宜快' },
      { id: 'kimi-k3', label: 'Kimi K3' }
    ]
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    iconKey: 'zhipu',
    service: 'openai',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    keyHint: 'https://open.bigmodel.cn/usercenter/apikeys',
    models: [
      { id: 'glm-5.3-flash', label: 'GLM-5.3 Flash', note: '推荐' },
      { id: 'glm-5.3', label: 'GLM-5.3' },
      { id: 'glm-5.2', label: 'GLM-5.2' }
    ]
  },
  {
    id: FREE_PROVIDER_ID,
    name: 'Google 免费翻译',
    /* 没有独立的 Google 品牌图标（不自己画、也不拿 Gemini 的星芒冒充），
       交给 providerIconHtml 用首字母兜底：圆底字母 G */
    iconKey: '',
    service: 'google',
    defaultBaseUrl: '',
    keyHint: '',
    models: []
  }
];

/** 厂牌 id 白名单（存进设置的 providerId / providerKeys 键都按它过滤） */
export const PROVIDER_IDS: readonly string[] = PROVIDERS.map((p) => p.id);

/** service → 该协议出口的「主厂牌」：老数据只记了 service 时靠它落位 */
const PRIMARY_PROVIDER_BY_SERVICE: Record<ModelRequestService, string> = {
  google: FREE_PROVIDER_ID,
  deepseek: 'deepseek',
  openai: 'openai',
  gemini: 'gemini'
};

export function getProvider(id: string | undefined | null): Provider | undefined {
  if (!id) return undefined;
  return PROVIDERS.find((p) => p.id === id);
}

export function isProviderId(value: unknown): value is string {
  return typeof value === 'string' && PROVIDER_IDS.includes(value);
}

/**
 * 按 service 找厂牌。注意这是**多对一**的反查：claude / qwen / kimi / zhipu
 * 的 service 都是 'openai'，所以它返回的是该协议出口的主厂牌（OpenAI），
 * 只用于「老数据迁移」与「常规分区那个粗粒度通道开关」。
 */
export function resolveProviderByService(service: string): Provider {
  const id = PRIMARY_PROVIDER_BY_SERVICE[service as ModelRequestService];
  return getProvider(id) || getProvider(FREE_PROVIDER_ID)!;
}

/** 按 model id 反查厂牌（用来把用户手填的 modelName 归位到某个厂牌下） */
export function findProviderByModelId(modelId: string | undefined | null): Provider | undefined {
  const id = (modelId || '').trim();
  if (!id) return undefined;
  return PROVIDERS.find((p) => p.models.some((m) => m.id === id));
}

/** 某个厂牌的预设模型（google-free 是空数组） */
export function providerModels(providerId: string): ProviderModel[] {
  return getProvider(providerId)?.models || [];
}

/** 该 model id 是否在这个厂牌的预设里 */
export function providerHasModel(providerId: string, modelId: string): boolean {
  return providerModels(providerId).some((m) => m.id === modelId);
}

/**
 * 按 service 扁平的预设清单，供弹窗按服务商列模型（形状与老代码完全一致）。
 * 同一 service 下多个厂牌的模型会合并（OpenAI 组里会同时出现 GPT / Claude / Qwen / Kimi / GLM
 * —— 它们在协议上是同一个出口，弹窗也没法再分一层），按 id 去重、保持 PROVIDERS 顺序。
 */
function buildPresetModels(): Record<string, ModelOption[]> {
  const out: Record<string, ModelOption[]> = {};
  const seen: Record<string, Set<string>> = {};

  for (const provider of PROVIDERS) {
    if (provider.service === 'google') continue;
    if (!out[provider.service]) out[provider.service] = [];
    if (!seen[provider.service]) seen[provider.service] = new Set<string>();
    for (const model of provider.models) {
      if (seen[provider.service].has(model.id)) continue;
      seen[provider.service].add(model.id);
      out[provider.service].push({ id: model.id, name: model.label, note: model.note });
    }
  }

  return out;
}

export const PRESET_MODELS: Record<string, ModelOption[]> = buildPresetModels();

/**
 * 在线模型列表的缓存键。
 * - 设置页按 **providerId** 存（cached_models_claude）；
 * - 弹窗按 **service** 存（cached_models_openai）；
 * - 两者的 service 相同 → 键也相同的厂牌（deepseek / openai / gemini）天然共用一条缓存，
 *   所以老缓存不用迁移；claude / qwen / kimi / zhipu 各占一条，互不污染。
 */
export function cachedModelsKey(topic: string): string {
  return `cached_models_${topic}`;
}

/* ══════════════════════════ 历史图标值白名单 ══════════════════════════
 * v0.4.2 的自定义模型条目带过 icon 字段（当时是内置的简化几何标记）。
 * 现在图标跟着厂牌走、界面不再渲染这个字段，但**存过的值要能被清洗接受**，
 * 不能因为升级把老条目抹成乱值。这里只保留 key 名单，不再保留任何路径数据。
 */
export const LEGACY_ICON_KEYS = [
  'deepseek', 'qwen', 'chatgpt', 'gemini', 'claude', 'kimi', 'glm', 'deepl', 'generic'
] as const;

/** 合法 icon 值 = 历史值 ∪ 厂牌图标 key（'zhipu' 这类新值也要能存） */
export function isModelIconKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return (LEGACY_ICON_KEYS as readonly string[]).includes(value)
    || (PROVIDER_ICON_KEYS as readonly string[]).includes(value);
}

/** 自定义模型上限（存进设置前与清洗时都按这个数字截断） */
export const MAX_CUSTOM_MODELS = 20;

/** 自定义模型服务商白名单（'custom' 走 OpenAI 兼容端点） */
export const CUSTOM_MODEL_SERVICES: readonly ModelServiceKey[] = ['deepseek', 'openai', 'gemini', 'custom'];

/** 自定义条目的 service → 真正用于请求的 service 枚举 */
export function resolveRequestService(service: ModelServiceKey): ModelRequestService {
  return service === 'custom' ? 'openai' : service;
}
