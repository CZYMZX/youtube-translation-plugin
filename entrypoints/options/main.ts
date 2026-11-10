/**
 * 高级设置页（v0.4.0）
 * ----------------------------------------------------------------------------
 * 与弹窗共用同一套设置与存储：
 *   - 设置：utils/storage.ts（chrome.storage.sync → local 降级）
 *   - 术语库：utils/packs.ts（自定义包存 local，内置包在代码里）
 * 两处任一改动都会通过 storage.onChanged 同步到另一处，不存在"两份设置"。
 */
import {
  DEFAULT_SETTINGS,
  type CustomModelEntry,
  type CustomModelService,
  type ExtensionSettings,
  type ModelOption
} from '../../types';
import { getStoredSettings, saveStoredSettings } from '../../utils/storage';
import {
  FREE_PROVIDER_ID,
  MAX_CUSTOM_MODELS,
  PROVIDERS,
  cachedModelsKey,
  getProvider,
  providerHasModel,
  resolveProviderByService,
  type Provider
} from '../../utils/models';
/* 厂牌图标统一取自 LobeHub 官方 SVG（utils/provider-icons.ts），这里只负责挂在 DOM 上 */
import { providerIconHtml } from '../../utils/provider-icons';
import {
  getAllGlossaryPacks,
  getAllScenes,
  loadCustomPacks,
  resolveScenePrompt,
  saveGlossaryPacks,
  saveScenePacks,
  validateGlossaryPack,
  validateScenePack,
  BUILTIN_GLOSSARY_PACKS,
  type CustomPacks,
  type GlossaryPack,
  type ScenePack
} from '../../utils/packs';
import { buildPromptLayers, PROMPT_LAYER_ORDER, type PromptLayer } from '../../utils/prompt-layers';
import { GLOSSARY_CATEGORY_LABELS, type GlossaryCategory, type GlossaryEntry } from '../../utils/glossary';
import { clearSentenceCache } from '../../utils/db-cache';
import {
  clearAllAiTracks,
  getAiTrackStats,
  pruneAiTracks
} from '../../utils/ai-track-cache';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string): T[] => Array.from(document.querySelectorAll<T>(sel));

type ServiceKey = ExtensionSettings['service'];

let settings: ExtensionSettings;
let customPacks: CustomPacks = { glossaries: [], scenes: [] };
let activePackId = '';
let editingIndex = -1;
let searchTerm = '';
let categoryFilter: GlossaryCategory | 'all' = 'all';

/* 翻译场景分区：当前「查看」的场景与「使用中」是两件事（见 renderSceneList 注释） */
let viewingSceneId = '';
/** 场景人设是否处于编辑态 */
let sceneEditing = false;
/** 场景编辑框的草稿：重绘（存储回声 / 报错重画）时不能让用户丢掉已输入的内容 */
let sceneDraft = '';
/** 场景保存的行内错误（不静默截断，也不弹窗） */
let sceneError = '';

/** 与 PACK-UPLOAD-SPEC / validateScenePack 一致的长度口径 */
const SCENE_PROMPT_MIN = 20;
const SCENE_PROMPT_MAX = 4000;

/* ══════════════════════════ 启动 ══════════════════════════ */

async function boot(): Promise<void> {
  settings = await getStoredSettings();
  customPacks = await loadCustomPacks();

  const version = chrome.runtime.getManifest().version;
  const versionEl = $('#app-version');
  if (versionEl) versionEl.textContent = `v${version}`;
  const aboutVersion = $('#about-version');
  if (aboutVersion) aboutVersion.textContent = `v${version} · MV3`;

  bindNav();
  bindControls();
  bindWordColorEvents();
  renderScenarios();
  reflectSettings();
  /* 颜色区的展开 / 收起跟着「自动字幕逐词显现」走（勾选态已由 reflectSettings 同步） */
  syncWordColorBlock();
  applyPreview();
  /* 默认只展开「正在使用」的那个厂牌（其余折叠，点整行展开） */
  expandedProviderId = settings.providerId || '';
  renderProviderList();
  /* 降级顺序列表要读「哪些厂牌配了 Key」，所以排在 renderProviderList() 之后 */
  renderFallbackOrder();
  bindFallbackOrderEvents();
  /* 常规分区「翻译服务」折叠块：两个折叠状态都不持久化，进页面一律收起 */
  bindFoldEvents();
  void refreshOnlineModels();

  activePackId = getAllGlossaryPacks(customPacks)[0]?.id ?? '';
  renderPackList();
  renderTable();

  viewingSceneId = settings.scenario;
  renderScenePane();

  bindGlossaryEvents();
  bindScenePackEvents();
  bindMiscEvents();
  bindAiCacheEvents();
  bindDialogMotion();
  /* 静态 <details>（文件格式规范）也走同一套高度过渡；厂牌面板里的 details 创建时自己绑 */
  bindDetailsMotion();

  // 弹窗侧改动 → 本页实时反映
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' && area !== 'local') return;
    /* 任一厂牌的在线模型缓存变了（另一标签页拉到 / 被清掉）→ 重读一遍：
       「参考模型按实际列表隐藏」这件事依赖缓存，缓存变了列表必须跟着变。 */
    const modelsChanged = Object.keys(changes).some((key) => key.startsWith('cached_models_'));
    if (modelsChanged) void refreshOnlineModels();
    if (Object.prototype.hasOwnProperty.call(changes, 'yt_sub_translator_settings')) {
      void getStoredSettings().then((next) => {
        settings = next;
        reflectSettings();
        /* 颜色区的展开 / 收起跟着「自动字幕逐词显现」走（勾选态已由 reflectSettings 同步） */
        syncWordColorBlock();
        applyPreview();
        renderScenarios();
        renderProviderList();
        /* 另一处改了厂牌 Key / 降级顺序：这块列表必须跟着重画（拖拽中会自己跳过） */
        renderFallbackOrder();
        renderScenePane();
      });
    }
  });
}

/* ══════════════════════════ 分区导航 ══════════════════════════ */

const navItems = (): HTMLButtonElement[] => $$<HTMLButtonElement>('.navitem');

function bindNav(): void {
  const nav = $('#sidenav');
  navItems().forEach((btn) => {
    btn.addEventListener('click', () => activatePane(btn.dataset.pane || 'general', false));
  });

  // 方向键在竖排 tablist 中上下移动
  nav?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const items = navItems();
    const current = items.findIndex((b) => b.classList.contains('active'));
    let next = current < 0 ? 0 : current;
    if (e.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    if (e.key === 'ArrowDown') next = (current + 1) % items.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = items.length - 1;
    e.preventDefault();
    activatePane(items[next].dataset.pane || 'general', true);
  });
}

function activatePane(pane: string, moveFocus: boolean): void {
  navItems().forEach((b) => {
    const on = b.dataset.pane === pane;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && moveFocus) b.focus();
  });

  $$('.pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${pane}`));
  moveMarker();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function moveMarker(): void {
  const marker = $('.nav-marker');
  const active = $('.navitem.active') as HTMLElement | null;
  if (!marker || !active) return;
  marker.style.setProperty('--marker-y', `${active.offsetTop + 4}px`);
  marker.style.height = `${active.offsetHeight - 8}px`;
}

/* ══════════════════════════ 设置绑定 ══════════════════════════ */

function bindControls(): void {
  $$('[data-setting]').forEach((el) => {
    const key = el.dataset.setting as keyof ExtensionSettings;

    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      el.addEventListener('change', () => void update({ [key]: el.checked } as Partial<ExtensionSettings>));
      return;
    }

    if (el instanceof HTMLInputElement && el.type === 'range') {
      el.addEventListener('input', () => {
        syncRangeOutput(key, Number(el.value));
        void update({ [key]: Number(el.value) } as Partial<ExtensionSettings>);
      });
      return;
    }

    if (el instanceof HTMLInputElement && el.type === 'color') {
      el.addEventListener('input', () => {
        void update({ [key]: el.value } as Partial<ExtensionSettings>);
      });
      return;
    }

    // 分段控件按钮
    if (el.tagName === 'BUTTON' && el.dataset.value !== undefined) {
      el.addEventListener('click', () => {
        /* 翻译通道：切通道要连带换回目标厂牌自己的 Key、端点与模型，
           否则会拿着上一家的 Key 去请求另一家的端点（401 / 404 都看不出原因）。 */
        if (key === 'service') {
          const target = el.dataset.value as ServiceKey;
          if (target !== settings.service) void update(serviceSwitchPatch(target));
          reflectSettings();
          return;
        }
        void update({ [key]: el.dataset.value } as Partial<ExtensionSettings>);
        // 选中态与滑块立即跟上：只有 service/scenario 走 update() 里的局部重绘，
        // 其余分段项原先要等 storage.onChanged 回声（≥320ms 防抖 + 存储往返）才动。
        reflectSettings();
      });
      return;
    }

    // select / text
    el.addEventListener('change', () => {
      const value = (el as HTMLInputElement | HTMLSelectElement).value;
      void update({ [key]: value } as Partial<ExtensionSettings>);
    });
  });
}

function reflectSettings(): void {
  $$('[data-setting]').forEach((el) => {
    const key = el.dataset.setting as keyof ExtensionSettings;
    const value = settings[key];

    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') {
        el.checked = Boolean(value);
      } else {
        /* 取值域特殊的项先归一再写进控件（逐词高亮颜色只认 hex） */
        const shown = DISPLAY_NORMALIZERS[key] ? DISPLAY_NORMALIZERS[key]!(value) : String(value ?? '');
        if (el.value !== shown) el.value = shown;
      }
      if (el.type === 'range') syncRangeOutput(key, Number(value));
      return;
    }

    if (el.tagName === 'BUTTON' && el.dataset.value !== undefined) {
      const on = String(value) === el.dataset.value;
      el.classList.toggle('active', on);
      // 分段按钮是「多选一」的按钮组：把选中态也暴露给读屏（原来只有 .active 配色）
      el.setAttribute('aria-pressed', String(on));

      // 只在「当前选中项」上写索引：每个按钮都写会被最后一个覆盖，导致滑块停在末位
      const seg = el.closest('.seg') as HTMLElement | null;
      if (seg) {
        const btns = Array.from(seg.querySelectorAll('button'));
        seg.style.setProperty('--seg-count', String(btns.length));
        if (on) seg.style.setProperty('--seg-index', String(btns.indexOf(el as HTMLButtonElement)));
      }
      return;
    }

    if ((el as HTMLSelectElement).value !== String(value ?? '')) {
      (el as HTMLSelectElement).value = String(value ?? '');
    }
  });

  syncServiceChrome();
  /* 「自动降级」开关的开合跟着 settings 走：弹窗改完、存储回声、进页面都对齐到这里 */
  syncFallbackDepend();
  /* 逐词高亮颜色：「跟随」勾选态 / 取色器可用性 / 显示值都跟着 settings 走 */
  syncWordColorRows();
}

const RANGE_FORMAT: Record<string, (v: number) => string> = {
  pauseThreshold: (v) => `${v} ms`,
  maxDurationMs: (v) => `${(v / 1000).toFixed(2)} s`,
  maxCharsPerSentence: (v) => `${v} 字`,
  maxWordsPerSentence: (v) => `${v} 词`,
  fontSize: (v) => `${v} px`,
  bgOpacity: (v) => `${v}%`,
  offsetY: (v) => `${v}%`,
  syncOffsetMs: (v) => `${v > 0 ? '+' : ''}${v} ms`
};

function syncRangeOutput(key: string, value: number): void {
  const out = document.querySelector<HTMLOutputElement>(`output[data-for="${key}"]`);
  if (out) out.textContent = (RANGE_FORMAT[key] || String)(value);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 逐词高亮颜色（v0.5.0 任务·设置页）：原文 / 译文两路，默认「跟随」
 * ══════════════════════════════════════════════════════════════════════════
 * 1) 存盘口径：每个颜色项只有两种合法取值 ——
 *    ''（空串）= 跟随用户在「字幕样式」里选的原文色 / 译文色；
 *    '#rgb' / '#rrggbb' = 用户单独指定的颜色。其它一律回落空串（= 跟随）。
 * 2) 显示口径 ≠ 存盘口径：<input type="color"> 不接受空串，跟随时它显示
 *    **跟随色的实际值**，但存储里仍是空串 —— 两者必须分开处理，不能把跟随色写进存储。
 * 3) 位置：并入「自动字幕逐词显现」正下方，只有该开关打开时才向下展开。
 * 4) 不做能力检测：能不能选颜色只看开关，与当前视频支不支持词级时间戳无关。
 */

/** 一个逐词高亮颜色项：存储键 / 跟随时取哪个设置项当颜色 / 「跟随」复选框 id */
interface WordColorItem {
  /** 存储键（原文侧 / 译文侧各一个） */
  key: 'wordHighlightColor' | 'wordHighlightTransColor';
  /** 跟随时取哪个设置项当颜色：原文侧 → origColor，译文侧 → transColor */
  followKey: 'origColor' | 'transColor';
  /** 「跟随」复选框（本地 UI 状态，不进存储） */
  followId: string;
}

const WORD_COLOR_ITEMS: WordColorItem[] = [
  { key: 'wordHighlightColor', followKey: 'origColor', followId: 'word-highlight-follow-orig' },
  { key: 'wordHighlightTransColor', followKey: 'transColor', followId: 'word-highlight-follow-trans' }
];

/** 只接受 #rgb / #rrggbb（大小写不敏感） */
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * 旧版本的默认值是纯白。那不是用户自己挑的（当时的取色器默认是置灰的，
 * 实际上没人能主动改成纯白），按新语义应视作「跟随」——
 * 否则升级上来的用户会莫名其妙地卡在「自定义白色」上，永远不会跟随原文色。
 */
const LEGACY_WORD_COLOR_DEFAULT = '#ffffff';

/**
 * 逐词高亮颜色的取值归一：空串（= 跟随）或合法 hex 原样保留，其它一律回落空串。
 * 为什么要归一：渲染层把这一项拼进 CSS 变量值，任意字符串都不能塞进去；
 * 这里再兜一次，老数据 / 手改过的 storage 也不会漏网。
 */
function sanitizeWordColor(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value) return '';
  if (value.toLowerCase() === LEGACY_WORD_COLOR_DEFAULT) return '';
  return HEX_COLOR_RE.test(value) ? value : '';
}

/** 读设置里的某个逐词高亮颜色值（已归一：'' = 跟随） */
function readWordColor(item: WordColorItem): string {
  const raw = (settings as unknown as Record<string, unknown>)[item.key];
  return sanitizeWordColor(raw);
}

/** 跟随色：原文侧取 origColor、译文侧取 transColor（存储层已保证是 #rrggbb） */
function followColorOf(item: WordColorItem): string {
  const raw = (settings as unknown as Record<string, unknown>)[item.followKey];
  if (typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw)) return raw;
  return item.followKey === 'origColor' ? DEFAULT_SETTINGS.origColor : DEFAULT_SETTINGS.transColor;
}

/**
 * 取色器的显示值：跟随时显示跟随色（**存储里仍是空串**），自定义时显示存的那个 hex。
 */
function displayWordColor(item: WordColorItem, raw?: unknown): string {
  const stored = raw === undefined ? readWordColor(item) : sanitizeWordColor(raw);
  return stored || followColorOf(item);
}

/** 少数取值域特殊的设置项：显示前先归一（key → 归一函数）。
 *  逐词高亮颜色跟随时存的是空串，而 <input type="color"> 不接受空串 ——
 *  直接写进去会被浏览器当成 #000000，界面上就会出现「存的是跟随、显示的是黑」。 */
const DISPLAY_NORMALIZERS: Partial<Record<string, (raw: unknown) => string>> = {
  wordHighlightColor: (raw) => displayWordColor(WORD_COLOR_ITEMS[0], raw),
  wordHighlightTransColor: (raw) => displayWordColor(WORD_COLOR_ITEMS[1], raw)
};

/**
 * 两个颜色项的控件状态：勾选态 / 取色器可用性 / 显示值，全部由**存储里的实际值**推导。
 * 「跟随」勾选 = 存的是空串；取消勾选 = 存的是 hex，取色器可编辑。
 */
function syncWordColorRows(): void {
  for (const item of WORD_COLOR_ITEMS) {
    const follow = document.getElementById(item.followId) as HTMLInputElement | null;
    const input = document.querySelector<HTMLInputElement>(`input[data-setting="${item.key}"]`);
    const following = readWordColor(item) === '';

    if (follow) follow.checked = following;
    if (input) {
      input.disabled = following;
      const shown = displayWordColor(item);
      if (input.value !== shown) input.value = shown;
    }
  }
}

/**
 * 颜色区的展开 / 收起：只看「自动字幕逐词显现」开关（设置里的实际值），不看 DOM 瞬时值。
 * 收起态不可聚焦（inert），焦点若在里面就交回给开关，别把焦点留在收起的内容上。
 */
function syncWordColorBlock(): void {
  const block = $('#word-color-block');
  if (!block) return;

  const toggle = $<HTMLInputElement>('input[data-setting="asrWordReveal"]');
  const open = settings.asrWordReveal !== false;

  if (toggle) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-controls', 'word-color-block');
  }
  block.inert = !open;

  if (open) {
    /* 先摘 hidden 并强制一次布局，让「0fr + opacity 0」的起点先落地，过渡才播得出来 */
    block.hidden = false;
    void block.offsetHeight;
    block.classList.add('is-open');
  } else {
    block.classList.remove('is-open');
    if (block.contains(document.activeElement)) toggle?.focus();
  }
}

/**
 * 「跟随」复选框：勾选 = 跟随（存空串），取消勾选 = 自定义（预填跟随色并存 hex）。
 * 取消勾选时必须预填当前跟随色，否则取色器会变成黑色（浏览器给空值的默认色）。
 */
function bindWordColorEvents(): void {
  for (const item of WORD_COLOR_ITEMS) {
    const follow = document.getElementById(item.followId) as HTMLInputElement | null;
    follow?.addEventListener('change', () => {
      if (follow.checked) {
        void updateWordColor(item.key, '');
      } else {
        const seed = followColorOf(item);
        const input = document.querySelector<HTMLInputElement>(`input[data-setting="${item.key}"]`);
        if (input) input.value = seed;
        void updateWordColor(item.key, seed);
      }
      syncWordColorRows();
    });
  }
}

/** 写一个逐词高亮颜色值（键名在类型上还没定型，先按 unknown 中转） */
function updateWordColor(key: WordColorItem['key'], value: string): void {
  const patch = { [key]: value } as unknown as Partial<ExtensionSettings>;
  void update(patch);
}

/* ══════════════════════════ 保存 ══════════════════════════ */

let saveTimer: number | undefined;
/* 防抖窗口内可能有多次改动（例如先切「括注」再切「ASR 纠错」），
   只留最后一个 patch 会把前一个静默丢掉。这里把窗口内的改动累积起来一起写。 */
let pendingPatch: Partial<ExtensionSettings> = {};

/**
 * 写设置 + 局部重绘。
 * `silent` 用于「正在输入的输入框」：Key / Base URL 每敲一个字都会走这里，
 * 若跟着重绘整个厂牌列表，输入框会被重建、光标直接跳走。
 */
async function update(rawPatch: Partial<ExtensionSettings>, options: { silent?: boolean } = {}): Promise<void> {
  const patch: Partial<ExtensionSettings> = { ...rawPatch };
  /* 两个逐词高亮颜色项过一遍归一（空串 = 跟随，或 #rgb / #rrggbb）。
     它们**永远**跟着 patch 走 ⇒ 只要本页保存过一次，落到设置里的就一定是
     这两种值之一 —— 哪怕原值是手改过的非法值。
     存储通道仍是 utils/storage.ts 那一条，这里只归一取值，不另写存取。 */
  for (const item of WORD_COLOR_ITEMS) {
    const incoming = (rawPatch as unknown as Record<string, unknown>)[item.key];
    const next = sanitizeWordColor(incoming !== undefined ? incoming : readWordColor(item));
    (patch as unknown as Record<string, unknown>)[item.key] = next;
  }
  settings = { ...settings, ...patch };
  /* 「字幕样式」里的原文色 / 译文色改了 → 跟随时取色器显示的颜色要立刻跟着变 */
  if (patch.origColor !== undefined || patch.transColor !== undefined) syncWordColorRows();
  /* 「自动字幕逐词显现」开关变了 → 颜色区跟着展开 / 收起（依据设置里的实际值） */
  if (patch.asrWordReveal !== undefined) syncWordColorBlock();
  pendingPatch = { ...pendingPatch, ...patch };
  // 预览必须读合并后的 settings：早期把 applyPreview() 放在合并之前，
  // 导致滑块/取色器改动整整滞后一次输入才反映到预览上。
  applyPreview();
  if (patch.scenario) {
    renderScenarios();
    /* 「使用中」标记要跟着搬家：常规分区改场景、或本分区点「使用此场景」都走这里 */
    renderScenePane();
  }
  if (patch.service) reflectSettings();
  /* 「自动降级」开关：只切列表的开合，不写 fallbackOrder（用户排好的顺序要留着） */
  if (patch.autoFallbackToGoogle !== undefined) syncFallbackDepend();
  /* 厂牌 / 模型 / 自定义条目任一变化都要重画列表（含「使用中」标记的移动） */
  if (!options.silent) {
    if (patch.providerId !== undefined || patch.modelName !== undefined
      || patch.service !== undefined || patch.customModels !== undefined) {
      /* renderProviderList() 末尾会一并刷新常规分区的折叠块（同一份 PROVIDERS） */
      renderProviderList();
    } else if (patch.providerKeys !== undefined || patch.providerBaseUrls !== undefined) {
      syncServiceChrome();
    }
    /* Key 有无决定「哪些厂牌能参与降级」：跟着重画降级顺序列表 */
    if (patch.providerKeys !== undefined) renderFallbackOrder();
  }

  setSaveState('saving');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    const toSave = pendingPatch;
    pendingPatch = {};
    try {
      settings = await saveStoredSettings(toSave);
      setSaveState('saved');
    } catch {
      setSaveState('error');
      toast('保存失败：浏览器存储不可用');
    }
  }, 320) as unknown as number;
}

function setSaveState(state: 'saved' | 'saving' | 'error'): void {
  const chip = $('#save-chip');
  if (!chip) return;
  chip.dataset.state = state;
  const label = chip.querySelector('b');
  if (label) label.textContent = state === 'saving' ? '保存中' : state === 'error' ? '保存失败' : '已保存';
}

/* ══════════════════════════ 场景 ══════════════════════════ */

/** 常规分区「翻译场景」折叠块是否展开；不持久化（纯视觉收纳，不新增设置项） */
let scenarioFoldOpen = false;

/** 收起态摘要用的文案：与卡片上的 hint 同一套取值，不另写一份 */
const sceneHintOf = (scene: ScenePack | undefined): string => {
  if (!scene) return '展开后选一个场景决定模型的身份与语气';
  if (!scene.prompt) return '待上传场景包';
  return scene.hint || scene.description || '';
};

function renderScenarios(): void {
  const grid = $('#scenario-grid');
  if (!grid) return;

  const scenes = getAllScenes(customPacks);
  grid.innerHTML = '';

  for (const scene of scenes) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'scenario-card' + (scene.id === settings.scenario ? ' active' : '');
    card.dataset.scenario = scene.id;

    const name = document.createElement('span');
    name.className = 'scenario-name';
    name.textContent = scene.name;

    const hint = document.createElement('span');
    hint.className = 'scenario-hint';
    hint.textContent = sceneHintOf(scene);

    card.append(name, hint);
    card.addEventListener('click', () => void update({ scenario: scene.id }));
    grid.appendChild(card);
  }

  syncScenarioFoldSummary(scenes);
}

/** 折叠块收起态摘要：当前场景名 + 一句话说明 + 场景总数（场景变多时不占满首屏） */
function syncScenarioFoldSummary(all: ScenePack[]): void {
  const current = all.find((s) => s.id === settings.scenario);

  const name = $('#fold-scenario-name');
  if (name) name.textContent = current ? current.name : '翻译场景';

  const hint = $('#fold-scenario-hint');
  if (hint) hint.textContent = sceneHintOf(current);

  const count = $('#fold-scenario-count');
  if (count) count.textContent = `${all.length} 个`;
}

/**
 * 展开 / 收起「翻译场景」。语义与「服务与模型」的厂牌展开一致：
 * 按钮上 aria-expanded、面板 hidden + inert（收起不可聚焦）、箭头只转 transform。
 */
function syncScenarioFoldState(): void {
  const fold = $('#scenario-fold');
  const toggle = $('#btn-scenario-fold');
  const panel = $('#scenario-fold-panel');
  if (!fold || !toggle || !panel) return;

  const open = scenarioFoldOpen;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.title = open ? '收起场景列表' : `展开场景列表（共 ${$('#fold-scenario-count')?.textContent || ''}）`;
  panel.inert = !open;

  if (open) {
    /* 先摘 hidden 并强制一次布局，让「0fr + opacity 0」起点先落地，过渡才播得出来 */
    panel.hidden = false;
    void panel.offsetHeight;
    fold.classList.add('is-open');
  } else {
    fold.classList.remove('is-open');
  }
}

/* ══════════════════════════ 翻译场景（提示词分层） ══════════════════════════
 * 与「常规」分区的场景卡片分工：
 *   - 常规分区 = 遥控器：点一下即「换用」，只关心选哪个；
 *   - 本分区 = 工作台：点列表只是「查看」，看清这套 prompt 由哪些层拼成、谁能改，
 *     换用必须显式点「使用此场景」——避免「想看一眼别的场景」把正在用的换掉。
 * 数据全部来自 utils/prompt-layers.ts / utils/packs.ts，页面不自己拼文案、不留副本。
 */

/** 每层由什么控制：用户看到「我改这一层会怎样」的答案（要求里的六种口径） */
const LAYER_OWNERS: Record<string, string> = {
  scene: '场景自带',
  common: '全局固定',
  annotation: '受「专有名词括注原文」设置控制',
  asr: '受「ASR 纠错授权」控制',
  reasoning: '受推理档位控制',
  glossary: '按本批命中的术语动态生成',
  output: '格式契约不可改'
};

const scenes = (): ScenePack[] => getAllScenes(customPacks);

/** 当前查看的场景：优先用户点的，其次正在使用的，最后退回第一个 */
function viewingScene(): ScenePack | undefined {
  const all = scenes();
  return all.find((s) => s.id === viewingSceneId)
    || all.find((s) => s.id === settings.scenario)
    || all[0];
}

function renderScenePane(): void {
  renderSceneList();
  renderSceneDetail();
}

function renderSceneList(): void {
  const list = $('#scene-list');
  if (!list) return;
  list.innerHTML = '';

  const all = scenes();
  const viewed = viewingScene();
  const total = $('#scene-total');
  if (total) total.textContent = String(all.length);

  for (const scene of all) {
    const isViewed = viewed?.id === scene.id;
    const inUse = scene.id === settings.scenario;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pack-item' + (isViewed ? ' active' : '');
    btn.dataset.scene = scene.id;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(isViewed));
    /* 当前「查看」项（不是当前使用项）：aria-current 让读屏也能分辨 */
    if (isViewed) btn.setAttribute('aria-current', 'true');

    const top = document.createElement('span');
    top.className = 'pack-item-top';
    const name = document.createElement('span');
    name.className = 'pack-item-name';
    name.textContent = scene.name;
    top.appendChild(name);
    if (inUse) {
      const flag = document.createElement('span');
      flag.className = 'pill pill-ok';
      flag.textContent = '使用中';
      top.appendChild(flag);
    }

    const meta = document.createElement('span');
    meta.className = 'pack-item-meta';
    meta.textContent = `${scene.builtIn ? '内置' : '自定义'}${scene.prompt ? '' : ' · 待配置提示词'}`;

    btn.append(top, meta);
    /* 只切「查看对象」，不动 settings.scenario（换用是右侧那个显式按钮的事） */
    btn.addEventListener('click', () => {
      viewingSceneId = scene.id;
      sceneEditing = false;
      sceneError = '';
      /* 左侧列表就地换选中态，右侧详情重绘：列表不重建，高亮过渡才播得出来 */
      syncSceneSelection();
      renderSceneDetail();
    });
    list.appendChild(btn);
  }
}

/** 「查看中」项切换：只改 class / aria-current，不重建列表 */
function syncSceneSelection(): void {
  const list = $('#scene-list');
  if (!list) return;
  const viewed = viewingScene();
  for (const btn of Array.from(list.querySelectorAll<HTMLElement>('.pack-item'))) {
    const on = btn.dataset.scene === (viewed?.id ?? '');
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
    if (on) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  }
}

function renderSceneDetail(): void {
  const host = $('#scene-detail');
  if (!host) return;
  host.innerHTML = '';

  const scene = viewingScene();
  if (!scene) {
    const empty = document.createElement('p');
    empty.className = 'empty-desc';
    empty.textContent = '还没有任何翻译场景。';
    host.appendChild(empty);
    return;
  }

  const inUse = scene.id === settings.scenario;
  /* resolveScenePrompt：占位场景（prompt 为空）实际注入的是 general 的文案，
     这里必须走同一个函数，否则「界面看到的」与「发给模型的」会各说一套 */
  const resolved = resolveScenePrompt(scene.id, customPacks);
  const targetLang = settings.targetLang || DEFAULT_SETTINGS.targetLang;
  /* 不传 glossaryBlock：术语层按批生成，界面不预览空壳（见下方 ghost 说明） */
  const layers = buildPromptLayers(resolved.prompt, settings, targetLang);

  host.appendChild(sceneHead(scene, resolved.name, inUse));

  const intro = document.createElement('p');
  intro.className = 'scene-intro';
  intro.textContent = '这是实际注入给翻译模型的 system prompt，从上到下依次拼接；除「场景人设」外都不能在此修改。';
  host.appendChild(intro);

  const layerList = document.createElement('div');
  layerList.className = 'layer-list';

  const byKey = new Map(layers.map((layer) => [layer.key, layer]));
  for (const key of PROMPT_LAYER_ORDER) {
    if (key === 'glossary') {
      /* 术语层不传 glossaryBlock 就不存在；但顺序得让人看见，所以留一句说明位 */
      layerList.appendChild(glossaryGhost());
      continue;
    }
    const layer = byKey.get(key);
    /* 空层按 body 判空隐藏（reasoning 某些档位可能返回空串） */
    if (!layer || !layer.body.trim()) continue;
    /* 序号取「在 PROMPT_LAYER_ORDER 里的位置」，不按可见卡片数累加：
       术语层只留说明位时，输出契约仍该是第 7 层，不能缩成第 6 层 */
    layerList.appendChild(layerCard(layer, PROMPT_LAYER_ORDER.indexOf(key) + 1, scene, resolved.prompt));
  }

  host.appendChild(layerList);
  syncLayerClamp();
}

function sceneHead(scene: ScenePack, resolvedName: string, inUse: boolean): HTMLElement {
  const head = document.createElement('div');
  head.className = 'scene-head';

  const title = document.createElement('h2');
  title.className = 'scene-title';
  title.textContent = scene.name;

  const desc = document.createElement('p');
  desc.className = 'scene-desc';
  desc.textContent = scene.description || scene.hint || '';

  const note = document.createElement('p');
  note.className = 'row-note';
  note.textContent = scene.builtIn
    ? '内置场景 · 只读：改文案会另存为一个自定义场景副本并自动启用，内置文案本身不动。'
    : '自定义场景 · 可编辑：改文案直接更新这个场景。';

  head.append(title, desc, note);

  /* 占位场景：没有自己的提示词，实际注入的是 general 的文案（要让用户看见这件事） */
  if (!scene.prompt) {
    const fallback = document.createElement('p');
    fallback.className = 'row-note scene-fallback';
    fallback.textContent = `这个场景还没有自己的提示词，实际注入的是「${resolvedName}」的人设；编辑保存后会变成这个场景自己的文案。`;
    head.appendChild(fallback);
  }

  const actions = document.createElement('div');
  actions.className = 'scene-actions';

  const useBtn = document.createElement('button');
  useBtn.type = 'button';
  useBtn.className = 'btn btn-primary';
  useBtn.id = 'btn-use-scene';
  useBtn.textContent = inUse ? '正在使用' : '使用此场景';
  useBtn.disabled = inUse;
  useBtn.setAttribute('aria-disabled', String(inUse));
  useBtn.title = inUse ? '当前正在使用这个场景' : '切换到这个场景（已有字幕会按新文案重译一次）';
  useBtn.addEventListener('click', () => {
    if (inUse) return;
    viewingSceneId = scene.id;
    /* 写 scenario 设置项并落盘（update() 内部已重绘本分区与常规分区的场景卡） */
    void update({ scenario: scene.id });
    toast(`已切换到「${scene.name}」`);
  });
  actions.appendChild(useBtn);

  head.appendChild(actions);
  return head;
}

function glossaryGhost(): HTMLElement {
  const ghost = document.createElement('p');
  ghost.className = 'layer-ghost';
  ghost.textContent = '第 6 层 · 本批命中术语：按本批命中的术语动态生成，此处不预览（只注入本批真命中的条目，术语本身在「术语库」分区维护）。';
  return ghost;
}

function layerCard(layer: PromptLayer, index: number, scene: ScenePack, resolvedPrompt: string): HTMLElement {
  const card = document.createElement('article');
  card.className = 'layer-card';
  card.dataset.layer = layer.key;

  const head = document.createElement('header');
  head.className = 'layer-head';

  const idx = document.createElement('span');
  idx.className = 'layer-index';
  idx.textContent = String(index);

  const title = document.createElement('span');
  title.className = 'layer-title';
  title.textContent = layer.title;

  /* 卡片右上角：这一层由什么控制 */
  const owner = document.createElement('span');
  owner.className = 'layer-owner';
  owner.textContent = LAYER_OWNERS[layer.key] || '';

  head.append(idx, title, owner);
  card.appendChild(head);

  const summary = document.createElement('p');
  summary.className = 'layer-summary';
  summary.textContent = layer.summary;
  card.appendChild(summary);

  if (layer.detail) {
    const detail = document.createElement('p');
    detail.className = 'layer-detail';
    detail.textContent = layer.detail;
    card.appendChild(detail);
  }

  /* 只有 scene 层 editable === true：编辑态用它自己的编辑器，其余层一律只读正文 */
  if (layer.editable && sceneEditing) {
    card.appendChild(sceneEditor());
  } else {
    const body = document.createElement('pre');
    body.className = 'layer-body';
    body.textContent = layer.body;
    card.appendChild(body);

    if (layer.editable) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn btn-quiet layer-edit';
      edit.id = 'btn-edit-scene-prompt';
      edit.textContent = '编辑';
      edit.addEventListener('click', () => {
        sceneEditing = true;
        sceneError = '';
        /* 草稿从「该场景自己的文案」起：占位场景就有 general 的文案可改 */
        sceneDraft = scene.prompt || resolvedPrompt;
        renderSceneDetail();
      });
      card.appendChild(edit);
    }

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'link-btn layer-more';
    more.textContent = '展开全文';
    /* 这是一次「同内容展开」而不是 0 → 内容：正文默认夹到 8 行，展开到 24 行，
       所以走 max-height（allowed 属性）而不是 grid-template-rows；时长同为 --dur-base */
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => {
      const open = card.classList.toggle('is-open');
      more.textContent = open ? '收起' : '展开全文';
      more.setAttribute('aria-expanded', String(open));
    });
    card.appendChild(more);

    /* 先按估算决定要不要折叠，页签可见后用真实高度校正（见 syncLayerClamp） */
    card.classList.toggle('is-clamped', estimateLayerLines(layer.body) > LAYER_VISIBLE_LINES);
  }

  return card;
}

/** 正文默认显示的行数（超出折叠 +「展开全文」） */
const LAYER_VISIBLE_LINES = 8;

/**
 * 估算正文占几行：CJK 记 1 宽、拉丁记 0.55 宽，按每行 54 宽度折算。
 * 为什么不用 scrollHeight：面板未激活时 display:none，量出来全是 0；
 * 估算值先兜住，页签激活后 syncLayerClamp() 再用真实高度纠正。
 */
function estimateLayerLines(text: string): number {
  return text.split('\n').reduce((sum, line) => {
    let width = 0;
    for (const ch of line) width += ch.charCodeAt(0) > 0x2000 ? 1 : 0.55;
    return sum + Math.max(1, Math.ceil(width / 54));
  }, 0);
}

/** 用真实高度校正折叠按钮：只在卡片可见时量，避免 display:none 下的 0 高度误判 */
function syncLayerClamp(): void {
  window.requestAnimationFrame(() => {
    $$('.layer-card').forEach((card) => {
      const body = card.querySelector<HTMLElement>('.layer-body');
      if (!body || body.offsetParent === null) return;
      const myCard = card as HTMLElement;
      if (myCard.classList.contains('is-open')) return;
      myCard.classList.toggle('is-clamped', body.scrollHeight - body.clientHeight > 2);
    });
  });
}

/** 场景人设编辑器：textarea + 保存 / 取消，长度不合格给行内错误 */
function sceneEditor(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'scene-editor-wrap';

  const label = document.createElement('label');
  label.className = 'field scene-editor-field';
  label.htmlFor = 'scene-prompt-input';

  const labelText = document.createElement('span');
  labelText.className = 'field-label';
  labelText.textContent = `场景人设文案（${SCENE_PROMPT_MIN}–${SCENE_PROMPT_MAX} 字）`;

  const textarea = document.createElement('textarea');
  textarea.className = 'ctl scene-editor';
  textarea.id = 'scene-prompt-input';
  textarea.rows = 10;
  textarea.spellcheck = false;
  /* 草稿由「编辑」按钮写入；这里不再回退到场景原文，
     否则用户把内容删空时会看到「不能为空」但框里又有字 */
  textarea.value = sceneDraft;
  textarea.addEventListener('input', () => {
    sceneDraft = textarea.value;
  });

  label.append(labelText, textarea);

  const error = document.createElement('p');
  error.className = 'field-error' + (sceneError ? '' : ' hidden');
  error.id = 'scene-prompt-error';
  error.setAttribute('role', 'alert');
  error.textContent = sceneError;

  const actions = document.createElement('div');
  actions.className = 'scene-actions';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary';
  save.id = 'btn-save-scene-prompt';
  save.textContent = '保存';
  save.addEventListener('click', () => void saveScenePrompt());

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-quiet';
  cancel.id = 'btn-cancel-scene-prompt';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => {
    sceneEditing = false;
    sceneError = '';
    renderSceneDetail();
  });

  actions.append(save, cancel);
  wrap.append(label, error, actions);
  return wrap;
}

function validateScenePrompt(text: string): string {
  if (!text) return '场景人设不能为空。';
  if (text.length < SCENE_PROMPT_MIN) {
    return `至少 ${SCENE_PROMPT_MIN} 字才能有效指导翻译，当前 ${text.length} 字。`;
  }
  if (text.length > SCENE_PROMPT_MAX) {
    return `最多 ${SCENE_PROMPT_MAX} 字，当前 ${text.length} 字，请删减后再保存（不会自动截断）。`;
  }
  return '';
}

/** id 唯一：内置包永远不覆盖，自定义 id 撞了就加后缀重试 */
function uniqueSceneId(base: string): string {
  const taken = new Set(scenes().map((s) => s.id));
  let candidate = base;
  let n = 1;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

/** 内置场景改文案 = 另存一个自定义副本（内置文案本身不动） */
function buildSceneCopy(scene: ScenePack, prompt: string): ScenePack {
  const slug = scene.id.replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'scene';
  return {
    id: uniqueSceneId(`custom-scene-${slug}-${Date.now().toString(36)}`),
    name: `${scene.name} · 自定义`,
    description: scene.description,
    hint: scene.hint,
    builtIn: false,
    prompt
  };
}

async function saveScenePrompt(): Promise<void> {
  const scene = viewingScene();
  if (!scene) return;

  const textarea = $('#scene-prompt-input') as HTMLTextAreaElement | null;
  const text = (textarea?.value ?? sceneDraft).trim();
  const message = validateScenePrompt(text);
  if (message) {
    /* 行内错误：不静默截断、不自动改写用户的文案 */
    sceneDraft = textarea?.value ?? sceneDraft;
    sceneError = message;
    renderSceneDetail();
    return;
  }

  let targetId = scene.id;
  let copied = false;
  if (scene.builtIn) {
    const copy = buildSceneCopy(scene, text);
    customPacks.scenes = [...customPacks.scenes, copy];
    targetId = copy.id;
    copied = true;
  } else {
    const pack = customPacks.scenes.find((p) => p.id === scene.id);
    if (!pack) {
      sceneError = '保存失败：这个自定义场景已不存在，请刷新页面后重试。';
      renderSceneDetail();
      return;
    }
    pack.prompt = text;
  }

  const ok = await saveScenePacks(customPacks.scenes);
  if (!ok) {
    sceneError = '保存失败：浏览器存储不可用。';
    renderSceneDetail();
    return;
  }

  sceneEditing = false;
  sceneError = '';
  sceneDraft = '';
  viewingSceneId = targetId;

  /* 内置 → 副本：顺带切到副本（用户改的本来就是「我要用这套」） */
  if (copied) await update({ scenario: targetId });
  else renderScenePane();

  const copyName = customPacks.scenes.find((p) => p.id === targetId)?.name || '';
  toast(
    copied
      ? `已另存为自定义场景「${copyName}」并启用；该场景已更新，已有字幕会按新文案重译一次`
      : '该场景已更新，已有字幕会按新文案重译一次'
  );
}

/* ══════════════════════════ 字幕预览 ══════════════════════════ */

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(15, 23, 42, ${alpha})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyPreview(): void {
  const sub = $('#preview-sub');
  const orig = $('#preview-orig');
  const trans = $('#preview-trans');
  if (!sub || !orig || !trans) return;

  sub.style.top = `${settings.offsetY}%`;
  sub.style.bottom = 'auto';
  sub.style.background = hexToRgba(settings.bgColor, settings.bgOpacity / 100);
  sub.style.flexDirection = settings.layoutOrder === 'original_top' ? 'column' : 'column-reverse';

  const both = settings.displayMode === 'bilingual';
  orig.style.display = settings.displayMode === 'translation_only' ? 'none' : 'block';
  trans.style.display = settings.displayMode === 'original_only' ? 'none' : 'block';

  const origSize = both ? Math.round(settings.fontSize * 0.82) : settings.fontSize;
  orig.style.fontSize = `${origSize}px`;
  orig.style.color = settings.origColor;
  trans.style.fontSize = `${settings.fontSize}px`;
  trans.style.color = settings.transColor;
}

/* ══════════════════════════ 术语库 ══════════════════════════ */

const packs = (): GlossaryPack[] => getAllGlossaryPacks(customPacks);

function activePack(): GlossaryPack | undefined {
  return packs().find((p) => p.id === activePackId);
}

function renderPackList(): void {
  const list = $('#pack-list');
  if (!list) return;
  list.innerHTML = '';

  const all = packs();
  const total = $('#pack-total');
  if (total) total.textContent = String(all.reduce((sum, p) => sum + p.entries.length, 0));

  for (const pack of all) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pack-item' + (pack.id === activePackId ? ' active' : '');
    btn.dataset.pack = pack.id;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(pack.id === activePackId));

    const top = document.createElement('span');
    top.className = 'pack-item-top';
    const name = document.createElement('span');
    name.className = 'pack-item-name';
    name.textContent = pack.name;
    const count = document.createElement('span');
    count.className = 'pack-item-count';
    count.textContent = String(pack.entries.length);
    top.append(name, count);

    const meta = document.createElement('span');
    meta.className = 'pack-item-meta';
    meta.textContent = pack.builtIn ? '内置 · 只读' : '自定义 · 可编辑';

    btn.append(top, meta);
    btn.addEventListener('click', () => {
      activePackId = pack.id;
      editingIndex = -1;
      /* 就地换选中态：重建列表会让新节点直接落成终态，高亮过渡看不到 */
      syncPackSelection();
      renderTable();
    });
    list.appendChild(btn);
  }
}

/** 选中项切换只改 class / aria，不重建列表（.pack-item 的背景与左侧标线靠过渡接上） */
function syncPackSelection(): void {
  const list = $('#pack-list');
  if (!list) return;
  for (const btn of Array.from(list.querySelectorAll<HTMLElement>('.pack-item'))) {
    const on = btn.dataset.pack === activePackId;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  }
}

function filteredEntries(pack: GlossaryPack): Array<{ entry: GlossaryEntry; index: number }> {
  const keyword = searchTerm.trim().toLowerCase();
  return pack.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false;
      if (!keyword) return true;
      return [entry.ja, entry.zh, entry.en || ''].join(' ').toLowerCase().includes(keyword);
    });
}

function renderTable(): void {
  const tbody = $('#gloss-tbody');
  const empty = $('#editor-empty');
  const badge = $('#editor-count');
  const banner = $('#readonly-banner');
  if (!tbody) return;

  const pack = activePack();
  tbody.innerHTML = '';
  if (!pack) {
    empty?.classList.remove('hidden');
    if (badge) badge.textContent = '';
    return;
  }

  banner?.classList.toggle('hidden', !pack.builtIn);

  const rows = filteredEntries(pack);
  if (badge) badge.textContent = `${rows.length} / ${pack.entries.length} 条`;
  empty?.classList.toggle('hidden', rows.length > 0 || Boolean(searchTerm));

  rows.forEach(({ entry, index }, order) => {
    const tr = document.createElement('tr');
    tr.style.animation = `rowEnter var(--dur-fast) var(--ease-out-expo) both`;
    tr.style.animationDelay = `${Math.min(order, 12) * 18}ms`;

    if (index === editingIndex) {
      tr.classList.add('is-editing');
      tr.append(editCell('ja', entry.ja), editCell('zh', entry.zh), editCell('en', entry.en || ''), editCategoryCell(entry.category), opCell(index, true));
    } else {
      tr.append(
        textCell(entry.ja, 'cell-ja'),
        textCell(entry.zh, 'cell-zh'),
        textCell(entry.en || '—', ''),
        textCell(GLOSSARY_CATEGORY_LABELS[entry.category] || '用语', 'cell-cat'),
        opCell(index, false)
      );
    }
    tbody.appendChild(tr);
  });
}

function textCell(text: string, cls: string): HTMLTableCellElement {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = text;
  td.title = text;
  return td;
}

function editCell(field: 'ja' | 'zh' | 'en', value: string): HTMLTableCellElement {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.className = 'gloss-input';
  input.value = value;
  input.dataset.field = field;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEditing();
    if (e.key === 'Escape') cancelEditing();
  });
  td.appendChild(input);
  return td;
}

function editCategoryCell(category: GlossaryCategory): HTMLTableCellElement {
  const td = document.createElement('td');
  const select = document.createElement('select');
  select.className = 'gloss-input';
  select.dataset.field = 'category';
  for (const [value, label] of Object.entries(GLOSSARY_CATEGORY_LABELS)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === category) opt.selected = true;
    select.appendChild(opt);
  }
  td.appendChild(select);
  return td;
}

function opCell(index: number, editing: boolean): HTMLTableCellElement {
  const td = document.createElement('td');
  const wrap = document.createElement('div');
  wrap.className = 'row-ops';

  const pack = activePack();
  const readonly = pack?.builtIn;

  if (editing) {
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'op-btn';
    save.textContent = '保存';
    save.addEventListener('click', saveEditing);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'op-btn';
    cancel.textContent = '取消';
    cancel.addEventListener('click', cancelEditing);

    wrap.append(save, cancel);
  } else {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'op-btn';
    edit.textContent = '编辑';
    edit.disabled = Boolean(readonly);
    edit.addEventListener('click', () => {
      if (readonly) {
        toast('内置术语库只读，可先「另存为自定义副本」');
        return;
      }
      editingIndex = index;
      renderTable();
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'op-btn op-btn-danger';
    del.textContent = '删除';
    del.disabled = Boolean(readonly);
    del.addEventListener('click', () => void deleteEntry(index));

    wrap.append(edit, del);
  }

  td.appendChild(wrap);
  return td;
}

function editablePack(): GlossaryPack | undefined {
  const pack = activePack();
  if (!pack || pack.builtIn) return undefined;
  return customPacks.glossaries.find((p) => p.id === pack.id);
}

function saveEditing(): void {
  const pack = editablePack();
  if (!pack) return;
  const inputs = $$<HTMLInputElement | HTMLSelectElement>('#gloss-tbody .gloss-input');
  const get = (field: string) => inputs.find((i) => i.dataset.field === field);

  const ja = (get('ja') as HTMLInputElement)?.value.trim() || '';
  const zh = (get('zh') as HTMLInputElement)?.value.trim() || '';
  if (!ja || !zh) {
    toast('日文与中文为必填项');
    return;
  }

  pack.entries[editingIndex] = {
    ...pack.entries[editingIndex],
    ja,
    zh,
    en: (get('en') as HTMLInputElement)?.value.trim() || undefined,
    category: ((get('category') as HTMLSelectElement)?.value as GlossaryCategory) || 'term'
  };

  editingIndex = -1;
  void persistGlossary('已保存条目');
}

function cancelEditing(): void {
  editingIndex = -1;
  renderTable();
}

async function deleteEntry(index: number): Promise<void> {
  const pack = editablePack();
  if (!pack) return;
  const entry = pack.entries[index];
  if (!entry) return;
  if (!window.confirm(`删除「${entry.ja} → ${entry.zh}」？`)) return;

  pack.entries.splice(index, 1);
  editingIndex = -1;
  await persistGlossary('已删除条目');
}

async function persistGlossary(message: string): Promise<void> {
  const ok = await saveGlossaryPacks(customPacks.glossaries);
  if (!ok) {
    toast('保存失败：浏览器存储不可用');
    return;
  }
  renderPackList();
  renderTable();
  toast(message);
}

function bindGlossaryEvents(): void {
  $('#gloss-search')?.addEventListener('input', (e) => {
    searchTerm = (e.target as HTMLInputElement).value;
    renderTable();
  });

  $('#gloss-category')?.addEventListener('change', (e) => {
    categoryFilter = (e.target as HTMLSelectElement).value as GlossaryCategory | 'all';
    renderTable();
  });

  $('#btn-add-entry')?.addEventListener('click', () => {
    const pack = editablePack();
    if (!pack) {
      toast('内置术语库只读，请先另存为自定义副本');
      return;
    }
    pack.entries.unshift({ id: `custom-${Date.now()}`, ja: '', zh: '', category: 'term', source: '手动添加', sourceType: 'community' });
    editingIndex = 0;
    searchTerm = '';
    categoryFilter = 'all';
    const searchEl = $('#gloss-search') as HTMLInputElement | null;
    if (searchEl) searchEl.value = '';
    renderTable();
  });

  $('#btn-clone-pack')?.addEventListener('click', () => {
    const pack = activePack();
    if (!pack) return;
    const copy: GlossaryPack = {
      id: `custom-${Date.now().toString(36)}`,
      name: `${pack.name}（副本）`,
      description: pack.description,
      builtIn: false,
      entries: pack.entries.map((e) => ({ ...e }))
    };
    customPacks.glossaries.push(copy);
    activePackId = copy.id;
    void persistGlossary('已另存为自定义副本，可以编辑了');
  });

  $('#btn-export-pack')?.addEventListener('click', () => {
    const pack = activePack();
    if (!pack) return;
    const payload = {
      version: 1,
      name: pack.name.replace(/（副本）$/, ''),
      description: pack.description,
      entries: pack.entries.map(({ id, ...rest }) => rest)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pack.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`已导出 ${pack.entries.length} 条`);
  });

  $('#btn-import-pack')?.addEventListener('click', () => $('#file-import')?.click());
  $('#file-import')?.addEventListener('change', (e) => void importPack(e.target as HTMLInputElement));

  /* 新建术语库：弹层收名称 + 描述，确认后建一个空包并自动选中 */
  $('#btn-new-pack')?.addEventListener('click', () => openNewPackDialog());
  $('#np-cancel')?.addEventListener('click', () => closeNewPackDialog());
  $('#np-save')?.addEventListener('click', () => createGlossaryPack());
  $('#new-pack-dialog')?.addEventListener('close', () => setNewPackError(''));
  for (const id of ['#np-name', '#np-desc']) {
    $(id)?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        e.preventDefault();
        createGlossaryPack();
      }
    });
  }
}

async function importPack(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  try {
    const raw = JSON.parse(await file.text());
    const result = validateGlossaryPack(raw);
    if (!result.ok || !result.pack) {
      toast(`导入失败：${result.errors.slice(0, 2).join('；')}`);
      return;
    }
    const pack = result.pack;
    if (BUILTIN_GLOSSARY_PACKS.some((p) => p.name === pack.name)) {
      pack.name = `${pack.name}（自定义）`;
    }
    customPacks.glossaries = [...customPacks.glossaries.filter((p) => p.name !== pack.name), pack];
    activePackId = pack.id;
    await persistGlossary(`已导入「${pack.name}」${pack.entries.length} 条`);
  } catch {
    toast('导入失败：文件不是合法 JSON');
  }
}

/* ══════════════════════════ 新建术语库（空包） ══════════════════════════ */

function openNewPackDialog(): void {
  const dialog = $('#new-pack-dialog') as HTMLDialogElement | null;
  if (!dialog) return;
  const name = $('#np-name') as HTMLInputElement | null;
  const desc = $('#np-desc') as HTMLInputElement | null;
  if (name) name.value = '';
  if (desc) desc.value = '';
  setNewPackError('');
  dialog.showModal();
  name?.focus();
}

function closeNewPackDialog(): void {
  closeDialogAnimated($('#new-pack-dialog') as HTMLDialogElement | null);
}

function setNewPackError(message: string): void {
  const el = $('#np-error');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}

/** id 唯一：内置 id 与既有自定义 id 都避开（撞了就加后缀重试，不静默覆盖） */
function uniquePackId(name: string): string {
  const taken = new Set(packs().map((p) => p.id));
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'pack';
  const base = `custom-glossary-${slug}-${Date.now().toString(36)}`;
  let candidate = base;
  let n = 1;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

/**
 * 新建一个空术语库。
 *
 * 注意：这里**不经过 validateGlossaryPack** —— 那个函数是「上传一份 JSON」的入口校验，
 * 明确要求 entries 非空（没有内容的文件没有导入意义）。而「先建壳、再逐条填」是另一条
 * 路径，走校验会一创建就报错。空包对下游是安全的：匹配阶段命中 0 条、指纹按内容算。
 */
function createGlossaryPack(): void {
  const nameInput = $('#np-name') as HTMLInputElement | null;
  const descInput = $('#np-desc') as HTMLInputElement | null;
  const name = (nameInput?.value || '').trim();
  const description = (descInput?.value || '').trim();

  if (!name) {
    setNewPackError('请填写术语库名称。');
    nameInput?.focus();
    return;
  }
  if (name.length > 40) {
    setNewPackError('名称最多 40 字。');
    nameInput?.focus();
    return;
  }
  if (description.length > 120) {
    setNewPackError('描述最多 120 字。');
    descInput?.focus();
    return;
  }
  if (packs().some((p) => p.name === name)) {
    setNewPackError(`已经有同名的术语库「${name}」，换个名字，或直接在那个包里改。`);
    nameInput?.focus();
    return;
  }

  const pack: GlossaryPack = {
    id: uniquePackId(name),
    name,
    description: description || '新建空包',
    builtIn: false,
    entries: []
  };

  customPacks.glossaries = [...customPacks.glossaries, pack];
  activePackId = pack.id;
  /* 新包是空的：清掉筛选条件，否则会显示「0 / 0 条」但看起来像被过滤空了 */
  searchTerm = '';
  categoryFilter = 'all';
  const searchEl = $('#gloss-search') as HTMLInputElement | null;
  if (searchEl) searchEl.value = '';
  const categoryEl = $('#gloss-category') as HTMLSelectElement | null;
  if (categoryEl) categoryEl.value = 'all';
  editingIndex = -1;

  closeNewPackDialog();
  void persistGlossary(`已创建「${pack.name}」，点「新增条目」添加第一条`);
}

/* ══════════════════════════ 翻译场景：新建 / 导入 / 模板 ══════════════════════════
 * 三条入口都在左侧场景栏底部（与术语库同一套 .pack-rail-foot 按钮）：
 *   ＋ 新建场景   → 收名称 + 描述 + 提示词，走 validateScenePack 同一条校验后入库
 *   导入 JSON     → 选文件 → validateScenePack → 成功入库并选中，失败逐条列出原因
 *   用 AI 生成模板 → 弹层给一段可整段投喂给任意大模型的提示词（见下方模板常量）
 * 三者都**不切换正在使用的场景**：本分区的语义是「选中 = 查看」，换用要显式点按钮。
 */

/** 新建场景的最小提示词种子：≥ SCENE_PROMPT_MIN，别让用户面对一个过不了校验的空框 */
const SCENE_PROMPT_SEED = '你是一位视频字幕译者，把日文口语译成自然的中文。要求：口语化、不逐词直译；保留说话人的语气与情绪；数字、单位与专有名词按通用译名处理；不添加原文没有的信息。';

function openNewSceneDialog(): void {
  const dialog = $('#new-scene-dialog') as HTMLDialogElement | null;
  if (!dialog) return;

  const name = $('#ns-name') as HTMLInputElement | null;
  const desc = $('#ns-desc') as HTMLInputElement | null;
  const prompt = $('#ns-prompt') as HTMLTextAreaElement | null;
  if (name) name.value = '';
  if (desc) desc.value = '';
  /* 空框是「新建」最糟的起点：预填一段能过校验的最小提示词，用户改两句就能用 */
  if (prompt) prompt.value = SCENE_PROMPT_SEED;
  setNewSceneError('');

  dialog.showModal();
  name?.focus();
}

function closeNewSceneDialog(): void {
  closeDialogAnimated($('#new-scene-dialog') as HTMLDialogElement | null);
}

function setNewSceneError(message: string): void {
  const el = $('#ns-error');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}

/**
 * 新建一个自定义翻译场景。
 * 校验走 validateScenePack（与「导入 JSON」同一条路径）：name 1~40、prompt 20~4000、
 * 含未知字段直接拒。只有全部通过才动 customPacks，绝不半入库。
 */
async function createScenePack(): Promise<void> {
  const nameInput = $('#ns-name') as HTMLInputElement | null;
  const descInput = $('#ns-desc') as HTMLInputElement | null;
  const promptInput = $('#ns-prompt') as HTMLTextAreaElement | null;

  const name = (nameInput?.value || '').trim();
  const description = (descInput?.value || '').trim();
  const prompt = (promptInput?.value || '').trim();

  if (!name) {
    setNewSceneError('请填写场景名称。');
    nameInput?.focus();
    return;
  }
  if (description.length > 120) {
    setNewSceneError('描述最多 120 字。');
    descInput?.focus();
    return;
  }
  if (scenes().some((s) => s.name === name)) {
    setNewSceneError(`已经有同名的场景「${name}」，换一个名字，或直接在右侧改那个场景的提示词。`);
    nameInput?.focus();
    return;
  }

  const result = validateScenePack({ version: 1, name, description, hint: '', prompt });
  if (!result.ok || !result.pack) {
    setNewSceneError(result.errors.join('；'));
    promptInput?.focus();
    return;
  }

  const pack: ScenePack = { ...result.pack, id: uniqueSceneId(result.pack.id) };
  customPacks.scenes = [...customPacks.scenes, pack];
  const ok = await saveScenePacks(customPacks.scenes);
  if (!ok) {
    setNewSceneError('保存失败：浏览器存储不可用。');
    return;
  }

  closeNewSceneDialog();
  viewingSceneId = pack.id;
  sceneEditing = false;
  sceneError = '';
  /* 常规分区的场景卡也要多一张（只多一张卡，不把它变成「使用中」） */
  renderScenarios();
  renderScenePane();
  toast(`已创建场景「${pack.name}」，点右侧「使用此场景」即可切换过去`);
}

function clearSceneImportReport(): void {
  const box = $('#scene-import-report');
  if (!box) return;
  box.innerHTML = '';
  box.classList.add('hidden');
}

/** 导入失败：逐条列出原因（字段级 / 条目级），并把区块放在分区顶部让人一眼看到 */
function showSceneImportReport(title: string, errors: string[]): void {
  const box = $('#scene-import-report');
  if (!box) return;
  box.innerHTML = '';

  const head = document.createElement('p');
  head.className = 'import-report-title';
  head.textContent = title;

  const list = document.createElement('ul');
  list.className = 'import-report-list';
  for (const message of errors) {
    const li = document.createElement('li');
    li.textContent = message;
    list.appendChild(li);
  }

  box.append(head, list);
  box.classList.remove('hidden');
  toast(`${title}${errors.length > 0 ? `：${errors[0]}` : ''}`);
}

/**
 * 导入场景 JSON：解析 → validateScenePack → 通过才入库。
 * 失败路径只写报告区，不碰 customPacks —— 「不合法文件绝不半入库」。
 */
async function importScenePack(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  clearSceneImportReport();

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    showSceneImportReport('导入失败：文件不是合法 JSON（未写入任何内容）', [
      'JSON.parse 报错：常见原因是多余逗号、单引号、// 注释，或用 … 省略了条目'
    ]);
    return;
  }

  const result = validateScenePack(raw);
  if (!result.ok || !result.pack) {
    showSceneImportReport('导入失败：校验未通过（未写入任何内容）', result.errors);
    return;
  }

  const pack = result.pack;
  /* 与已有场景（含内置）同名时加后缀，不静默覆盖别人 */
  if (scenes().some((s) => s.name === pack.name)) pack.name = `${pack.name}（自定义）`;
  pack.id = uniqueSceneId(pack.id);

  customPacks.scenes = [...customPacks.scenes.filter((p) => p.name !== pack.name), pack];
  const ok = await saveScenePacks(customPacks.scenes);
  if (!ok) {
    showSceneImportReport('导入失败：浏览器存储不可用（未写入）', ['chrome.storage.local 不可用，请检查扩展权限']);
    return;
  }

  clearSceneImportReport();
  viewingSceneId = pack.id;
  sceneEditing = false;
  sceneError = '';
  renderScenarios();
  renderScenePane();
  toast(`已导入场景「${pack.name}」，点右侧「使用此场景」即可切换过去`);
}

/* ───────────────────────── 模板提示词（界面与文档同源） ─────────────────────────
 * 为什么放在这里而不是 HTML 里：模板正文要跟 docs/PACK-UPLOAD-SPEC.md 的字段表一字不差，
 * 写死在 HTML 就会变成「改规范要改两处」的第二个真相。这里给的是纯文本常量，
 * 拼进 textarea 供整段复制，投喂给任意大模型后产出可直接导入的 JSON。
 * 两份模板必须分开：术语库是 entries 数组，场景是单条 prompt，糊成一份会误导模型。
 */

const TEMPLATE_HEADER = [
  '# 需求：',
  '',
  '## 只输出 JSON',
  '- 不要解释、不要前后缀客套话、不要 markdown 代码块围栏（不要 ```json）。',
  '- 输出必须能被 JSON.parse 直接解析：不要尾逗号、不要注释、不要单引号、不要用 … 省略内容。'
].join('\n');

/** 术语库模板：字段表与 docs/PACK-UPLOAD-SPEC.md §一 一致 */
export function glossaryTemplatePrompt(): string {
  return [
    TEMPLATE_HEADER,
    '',
    '你是「字幕断句翻译器」的术语库 JSON 生成器。按上面这行需求，输出一个可以直接导入设置页「术语库」分区的 JSON 对象。',
    '',
    '## 顶层字段（只允许这 4 个）',
    '| 字段 | 必填 | 限制 | 说明 |',
    '|---|---|---|---|',
    '| name | ✅ | 字符串，1~40 字 | 术语库名称；与内置类别同名时自动加「（自定义）」后缀 |',
    '| entries | ✅ | 数组，1~2000 条 | 术语条目列表 |',
    '| description | 否 | 字符串 | 列表页展示的描述 |',
    '| version | 否 | 数字 | 建议填 1，便于后续兼容 |',
    '',
    '## 条目字段（entries 里每一项，只允许这 6 个）',
    '| 字段 | 必填 | 限制 | 说明 |',
    '|---|---|---|---|',
    '| ja | ✅ | 1~60 字 | 日文原词，匹配主键；翻译时按子串匹配原文 |',
    '| zh | ✅ | 1~120 字 | 中文译名（会强制 AI 使用） |',
    '| en | 否 | 字符串 | 英文/罗马字，仅展示与检索 |',
    '| category | 否 | talent / group / game / song / term | 缺省按 term |',
    '| source | 否 | 字符串（建议 URL） | 来源；缺省记为「用户上传」 |',
    '| sourceType | 否 | official / wiki / community | 来源类型，缺省 community |',
    '',
    '## 硬约束',
    '- ja 必须是原文里会真实出现的写法（原文是片假名就写片假名，不要写成汉字）。',
    '- 一条术语只放一个译名；译名不要带括号原文（写成「苦力怕」，不要「苦力怕（Creeper）」）。',
    '- category 只能取 talent / group / game / song / term 之一。',
    '- 不允许多余字段，键名拼错会让整个文件被拒。',
    '',
    '## 最小可用示例（照这个形状输出，内容按需求换）',
    '{"version":1,"name":"示例库","description":"演示用","entries":[{"ja":"クリーパー","zh":"苦力怕","en":"Creeper","category":"game"}]}',
    '',
    '现在只输出 JSON 本体。'
  ].join('\n');
}

/** 翻译场景模板：字段表与 docs/PACK-UPLOAD-SPEC.md §二 一致 */
export function sceneTemplatePrompt(): string {
  return [
    TEMPLATE_HEADER,
    '',
    '你是「字幕断句翻译器」的翻译场景 JSON 生成器。按上面这行需求，输出一个可以直接导入设置页「翻译场景」分区的 JSON 对象。',
    '',
    '## 顶层字段（只允许这 5 个）',
    '| 字段 | 必填 | 限制 | 说明 |',
    '|---|---|---|---|',
    '| name | ✅ | 1~40 字 | 场景名称，列表展示 |',
    '| prompt | ✅ | 20~4000 字 | 场景提示词，作为 system prompt 的场景段注入 |',
    '| description | 否 | 字符串 | 场景说明 |',
    '| hint | 否 | 字符串 | 示例（如适合的视频类型） |',
    '| version | 否 | 数字 | 建议 1 |',
    '',
    '## prompt 必须写全这 5 件事',
    '1. 角色：你是什么译者（VTuber 熟肉 / 科普字幕 / 歌词译者…）；',
    '2. 受众与语气：面向谁、正式还是口语、是否保留礼貌层级；',
    '3. 术语策略：专有名词保留原文 / 统一译名 / 不括注；',
    '4. 格式与数字：单位、数字、公式、时间格式如何处理；',
    '5. 禁止事项：不得增删事实、不得解释剧情、不得输出多句合一。',
    '',
    '## 最小可用示例（照这个形状输出，内容按需求换）',
    '{"version":1,"name":"数学讲解","description":"公式与例题讲解","hint":"例：数学网课","prompt":"你是一位数学教学视频字幕译者。要求：公式与符号原样保留；术语用国内教材通用译名；讲解语气口语化、逻辑连接词清晰；不添加原文没有的推导步骤。"}',
    '',
    '现在只输出 JSON 本体。'
  ].join('\n');
}

function openTemplateDialog(kind: 'glossary' | 'scene'): void {
  const dialog = $('#template-dialog') as HTMLDialogElement | null;
  const body = $('#tpl-body') as HTMLTextAreaElement | null;
  if (!dialog || !body) return;

  body.value = kind === 'scene' ? sceneTemplatePrompt() : glossaryTemplatePrompt();

  const title = $('#tpl-title');
  if (title) title.textContent = kind === 'scene' ? '用 AI 生成翻译场景' : '用 AI 生成术语库';
  const note = $('#tpl-note');
  if (note) {
    note.textContent = kind === 'scene'
      ? '第一行是留给你的空位（写这类视频该怎么译）；产出的 JSON 可以直接用「导入 JSON」入库。'
      : '第一行是留给你的空位（写要收哪些词）；产出的 JSON 可以直接用「导入 JSON」入库。';
  }

  dialog.showModal();
  /* 焦点进入正文，并把光标放在「# 需求：」这一行末尾，打开就能直接写需求 */
  body.focus();
  const firstBreak = body.value.indexOf('\n');
  const caret = firstBreak > 0 ? firstBreak : body.value.length;
  body.setSelectionRange(caret, caret);
}

function closeTemplateDialog(): void {
  closeDialogAnimated($('#template-dialog') as HTMLDialogElement | null);
}

/**
 * 复制模板正文。
 * 扩展页（chrome-extension://）不一定有剪贴板权限，所以失败时降级为
 * 「选中 textarea 全部内容 + 提示手动 Ctrl+C」——而不是弹一句「复制失败」了事。
 * 成功时按钮自己给一次状态反馈（.is-copied + 文案「已复制」），1.2s 后还原。
 */
async function copyTemplateText(): Promise<void> {
  const body = $('#tpl-body') as HTMLTextAreaElement | null;
  if (!body) return;

  const text = body.value;
  const clip = navigator.clipboard;
  if (clip && typeof clip.writeText === 'function') {
    try {
      await clip.writeText(text);
      flashCopied();
      toast('模板已复制，直接粘给你常用的 AI');
      return;
    } catch {
      /* 落到下面的降级路径 */
    }
  }

  body.focus();
  body.select();
  toast('已选中全部内容，按 Ctrl+C 手动复制（浏览器没有给剪贴板权限）');
}

let copiedTimer: number | undefined;

/** 复制按钮的一次性状态（不做弹窗）：底色 / 文字色走 160ms 过渡 */
function flashCopied(): void {
  const btn = $('#tpl-copy');
  if (!btn) return;
  btn.classList.add('is-copied');
  btn.textContent = '已复制';
  window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => {
    btn.classList.remove('is-copied');
    btn.textContent = '复制';
  }, 1200) as unknown as number;
}

function bindScenePackEvents(): void {
  $('#btn-new-scene')?.addEventListener('click', () => openNewSceneDialog());
  $('#ns-cancel')?.addEventListener('click', () => closeNewSceneDialog());
  $('#ns-save')?.addEventListener('click', () => void createScenePack());
  $('#new-scene-dialog')?.addEventListener('close', () => setNewSceneError(''));
  for (const id of ['#ns-name', '#ns-desc']) {
    $(id)?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        e.preventDefault();
        void createScenePack();
      }
    });
  }

  $('#btn-import-scene')?.addEventListener('click', () => $('#file-import-scene')?.click());
  $('#file-import-scene')?.addEventListener('change', (e) => void importScenePack(e.target as HTMLInputElement));

  $('#btn-scene-template')?.addEventListener('click', () => openTemplateDialog('scene'));
  $('#btn-glossary-template')?.addEventListener('click', () => openTemplateDialog('glossary'));
  $('#tpl-close')?.addEventListener('click', () => closeTemplateDialog());
  $('#tpl-copy')?.addEventListener('click', () => void copyTemplateText());
}

/* ══════════════════════════ 厂牌与模型（厂牌一级 / 模型二级） ══════════════════════════ */
/*
 * 层级照 LobeHub 的信息结构：厂牌是一级（图标 + 名字 + Key 状态 + 模型数 + 展开箭头），
 * 具体模型缩进收在厂牌下面；Key 与 Base URL 也长在厂牌展开后的面板里 —— 这正是
 * 「Key 跟着所选模型厂商分别配置」的落点：切到哪个厂牌，看到的就是那个厂牌自己的 Key。
 * 默认只展开正在使用的厂牌，其余折叠（信息密度与可发现性之间的取舍）。
 */

/** 一个模型行：id 发给服务商，label 给人看，note 是定位短语（推荐 / 最省 / 最强） */
type ModelRow = {
  id: string;
  label: string;
  note?: string;
  /** 自定义条目在 settings.customModels 里的下标；非自定义条目为 -1 */
  customIndex: number;
};

/** 「获取模型」拉到的在线列表，按 providerId 存放（持久化在 chrome.storage.local） */
const onlineModels: Record<string, ModelOption[]> = {};
/** 当前展开的厂牌 id；'' = 全部收起 */
let expandedProviderId = '';
/** 重绘后要把焦点还回去的元素（data-fk）：重绘不能把键盘用户甩回页面顶部 */
let focusKeyAfterRender = '';

/* ── 连通性测试（迁自「服务与模型」那行，口径与弹窗一致） ─────────────────────
 * 弹窗口径：TRANSLATE_BATCH + 1 句样例 + noFallback + bypassCache，量真实往返耗时；
 * 不用「请求 /models 列表」那种测法 —— 中转站不一定实现该端点，量到的也不是翻译耗时。
 * 结果只存在内存里（page 会话内有效），不落盘、不切换用户当前选择。
 */
const LATENCY_TIMEOUT_MS = 15000;
const LATENCY_PROBE_TEXT = 'Hello! We are testing YouTube subtitle translation.';
type LatencyResult = { ok: boolean; ms: number; error?: string };
/** 键 = `${providerId}:${modelId}`；重绘后仍能把徽标补回对应行 */
const latencyResults: Record<string, LatencyResult> = {};
/** 每次开始测某个厂牌就 +1；旧循环发现 token 变了就停手（避免切走后面包屑写错地方） */
let latencyRunToken = 0;
/** 当前正在测的厂牌 id（'' = 没在测），用来刷新按钮态 */
let latencyRunningProvider = '';

const latencyKey = (providerId: string, modelId: string): string => `${providerId}:${modelId}`;

/** 三档阈值与弹窗完全一致：<600 极速 / <1800 良好 / 其它较慢；失败单独一档 */
function latencyTone(result: LatencyResult): { cls: string; label: string } {
  if (!result.ok) return { cls: 'is-error', label: '失败' };
  if (result.ms < 600) return { cls: 'is-fast', label: '极速' };
  if (result.ms < 1800) return { cls: 'is-medium', label: '良好' };
  return { cls: 'is-slow', label: '较慢' };
}

/** 延迟徽标：延迟显示在模型名后面，格式 `${ms} ms`，失败显示「失败」 */
function latencyBadgeNode(providerId: string, modelId: string, result: LatencyResult): HTMLElement {
  const tone = latencyTone(result);
  const badge = document.createElement('span');
  badge.className = `latency model-latency ${tone.cls}`;
  badge.dataset.latency = latencyKey(providerId, modelId);
  badge.textContent = result.ok ? `${result.ms} ms` : '失败';
  badge.title = result.ok
    ? `真实翻译往返 ${result.ms}ms（${tone.label}）`
    : `测试失败：${result.error || '请求未响应'}`;
  badge.setAttribute(
    'aria-label',
    result.ok
      ? `${modelId} 连通性 ${result.ms} 毫秒，${tone.label}`
      : `${modelId} 连通性测试失败：${result.error || '请求未响应'}`
  );
  return badge;
}

/** 该行当前已有的测试结果（重绘时用来把徽标放回去）；没测过返回 null */
function latencyBadgeFor(providerId: string, modelId: string): HTMLElement | null {
  const result = latencyResults[latencyKey(providerId, modelId)];
  return result ? latencyBadgeNode(providerId, modelId, result) : null;
}

/** 该厂牌自己存的那把 Key（不是「当前生效」的那把） */
const providerKeyOf = (provider: Provider): string => (settings.providerKeys || {})[provider.id] || '';
/** 该厂牌被单独覆盖过的端点（空串 = 没覆盖，用官方端点） */
const providerBaseOverride = (provider: Provider): string => (settings.providerBaseUrls || {})[provider.id] || '';
/** 实际生效的端点：用户覆盖值优先，其次厂牌声明的官方端点（'' = 走官方 SDK 自带路径） */
const providerBase = (provider: Provider): string => providerBaseOverride(provider) || provider.defaultBaseUrl;
/** 这个厂牌是不是正在用的那个（Google 免费通道下谁都不算在用） */
const providerInUse = (provider: Provider): boolean =>
  settings.service !== 'google' && settings.providerId === provider.id;
const freeInUse = (): boolean => settings.service === 'google';

/* ── 按厂牌记住上次选的模型（v0.4.2 问题 1） ──────────────────────────────────
 * 设置里只有一个 modelName，切走厂牌后旧选择没地方存 → 切回来只能落到 models[0]。
 * providerModelSelections[providerId] 就是那个「地方」，三个时机都要写：
 *   ① 切走前留底旧厂牌；② 切到新厂牌时把本次结果记进新厂牌；③ 手动选 / 手填时更新。
 * 读的时候**不校验是否还在清单里**：手填的自定义 id、已下架的型号都要能恢复。
 */
const rememberedModelOf = (providerId: string): string =>
  (settings.providerModelSelections || {})[providerId] || '';

/**
 * 切到某厂牌时该用哪个型号（优先级与弹窗 applyProviderSelection 完全一致）：
 *   1. providerModelSelections[该厂牌]（上次选的，可能已不在清单里）
 *   2. 当前 modelName 本来就属于这个厂牌（用户手选的，保留）
 *   3. 该厂牌的默认模型 models[0]
 */
function nextModelFor(provider: Provider): string {
  const remembered = rememberedModelOf(provider.id).trim();
  if (remembered) return remembered;
  const current = (settings.modelName || '').trim();
  if (current && providerHasModel(provider.id, current)) return current;
  return provider.models[0]?.id || '';
}

/** 把「某厂牌 → 某型号」并入 providerModelSelections（modelId 空 = 删掉这条记忆） */
function withModelSelection(
  patch: Partial<ExtensionSettings>,
  providerId: string,
  modelId: string
): Partial<ExtensionSettings> {
  const next = { ...(settings.providerModelSelections || {}) };
  const clean = (modelId || '').trim();
  if (!providerId) return patch;
  if (clean) next[providerId] = clean;
  else delete next[providerId];
  return { ...patch, providerModelSelections: next };
}

/**
 * 一个厂牌下要显示的模型行 —— **只显示真正可用的**（v0.4.2 问题 2）。
 *
 * 数据源只有三样：
 *   1. 在线列表 `cached_models_<providerId>`（用户点过「获取模型」拉到的）
 *   2. 该厂牌下的自定义模型（`settings.customModels` 里 providerId 匹配的）
 *   3. 正在使用的那个型号（两边都没有时也补一行，标「当前设置 · 未在列表」）
 *
 * `provider.models`（参考清单）**不再参与渲染**：它只服务默认值、`providerHasModel`
 * 归属判断与 `findProviderByModelId` 反查。把它当列表渲染就会出现「选了 OpenAI、
 * 端点指向中转站，下拉里却混着 gpt-* 预置型号」这种与实际账号能力不符的情况
 * （用户截图里的那个 bug）。三样都没有 → 空数组，由 providerModelsEl 出空态提示。
 */
function modelRowsFor(provider: Provider): ModelRow[] {
  const rows: ModelRow[] = [];
  const seen = new Set<string>();

  for (const item of onlineModels[provider.id] || []) {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    rows.push({
      id: item.id,
      label: item.name && item.name !== item.id ? item.name : item.id,
      note: item.note,
      customIndex: -1
    });
  }

  (settings.customModels || []).forEach((entry, index) => {
    if (entry.providerId !== provider.id || seen.has(entry.id)) return;
    seen.add(entry.id);
    rows.push({ id: entry.id, label: entry.label || entry.id, customIndex: index });
  });

  /* 正在用、但不在任何清单里（手填 / 已下架 / 从弹窗切过来的旧型号）：
     补一条并保持选中 —— 列表更新不能把用户正在用的型号「显示没了」。 */
  const currentId = settings.modelName || '';
  if (providerInUse(provider) && currentId && !seen.has(currentId)) {
    rows.unshift({
      id: currentId,
      label: `当前设置：${currentId}`,
      note: '当前设置 · 未在列表',
      customIndex: -1
    });
  }
  return rows;
}

/** 该厂牌有没有「获取过模型」（有缓存或只有自定义模型都算有信息） */
function hasModelInfo(provider: Provider): boolean {
  return (onlineModels[provider.id] || []).length > 0;
}


/** 一行模型：缩进在厂牌下面，图标沿用厂牌（不重复画一遍，也不做整行 hover 上浮） */
function modelRowEl(provider: Provider, row: ModelRow): HTMLElement {
  const current = providerInUse(provider) && (settings.modelName || '') === row.id;

  const wrap = document.createElement('div');
  wrap.className = 'model-row' + (current ? ' is-current' : '') + (row.customIndex >= 0 ? ' is-custom' : '');
  wrap.dataset.modelId = row.id;
  wrap.dataset.provider = provider.id;

  /* 行本身是按钮语义：原生 button 自带 Enter/Space 与 :focus-visible 焦点环 */
  const hit = document.createElement('button');
  hit.type = 'button';
  hit.className = 'model-hit';
  hit.dataset.fk = `model:${provider.id}:${row.id}`;
  hit.dataset.modelId = row.id;
  hit.dataset.provider = provider.id;
  hit.setAttribute('aria-pressed', String(current));
  if (current) {
    hit.setAttribute('aria-disabled', 'true');
    hit.title = `正在使用 ${row.id}`;
  } else {
    hit.title = `切换到 ${row.label}（${row.id}）`;
  }

  const main = document.createElement('span');
  main.className = 'model-main';
  const label = document.createElement('span');
  label.className = 'model-label';
  label.textContent = row.label;
  const idText = document.createElement('span');
  idText.className = 'model-id';
  idText.textContent = row.id;
  main.append(label, idText);

  const tail = document.createElement('span');
  tail.className = 'model-tail';
  if (row.note) {
    const note = document.createElement('span');
    note.className = 'model-note';
    note.textContent = row.note;
    tail.appendChild(note);
  }
  /* 测试结果徽标：延迟就落在模型名后面（使用中之前），重绘后由内存结果补回 */
  const latencyBadge = latencyBadgeFor(provider.id, row.id);
  if (latencyBadge) tail.appendChild(latencyBadge);
  if (current) {
    const state = document.createElement('span');
    state.className = 'model-state';
    state.textContent = '使用中';
    tail.appendChild(state);
  }

  hit.append(main, tail);
  hit.addEventListener('click', () => {
    if (current) return; // 正在使用中的一行不可再点
    void selectModel(provider.id, row.id);
  });
  wrap.appendChild(hit);

  if (row.customIndex >= 0) {
    const ops = document.createElement('span');
    ops.className = 'model-ops';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'op-btn';
    edit.textContent = '编辑';
    edit.dataset.editCustom = String(row.customIndex);
    edit.dataset.fk = `editcustom:${row.customIndex}`;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'op-btn op-btn-danger';
    del.textContent = '删除';
    del.dataset.deleteCustom = String(row.customIndex);
    del.dataset.fk = `delcustom:${row.customIndex}`;

    ops.append(edit, del);
    wrap.appendChild(ops);
  }

  return wrap;
}

/** 厂牌展开后的配置区：这一家的 Key（可显示/隐藏）+ 折叠起来的「高级：Base URL」 */
function providerConfigEl(provider: Provider): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'provider-config';

  const keyField = document.createElement('label');
  keyField.className = 'field provider-field';
  const keyLabel = document.createElement('span');
  keyLabel.className = 'field-label';
  keyLabel.textContent = 'API Key';
  const keyState = document.createElement('span');
  keyState.className = 'provider-keystate-inline';
  keyState.dataset.keystate = provider.id;
  keyState.textContent = providerKeyOf(provider) ? '已保存' : '尚未保存';
  keyLabel.appendChild(keyState);

  const keyRow = document.createElement('div');
  keyRow.className = 'input-with-btn';
  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.className = 'ctl ctl-text';
  keyInput.value = providerKeyOf(provider);
  keyInput.placeholder = 'sk-...';
  keyInput.autocomplete = 'off';
  keyInput.spellcheck = false;
  keyInput.dataset.providerKey = provider.id;
  keyInput.dataset.fk = `key:${provider.id}`;
  keyInput.setAttribute('aria-label', `${provider.name} 的 API Key`);

  const eye = document.createElement('button');
  eye.type = 'button';
  eye.className = 'btn btn-icon';
  eye.title = '显示 / 隐藏';
  eye.setAttribute('aria-label', `显示或隐藏 ${provider.name} 的 API Key`);
  eye.dataset.fk = `keyeye:${provider.id}`;
  eye.dataset.providerKeyToggle = provider.id;
  /* 眼睛是界面图标（不是品牌图形），沿用页面上已有的那一个 */
  eye.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>';

  keyRow.append(keyInput, eye);
  keyField.append(keyLabel, keyRow);

  const hint = document.createElement('p');
  hint.className = 'provider-keyhint';
  hint.textContent = provider.keyHint ? 'Key 只存在本机浏览器存储里；申请入口：' : '';
  if (provider.keyHint) {
    const link = document.createElement('a');
    link.className = 'link-btn';
    link.href = provider.keyHint;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = '厂商官网';
    hint.appendChild(link);
  }

  wrap.append(keyField, hint);

  /* 高级：Base URL 默认收起 —— 绝大多数人只填 Key，端点只在用中转站时才需要动 */
  const advanced = document.createElement('details');
  advanced.className = 'provider-advanced';
  /* 与静态的 #scene-spec 同一套标记：bindDetailsMotion 按这个属性扫，少一处遗漏就少一次瞬跳 */
  advanced.dataset.detailsMotion = 'true';
  const summary = document.createElement('summary');
  summary.textContent = '高级：Base URL';
  const baseField = document.createElement('label');
  baseField.className = 'field provider-field';
  const baseLabel = document.createElement('span');
  baseLabel.className = 'field-label';
  baseLabel.textContent = 'Base URL';
  const baseInput = document.createElement('input');
  baseInput.type = 'text';
  baseInput.className = 'ctl ctl-text';
  baseInput.value = providerBaseOverride(provider);
  baseInput.placeholder = provider.defaultBaseUrl || '（留空即可）';
  baseInput.spellcheck = false;
  baseInput.dataset.providerBase = provider.id;
  baseInput.dataset.fk = `base:${provider.id}`;
  baseInput.setAttribute('aria-label', `${provider.name} 的 Base URL`);
  baseField.append(baseLabel, baseInput);

  const baseNote = document.createElement('p');
  baseNote.className = 'row-note';
  baseNote.textContent = provider.defaultBaseUrl
    ? `留空 = 用官方端点 ${provider.defaultBaseUrl}；中转站填到 /v1 为止。`
    : 'Gemini 走官方 SDK 自带路径，一般不需要填；填了也不会改变请求地址。';

  /* 原生 <details> 没有高度过渡：内容包一层 .details-body（grid 0fr → 1fr），
     与两个 .fold / 厂牌面板同一条口径（见 attachDetailsMotion） */
  const advancedBody = document.createElement('div');
  advancedBody.className = 'details-body';
  const advancedInner = document.createElement('div');
  advancedInner.className = 'details-body-inner';
  advancedInner.append(baseField, baseNote);
  advancedBody.appendChild(advancedInner);

  advanced.append(summary, advancedBody);
  attachDetailsMotion(advanced);
  wrap.appendChild(advanced);

  return wrap;
}

function providerModelsEl(provider: Provider, rows: ModelRow[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'provider-models';

  if (rows.length === 0) {
    /* 空态：不再拿参考清单兜底，直接告诉用户「怎么把真正可用的型号拉出来」 */
    const empty = document.createElement('p');
    empty.className = 'row-note provider-empty';
    empty.dataset.modelEmpty = provider.id;
    empty.textContent = hasModelInfo(provider)
      ? '这个厂牌这次没有返回可用模型：可以再点一次「获取模型」，或用「＋ 自定义模型」手填一个型号 id。'
      : '还没获取过模型列表。点下面的「获取模型」，用这家厂牌自己的 Key 拉取真正可用的型号；也可以直接「＋ 自定义模型」。';
    wrap.appendChild(empty);
    return wrap;
  }

  for (const row of rows) wrap.appendChild(modelRowEl(provider, row));
  return wrap;
}

/** 厂牌面板底部：获取模型 / 添加自定义模型 / 测试连通性（都作用于这个厂牌） */
function providerToolbarEl(provider: Provider): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'model-toolbar';

  const fetchBtn = document.createElement('button');
  fetchBtn.type = 'button';
  fetchBtn.className = 'btn';
  fetchBtn.id = `btn-fetch-models-${provider.id}`;
  fetchBtn.textContent = '获取模型';
  fetchBtn.title = `用 ${provider.name} 的 Key 与端点拉取可用模型列表`;
  fetchBtn.dataset.fetchModels = provider.id;
  fetchBtn.dataset.fk = `fetch:${provider.id}`;

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-quiet';
  addBtn.id = `btn-add-custom-model-${provider.id}`;
  addBtn.textContent = '＋ 自定义模型';
  addBtn.title = `在 ${provider.name} 这个厂牌下添加自定义模型`;
  addBtn.setAttribute('aria-label', `在 ${provider.name} 下添加自定义模型`);
  addBtn.dataset.addCustom = provider.id;
  addBtn.dataset.fk = `addcustom:${provider.id}`;

  /* 「测试连通性」：迁自「服务与模型」那一行，测试对象改成这个厂牌下的每个模型 */
  const hasKey = Boolean(providerKeyOf(provider));
  const testBtn = document.createElement('button');
  testBtn.type = 'button';
  testBtn.className = 'btn btn-quiet';
  testBtn.id = `btn-test-provider-${provider.id}`;
  testBtn.textContent = '测试连通性';
  testBtn.title = hasKey
    ? `逐个模型用一句样例真实翻译一次，量往返耗时（不走模型列表）`
    : '先填写 API Key 才能测';
  testBtn.disabled = !hasKey;
  testBtn.dataset.testProvider = provider.id;
  testBtn.dataset.fk = `test:${provider.id}`;

  const status = document.createElement('span');
  status.className = 'row-note provider-status';
  status.dataset.fk = `status:${provider.id}`;
  status.textContent = '列表会缓存在本地，弹窗与本页共用。';

  /* 测试口径写在按钮旁边的小字里：用户点之前就知道它要花一次真实翻译的钱 */
  const testHint = document.createElement('p');
  testHint.className = 'row-note provider-testhint';
  testHint.textContent = '测试连通性：用一句样例真实翻译一次，量往返耗时，不走模型列表；结果只显示在本次会话里。';

  bar.append(fetchBtn, addBtn, testBtn, status, testHint);
  return bar;
}

/** 一个厂牌 = 一行可展开的标题 + 收起时隐藏的面板 */
function providerGroupEl(provider: Provider): HTMLElement {
  const open = expandedProviderId === provider.id;
  const inUse = providerInUse(provider);
  const rows = modelRowsFor(provider);

  const group = document.createElement('div');
  group.className = 'provider-group' + (open ? ' is-open' : '') + (inUse ? ' is-current' : '');
  group.dataset.provider = provider.id;

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'provider-row';
  row.dataset.provider = provider.id;
  row.dataset.fk = `row:${provider.id}`;
  row.setAttribute('aria-expanded', String(open));
  row.setAttribute('aria-controls', `provider-panel-${provider.id}`);
  row.title = open ? `收起 ${provider.name}` : `展开 ${provider.name} 的 Key 与模型`;

  /* 图标是 utils/provider-icons.ts 里的静态常量（LobeHub 原始路径），不含任何用户输入 */
  const icon = document.createElement('span');
  icon.className = 'provider-icon-slot';
  icon.innerHTML = providerIconHtml(provider.iconKey, provider.name);

  const main = document.createElement('span');
  main.className = 'provider-main';
  const name = document.createElement('span');
  name.className = 'provider-name';
  name.textContent = provider.name;
  const meta = document.createElement('span');
  meta.className = 'provider-meta';
  const keyState = document.createElement('span');
  keyState.className = 'provider-keystate';
  keyState.dataset.keystate = provider.id;
  keyState.textContent = providerKeyOf(provider) ? '已配置 Key' : '未配置 Key';
  const count = document.createElement('span');
  count.className = 'provider-count';
  count.textContent = `· ${rows.length} 个模型`;
  meta.append(keyState, count);
  main.append(name, meta);

  const tail = document.createElement('span');
  tail.className = 'provider-tail';
  if (inUse) {
    const flag = document.createElement('span');
    flag.className = 'provider-flag';
    flag.textContent = '使用中';
    tail.appendChild(flag);
  }
  const chevron = document.createElement('span');
  chevron.className = 'provider-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  tail.appendChild(chevron);

  row.append(icon, main, tail);
  group.appendChild(row);

  const panel = document.createElement('div');
  panel.className = 'provider-panel';
  panel.id = `provider-panel-${provider.id}`;
  /* 折叠态的两道保险：
   *   hidden → 首次渲染就不参与布局（display:none，省一次排布）
   *   inert  → 不管有没有 hidden，都不进 tab 序列、读屏也念不到
   * 展开/收起时由 syncProviderGroupState() 就地改（不重建 DOM，高度过渡才播得出来）。 */
  panel.hidden = !open;
  panel.inert = !open;
  const inner = document.createElement('div');
  inner.className = 'provider-panel-inner';
  inner.append(providerConfigEl(provider), providerModelsEl(provider, rows), providerToolbarEl(provider));
  panel.appendChild(inner);
  group.appendChild(panel);

  return group;
}

/**
 * 展开 / 收起厂牌：只改状态，不重绘整块列表。
 * 原来走 renderProviderList() 重建 DOM，新节点直接以终态出现，
 * 所以「高度过渡」写了也永远看不到——这里改成就地切 class。
 */
function syncProviderGroupState(providerId: string): void {
  const host = $('#provider-list');
  if (!host) return;

  for (const group of Array.from(host.querySelectorAll<HTMLElement>('.provider-group'))) {
    const id = group.dataset.provider || '';
    const row = group.querySelector<HTMLElement>('.provider-row');
    const panel = group.querySelector<HTMLElement>('.provider-panel');
    if (!row || !panel) continue;

    const open = Boolean(providerId) && id === providerId;
    const name = row.querySelector('.provider-name')?.textContent || id;

    row.setAttribute('aria-expanded', String(open));
    row.title = open ? `收起 ${name}` : `展开 ${name} 的 Key 与模型`;
    /* 收起态不可聚焦 / 不进 tab 序列（inert 会连带把子树的点击与读屏一起挡掉） */
    panel.inert = !open;

    if (open) {
      /* 先去掉 hidden 并强制一次布局，让「0fr + opacity 0」这个起点先落地，
         下一帧再加 .is-open 才有过渡；否则同一帧里两次变化会被合并成终态。 */
      panel.hidden = false;
      void panel.offsetHeight;
      group.classList.add('is-open');
    } else {
      group.classList.remove('is-open');
    }
  }
}

type FocusSnapshot = { fk: string; start: number | null; end: number | null };

/** 重绘前记下焦点落在哪个元素（data-fk）与光标位置 */
function captureProviderFocus(): FocusSnapshot | null {
  const el = document.activeElement as (HTMLElement & Partial<HTMLInputElement>) | null;
  if (!el || !el.dataset || !el.dataset.fk) return null;
  const host = $('#provider-list');
  if (!host || !host.contains(el)) return null;
  const isText = typeof el.selectionStart === 'number';
  return {
    fk: el.dataset.fk,
    start: isText ? (el.selectionStart as number) : null,
    end: isText ? (el.selectionEnd as number) : null
  };
}

function restoreProviderFocus(snap: FocusSnapshot | null, explicitKey = ''): void {
  const fk = explicitKey || snap?.fk;
  if (!fk) return;
  const next = document.querySelector<HTMLElement>(`#provider-list [data-fk="${fk}"]`);
  if (!next) return;
  next.focus();
  if (snap && snap.start !== null) {
    const input = next as HTMLInputElement;
    if (typeof input.setSelectionRange === 'function') {
      try {
        input.setSelectionRange(snap.start, snap.end ?? snap.start);
      } catch {
        /* number / email 之类的输入框不支持选区，忽略 */
      }
    }
  }
}

function renderProviderList(): void {
  const host = $('#provider-list');
  if (!host) return;

  const snap = captureProviderFocus();
  const explicitKey = focusKeyAfterRender;
  focusKeyAfterRender = '';

  host.innerHTML = '';
  for (const provider of PROVIDERS) {
    /* 免 Key 那块是静态 HTML（列表最上方），这里只渲染需要 Key 的厂牌 */
    if (provider.service === 'google') continue;
    host.appendChild(providerGroupEl(provider));
  }

  syncServiceChrome();
  restoreProviderFocus(snap, explicitKey);
  /* 常规分区「翻译服务」的折叠块与这里是同一份数据：一起刷新，两处永远不会说两套话 */
  renderProviderFold();
}

/** 免 Key 区、当前通道文案、各厂牌「已配置 / 未配置」标记（不重建 DOM，可在输入时调用） */
function syncServiceChrome(): void {
  const freeBtn = $('#btn-free-google');
  if (freeBtn) {
    const on = freeInUse();
    freeBtn.classList.toggle('is-current', on);
    freeBtn.setAttribute('aria-pressed', String(on));
  }
  const freeFlag = $('#free-flag');
  if (freeFlag) freeFlag.classList.toggle('hidden', !freeInUse());

  const provider = getProvider(settings.providerId);
  const hint = $('#provider-current-hint');
  if (hint) {
    hint.textContent = freeInUse()
      ? '当前使用：Google 免费翻译（不需要 Key 与模型）'
      : `当前使用：${provider ? provider.name : '—'} · ${settings.modelName || '还没有选模型'}`;
  }

  for (const item of PROVIDERS) {
    if (item.service === 'google') continue;
    const configured = Boolean(providerKeyOf(item));
    $$(`[data-keystate="${item.id}"]`).forEach((el) => {
      if (el.classList.contains('provider-keystate-inline')) {
        el.textContent = configured ? '已保存' : '尚未保存';
        return;
      }
      el.textContent = configured ? '已配置 Key' : '未配置 Key';
    });
    /* 测试按钮跟着 Key 有无走：没 Key 就禁用（正在测的那个别打断） */
    if (latencyRunningProvider !== item.id) {
      const testBtn = document.querySelector<HTMLButtonElement>(`#provider-list [data-fk="test:${item.id}"]`);
      if (testBtn) {
        testBtn.disabled = !configured;
        testBtn.title = configured
          ? '逐个模型用一句样例真实翻译一次，量往返耗时（不走模型列表）'
          : '先填写 API Key 才能测';
      }
    }
  }

  /* 常规分区那行摘要也读同一份状态：收起态就能看出「当前是谁 + 有没有 Key」 */
  syncProviderFoldSummary();
}

/* ══════════════════════ 自动降级 · 降级顺序（v0.4.2） ══════════════════════
 * 需求：「默认保持现有行为（未主动选择时可直接降级至谷歌免费翻译）；新增「自动降级」开关，
 *        开启后允许为已配置的厂牌设置优先级顺序，并支持上下拖拽直接调整」。
 *
 * 数据只有一份：settings.fallbackOrder（providerId 数组，顺序 = 优先级 高 → 低）。
 *   - `[]`（默认）→ 失败直接降级 Google 免费翻译（v0.4.1 行为，一个字都不能变）；
 *   - 非空 → 按顺序逐级尝试，全部失败再落 Google 免费（执行链在 utils/translator.ts）。
 *
 * 本页只做「读写既有字段」，三条纪律：
 *   1. 白名单 / 去重 / 上限 8 全在 utils/storage.ts#sanitizeFallbackOrder —— 这里不二次校验；
 *   2. 不替用户从数组里删条目：未配 Key 的厂牌照样留着（Key 可以事后补，优先级是用户偏好），
 *      只是置灰标「未配置 Key · 不生效」，由运行时自己跳过；
 *   3. 该字段不进缓存指纹，改它不会让旧译文失效 ⇒ 不弹「将重新翻译」。
 *
 * 开关就是既有的 autoFallbackToGoogle（走 data-setting 通用绑定，没有专属保存代码）；
 * 关掉时列表只是收起，**不写** fallbackOrder —— 用户排好的顺序下次开启还在。
 */

/** 降级顺序的一行：厂牌 + 是否已配 Key + 是否已写进 fallbackOrder */
type FallbackRow = { provider: Provider; configured: boolean; ordered: boolean };

/** 固定兜底行（永远最后、不可拖、不可删）的说明文案 */
const FALLBACK_FINAL_NOTE = '最终兜底 · 无需 Key，始终作为最后一级';

/**
 * 列表要展示哪些行（展示顺序 = 执行顺序）：
 *   1. fallbackOrder 里的厂牌，按数组顺序 —— 未配 Key 的也留着（置灰），不静默抹掉；
 *      其中 google-free 不重复占一行：末尾那条固定兜底行就是它；
 *   2. 已配置 Key 但还没写进数组的厂牌，追加在末尾，标「未排序」；
 *   3. 未配 Key 且不在数组里的厂牌**不展示**（它不参与降级，列出来只会让人以为会试它）。
 */
function fallbackRows(): FallbackRow[] {
  const order = Array.isArray(settings.fallbackOrder) ? settings.fallbackOrder : [];
  const rows: FallbackRow[] = [];
  const seen = new Set<string>();

  for (const id of order) {
    if (seen.has(id)) continue; // 存储层已去重，这里只防 DOM 出现两行
    const provider = getProvider(id);
    if (!provider) continue;
    seen.add(id);
    if (provider.service === 'google') continue; // 固定兜底行承载
    rows.push({ provider, configured: Boolean(providerKeyOf(provider)), ordered: true });
  }

  for (const provider of PROVIDERS) {
    if (provider.service === 'google' || seen.has(provider.id)) continue;
    if (!providerKeyOf(provider)) continue;
    rows.push({ provider, configured: true, ordered: false });
  }

  return rows;
}

/** 当前界面的行顺序（不含固定兜底行）—— 拖拽与上/下移的写回都以它为准 */
function fallbackDomIds(): string[] {
  const host = $('#fallback-order-list');
  if (!host) return [];
  return Array.from(host.querySelectorAll<HTMLElement>('.fallback-item[data-provider]'))
    .map((el) => el.dataset.provider || '')
    .filter(Boolean);
}

/**
 * 写回前的最后一步：数组里的 google-free（如果本来就有）按旧下标插回去。
 * 它不占独立的行（固定兜底行就是它），但也不该因为一次拖拽被悄悄删掉。
 */
function withFreeSlot(ids: string[]): string[] {
  const prev = Array.isArray(settings.fallbackOrder) ? settings.fallbackOrder : [];
  const at = prev.indexOf(FREE_PROVIDER_ID);
  if (at < 0 || ids.includes(FREE_PROVIDER_ID)) return ids;
  const next = ids.slice();
  next.splice(Math.min(at, next.length), 0, FREE_PROVIDER_ID);
  return next;
}

/** 「自动降级」开关 → 列表展开 / 收起（grid 0fr → 1fr，与其它折叠块同一条声明） */
function syncFallbackDepend(): void {
  const panel = $('#fallback-order-panel');
  const toggle = $('#row-auto-fallback input[data-setting="autoFallbackToGoogle"]') as HTMLInputElement | null;
  if (!panel || !toggle) return;

  const open = settings.autoFallbackToGoogle !== false;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-controls', 'fallback-order-panel');
  /* 收起态不可聚焦 / 不进 tab 序列：与厂牌面板、两个 .fold 同一道保险 */
  panel.inert = !open;

  if (open) {
    /* 先去掉 hidden 并强排一次，让「0fr + opacity 0」这个起点落地，下一帧加 .is-open 才有过渡 */
    panel.hidden = false;
    void panel.offsetHeight;
    panel.classList.add('is-open');
  } else {
    panel.classList.remove('is-open');
  }
}

/** 一行：拖拽手柄 + 厂牌图标 + 厂牌名 +（未配 Key / 未排序）状态 + 序号 + 上/下移按钮 */
function fallbackItemEl(row: FallbackRow, index: number, total: number): HTMLElement {
  const { provider, configured, ordered } = row;

  const item = document.createElement('div');
  item.className = 'fallback-item' + (configured ? '' : ' is-unconfigured');
  item.dataset.provider = provider.id;
  item.dataset.draggable = String(configured);
  item.setAttribute('role', 'listitem');
  item.tabIndex = -1;
  item.title = configured
    ? (ordered
      ? `拖动调整 ${provider.name} 的降级优先级（当前第 ${index + 1} 级）`
      : `把 ${provider.name} 拖进降级顺序（现在还没写进顺序）`)
    : `${provider.name} 未配置 Key，本次不参与降级`;

  /* 手柄：只有已配 Key 的厂牌能拖（未配的不参与降级，拖了也没有执行意义） */
  const grip = document.createElement('span');
  grip.className = 'fallback-grip' + (configured ? '' : ' is-ghost');
  if (configured) {
    grip.dataset.grip = provider.id;
    grip.title = '按住拖动';
  }
  grip.setAttribute('aria-hidden', 'true');
  grip.textContent = configured ? '⠿' : '';
  item.appendChild(grip);

  /* 图标是 utils/provider-icons.ts 的静态常量（LobeHub 原始路径），与厂牌行同一份 */
  const slot = document.createElement('span');
  slot.className = 'provider-icon-slot';
  slot.innerHTML = providerIconHtml(provider.iconKey, provider.name, 16);
  item.appendChild(slot);

  const main = document.createElement('span');
  main.className = 'fallback-main';
  const name = document.createElement('span');
  name.className = 'fallback-name';
  name.textContent = provider.name;
  main.appendChild(name);

  const state = document.createElement('span');
  state.className = 'fallback-state';
  if (!configured) state.textContent = '未配置 Key · 不生效';
  else if (!ordered) state.textContent = '未排序';
  if (state.textContent) main.appendChild(state);
  item.appendChild(main);

  const tail = document.createElement('span');
  tail.className = 'fallback-tail';

  const seq = document.createElement('span');
  seq.className = 'fallback-index';
  seq.textContent = String(index + 1);
  seq.title = `第 ${index + 1} 级`;
  tail.appendChild(seq);

  /* 键盘可达：上移 / 下移各一个按钮（边界保留焦点，只 no-op，不 disabled，免得焦点掉回 body） */
  for (const dir of ['up', 'down'] as const) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fallback-move';
    btn.dataset.move = dir;
    btn.textContent = dir === 'up' ? '↑' : '↓';
    btn.setAttribute('aria-label', `${dir === 'up' ? '上移' : '下移'} ${provider.name}`);
    const atEdge = dir === 'up' ? index === 0 : index === total - 1;
    if (atEdge) btn.setAttribute('aria-disabled', 'true');
    tail.appendChild(btn);
  }

  item.appendChild(tail);
  return item;
}

/** 末尾固定一行：Google 免费翻译 · 最终兜底（draggable=false、无手柄、无上下移、不可删） */
function fallbackFinalEl(): HTMLElement {
  const free = freeProvider();

  const item = document.createElement('div');
  item.className = 'fallback-item is-final';
  item.id = 'fallback-order-final';
  item.setAttribute('role', 'listitem');
  item.dataset.draggable = 'false';
  item.draggable = false;
  item.title = 'Google 免费翻译不需要 Key，始终作为降级的最后一级';

  /* 占位而不是手柄：与上面几行的图标对齐，但不给任何可拖拽的外观 */
  const space = document.createElement('span');
  space.className = 'fallback-grip is-ghost';
  space.setAttribute('aria-hidden', 'true');
  item.appendChild(space);

  const slot = document.createElement('span');
  slot.className = 'provider-icon-slot';
  slot.innerHTML = providerIconHtml(free.iconKey, free.name, 16);
  item.appendChild(slot);

  const main = document.createElement('span');
  main.className = 'fallback-main';
  const name = document.createElement('span');
  name.className = 'fallback-name';
  name.textContent = free.name;
  const state = document.createElement('span');
  state.className = 'fallback-state';
  state.textContent = FALLBACK_FINAL_NOTE;
  main.append(name, state);
  item.appendChild(main);

  return item;
}

/* ── 拖拽（Pointer Events：鼠标 + 触控 + 触控笔同一套；HTML5 DnD 在移动端不触发） ── */

type FallbackDrag = {
  pointerId: number;
  id: string;
  from: number;
  to: number;
  moved: boolean;
  startY: number;
  /** 一行占高（含行距）—— 让位位移用 */
  step: number;
  /** 行本身的净高（不含行距）—— 插入线与位移夹取用 */
  itemH: number;
  /** 各行未位移时的中心 y（视口坐标） */
  centers: number[];
  item: HTMLElement;
  line: HTMLElement | null;
  items: HTMLElement[];
};

let fallbackDrag: FallbackDrag | null = null;

function onFallbackGripDown(event: PointerEvent, grip: HTMLElement): void {
  if (fallbackDrag) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  const host = $('#fallback-order-list');
  const item = grip.closest<HTMLElement>('.fallback-item');
  if (!host || !item) return;

  const items = Array.from(host.querySelectorAll<HTMLElement>('.fallback-item[data-provider]'));
  const from = items.indexOf(item);
  if (from < 0) return;

  const rects = items.map((el) => el.getBoundingClientRect());
  const height = rects[from].height || 36;
  const step = rects.length > 1 ? Math.abs(rects[1].top - rects[0].top) || height + 2 : height + 2;

  /* 按住手柄时不要顺带选中文字（触控的「不要滚页面」由 CSS 的 touch-action: none 负责） */
  event.preventDefault();

  fallbackDrag = {
    pointerId: event.pointerId,
    id: item.dataset.provider || '',
    from,
    to: from,
    moved: false,
    startY: event.clientY,
    step,
    itemH: height,
    centers: rects.map((r) => r.top + r.height / 2),
    item,
    line: host.querySelector<HTMLElement>('#fallback-drop-line'),
    items
  };

  /* 挂在 window 上：指针移出列表甚至移出窗口也收得到（触控有隐式捕获，同样会冒到这里） */
  window.addEventListener('pointermove', onFallbackGripMove);
  window.addEventListener('pointerup', onFallbackGripUp);
  window.addEventListener('pointercancel', onFallbackGripUp);
}

function onFallbackGripMove(event: PointerEvent): void {
  const drag = fallbackDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;

  const dy = event.clientY - drag.startY;
  if (!drag.moved && Math.abs(dy) < 4) return; // 4px 死区：轻点手柄不算拖

  if (!drag.moved) {
    drag.moved = true;
    drag.item.classList.add('is-dragging');
    $('#fallback-order-list')?.classList.add('is-sorting');
    drag.line?.classList.add('is-on');
  }

  /* 被拖那行跟手：只写 transform，且 .is-dragging 已把 transition 摘掉。
     位移夹在列表范围内（最上 = 第 0 格，最下 = 最后一格）——否则它会骑到标题行上，
     看起来像行被画到了外面；判定落点仍用未夹取的指针位移，所以拖到列表外照样能落到头/尾。 */
  const limit = drag.step * (drag.items.length - 1 - drag.from);
  const min = -drag.step * drag.from;
  const visual = Math.max(min, Math.min(limit, dy));
  drag.item.style.transform = `translateY(${Math.round(visual)}px)`;

  const center = drag.centers[drag.from] + dy;
  let to = drag.from;
  for (let i = 0; i < drag.items.length; i += 1) {
    if (i === drag.from) continue;
    if (i < drag.from && center < drag.centers[i]) to = Math.min(to, i);
    if (i > drag.from && center > drag.centers[i]) to = Math.max(to, i);
  }
  drag.to = to;

  /* 其余行平滑让位：整体挪一行高，同样只动 transform（不碰 top/height，不会抖） */
  drag.items.forEach((el, i) => {
    if (i === drag.from) return;
    let shift = 0;
    if (to < drag.from && i >= to && i < drag.from) shift = drag.step;
    if (to > drag.from && i > drag.from && i <= to) shift = -drag.step;
    el.style.transform = shift ? `translateY(${shift}px)` : '';
  });

  /* 插入指示线：让位后空出来的那一格的顶边（上下两个方向同一条公式；只动 transform） */
  const host = $('#fallback-order-list');
  if (drag.line && host && drag.centers[to] !== undefined) {
    const listTop = host.getBoundingClientRect().top;
    const y = drag.centers[to] - drag.itemH / 2 - listTop - 1;
    drag.line.style.transform = `translateY(${Math.round(y)}px)`;
  }
}

function onFallbackGripUp(event: PointerEvent): void {
  const drag = fallbackDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  fallbackDrag = null;

  window.removeEventListener('pointermove', onFallbackGripMove);
  window.removeEventListener('pointerup', onFallbackGripUp);
  window.removeEventListener('pointercancel', onFallbackGripUp);

  drag.item.classList.remove('is-dragging');
  drag.item.style.transform = '';
  drag.items.forEach((el) => { el.style.transform = ''; });
  $('#fallback-order-list')?.classList.remove('is-sorting');
  drag.line?.classList.remove('is-on');

  if (!drag.moved || drag.to === drag.from) {
    /* 只按了一下没拖：焦点给回这一行，别让它停在已松手的手柄上 */
    drag.item.focus();
    return;
  }

  const ids = fallbackDomIds();
  const moved = ids.splice(drag.from, 1)[0];
  ids.splice(drag.to, 0, moved);
  void commitFallbackOrder(ids, drag.id, 'row');
}

/** 键盘路径：行尾 ↑ / ↓ 按钮（Alt+↑/↓ 也走这里，见 bindFallbackOrderEvents） */
function moveFallbackRow(id: string, dir: 'up' | 'down'): void {
  if (fallbackDrag) return;
  const ids = fallbackDomIds();
  const at = ids.indexOf(id);
  if (at < 0) return;
  const to = at + (dir === 'up' ? -1 : 1);
  /* 已在头 / 尾：不落盘、不重绘（焦点自然留在原按钮上，连按不会掉） */
  if (to < 0 || to >= ids.length) return;
  const next = ids.slice();
  next.splice(to, 0, next.splice(at, 1)[0]);
  void commitFallbackOrder(next, id, dir);
}

/** 重绘后把焦点还给「被移动的那一行」（键盘连按 / 拖拽松手都要） */
let fallbackFocusAfterRender = '';

/** 重绘前记下焦点落在哪一行 / 哪个按钮上：存储回声会把行节点整个换掉 */
function captureFallbackFocus(): string {
  const el = document.activeElement as HTMLElement | null;
  const host = $('#fallback-order-list');
  if (!el || !host || !host.contains(el)) return '';
  const id = el.closest<HTMLElement>('.fallback-item')?.dataset.provider || '';
  if (!id) return '';
  const move = el.dataset.move;
  return `${id}:${move === 'up' || move === 'down' ? move : 'row'}`;
}

function applyFallbackFocus(): void {
  const want = fallbackFocusAfterRender;
  fallbackFocusAfterRender = '';
  if (!want) return;
  const cut = want.lastIndexOf(':');
  const id = cut > 0 ? want.slice(0, cut) : want;
  const kind = cut > 0 ? want.slice(cut + 1) : 'row';
  const row = document.querySelector<HTMLElement>(`#fallback-order-list .fallback-item[data-provider="${id}"]`);
  if (!row) return;

  if (kind === 'up' || kind === 'down') {
    const btn = row.querySelector<HTMLButtonElement>(`.fallback-move[data-move="${kind}"]`);
    if (btn) {
      btn.focus();
      return;
    }
  }
  row.focus();
}

/**
 * 写回 fallbackOrder 并重绘：数组 = 界面上的行顺序（只含可拖拽的已配 Key 厂牌，
 * 外加数组里原本就有的「未配 Key」条目 —— 它们随行一起搬，不会被挤掉）。
 * 保存走既有 update() → saveStoredSettings → sync；不触发译文失效。
 */
async function commitFallbackOrder(ids: string[], focusId: string, focusKind: 'row' | 'up' | 'down'): Promise<void> {
  fallbackFocusAfterRender = `${focusId}:${focusKind}`;
  await update({ fallbackOrder: withFreeSlot(ids) });
  renderFallbackOrder();
}

function bindFallbackOrderEvents(): void {
  const host = $('#fallback-order-list');
  if (!host) return;

  host.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null;
    const grip = target?.closest<HTMLElement>('.fallback-grip[data-grip]');
    if (!grip) return;
    onFallbackGripDown(event, grip);
  });

  host.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('.fallback-move');
    if (!btn) return;
    const id = btn.closest<HTMLElement>('.fallback-item')?.dataset.provider || '';
    if (!id) return;
    moveFallbackRow(id, btn.dataset.move === 'up' ? 'up' : 'down');
  });

  /* Alt+↑ / ↓：焦点落在行内任意位置（含刚拖完的那一行）也能调顺序，不必去够小箭头 */
  host.addEventListener('keydown', (event) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const id = (event.target as HTMLElement | null)?.closest<HTMLElement>('.fallback-item')?.dataset.provider || '';
    if (!id) return;
    event.preventDefault();
    moveFallbackRow(id, event.key === 'ArrowUp' ? 'up' : 'down');
  });
}

/** 渲染整块降级顺序（行 + 插入指示线 + 固定兜底行 + 空态 / 默认行为提示） */
function renderFallbackOrder(): void {
  /* 拖拽中不重建：存储回声（320ms 防抖后回来）会把被拖的节点换掉，手势当场断掉 */
  if (fallbackDrag) return;
  const host = $('#fallback-order-list');
  if (!host) return;

  /* 显式指定（刚移动完）优先；否则沿用当前焦点 —— 回声重绘后焦点不掉回 body */
  const keepFocus = fallbackFocusAfterRender || captureFallbackFocus();

  const rows = fallbackRows();
  const draggable = rows.filter((row) => row.configured).length;

  host.innerHTML = '';
  rows.forEach((row, index) => host.appendChild(fallbackItemEl(row, index, rows.length)));

  /* 插入指示线：只有拖拽时才显形（role=presentation，读屏不念） */
  const line = document.createElement('span');
  line.className = 'fallback-drop';
  line.id = 'fallback-drop-line';
  line.setAttribute('role', 'presentation');
  line.setAttribute('aria-hidden', 'true');
  host.appendChild(line);
  host.appendChild(fallbackFinalEl());

  /* 空态：一个已配 Key 的厂牌都没有（数组里若还有未配 Key 的条目，照样留在下面，不抹掉） */
  const empty = $('#fallback-order-empty');
  if (empty) {
    empty.textContent = '还没有可参与降级的厂牌 · 先去上面的厂牌行填写 API Key';
    empty.classList.toggle('hidden', draggable > 0);
  }

  /* 「未设置顺序」提示：数组里一个厂牌都没有 → 说明默认行为（不自动填任何顺序） */
  const hint = $('#fallback-order-hint');
  const ordered = (settings.fallbackOrder || []).filter((id) => {
    const provider = getProvider(id);
    return Boolean(provider && provider.service !== 'google');
  });
  if (hint) hint.classList.toggle('hidden', ordered.length > 0);

  fallbackFocusAfterRender = keepFocus;
  syncFallbackDepend();
  applyFallbackFocus();
}

/* ══════════════════════════ 常规分区「翻译服务」折叠块 ══════════════════════════
 * 需求五：把原来硬编码四种服务的 .seg-4 换成可折叠的厂牌选择器。
 *   - 数据源只有 utils/models.ts 的 PROVIDERS（免费通道在最上，其余按声明顺序），页面不留第二份；
 *   - 切换复用 providerSwitchPatch()（「服务与模型」的粗粒度切换 serviceSwitchPatch 也调它）；
 *   - 折叠语义与「服务与模型」的厂牌展开一致：aria-expanded / hidden / inert / 箭头旋转；
 *   - 展开状态不持久化，进页面一律收起。
 */

/** 免 Key 通道（PROVIDERS 里的 google-free） */
const freeProvider = (): Provider =>
  getProvider(FREE_PROVIDER_ID) || (PROVIDERS[PROVIDERS.length - 1] as Provider);

/** 常规分区厂牌选择器是否展开；不持久化 */
let providerFoldOpen = false;

/** 收起态摘要：厂牌图标 + 厂牌名 + 当前模型 id（等宽）+ Key 状态 */
function syncProviderFoldSummary(): void {
  const provider = freeInUse() ? freeProvider() : (getProvider(settings.providerId) || freeProvider());
  const isFree = provider.service === 'google';

  const icon = $('#fold-provider-icon');
  /* 图标是 utils/provider-icons.ts 的静态常量（LobeHub 原始路径），不含用户输入 */
  if (icon) icon.innerHTML = providerIconHtml(provider.iconKey, provider.name);

  const name = $('#fold-provider-name');
  if (name) name.textContent = provider.name;

  const model = $('#fold-provider-model');
  if (model) {
    model.textContent = isFree ? '免 Key · 不需要选模型' : (settings.modelName || '还没有选模型');
    model.classList.toggle('fold-mono', !isFree && Boolean(settings.modelName));
  }

  const badge = $('#fold-provider-badge');
  if (badge) badge.textContent = isFree ? '免 Key' : (providerKeyOf(provider) ? '已配置 Key' : '未配置 Key');
}

/** 展开态：全部通道（Google 免费 + 7 个厂牌），行结构沿用 .provider-row 保证等高与同一套 hover */
function renderProviderFold(): void {
  const list = $('#provider-fold-list');
  if (!list) return;

  list.innerHTML = '';
  const free = freeProvider();
  const ordered = [free, ...PROVIDERS.filter((p) => p.id !== free.id)];

  for (const provider of ordered) {
    const isFree = provider.service === 'google';
    const inUse = isFree ? freeInUse() : providerInUse(provider);
    const rows = isFree ? [] : modelRowsFor(provider);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'provider-row';
    btn.dataset.foldProvider = provider.id;
    btn.dataset.fk = `foldpick:${provider.id}`;
    btn.setAttribute('aria-pressed', String(inUse));
    if (inUse) btn.setAttribute('aria-current', 'true');
    btn.title = inUse ? `正在使用 ${provider.name}` : `切换到 ${provider.name}`;

    const slot = document.createElement('span');
    slot.className = 'provider-icon-slot';
    slot.innerHTML = providerIconHtml(provider.iconKey, provider.name);

    const main = document.createElement('span');
    main.className = 'provider-main';
    const name = document.createElement('span');
    name.className = 'provider-name';
    name.textContent = provider.name;
    const meta = document.createElement('span');
    meta.className = 'provider-meta';
    const keyState = document.createElement('span');
    keyState.className = 'provider-keystate';
    if (isFree) {
      keyState.textContent = '免 Key';
    } else {
      /* 与「服务与模型」同一个 data-keystate：syncServiceChrome() 会顺带刷新这里 */
      keyState.dataset.keystate = provider.id;
      keyState.textContent = providerKeyOf(provider) ? '已配置 Key' : '未配置 Key';
    }
    const count = document.createElement('span');
    count.className = 'provider-count';
    count.textContent = isFree ? '· 不需要模型' : `· ${rows.length} 个模型`;
    meta.append(keyState, count);
    main.append(name, meta);

    const tail = document.createElement('span');
    tail.className = 'provider-tail';
    if (inUse) {
      const flag = document.createElement('span');
      flag.className = 'provider-flag';
      flag.textContent = '使用中';
      tail.appendChild(flag);
    }

    btn.append(slot, main, tail);
    btn.addEventListener('click', () => void chooseProviderFromFold(provider.id));
    list.appendChild(btn);
  }

  syncProviderFoldSummary();
}

function syncProviderFoldState(): void {
  const fold = $('#provider-fold');
  const toggle = $('#btn-provider-fold');
  const panel = $('#provider-fold-panel');
  if (!fold || !toggle || !panel) return;

  const open = providerFoldOpen;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.title = open ? '收起通道列表' : '展开全部通道';
  /* 收起态不可聚焦 / 不进 tab 序列：与厂牌面板同一道保险 */
  panel.inert = !open;

  if (open) {
    panel.hidden = false;
    void panel.offsetHeight;
    fold.classList.add('is-open');
  } else {
    fold.classList.remove('is-open');
  }
}

/**
 * 在常规分区点一行厂牌：写 providerId / service / modelName（厂牌默认模型）
 * / apiKey / apiBaseUrl（各取 providerKeys、providerBaseUrls 里那一家自己的）。
 * 未配置 Key 也照切，只补一句提示 —— 与 selectModel() 的口径一致。
 */
async function chooseProviderFromFold(providerId: string): Promise<void> {
  const provider = getProvider(providerId);
  if (!provider) return;

  /* 收起要在 update() 的重绘之前就位（重绘只换列表内容，不动折叠状态） */
  providerFoldOpen = false;
  syncProviderFoldState();

  const same = provider.service === 'google' ? freeInUse() : providerInUse(provider);
  if (same) return; // 已在使用中：点一下只收起

  await update(providerSwitchPatch(provider.id));

  /* 列表每次刷新都会重建行节点，被点的那个已经不在 DOM 里：焦点还给折叠块的按钮 */
  $('#btn-provider-fold')?.focus();

  if (provider.service === 'google') {
    toast('已切换到 Google 免费翻译');
    return;
  }
  if (!providerKeyOf(provider)) toast(`${provider.name} 还没保存 Key，去「服务与模型」填写`);
  else toast(`已切换到 ${provider.name}`);
}

/**
 * 按厂牌算切换补丁 —— 「常规」折叠块与「服务与模型」共用这一份实现。
 * 设置里只有一个 apiKey / apiBaseUrl / modelName 会被请求层读取，所以切厂牌时必须
 * 一次性换成目标厂牌自己的 Key、端点与模型，否则会出现「拿 A 家的 Key 请求 B 家的端点」。
 * 模型选择走 nextModelFor()：**先看这个厂牌上次选的是什么**（问题 1 的记忆），
 * 再看当前型号是否本就属于它，最后才回落到默认模型 —— 两处（弹窗 / 设置页）同一优先级。
 * 与 utils/storage.ts#sanitizeSettings 的「当前厂牌那一格以当前值为准」互为一致性校验。
 */
function providerSwitchPatch(providerId: string): Partial<ExtensionSettings> {
  const provider = getProvider(providerId);
  if (!provider) return {};

  if (provider.service === 'google') return { service: 'google', providerId: provider.id };

  const nextModel = nextModelFor(provider);

  /* ① 切走前先把旧厂牌的选择留底；② 再把本次的结果记到新厂牌上 */
  const selections = { ...(settings.providerModelSelections || {}) };
  const previousId = settings.providerId || '';
  const previousModel = (settings.modelName || '').trim();
  if (previousId && previousModel && previousId !== provider.id) selections[previousId] = previousModel;
  if (nextModel) selections[provider.id] = nextModel;

  return {
    service: provider.service,
    providerId: provider.id,
    apiKey: providerKeyOf(provider),
    apiBaseUrl: providerBase(provider),
    modelName: nextModel,
    providerModelSelections: selections
  };
}

/** 按请求协议切换通道（老的分段控件口径）：落到该 service 的主厂牌，再走同一份补丁 */
function serviceSwitchPatch(target: ServiceKey): Partial<ExtensionSettings> {
  if (target === 'google') return { service: 'google', providerId: FREE_PROVIDER_ID };
  return providerSwitchPatch(resolveProviderByService(target).id);
}

/* ══════════════════════════ 常规分区两个折叠块的事件 ══════════════════════════
 * 两块都是原生 <button>：Enter / Space 由浏览器负责，:focus-visible 焦点环也现成。
 * 展开状态只是局部变量，不进设置、不进 chrome.storage。
 */
function bindFoldEvents(): void {
  /* 初始态一律收起（HTML 里已是 aria-expanded="false" + hidden），这里补上 inert，
     收起的面板才是真的不可聚焦、不进 tab 序列 */
  syncProviderFoldState();
  syncScenarioFoldState();

  $('#btn-provider-fold')?.addEventListener('click', () => {
    providerFoldOpen = !providerFoldOpen;
    syncProviderFoldState();
  });

  /* 底部细字链接：切到「服务与模型」分区看全量模型与自定义模型 */
  $('#btn-provider-fold-more')?.addEventListener('click', () => {
    providerFoldOpen = false;
    syncProviderFoldState();
    activatePane('service', false);
  });

  $('#btn-scenario-fold')?.addEventListener('click', () => {
    scenarioFoldOpen = !scenarioFoldOpen;
    syncScenarioFoldState();
  });
}

/**
 * 点一行模型 = 一次性写 { providerId, modelName, service, apiBaseUrl, apiKey }。
 * apiBaseUrl 必须跟着写：Claude / 通义 / Kimi / GLM 的 service 都是 'openai'，
 * 不写端点就会打到 api.openai.com 上（401 看着像 Key 错，其实是端点错）。
 */
async function selectModel(providerId: string, modelId: string): Promise<void> {
  const provider = getProvider(providerId);
  if (!provider || !modelId) return;
  if (providerInUse(provider) && (settings.modelName || '') === modelId) return;

  const key = providerKeyOf(provider);
  /* 展开态与焦点要在 update() 触发的重绘之前就位 */
  expandedProviderId = provider.id;
  focusKeyAfterRender = `model:${provider.id}:${modelId}`;

  await update({
    providerId: provider.id,
    modelName: modelId,
    service: provider.service,
    apiBaseUrl: providerBase(provider),
    apiKey: key,
    /* 手动选的型号也要记住，否则下次切回来还是旧的那一个 */
    providerModelSelections: { ...(settings.providerModelSelections || {}), [provider.id]: modelId }
  });

  const label = modelRowsFor(provider).find((row) => row.id === modelId)?.label || modelId;
  if (!key) toast(`已切到 ${label}；${provider.name} 还没有保存 Key，填好后再试`);
  else toast(`已切换到 ${label}`);
}

/** 读回各厂牌的在线列表缓存（弹窗拉到过的、本页拉到过的都直接复用） */
function refreshOnlineModels(): Promise<void> {
  const ids = PROVIDERS.filter((p) => p.service !== 'google').map((p) => p.id);
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(ids.map((id) => cachedModelsKey(id)), (res) => {
        void chrome.runtime.lastError;
        for (const id of ids) {
          const list = res?.[cachedModelsKey(id)];
          onlineModels[id] = Array.isArray(list) ? (list as ModelOption[]) : [];
        }
        renderProviderList();
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

/**
 * 通过 background 的 FETCH_MODELS 拉取（复用弹窗同一条链路，含各家鉴权差异）。
 * 只作用于**传进来的那个厂牌**：用它的 Key、用它的端点，结果也只并进它的列表。
 */
function fetchModels(providerId: string): void {
  const provider = getProvider(providerId);
  if (!provider || provider.service === 'google') {
    toast('Google 免费通道无需选择模型');
    return;
  }

  const key = providerKeyOf(provider);
  if (!key) {
    toast(`请先填写 ${provider.name} 的 API Key`);
    document.querySelector<HTMLInputElement>(`#provider-list [data-fk="key:${provider.id}"]`)?.focus();
    return;
  }

  const btn = document.querySelector<HTMLButtonElement>(`#provider-list [data-fk="fetch:${provider.id}"]`);
  const status = document.querySelector<HTMLElement>(`#provider-list [data-fk="status:${provider.id}"]`);
  const label = btn?.textContent ?? '获取模型';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '获取中…';
  }
  if (status) status.textContent = `正在向 ${provider.name} 拉取可用模型…`;

  const querySettings: ExtensionSettings = {
    ...settings,
    service: provider.service,
    apiKey: key,
    apiBaseUrl: providerBase(provider)
  };

  chrome.runtime.sendMessage({ type: 'FETCH_MODELS', payload: { settings: querySettings } }, (res) => {
    void chrome.runtime.lastError;
    const statusNow = document.querySelector<HTMLElement>(`#provider-list [data-fk="status:${provider.id}"]`);

    if (res && res.success && Array.isArray(res.models) && res.models.length > 0) {
      onlineModels[provider.id] = res.models as ModelOption[];
      chrome.storage.local.set({ [cachedModelsKey(provider.id)]: res.models });
      focusKeyAfterRender = `fetch:${provider.id}`;
      renderProviderList();
      const after = document.querySelector<HTMLElement>(`#provider-list [data-fk="status:${provider.id}"]`);
      if (after) after.textContent = `已获取 ${res.models.length} 个模型（在线在前、预设补后），点任意一行即生效。`;
      toast(`获取到 ${res.models.length} 个可用模型`);
      return;
    }

    /* 失败时按钮没被重绘过，直接就地恢复 */
    if (btn) {
      btn.disabled = false;
      btn.textContent = label;
    }
    if (statusNow) statusNow.textContent = `获取失败：${res?.error || '接口未返回模型列表'}`;
    toast('获取模型失败，请检查 Key 与 Base URL');
  });
}

/* ══════════════════════════ 连通性测试（厂牌面板内） ══════════════════════════
 * 需求：「厂牌展开后添加测试按钮，并把『翻译通道』那一行的连通性测试搬过去；
 * 测试方式与弹窗一致（不用返回模型列表的延迟测法），测试对象为该厂牌下所有模型，
 * 延迟结果显示在模型名后面」。
 *
 * 三条纪律：
 *   1. **不污染用户设置**：请求用临时 settings 对象（只把 modelName 换成被测那个），
 *      不调 update() / saveStoredSettings，providerId / apiKey 一个字节都不动；
 *   2. **串行**：一个测完再测下一个（并发会把中转站的限流和网络抖动搅在一起，量出来没意义）；
 *   3. **失效保护**：runToken 变了就停手 —— 用户中途切厂牌 / 收起面板 / 重开一次测试，
 *      旧循环不会把结果写进别的厂牌。
 */
function latencyQueryFor(provider: Provider, modelId: string): ExtensionSettings {
  return {
    ...settings,
    /* 只用来看「这个厂牌这个型号通不通」，不写回 settings */
    providerId: provider.id,
    service: provider.service,
    apiBaseUrl: providerBase(provider),
    apiKey: providerKeyOf(provider),
    modelName: modelId
  };
}

/** 一次真实翻译往返（与弹窗 handleTestApi 同口径：1 句样例 + noFallback + bypassCache） */
function translatePing(query: ExtensionSettings): Promise<LatencyResult> {
  return new Promise<LatencyResult>((resolve) => {
    const started = performance.now();
    let settled = false;

    const finish = (result: LatencyResult): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(result);
    };

    /* 回调可能永远不来（端点吞包），15s 上限按失败处理，免得按钮一直停在「测试中」 */
    const timer = window.setTimeout(() => {
      finish({
        ok: false,
        ms: Math.round(performance.now() - started),
        error: `超时（${LATENCY_TIMEOUT_MS / 1000}s 内没有返回）`
      });
    }, LATENCY_TIMEOUT_MS);

    try {
      chrome.runtime.sendMessage(
        {
          type: 'TRANSLATE_BATCH',
          payload: {
            texts: [LATENCY_PROBE_TEXT],
            targetLang: query.targetLang,
            settings: query,
            noFallback: true, // 测试不许偷偷回退到 Google，否则测的不是这个端点
            bypassCache: true // 必须真实发一次请求，命中缓存就量不到网络
          }
        },
        (res) => {
          void chrome.runtime.lastError;
          const ms = Math.round(performance.now() - started);
          const ok = Boolean(res && res.success && Array.isArray(res.translations) && res.translations.length > 0);
          finish({ ok, ms, error: ok ? undefined : res?.error || '请求未响应' });
        }
      );
    } catch (err) {
      finish({
        ok: false,
        ms: Math.round(performance.now() - started),
        error: (err as Error).message.slice(0, 80)
      });
    }
  });
}

/** 属性选择器里的值转义（model id 可能带 . : / 之类） */
const attrValue = (value: string): string => value.replace(/["\\]/g, '\\$&');

function modelRowNode(providerId: string, modelId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `#provider-list .model-row[data-provider="${attrValue(providerId)}"][data-model-id="${attrValue(modelId)}"]`
  );
}

/** 把结果写进那一行的尾部（不重绘整块列表：重绘会换掉节点、也打断键盘焦点） */
function paintLatencyBadge(providerId: string, modelId: string, result: LatencyResult): void {
  const row = modelRowNode(providerId, modelId);
  const tail = row?.querySelector<HTMLElement>('.model-tail');
  if (!tail) return; // 这行已被隐藏 / 面板被重建，跳过（重绘时由 latencyBadgeFor 补回）
  tail.querySelectorAll('.model-latency').forEach((el) => el.remove());
  const badge = latencyBadgeNode(providerId, modelId, result);
  const state = tail.querySelector('.model-state');
  if (state) tail.insertBefore(badge, state);
  else tail.appendChild(badge);
}

/** 按钮态：测试中显示「测试中 n/N」并禁用；没配 Key 时保持禁用 */
function syncTestButton(providerId: string, done: number, total: number, running: boolean): void {
  const btn = document.querySelector<HTMLButtonElement>(`#provider-list [data-fk="test:${providerId}"]`);
  if (!btn) return;
  const provider = getProvider(providerId);
  const hasKey = Boolean(provider && providerKeyOf(provider));
  btn.disabled = running || !hasKey;
  if (running) {
    btn.textContent = `测试中 ${done}/${total}`;
    btn.setAttribute('aria-busy', 'true');
    return;
  }
  btn.textContent = '测试连通性';
  btn.removeAttribute('aria-busy');
  btn.title = hasKey ? '逐个模型用一句样例真实翻译一次，量往返耗时（不走模型列表）' : '先填写 API Key 才能测';
}

/**
 * 测这个厂牌下的所有模型（= 列表里实际渲染的那些行，含自定义模型）。
 * 串行跑完，逐个把延迟写回那一行；不落盘、不切换用户当前选择。
 */
async function testProviderLatency(providerId: string): Promise<void> {
  const provider = getProvider(providerId);
  if (!provider || provider.service === 'google') {
    toast('Google 免费通道无需 Key，视频页可直接使用');
    return;
  }

  const key = providerKeyOf(provider);
  if (!key) {
    toast(`请先填写 ${provider.name} 的 API Key`);
    document.querySelector<HTMLInputElement>(`#provider-list [data-fk="key:${provider.id}"]`)?.focus();
    return;
  }

  const modelIds = modelRowsFor(provider).map((row) => row.id);

  /* 任何一次新的测试都让旧循环失效（重开 / 切到别家测） */
  const token = ++latencyRunToken;
  latencyRunningProvider = provider.id;

  if (modelIds.length === 0) {
    latencyRunningProvider = '';
    toast(`「${provider.name}」下还没有可测的模型`);
    return;
  }

  syncTestButton(provider.id, 1, modelIds.length, true);

  let okCount = 0;
  for (let i = 0; i < modelIds.length; i += 1) {
    if (token !== latencyRunToken) return; // 被新的测试取代
    syncTestButton(provider.id, i + 1, modelIds.length, true);
    const result = await translatePing(latencyQueryFor(provider, modelIds[i]));
    if (token !== latencyRunToken) return;
    latencyResults[latencyKey(provider.id, modelIds[i])] = result;
    if (result.ok) okCount += 1;
    paintLatencyBadge(provider.id, modelIds[i], result);
  }

  latencyRunningProvider = '';
  syncTestButton(provider.id, modelIds.length, modelIds.length, false);
  toast(
    okCount === modelIds.length
      ? `${provider.name}：${modelIds.length} 个模型全部连通`
      : `${provider.name}：${okCount}/${modelIds.length} 个模型连通正常，其余见模型名后的标记`
  );
}

/*
 * 厂牌列表事件（委托）
 * 厂牌列表是整块重绘的（展开/收起、拉到新列表、存储回声都会重画），
 * 所以事件只能委托在容器上，不然每次重绘后旧的监听就全指向被删掉的节点。
 */

function toggleProviderPanel(providerId: string): void {
  if (!providerId) return;
  expandedProviderId = expandedProviderId === providerId ? '' : providerId;
  /* 就地切换而不重绘：重绘会换掉面板节点，展开/收起的高度过渡就永远从终态开始。
     焦点本来就落在被点的厂牌行上（原生 button），不需要重绘后再还回去。 */
  focusKeyAfterRender = '';
  syncProviderGroupState(expandedProviderId);
}

function toggleProviderKeyVisibility(providerId: string): void {
  const input = document.querySelector<HTMLInputElement>(`#provider-list [data-fk="key:${providerId}"]`);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

/** Key 输入：只写**这个厂牌**的格子；它正好是正在用的那个时，同步 apiKey（请求层读的是 apiKey） */
function onProviderKeyInput(providerId: string, value: string): void {
  const provider = getProvider(providerId);
  if (!provider) return;

  const keys = { ...(settings.providerKeys || {}) };
  const trimmed = value.trim();
  if (trimmed) keys[providerId] = trimmed;
  else delete keys[providerId];

  const patch: Partial<ExtensionSettings> = { providerKeys: keys };
  if (settings.providerId === providerId) patch.apiKey = trimmed;
  /* silent：正在输入，重绘会把输入框换掉、光标跳走 */
  void update(patch, { silent: true });
  syncServiceChrome();
}

/** Base URL 输入：覆盖值存进这个厂牌的格子；空 = 回落到厂牌的官方端点 */
function onProviderBaseInput(providerId: string, value: string): void {
  const provider = getProvider(providerId);
  if (!provider) return;

  const urls = { ...(settings.providerBaseUrls || {}) };
  const trimmed = value.trim();
  if (trimmed) urls[providerId] = trimmed;
  else delete urls[providerId];

  const patch: Partial<ExtensionSettings> = { providerBaseUrls: urls };
  if (settings.providerId === providerId) patch.apiBaseUrl = trimmed || provider.defaultBaseUrl;
  void update(patch, { silent: true });
}

function bindProviderEvents(): void {
  const host = $('#provider-list');
  if (!host) return;

  host.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest('button') as HTMLButtonElement | null;
    if (!btn) return;

    /* 厂牌行：点整行展开 / 收起（模型行自己带监听，这里不重复处理） */
    if (btn.classList.contains('provider-row')) {
      toggleProviderPanel(btn.dataset.provider || '');
      return;
    }
    if (btn.dataset.providerKeyToggle) {
      toggleProviderKeyVisibility(btn.dataset.providerKeyToggle);
      return;
    }
    if (btn.dataset.fetchModels) {
      fetchModels(btn.dataset.fetchModels);
      return;
    }
    if (btn.dataset.testProvider) {
      void testProviderLatency(btn.dataset.testProvider);
      return;
    }
    if (btn.dataset.addCustom) {
      openCustomDialog(btn.dataset.addCustom);
      return;
    }
    if (btn.dataset.editCustom !== undefined) {
      const index = Number(btn.dataset.editCustom);
      const entry = (settings.customModels || [])[index];
      if (entry?.providerId) openCustomDialog(entry.providerId, index);
      return;
    }
    if (btn.dataset.deleteCustom !== undefined) {
      void deleteCustomModel(Number(btn.dataset.deleteCustom));
    }
  });

  host.addEventListener('input', (event) => {
    const el = event.target as HTMLInputElement | null;
    if (!el) return;
    if (el.dataset.providerKey) {
      onProviderKeyInput(el.dataset.providerKey, el.value);
      return;
    }
    if (el.dataset.providerBase) onProviderBaseInput(el.dataset.providerBase, el.value);
  });

  /* Key 输完（blur / 回车）才重画降级顺序：输入过程中重绘会把焦点与光标一起弄丢 */
  host.addEventListener('change', (event) => {
    const el = event.target as HTMLInputElement | null;
    if (el?.dataset.providerKey) renderFallbackOrder();
  });

  /* 免 Key 区：选中即 service='google'，不需要 Key、不需要模型 */
  $('#btn-free-google')?.addEventListener('click', () => {
    if (freeInUse()) return;
    void update({ service: 'google' });
    toast('已切换到 Google 免费翻译');
  });
}

/* ══════════════════════════ 自定义模型（挂在厂牌下） ══════════════════════════ */
/*
 * 自定义条目也必须落在某个厂牌下：请求用的 service 只有 4 个出口，端点来自厂牌，
 * 所以「这条是 Claude 的还是 Qwen 的」只能靠 CustomModelEntry.providerId 记。
 * 字段收敛成 显示名 + model id —— 服务商与图标都由所属厂牌决定，不用再选一遍。
 */

let editingCustomIndex = -1;
/** 弹层当前作用于哪个厂牌 */
let customDialogProviderId = '';

function openCustomDialog(providerId: string, index = -1): void {
  const provider = getProvider(providerId);
  const dialog = $('#custom-model-dialog') as HTMLDialogElement | null;
  if (!provider || !dialog) return;

  const entry = index >= 0 ? (settings.customModels || [])[index] : undefined;
  editingCustomIndex = entry ? index : -1;
  customDialogProviderId = provider.id;

  const label = $('#cm-label') as HTMLInputElement | null;
  const id = $('#cm-id') as HTMLInputElement | null;
  if (label) label.value = entry?.label ?? '';
  if (id) id.value = entry?.id ?? '';

  const title = $('#cm-title');
  if (title) title.textContent = entry ? '编辑自定义模型' : '自定义模型';
  const providerName = $('#cm-provider-name');
  if (providerName) providerName.textContent = provider.name;

  dialog.showModal();
  id?.focus();
}

function closeCustomDialog(): void {
  const dialog = $('#custom-model-dialog') as HTMLDialogElement | null;
  editingCustomIndex = -1;
  closeDialogAnimated(dialog);
}

async function saveCustomModel(): Promise<void> {
  const provider = getProvider(customDialogProviderId);
  if (!provider) return;

  const idInput = $('#cm-id') as HTMLInputElement | null;
  const labelInput = $('#cm-label') as HTMLInputElement | null;

  const id = (idInput?.value || '').trim();
  if (!id) {
    toast('请填写 model id');
    idInput?.focus();
    return;
  }
  if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(id)) {
    toast('model id 只能用字母、数字与 . _ : / -');
    idInput?.focus();
    return;
  }

  const list = [...(settings.customModels || [])];
  const wasEditing = editingCustomIndex;
  /* 去重按「厂牌 + id」：同一个 id 在两家厂牌下是两条不同的配置 */
  if (list.some((m, i) => i !== wasEditing && (m.providerId || '') === provider.id && m.id === id)) {
    toast(`「${provider.name}」下已经有这个 model id 了`);
    return;
  }
  if (wasEditing < 0 && list.length >= MAX_CUSTOM_MODELS) {
    toast(`最多 ${MAX_CUSTOM_MODELS} 个自定义模型`);
    return;
  }

  const before = wasEditing >= 0 ? list[wasEditing] : undefined;
  const entry: CustomModelEntry = {
    id,
    label: (labelInput?.value || '').trim() || id,
    /* 请求出口与图标都跟随厂牌：service 决定协议，端点由 providerBase 提供 */
    service: (provider.service === 'google' ? 'custom' : provider.service) as CustomModelService,
    icon: provider.iconKey || 'generic',
    providerId: provider.id
  };

  if (wasEditing >= 0) list[wasEditing] = entry;
  else list.push(entry);

  const patch: Partial<ExtensionSettings> = { customModels: list };

  /* 改的正好是正在用的那条：modelName 跟着改，不要留下指向旧 id 的悬空引用 */
  if (before && providerInUse(provider) && settings.modelName === before.id) {
    Object.assign(patch, withModelSelection({ modelName: id }, provider.id, id));
  }

  closeCustomDialog();
  expandedProviderId = provider.id;
  await update(patch);
  toast(before ? '已更新自定义模型' : `已添加到「${provider.name}」`);
}

async function deleteCustomModel(index: number): Promise<void> {
  const list = [...(settings.customModels || [])];
  const entry = list[index];
  if (!entry) return;

  const provider = getProvider(entry.providerId || '');
  const providerName = provider ? provider.name : '该厂牌';
  if (!window.confirm(`删除「${providerName}」下的自定义模型「${entry.label || entry.id}」？`)) return;

  list.splice(index, 1);
  const patch: Partial<ExtensionSettings> = { customModels: list };

  /* 删掉的正好是正在用的那条：回退到该厂牌的默认模型（绝不留下空 modelName） */
  if (provider && providerInUse(provider) && settings.modelName === entry.id) {
    const fallback = provider.models[0];
    if (fallback) {
      expandedProviderId = provider.id;
      Object.assign(patch, withModelSelection({
        modelName: fallback.id,
        service: provider.service,
        apiBaseUrl: providerBase(provider),
        apiKey: providerKeyOf(provider)
      }, provider.id, fallback.id));
    } else {
      patch.modelName = '';
      /* 记忆里也不能留着这个已经删掉的 id */
      Object.assign(patch, withModelSelection({}, provider.id, ''));
    }
  }

  await update(patch);
  toast('已删除自定义模型');
}

/* ══════════════════════════ 其他动作 ══════════════════════════ */

function bindMiscEvents(): void {
  $('#btn-open-popup')?.addEventListener('click', () => {
    // 弹窗没有 API 可直接打开，这里提示用户点工具栏图标
    toast('点浏览器工具栏上的扩展图标即可打开快捷面板');
  });

  /* 「连通性测试」已迁进每个厂牌展开面板的工具条（见 testProviderLatency） */
  bindProviderEvents();

  /* 自定义模型：取消 / 保存 / Esc 关闭（新增与编辑由厂牌面板委托触发） */
  $('#cm-cancel')?.addEventListener('click', () => closeCustomDialog());
  $('#cm-save')?.addEventListener('click', () => void saveCustomModel());
  $('#custom-model-dialog')?.addEventListener('close', () => {
    editingCustomIndex = -1;
  });
  for (const id of ['#cm-id', '#cm-label']) {
    $(id)?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        e.preventDefault();
        void saveCustomModel();
      }
    });
  }

  /* 厂牌列表：厂牌行与模型行本身都是 button（Enter/Space 原生可用），
     这里只补 ↑↓/Home/End 在可见模型行之间移动焦点，省得用 Tab 逐行跳。 */
  $('#provider-list')?.addEventListener('keydown', (e) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes((e as KeyboardEvent).key)) return;
    /* 只在「展开中」的面板里找模型行：收起态用 .is-open 判，
       比 [hidden] 可靠——就地切换时节点不会重绘，hidden 也不再是唯一开关 */
    const hits = $$<HTMLButtonElement>('#provider-list .provider-group.is-open .provider-panel .model-hit');
    if (hits.length === 0) return;
    const at = hits.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    let next = at;
    if ((e as KeyboardEvent).key === 'ArrowDown') next = (at + 1) % hits.length;
    if ((e as KeyboardEvent).key === 'ArrowUp') next = (at - 1 + hits.length) % hits.length;
    if ((e as KeyboardEvent).key === 'Home') next = 0;
    if ((e as KeyboardEvent).key === 'End') next = hits.length - 1;
    e.preventDefault();
    hits[next].focus();
  });

  $('#btn-clear-cache')?.addEventListener('click', async () => {
    const ok = await clearSentenceCache();
    toast(ok ? '翻译缓存已清空' : '清空失败：数据库被占用，请刷新视频页后重试');
  });

  $('#btn-reset-settings')?.addEventListener('click', () => void resetSettings());
  $('#btn-reset-all')?.addEventListener('click', () => void resetSettings());
}

/* ══════════════════════ AI 精翻字幕缓存（需求 7） ══════════════════════ */
/*
 * 两条纪律：
 *   1. 默认值只在 types/index.ts 里定义一份，这里只用不定义；
 *   2. 保留时长**变短**时要立刻按新 TTL 清理（否则用户改成 1 天后还得再等一天才生效）。
 */
/** 记录上一次生效的 TTL，用来判断这次点击是「变短」还是「变长」 */
let aiCacheTtlApplied: number = DEFAULT_SETTINGS.aiCacheTtlHours ?? 720;

function bindAiCacheEvents(): void {
  aiCacheTtlApplied = settings.aiCacheTtlHours ?? DEFAULT_SETTINGS.aiCacheTtlHours ?? 720;

  $$<HTMLButtonElement>('[data-setting="aiCacheTtlHours"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.value);
      if (!Number.isFinite(next) || next === aiCacheTtlApplied) return;
      const prev = aiCacheTtlApplied;
      aiCacheTtlApplied = next;
      // 永久（0）不需要清理；只有「变短」才立刻清理一次
      if (next > 0 && (prev === 0 || next < prev)) {
        void pruneAiTracks(next).then(async (removed) => {
          await refreshAiCacheStat();
          if (removed > 0) toast(`已按新的保留时长清理 ${removed} 条 AI 精翻缓存`);
        });
        return;
      }
      void refreshAiCacheStat();
    });
  });

  $('#btn-clear-ai-cache')?.addEventListener('click', async () => {
    if (!window.confirm('清空全部视频的 AI 精翻字幕缓存？清空后重新打开视频需要重新精翻，普通机翻译文不受影响。')) {
      return;
    }
    const removed = await clearAllAiTracks();
    await refreshAiCacheStat();
    toast(removed > 0 ? `已清空 ${removed} 个视频的 AI 精翻缓存` : 'AI 精翻缓存已经是空的');
  });

  // 打开设置页先按当前 TTL 清一次过期记录，再显示统计（不需要用户改任何设置）
  void pruneAiTracks(aiCacheTtlApplied)
    .then(() => refreshAiCacheStat())
    .catch(() => refreshAiCacheStat());
}

/** 「N 个视频 · 约 X KB」 */
async function refreshAiCacheStat(): Promise<void> {
  const el = $('#ai-cache-stat');
  if (!el) return;
  try {
    const stats = await getAiTrackStats();
    if (stats.count <= 0) {
      el.textContent = '本地暂无 AI 精翻字幕缓存。';
      return;
    }
    const kb = stats.bytes / 1024;
    const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
    el.textContent = `已缓存 ${stats.count} 个视频 · 约 ${size}`;
  } catch {
    el.textContent = '本地暂无 AI 精翻字幕缓存。';
  }
}


async function resetSettings(): Promise<void> {
  if (!window.confirm('恢复默认设置？术语库与自定义场景包会保留。')) return;
  // 只认 types 里的 DEFAULT_SETTINGS：早期这里手写了一份残缺的默认值副本，
  // 漏掉 segmentationLanguage / 三种配色 / API 配置，导致「恢复默认」名不副实。
  settings = await saveStoredSettings({ ...DEFAULT_SETTINGS });
  reflectSettings();
  applyPreview();
  renderScenarios();
  toast('已恢复默认设置');
}

/* ══════════════════════════ 弹层动效 ══════════════════════════
 * 原生 <dialog> 只有「打开」这一侧能纯靠 CSS（.modal[open] 的 modalEnter）：
 * close() 是同步的，节点立刻 display:none，反向过渡没地方挂。
 * 所以关闭走一次 .is-closing（modalExit，--dur-fast），等时长到了再真正 close()。
 * 时长从 :root 令牌读，不在 JS 里另写一份硬编码。
 */

/** 把 --dur-* 令牌解析成毫秒；读不到就退回兜底值 */
function tokenDurationMs(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const match = /^([\d.]+)\s*(ms|s)$/.exec(raw);
  if (!match) return fallback;
  return match[2] === 's' ? Number(match[1]) * 1000 : Number(match[1]);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 关弹层：先播反向动画，再 close()；reduced-motion 下直接关，不做等待 */
function closeDialogAnimated(dialog: HTMLDialogElement | null): void {
  if (!dialog || !dialog.open || dialog.classList.contains('is-closing')) return;
  const finish = (): void => {
    dialog.classList.remove('is-closing');
    dialog.close();
  };
  if (prefersReducedMotion()) {
    finish();
    return;
  }
  dialog.classList.add('is-closing');
  window.setTimeout(finish, tokenDurationMs('--dur-fast', 160) + 40);
}

/** Esc 关闭也走同一套反向动画（原生 cancel 之后就是关闭，来不及做过渡） */
function bindDialogMotion(): void {
  for (const id of ['#custom-model-dialog', '#new-pack-dialog', '#new-scene-dialog', '#template-dialog']) {
    const dialog = $(id) as HTMLDialogElement | null;
    dialog?.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialogAnimated(dialog);
    });
  }
}

/* ══════════════════════════ 可展开容器的统一过渡（问题 5） ══════════════════════════
 * 设置页一共五类 disclosure：
 *   1. 常规 · 翻译服务（.fold #provider-fold）
 *   2. 常规 · 翻译场景（.fold #scenario-fold）
 *   3. 服务与模型 · 厂牌面板（.provider-group[aria-expanded] > .provider-panel）
 *   4. 服务与模型 · 高级 Base URL（details.provider-advanced）
 *   5. 翻译场景 · 文件格式规范（details.spec-block#scene-spec）
 * 前三个本来就走 grid-template-rows 0fr → 1fr + opacity；4 / 5 因为是原生 <details>，
 * 关着时内容根本不渲染，写 transition 也没起点，所以此前只有一次淡入动画、高度是瞬跳。
 * 这里给 4 / 5 里包一层 .details-body（同样的 grid + opacity），用 toggle 事件驱动
 * .is-open —— 五者的 computed transition-property / duration 因此完全一致。
 *
 * 收起方向仍是瞬切：原生 details 关闭后内容不渲染，没有可过渡的终态。这是浏览器行为，
 * 文档（docs/UI.md）里如实登记，不为了让「收起也有动画」去自造 disclosure 组件。
 */
function attachDetailsMotion(details: HTMLDetailsElement): void {
  const body = details.querySelector<HTMLElement>(':scope > .details-body');
  const summary = details.querySelector<HTMLElement>(':scope > summary');
  if (!body) return;

  /* .is-motion 由 JS 添加：万一脚本没跑到，.details-body 保持 1fr 正常可读，
     不会因为「CSS 默认 0fr」而把内容藏死 */
  details.classList.add('is-motion');

  /* 展开前先落回起点：toggle 事件是异步派发的，等它到的时候浏览器可能已经按 1fr 画过一帧 */
  summary?.addEventListener('click', () => {
    if (!details.open) body.classList.remove('is-open');
  });

  details.addEventListener('toggle', () => {
    if (!details.open) {
      body.classList.remove('is-open');
      return;
    }
    body.classList.remove('is-open');
    void body.offsetHeight;
    window.requestAnimationFrame(() => body.classList.add('is-open'));
  });

  if (details.open) body.classList.add('is-open');
}

/** 页面里静态写死的 details（厂牌面板里的那些在创建时自己 attach）：按 data 属性扫，不按 class 猜 */
function bindDetailsMotion(): void {
  $$<HTMLDetailsElement>('details[data-details-motion]').forEach((el) => attachDetailsMotion(el));
}

/* ══════════════════════════ 提示条 ══════════════════════════ */

let toastTimer: number | undefined;

function toast(message: string): void {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400) as unknown as number;
}

/* ══════════════════════════ 初始化 ══════════════════════════ */

void boot();

window.addEventListener('resize', () => moveMarker());
