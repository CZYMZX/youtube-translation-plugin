/**
 * ============================================================================
 * YouTube 智能字幕断句翻译器 - 扩展弹出设置面板 (Popup Main Controller)
 * 当前版本: v0.4.1 (独立高级设置页)
 *
 * 【v0.1.0 架构与设计规范统一守则（跨会话协作必读）】：
 * 1. 翻译服务引擎参数折叠规范：当选择大模型服务（DeepSeek、OpenAI、Gemini）时，
 *    API Key、Base URL、模型拉取与测试按钮必须收拢在手风琴折叠卡片 (#ai-config-section) 内，
 *    默认收起，并通过 Badge（已就绪/未配置）与当前模型名显示概览，严禁改回默认完全展开。
 * 2. 标签页切换防抖与稳定视口：切换标签时调用 window.scrollTo({ top: 0, behavior: 'instant' })，
 *    配合 style.css 中的 scrollbar-gutter: stable 与 overflow-y: scroll 彻底根除晃动。
 * 3. 实时响应与去抖同步：persistSettings() 支持防抖与立即写入，实时同步到 chrome.runtime 与本地存储。
 * ============================================================================
 */

import { DEFAULT_SETTINGS, type ExtensionSettings } from '../../types';
import { GLOSSARY_CATEGORY_LABELS, type GlossaryCategory } from '../../utils/glossary';
import {
  getAllGlossaryPacks,
  getAllScenes,
  loadCustomPacks,
  saveGlossaryPacks,
  saveScenePacks,
  validateGlossaryPack,
  validateScenePack,
  DEFAULT_GLOSSARY_PACKS,
  BUILTIN_GLOSSARY_PACKS,
  BUILTIN_SCENES,
  type CustomPacks,
  type GlossaryPack,
  type ScenePack
} from '../../utils/packs';
import {
  ICON_PREVIEW_OPEN,
  ICON_PREVIEW_CLOSE,
  ICON_REFRESH,
  ICON_HOURGLASS,
  ICON_CHECK,
  ICON_ALERT
} from '../../utils/icons';

function hexToRgba(hex: string, opacity: number): string {
  if (!hex || hex === 'transparent' || hex === '#00000000') return 'transparent';
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c, 16);
  if (isNaN(num)) return `rgba(15, 23, 42, ${opacity / 100})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
}

/**
 * 状态文案统一用 DOM 构建，杜绝把接口返回内容拼进 innerHTML
 */
function renderStatus(
  el: HTMLElement | null,
  className: string,
  icon: string,
  text: string,
  detail?: string
) {
  if (!el) return;
  el.className = className;
  el.textContent = '';

  const iconSpan = document.createElement('span');
  iconSpan.style.cssText =
    'display:inline-flex;width:13px;height:13px;margin-right:4px;vertical-align:-1.5px;color:#ffffff;';
  iconSpan.innerHTML = icon;
  el.appendChild(iconSpan);
  el.appendChild(document.createTextNode(text));

  if (detail) {
    el.appendChild(document.createElement('br'));
    const detailEl = document.createElement('span');
    detailEl.style.opacity = '0.85';
    detailEl.textContent = detail;
    el.appendChild(detailEl);
  }
}

// DOM 元素引用
const enabledToggle = document.getElementById('enabled-toggle') as HTMLInputElement;
const targetLangSelect = document.getElementById('target-lang') as HTMLSelectElement;
const serviceSelect = document.getElementById('service-select') as HTMLSelectElement;

// 场景与推理
const scenarioSelect = document.getElementById('scenario-select') as HTMLSelectElement;
const reasoningSelect = document.getElementById('reasoning-select') as HTMLSelectElement;
const reasoningBadge = document.getElementById('reasoning-badge') as HTMLElement;

const aiConfigSection = document.getElementById('ai-config-section') as HTMLElement;
const aiAccordionHeader = document.getElementById('ai-accordion-header') as HTMLButtonElement | null;
const aiAccordionDesc = document.getElementById('ai-accordion-desc') as HTMLElement | null;
const aiConfigStatusBadge = document.getElementById('ai-config-status-badge') as HTMLElement | null;
const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
const btnToggleKey = document.getElementById('btn-toggle-key') as HTMLButtonElement;
const apiBaseUrlInput = document.getElementById('api-base-url') as HTMLInputElement;
const modelNameInput = document.getElementById('model-name') as HTMLInputElement;
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
const btnFetchModels = document.getElementById('btn-fetch-models') as HTMLButtonElement;
const fetchModelsStatus = document.getElementById('fetch-models-status') as HTMLElement;
const btnTestApi = document.getElementById('btn-test-api') as HTMLButtonElement;
const testStatus = document.getElementById('test-status') as HTMLElement;

const autoHideNativeCheck = document.getElementById('auto-hide-native') as HTMLInputElement;
const autoFallbackToggle = document.getElementById('auto-fallback-toggle') as HTMLInputElement;

// 术语库注入开关（v0.2.9：位于「术语与场景」页）
const glossaryEnabledCheck = document.getElementById('glossary-enabled') as HTMLInputElement | null;

// 术语与场景页（v0.2.9）
const sceneListEl = document.getElementById('scene-list') as HTMLElement | null;
const glossaryPackListEl = document.getElementById('glossary-pack-list') as HTMLElement | null;
const sceneActiveBadgeEl = document.getElementById('scene-active-badge') as HTMLElement | null;
const glossaryTotalBadgeEl = document.getElementById('glossary-total-badge') as HTMLElement | null;
const packPreviewEl = document.getElementById('pack-preview') as HTMLElement | null;
const packStatusEl = document.getElementById('pack-status') as HTMLElement | null;
const btnUploadScene = document.getElementById('btn-upload-scene') as HTMLButtonElement | null;
const btnUploadGlossary = document.getElementById('btn-upload-glossary') as HTMLButtonElement | null;
const sceneUploadInput = document.getElementById('scene-upload-input') as HTMLInputElement | null;
const glossaryUploadInput = document.getElementById('glossary-upload-input') as HTMLInputElement | null;

// 断句参数
const pauseThresholdRange = document.getElementById('pause-threshold') as HTMLInputElement;
const pauseThresholdVal = document.getElementById('pause-threshold-val') as HTMLElement;
const maxWordsRange = document.getElementById('max-words') as HTMLInputElement;
const maxWordsVal = document.getElementById('max-words-val') as HTMLElement;
const maxCharsRange = document.getElementById('max-chars') as HTMLInputElement;
const maxCharsVal = document.getElementById('max-chars-val') as HTMLElement;
const maxDurationRange = document.getElementById('max-duration') as HTMLInputElement;
const maxDurationVal = document.getElementById('max-duration-val') as HTMLElement;
const segmentationLanguageSelect = document.getElementById('segmentation-language') as HTMLSelectElement;
const mergeFragmentsCheck = document.getElementById('merge-fragments') as HTMLInputElement;
const autoPunctuationCheck = document.getElementById('auto-punctuation') as HTMLInputElement;

// 样式排版与颜色
const displayModeSelect = document.getElementById('display-mode') as HTMLSelectElement;
const layoutOrderSelect = document.getElementById('layout-order') as HTMLSelectElement;
const transColorInput = document.getElementById('trans-color-input') as HTMLInputElement;
const origColorInput = document.getElementById('orig-color-input') as HTMLInputElement;
const bgColorInput = document.getElementById('bg-color-input') as HTMLInputElement;
const aiColorInput = document.getElementById('ai-color-input') as HTMLInputElement;
const fontSizeRange = document.getElementById('font-size') as HTMLInputElement;
const fontSizeVal = document.getElementById('font-size-val') as HTMLElement;
const bgOpacityRange = document.getElementById('bg-opacity') as HTMLInputElement;
const bgOpacityVal = document.getElementById('bg-opacity-val') as HTMLElement;

// 预览元素
const previewBox = document.getElementById('preview-box') as HTMLElement;
const previewOrig = document.getElementById('preview-orig') as HTMLElement;
const previewTrans = document.getElementById('preview-trans') as HTMLElement;
const previewAi = document.getElementById('preview-ai') as HTMLElement;

const networkAlert = document.getElementById('network-alert') as HTMLElement;
const networkAlertText = document.getElementById('network-alert-text') as HTMLElement;

let currentSettings: ExtensionSettings = { ...DEFAULT_SETTINGS };

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();

  // v0.4.0：跳转高级设置页
  document.getElementById('btn-open-options')?.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
  setupSmoothSwitchers();
  await loadSettings();
  bindEvents();
  await initPacksUI();
  updatePreview();
  checkTranslationConnectivity();
});

/**
 * 检测当前网络是否支持 Google 翻译
 */
function checkTranslationConnectivity() {
  if (currentSettings.service === 'google') {
    chrome.runtime.sendMessage({ type: 'CHECK_GOOGLE_TRANSLATE_CONNECTION' }, (res) => {
      if (res && res.canConnect === false) {
        if (networkAlert) {
          networkAlert.classList.remove('hidden');
          if (networkAlertText) {
            networkAlertText.textContent = '当前网络无法直连 Google 免费翻译接口，建议开启科学代理或在下方切换为 DeepSeek / Gemini / OpenAI 翻译。';
          }
        }
      } else {
        if (networkAlert) {
          networkAlert.classList.add('hidden');
        }
      }
    });
  } else {
    if (networkAlert) {
      networkAlert.classList.add('hidden');
    }
  }
}

/**
 * 标签页切换逻辑 (带弹性吸附滑块)
 */
function setupTabs() {
  const tabsContainer = document.getElementById('main-tabs') as HTMLElement | null;
  const tabBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-btn'));
  const tabContents = document.querySelectorAll('.tab-content');

  /** 激活指定页签（同时同步 aria 状态与滑块位置） */
  const activate = (index: number, moveFocus = false) => {
    const btn = tabBtns[index];
    if (!btn) return;

    tabBtns.forEach((b, i) => {
      const on = i === index;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });

    tabContents.forEach((c) => c.classList.remove('active'));
    if (tabsContainer) {
      tabsContainer.style.setProperty('--tab-active-index', String(index));
    }
    const tabId = btn.getAttribute('data-tab');
    const targetContent = document.getElementById(`tab-${tabId}`);
    if (targetContent) {
      targetContent.classList.add('active');
    }
    if (moveFocus) btn.focus();
    // 切换标签页时平滑重置滚动位置到顶部
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  tabBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => activate(index));
  });

  // v0.3.0：tablist 键盘导航（← → ↑ ↓ / Home / End），符合 ARIA APG
  tabsContainer?.addEventListener('keydown', (e: KeyboardEvent) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key)) return;

    const current = tabBtns.findIndex((b) => b.classList.contains('active'));
    let next = current < 0 ? 0 : current;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = (current - 1 + tabBtns.length) % tabBtns.length;
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      next = (current + 1) % tabBtns.length;
    } else if (e.key === 'Home') {
      next = 0;
    } else if (e.key === 'End') {
      next = tabBtns.length - 1;
    }
    e.preventDefault();
    activate(next, true);
  });
}

/**
 * 设置平滑选项切换器 (Smooth Option Switcher)
 */
function setupSmoothSwitchers() {
  const switchers = document.querySelectorAll('.smooth-switcher');
  switchers.forEach((switcher) => {
    const targetId = switcher.getAttribute('data-target');
    const items = switcher.querySelectorAll('.switcher-item');
    const count = switcher.getAttribute('data-count') || String(items.length);
    (switcher as HTMLElement).style.setProperty('--count', count);

    items.forEach((item, index) => {
      item.addEventListener('click', () => {
        items.forEach((it) => it.classList.remove('active'));
        item.classList.add('active');
        (switcher as HTMLElement).style.setProperty('--active-index', String(index));

        if (targetId) {
          const targetSelect = document.getElementById(targetId) as HTMLSelectElement | null;
          const val = item.getAttribute('data-value');
          if (targetSelect && val) {
            targetSelect.value = val;
            targetSelect.dispatchEvent(new Event('change'));
          }
        }
      });
    });
  });
}

/**
 * 根据 select 当前值同步平滑切换器的滑块位置
 */
function syncSmoothSwitchers() {
  const switchers = document.querySelectorAll('.smooth-switcher');
  switchers.forEach((switcher) => {
    const targetId = switcher.getAttribute('data-target');
    if (!targetId) return;
    const targetSelect = document.getElementById(targetId) as HTMLSelectElement | null;
    if (!targetSelect) return;
    const currentVal = targetSelect.value;
    const items = Array.from(switcher.querySelectorAll('.switcher-item'));
    const count = switcher.getAttribute('data-count') || String(items.length);
    (switcher as HTMLElement).style.setProperty('--count', count);

    const matchedIndex = items.findIndex((it) => it.getAttribute('data-value') === currentVal);
    if (matchedIndex !== -1) {
      items.forEach((it) => it.classList.remove('active'));
      items[matchedIndex].classList.add('active');
      (switcher as HTMLElement).style.setProperty('--active-index', String(matchedIndex));
    }
  });
}

/**
 * 从 Background 或 Storage 加载设置
 */
async function loadSettings() {
  return new Promise<void>((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn('[Popup] 读取设置失败:', chrome.runtime.lastError.message);
        if (networkAlert && networkAlertText) {
          networkAlert.classList.remove('hidden');
          networkAlertText.textContent =
            '读取本地设置失败，当前显示默认值；直接修改会覆盖原配置，请刷新后重试。';
        }
      } else if (res && res.success && res.settings) {
        currentSettings = { ...DEFAULT_SETTINGS, ...res.settings };
      }
      populateForm();
      resolve();
    });
  });
}

/**
 * 各服务商默认/推荐模型预设
 */
const PRESET_MODELS: Record<string, Array<{ id: string; name?: string }>> = {
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek-V3 / Chat (推荐)' },
    { id: 'deepseek-reasoner', name: 'DeepSeek-R1 / Reasoner (深度推理)' }
  ],
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o mini (快速轻巧)' },
    { id: 'gpt-4o', name: 'GPT-4o (旗舰全能)' },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Antigravity推荐)' },
    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite (极速低延迟)' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (高质)' }
  ],
  gemini: [
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (快速推荐)' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (深度分析)' },
    { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash (实验版)' }
  ]
};

/**
 * 渲染模型下拉选项
 */
function renderModelOptions(models: Array<{ id: string; name?: string }>, selectedModel?: string) {
  if (!modelSelect) return;
  modelSelect.innerHTML = '';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = `-- 可选模型列表 (${models.length} 个) --`;
  modelSelect.appendChild(defaultOpt);

  let matched = false;
  const currentVal = selectedModel !== undefined ? selectedModel : modelNameInput.value.trim();

  models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name && m.name !== m.id ? `${m.name} [${m.id}]` : m.id;
    if (m.id === currentVal) {
      opt.selected = true;
      matched = true;
    }
    modelSelect.appendChild(opt);
  });

  // 若当前设定的模型不在返回列表里，保留作为单独选项
  if (currentVal && !matched) {
    const customOpt = document.createElement('option');
    customOpt.value = currentVal;
    customOpt.textContent = `当前设置: ${currentVal}`;
    customOpt.selected = true;
    modelSelect.appendChild(customOpt);
  }

  const manualOpt = document.createElement('option');
  manualOpt.value = '__custom__';
  manualOpt.textContent = '手动输入其它自定义模型...';
  modelSelect.appendChild(manualOpt);
}

/**
 * 加载当前服务商的模型选项（优先读取缓存，否则读取预设）
 */
function loadModelOptionsForCurrentService(selectedModel?: string) {
  const service = serviceSelect.value;
  if (service === 'google') return;

  chrome.storage.local.get([`cached_models_${service}`], (result) => {
    const cached = result[`cached_models_${service}`];
    if (Array.isArray(cached) && cached.length > 0) {
      renderModelOptions(cached, selectedModel);
    } else {
      renderModelOptions(PRESET_MODELS[service] || [], selectedModel);
    }
  });
}

/**
 * 将配置填入表单控件
 */
function populateForm() {
  enabledToggle.checked = currentSettings.enabled;
  targetLangSelect.value = currentSettings.targetLang;
  serviceSelect.value = currentSettings.service;

  scenarioSelect.value = currentSettings.scenario || 'vtuber';

  reasoningSelect.value = currentSettings.reasoningEffort || 'low';
  updateReasoningBadge();

  apiKeyInput.value = currentSettings.apiKey || '';
  apiBaseUrlInput.value = currentSettings.apiBaseUrl || '';
  modelNameInput.value = currentSettings.modelName || '';
  loadModelOptionsForCurrentService(currentSettings.modelName || '');
  autoHideNativeCheck.checked = currentSettings.autoHideNativeSubtitles;
  if (autoFallbackToggle) {
    autoFallbackToggle.checked = currentSettings.autoFallbackToGoogle !== false;
  }

  if (glossaryEnabledCheck) {
    glossaryEnabledCheck.checked = currentSettings.glossaryEnabled !== false;
  }
  if (sceneListEl) {
    renderSceneList();
    renderGlossaryPackList();
  }

  pauseThresholdRange.value = String(currentSettings.pauseThreshold);
  pauseThresholdVal.textContent = `${currentSettings.pauseThreshold} ms`;

  maxWordsRange.value = String(currentSettings.maxWordsPerSentence);
  maxWordsVal.textContent = `${currentSettings.maxWordsPerSentence} 词`;

  if (maxCharsRange) {
    maxCharsRange.value = String(currentSettings.maxCharsPerSentence ?? 28);
    maxCharsVal.textContent = `${currentSettings.maxCharsPerSentence ?? 28} 字`;
  }

  if (maxDurationRange) {
    const dur = currentSettings.maxDurationMs ?? 6500;
    maxDurationRange.value = String(dur);
    maxDurationVal.textContent = `${(dur / 1000).toFixed(1)} 秒`;
  }

  if (segmentationLanguageSelect) {
    segmentationLanguageSelect.value = currentSettings.segmentationLanguage || 'auto';
  }

  if (mergeFragmentsCheck) {
    mergeFragmentsCheck.checked = currentSettings.mergeShortFragments !== false;
  }

  autoPunctuationCheck.checked = currentSettings.autoPunctuation;

  displayModeSelect.value = currentSettings.displayMode;
  layoutOrderSelect.value = currentSettings.layoutOrder;

  transColorInput.value = currentSettings.transColor || '#38bdf8';
  origColorInput.value = currentSettings.origColor || '#e2e8f0';
  bgColorInput.value = currentSettings.bgColor || '#0f172a';
  if (aiColorInput) aiColorInput.value = currentSettings.aiIconColor || '#fbbf24';

  fontSizeRange.value = String(currentSettings.fontSize);
  fontSizeVal.textContent = `${currentSettings.fontSize} px`;

  bgOpacityRange.value = String(currentSettings.bgOpacity);
  bgOpacityVal.textContent = `${currentSettings.bgOpacity}%`;

  toggleAiSectionVisibility();
  syncSmoothSwitchers();
  updateColorDotActiveStates();
}

/**
 * 更新颜色预设圆点的高亮选中态
 */
function updateColorDotActiveStates() {
  const dots = document.querySelectorAll('.color-preset-dot');
  dots.forEach((dot) => {
    const targetType = dot.parentElement?.getAttribute('data-target');
    const color = dot.getAttribute('data-color')?.toLowerCase();
    if (!targetType || !color) return;

    let currentColor = '';
    if (targetType === 'transColor') currentColor = currentSettings.transColor.toLowerCase();
    else if (targetType === 'origColor') currentColor = currentSettings.origColor.toLowerCase();
    else if (targetType === 'bgColor') currentColor = currentSettings.bgColor.toLowerCase();
    else if (targetType === 'aiIconColor') currentColor = (currentSettings.aiIconColor || '#fbbf24').toLowerCase();

    if (currentColor === color) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
}

function updateReasoningBadge() {
  if (!reasoningBadge) return;
  const val = reasoningSelect.value;
  if (val === 'high') {
    reasoningBadge.textContent = '深度推理';
    reasoningBadge.className = 'badge badge-accent';
  } else if (val === 'low') {
    reasoningBadge.textContent = '轻度推理';
    reasoningBadge.className = 'badge';
  } else {
    reasoningBadge.textContent = '极速模式';
    reasoningBadge.className = 'badge';
  }
}

/**
 * 切换 AI 配置选项卡显示与隐藏
 */
function toggleAiSectionVisibility() {
  const service = serviceSelect.value;
  if (service === 'google') {
    aiConfigSection.classList.add('hidden');
  } else {
    aiConfigSection.classList.remove('hidden');

    if (service === 'deepseek') {
      apiBaseUrlInput.placeholder = 'https://api.deepseek.com/v1';
      modelNameInput.placeholder = 'deepseek-chat';
    } else if (service === 'openai') {
      apiBaseUrlInput.placeholder = 'https://api.openai.com/v1';
      modelNameInput.placeholder = 'gpt-4o-mini';
    } else if (service === 'gemini') {
      apiBaseUrlInput.placeholder = '（Gemini 使用官方 SDK 端点）';
      modelNameInput.placeholder = 'gemini-1.5-flash';
    }
    updateAiAccordionState();
  }
}

/**
 * 【v0.1.0 改动注释：动态刷新 AI 配置手风琴卡片状态徽标与描述】
 * 当折叠收起时，用户无需点开卡片即可快速获知当前引擎参数状态：
 * 1. 是否已填入 API Key（徽标显示「已就绪」/「未配置」）；
 * 2. 当前生效的目标模型名称（如「当前模型: gemini-3.5-flash-lite」）。
 */
function updateAiAccordionState() {
  const service = serviceSelect.value;
  if (service === 'google') return;

  const hasKey = !!apiKeyInput.value.trim();
  const model = modelNameInput.value.trim();

  if (aiConfigStatusBadge) {
    if (hasKey) {
      aiConfigStatusBadge.textContent = '已就绪';
      aiConfigStatusBadge.className = 'badge badge-accent';
    } else {
      aiConfigStatusBadge.textContent = '未配置';
      aiConfigStatusBadge.className = 'badge';
    }
  }

  if (aiAccordionDesc) {
    if (model) {
      aiAccordionDesc.textContent = `当前模型: ${model}`;
    } else {
      aiAccordionDesc.textContent = '点击展开配置 Key 与模型参数';
    }
  }
}

/**
 * 实时同步保存配置
 */
let saveTimer: any = null;
let savePending = false;

function sendSettingsSave() {
  savePending = false;
  chrome.runtime.sendMessage(
    {
      type: 'SAVE_SETTINGS',
      payload: currentSettings
    },
    () => {
      // 读取 lastError，避免 popup 关闭时出现未处理的 runtime 警告
      void chrome.runtime.lastError;
    }
  );
}

/**
 * popup 关闭/切后台时立即落盘，避免 250ms 防抖窗口内的最后一次输入丢失
 */
function flushPendingSettingsSave() {
  if (!savePending) return;
  clearTimeout(saveTimer);
  sendSettingsSave();
}

function persistSettings(immediate = false) {
  currentSettings = {
    enabled: enabledToggle.checked,
    targetLang: targetLangSelect.value,
    service: serviceSelect.value as any,
    scenario: (scenarioSelect.value || currentSettings.scenario || 'vtuber') as any,
    reasoningEffort: reasoningSelect.value as any,
    apiKey: apiKeyInput.value.trim(),
    apiBaseUrl: apiBaseUrlInput.value.trim(),
    modelName: modelNameInput.value.trim(),
    autoHideNativeSubtitles: autoHideNativeCheck.checked,
    autoFallbackToGoogle: autoFallbackToggle ? autoFallbackToggle.checked : true,
    glossaryEnabled: glossaryEnabledCheck ? glossaryEnabledCheck.checked : true,
    glossaryPacks: currentSettings.glossaryPacks && currentSettings.glossaryPacks.length > 0
      ? currentSettings.glossaryPacks
      : ['vtuber-hololive'],
    pauseThreshold: parseInt(pauseThresholdRange.value, 10),
    maxWordsPerSentence: parseInt(maxWordsRange.value, 10),
    minWordsPerSentence: currentSettings.minWordsPerSentence,
    maxDurationMs: maxDurationRange ? parseInt(maxDurationRange.value, 10) : currentSettings.maxDurationMs,
    autoPunctuation: autoPunctuationCheck.checked,
    segmentationLanguage: segmentationLanguageSelect
      ? (segmentationLanguageSelect.value as any)
      : currentSettings.segmentationLanguage || 'auto',
    maxCharsPerSentence: maxCharsRange ? parseInt(maxCharsRange.value, 10) : currentSettings.maxCharsPerSentence ?? 28,
    mergeShortFragments: mergeFragmentsCheck ? mergeFragmentsCheck.checked : true,
    displayMode: displayModeSelect.value as any,
    layoutOrder: layoutOrderSelect.value as any,
    transColor: transColorInput.value,
    origColor: origColorInput.value,
    bgColor: bgColorInput.value,
    aiIconColor: aiColorInput ? aiColorInput.value : currentSettings.aiIconColor || '#fbbf24',
    fontSize: parseInt(fontSizeRange.value, 10),
    bgOpacity: parseInt(bgOpacityRange.value, 10),
    offsetY: currentSettings.offsetY,
    syncOffsetMs: currentSettings.syncOffsetMs || 0
  };

  updateReasoningBadge();
  updateAiAccordionState();
  updatePreview();

  if (immediate) {
    clearTimeout(saveTimer);
    sendSettingsSave();
  } else {
    clearTimeout(saveTimer);
    savePending = true;
    saveTimer = setTimeout(sendSettingsSave, 250);
  }
}

window.addEventListener('pagehide', flushPendingSettingsSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushPendingSettingsSave();
  }
});

/**
 * 绑定所有控件事件
 */
function bindEvents() {
  enabledToggle.addEventListener('change', () => persistSettings(true));
  targetLangSelect.addEventListener('change', () => persistSettings(true));
  if (autoFallbackToggle) {
    autoFallbackToggle.addEventListener('change', () => persistSettings(true));
  }

  // 术语库注入开关（v0.2.9）
  if (glossaryEnabledCheck) {
    glossaryEnabledCheck.addEventListener('change', () => persistSettings(true));
  }

  // 术语与场景页（v0.2.9）
  if (btnUploadScene && sceneUploadInput) {
    btnUploadScene.addEventListener('click', () => sceneUploadInput.click());
  }
  if (btnUploadGlossary && glossaryUploadInput) {
    btnUploadGlossary.addEventListener('click', () => glossaryUploadInput.click());
  }
  if (sceneUploadInput) {
    sceneUploadInput.addEventListener('change', () => handleSceneUpload(sceneUploadInput));
  }
  if (glossaryUploadInput) {
    glossaryUploadInput.addEventListener('change', () => handleGlossaryUpload(glossaryUploadInput));
  }

  scenarioSelect.addEventListener('change', () => persistSettings(true));
  reasoningSelect.addEventListener('change', () => persistSettings(true));

  serviceSelect.addEventListener('change', () => {
    toggleAiSectionVisibility();
    loadModelOptionsForCurrentService();
    if (fetchModelsStatus) {
      fetchModelsStatus.textContent = '';
      fetchModelsStatus.className = 'sub-status-msg';
    }
    persistSettings(true);
    checkTranslationConnectivity();
  });

  if (aiAccordionHeader) {
    aiAccordionHeader.addEventListener('click', (e) => {
      e.preventDefault();
      aiConfigSection.classList.toggle('expanded');
    });
  }

  apiKeyInput.addEventListener('input', () => persistSettings());
  apiBaseUrlInput.addEventListener('input', () => persistSettings());

  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      const val = modelSelect.value;
      if (val === '__custom__') {
        modelNameInput.focus();
        modelNameInput.select();
      } else if (val) {
        modelNameInput.value = val;
        persistSettings(true);
      }
    });
  }

  modelNameInput.addEventListener('input', () => {
    const val = modelNameInput.value.trim();
    let found = false;
    for (let i = 0; i < modelSelect.options.length; i++) {
      if (modelSelect.options[i].value === val) {
        modelSelect.selectedIndex = i;
        found = true;
        break;
      }
    }
    if (!found) {
      modelSelect.value = '__custom__';
    }
    persistSettings();
  });

  if (btnFetchModels) {
    btnFetchModels.addEventListener('click', () => fetchModelsFromApi());
  }

  autoHideNativeCheck.addEventListener('change', () => persistSettings(true));

  // 断句
  pauseThresholdRange.addEventListener('input', () => {
    pauseThresholdVal.textContent = `${pauseThresholdRange.value} ms`;
    persistSettings();
  });

  maxWordsRange.addEventListener('input', () => {
    maxWordsVal.textContent = `${maxWordsRange.value} 词`;
    persistSettings();
  });

  if (maxCharsRange) {
    maxCharsRange.addEventListener('input', () => {
      maxCharsVal.textContent = `${maxCharsRange.value} 字`;
      persistSettings();
    });
  }

  if (maxDurationRange) {
    maxDurationRange.addEventListener('input', () => {
      maxDurationVal.textContent = `${(parseInt(maxDurationRange.value, 10) / 1000).toFixed(1)} 秒`;
      persistSettings();
    });
  }

  if (segmentationLanguageSelect) {
    segmentationLanguageSelect.addEventListener('change', () => persistSettings(true));
  }

  if (mergeFragmentsCheck) {
    mergeFragmentsCheck.addEventListener('change', () => persistSettings(true));
  }

  autoPunctuationCheck.addEventListener('change', () => persistSettings(true));

  // 样式与颜色
  displayModeSelect.addEventListener('change', () => persistSettings(true));
  layoutOrderSelect.addEventListener('change', () => persistSettings(true));

  transColorInput.addEventListener('input', () => persistSettings());
  origColorInput.addEventListener('input', () => persistSettings());
  bgColorInput.addEventListener('input', () => persistSettings());
  aiColorInput?.addEventListener('input', () => persistSettings());

  // 快捷色块点击
  const colorPresetDots = document.querySelectorAll('.color-preset-dot');
  colorPresetDots.forEach((dot) => {
    dot.addEventListener('click', () => {
      const targetType = dot.parentElement?.getAttribute('data-target');
      const color = dot.getAttribute('data-color');
      if (!targetType || !color) return;

      if (targetType === 'transColor') {
        transColorInput.value = color;
        persistSettings(true);
      } else if (targetType === 'origColor') {
        origColorInput.value = color;
        persistSettings(true);
      } else if (targetType === 'bgColor') {
        if (color !== '#00000000') bgColorInput.value = color;
        currentSettings.bgColor = color;
        persistSettings(true);
      } else if (targetType === 'aiIconColor') {
        if (aiColorInput) aiColorInput.value = color;
        currentSettings.aiIconColor = color;
        persistSettings(true);
      }
      updateColorDotActiveStates();
    });
  });

  fontSizeRange.addEventListener('input', () => {
    fontSizeVal.textContent = `${fontSizeRange.value} px`;
    persistSettings();
  });

  bgOpacityRange.addEventListener('input', () => {
    bgOpacityVal.textContent = `${bgOpacityRange.value}%`;
    persistSettings();
  });

  btnToggleKey.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      btnToggleKey.innerHTML = `<span style="display:inline-flex;width:14px;height:14px;align-items:center;">${ICON_PREVIEW_CLOSE}</span>`;
    } else {
      apiKeyInput.type = 'password';
      btnToggleKey.innerHTML = `<span style="display:inline-flex;width:14px;height:14px;align-items:center;">${ICON_PREVIEW_OPEN}</span>`;
    }
  });

  btnTestApi.addEventListener('click', handleTestApi);
}

/**
 * 从 API 接口获取可用模型列表
 */
async function fetchModelsFromApi() {
  const service = serviceSelect.value;
  const apiKey = apiKeyInput.value.trim();
  const apiBaseUrl = apiBaseUrlInput.value.trim();

  if (!apiKey && service !== 'google') {
    if (fetchModelsStatus) {
      fetchModelsStatus.className = 'sub-status-msg error';
      fetchModelsStatus.innerHTML = `<span style="display:inline-flex;width:12px;height:12px;margin-right:4px;vertical-align:-1px;">${ICON_ALERT}</span>请先在上方填入 API Key 再点击获取模型`;
    }
    apiKeyInput.focus();
    return;
  }

  if (btnFetchModels) {
    btnFetchModels.disabled = true;
    btnFetchModels.innerHTML = `<span class="hourglass-flip-anim" style="display:inline-flex;width:12px;height:12px;margin-right:4px;">${ICON_HOURGLASS}</span>拉取中...`;
  }
  if (fetchModelsStatus) {
    fetchModelsStatus.className = 'sub-status-msg loading';
    fetchModelsStatus.textContent = '正在通过接口获取可用模型列表...';
  }

  const querySettings: ExtensionSettings = {
    ...currentSettings,
    service: service as any,
    apiKey,
    apiBaseUrl
  };

  chrome.runtime.sendMessage(
    {
      type: 'FETCH_MODELS',
      payload: { settings: querySettings }
    },
    (res) => {
      if (btnFetchModels) {
        btnFetchModels.disabled = false;
        btnFetchModels.innerHTML = `<span style="display:inline-flex;width:12px;height:12px;align-items:center;margin-right:3px;">${ICON_REFRESH}</span>从 API 获取模型`;
      }

      if (res && res.success && Array.isArray(res.models) && res.models.length > 0) {
        if (fetchModelsStatus) {
          fetchModelsStatus.className = 'sub-status-msg success';
          renderStatus(
            fetchModelsStatus,
            'sub-status-msg success',
            ICON_CHECK,
            `成功获取到 ${res.models.length} 个可用模型！`
          );
        }

        // 缓存到 local storage
        chrome.storage.local.set({ [`cached_models_${service}`]: res.models });

        // 重新渲染下拉列表
        renderModelOptions(res.models, modelNameInput.value.trim());

        // 如果目前未指定模型名称，自动推荐选中第一个
        if (!modelNameInput.value.trim()) {
          const first = res.models[0].id;
          modelSelect.value = first;
          modelNameInput.value = first;
          persistSettings(true);
        }
      } else {
        if (fetchModelsStatus) {
          fetchModelsStatus.className = 'sub-status-msg error';
          renderStatus(
            fetchModelsStatus,
            'sub-status-msg error',
            ICON_ALERT,
            `获取失败: ${res?.error || '接口未返回模型列表'}`
          );
        }
      }
    }
  );
}

/**
 * 测试连接翻译服务与响应延迟
 */
async function handleTestApi() {
  const latencyBadge = document.getElementById('test-latency-badge') as HTMLElement;
  testStatus.className = 'status-msg';
  testStatus.textContent = '正在发起请求并测试往返延迟...';
  if (latencyBadge) {
    latencyBadge.className = 'latency-badge hidden';
    latencyBadge.textContent = '';
  }
  btnTestApi.disabled = true;
  btnTestApi.textContent = '测试中...';

  persistSettings(true);

  const testSample = currentSettings.scenario === 'vtuber'
    ? ["Wait, chat, did you see that?! That was totally yabai www!"]
    : ["Hello! We are testing YouTube subtitle translation."];

  const startTime = performance.now();

  chrome.runtime.sendMessage(
    {
      type: 'TRANSLATE_BATCH',
      payload: {
        texts: testSample,
        targetLang: currentSettings.targetLang,
        settings: currentSettings,
        noFallback: true,   // 关键：测试连接严禁自动回退到谷歌翻译！必须真实验证当前端点
        bypassCache: true   // 关键：测试连接必须跳过缓存，进行真实的网络端点探测！
      }
    },
    (res) => {
      const latencyMs = Math.round(performance.now() - startTime);
      btnTestApi.disabled = false;
      btnTestApi.textContent = '测试连接与延迟';

      if (latencyBadge) {
        latencyBadge.classList.remove('hidden');
        latencyBadge.textContent = `${latencyMs} ms`;
        if (latencyMs < 600) {
          latencyBadge.className = 'latency-badge latency-fast';
          latencyBadge.title = `响应耗时: ${latencyMs}ms (极速，字幕秒级跟随)`;
        } else if (latencyMs < 1800) {
          latencyBadge.className = 'latency-badge latency-medium';
          latencyBadge.title = `响应耗时: ${latencyMs}ms (良好，滑动窗口预取无卡顿)`;
        } else {
          latencyBadge.className = 'latency-badge latency-slow';
          latencyBadge.title = `响应耗时: ${latencyMs}ms (较慢，大模型深度推理或中转网络延迟)`;
        }
      }

      if (res && res.success && res.translations && res.translations.length > 0) {
        testStatus.className = 'status-msg success';
        let serviceLabel = 'Google 翻译';
        if (currentSettings.service === 'openai') {
          serviceLabel = `OpenAI代理 [${currentSettings.modelName?.trim() || 'gpt-4o-mini'}]`;
        } else if (currentSettings.service === 'deepseek') {
          serviceLabel = `DeepSeek [${currentSettings.modelName?.trim() || 'deepseek-chat'}]`;
        } else if (currentSettings.service === 'gemini') {
          serviceLabel = `Gemini [${currentSettings.modelName?.trim() || 'gemini-1.5-flash'}]`;
        }
        renderStatus(
          testStatus,
          'status-msg success',
          ICON_CHECK,
          `连通正常 (${serviceLabel}) · 耗时 ${latencyMs}ms：`,
          `"${res.translations[0]}"`
        );
      } else {
        testStatus.className = 'status-msg error';
        if (latencyBadge) {
          latencyBadge.className = 'latency-badge latency-error';
          latencyBadge.textContent = `异常 (${latencyMs}ms)`;
        }
        renderStatus(
          testStatus,
          'status-msg error',
          ICON_ALERT,
          `连接失败 (耗时 ${latencyMs}ms)：${res?.error || '请求未响应'}`
        );
      }
    }
  );
}

/**
 * 实时更新预览效果
 */
function updatePreview() {
  const {
    fontSize,
    bgOpacity,
    displayMode,
    layoutOrder,
    scenario,
    reasoningEffort,
    bgColor = '#0f172a',
    origColor = '#e2e8f0',
    transColor = '#38bdf8',
    aiIconColor = '#fbbf24'
  } = currentSettings;

  previewBox.style.backgroundColor = hexToRgba(bgColor, bgOpacity);
  if (previewAi) {
    previewAi.style.color = aiIconColor;
  }

  previewOrig.style.textShadow = '0 0 2px #000, 0 0 4px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 5px rgba(0,0,0,0.9)';
  previewTrans.style.textShadow = '0 0 2px #000, 0 0 4px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 5px rgba(0,0,0,0.9)';

  previewOrig.style.color = origColor;
  previewTrans.style.color = transColor;

  if (layoutOrder === 'translation_top') {
    previewTrans.style.fontSize = `${fontSize}px`;
    previewTrans.style.fontWeight = '600';
    previewOrig.style.fontSize = `${Math.round(fontSize * 0.8)}px`;
    previewOrig.style.fontWeight = '500';
    previewOrig.style.opacity = '0.92';
  } else {
    previewOrig.style.fontSize = `${fontSize}px`;
    previewOrig.style.fontWeight = '600';
    previewTrans.style.fontSize = `${Math.round(fontSize * 0.88)}px`;
    previewTrans.style.fontWeight = '500';
    previewOrig.style.opacity = '1';
  }

  if (scenario === 'vtuber') {
    previewOrig.textContent = 'Wait, chat, did you see that?! That was totally yabai www!';
    if (reasoningEffort === 'high') {
      previewTrans.textContent = '等等弹幕区的大家，刚才你们看到了吗？！这也太牙白了吧笑死www！';
    } else if (reasoningEffort === 'low') {
      previewTrans.textContent = '等等观众们，看到了吗？！这真的太糟了草www！';
    } else {
      previewTrans.textContent = '等等聊天室，你们看见那个了吗？太糟糕了哈哈哈！';
    }
  } else {
    previewOrig.textContent = "So today we're going to build a browser extension.";
    previewTrans.textContent = '所以今天我们来构建一个浏览器扩展。';
  }

  if (displayMode === 'translation_only') {
    previewOrig.style.display = 'none';
    previewTrans.style.display = 'block';
  } else if (displayMode === 'original_only') {
    previewOrig.style.display = 'block';
    previewTrans.style.display = 'none';
  } else {
    previewOrig.style.display = 'block';
    previewTrans.style.display = 'block';
  }

  if (layoutOrder === 'translation_top') {
    previewBox.style.flexDirection = 'column-reverse';
  } else {
    previewBox.style.flexDirection = 'column';
  }
}


/* ───────────────────── 术语与场景页（v0.2.9） ───────────────────── */

let customPacks: CustomPacks = { glossaries: [], scenes: [] };

async function initPacksUI(): Promise<void> {
  customPacks = await loadCustomPacks();
  renderSceneList();
  renderGlossaryPackList();
}

function showPackStatus(message: string, kind: 'ok' | 'error' | 'warn' = 'ok'): void {
  if (!packStatusEl) return;
  packStatusEl.textContent = message;
  packStatusEl.style.color = kind === 'error' ? '#f87171' : kind === 'warn' ? '#fbbf24' : '#34d399';
  window.setTimeout(() => {
    if (packStatusEl.textContent === message) {
      packStatusEl.textContent = '';
    }
  }, 5000);
}

function getEnabledPackIds(): string[] {
  const ids = currentSettings.glossaryPacks;
  return Array.isArray(ids) && ids.length > 0 ? ids : DEFAULT_GLOSSARY_PACKS.slice();
}

/** 场景卡片列表（内置 + 上传） */
function renderSceneList(): void {
  const scenes = getAllScenes(customPacks);
  const activeId = currentSettings.scenario || 'vtuber';

  // 同步隐藏 select（保存逻辑依赖它）
  if (scenarioSelect) {
    scenarioSelect.innerHTML = '';
    for (const scene of scenes) {
      const option = document.createElement('option');
      option.value = scene.id;
      option.textContent = scene.name;
      scenarioSelect.appendChild(option);
    }
    scenarioSelect.value = activeId;
  }

  if (sceneActiveBadgeEl) {
    sceneActiveBadgeEl.textContent = scenes.find((s) => s.id === activeId)?.name || '通用日常';
  }
  if (!sceneListEl) return;

  sceneListEl.innerHTML = '';
  for (const scene of scenes) {
    const card = document.createElement('div');
    card.className = 'pack-card clickable' + (scene.id === activeId ? ' active' : '');

    const main = document.createElement('div');
    main.className = 'pack-main';
    const nameRow = document.createElement('div');
    nameRow.className = 'pack-name-row';
    const name = document.createElement('span');
    name.className = 'pack-name';
    name.textContent = scene.name;
    const badge = document.createElement('span');
    badge.className = 'badge' + (scene.prompt ? '' : ' pack-badge-empty');
    badge.textContent = scene.prompt ? (scene.builtIn ? '内置' : '已上传') : '待上传';
    nameRow.append(name, badge);
    const desc = document.createElement('span');
    desc.className = 'pack-desc';
    desc.textContent = scene.hint || scene.description;
    main.append(nameRow, desc);

    const actions = document.createElement('div');
    actions.className = 'pack-actions';
    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.className = 'btn-chip';
    useBtn.textContent = scene.id === activeId ? '使用中' : '使用';
    useBtn.disabled = scene.id === activeId || !scene.prompt;
    useBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectScene(scene);
    });
    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'btn-chip';
    uploadBtn.textContent = '上传';
    uploadBtn.title = `上传「${scene.name}」场景包（JSON）`;
    uploadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sceneUploadInput?.click();
    });
    actions.append(useBtn, uploadBtn);

    card.append(main, actions);
    card.addEventListener('click', () => {
      if (!scene.prompt) {
        showPackStatus('该场景为占位类别，请先上传场景包后再使用', 'warn');
        return;
      }
      selectScene(scene);
    });
    sceneListEl.appendChild(card);
  }
}

function selectScene(scene: ScenePack): void {
  if (!scene.prompt) {
    showPackStatus('该场景尚未配置提示词', 'warn');
    return;
  }
  currentSettings.scenario = scene.id;
  if (scenarioSelect) scenarioSelect.value = scene.id;
  persistSettings(true);
  renderSceneList();
  updatePreview();
  showPackStatus(`已切换到「${scene.name}」场景`, 'ok');
}

/** 术语库包卡片列表（内置 + 上传） */
function renderGlossaryPackList(): void {
  const packs = getAllGlossaryPacks(customPacks);
  const enabled = getEnabledPackIds();

  if (glossaryTotalBadgeEl) {
    const total = packs.filter((p) => enabled.includes(p.id)).reduce((sum, p) => sum + p.entries.length, 0);
    glossaryTotalBadgeEl.textContent = `${total} 条`;
    glossaryTotalBadgeEl.title = `启用 ${enabled.length} 个术语库`;
  }
  if (!glossaryPackListEl) return;

  glossaryPackListEl.innerHTML = '';
  for (const pack of packs) {
    const card = document.createElement('div');
    card.className = 'pack-card clickable';

    const main = document.createElement('div');
    main.className = 'pack-main';
    const nameRow = document.createElement('div');
    nameRow.className = 'pack-name-row';
    const name = document.createElement('span');
    name.className = 'pack-name';
    name.textContent = pack.name;
    const countBadge = document.createElement('span');
    countBadge.className = 'badge' + (pack.entries.length === 0 ? ' pack-badge-empty' : '');
    countBadge.textContent = `${pack.entries.length} 条`;
    nameRow.append(name, countBadge);
    const desc = document.createElement('span');
    desc.className = 'pack-desc';
    desc.textContent = pack.description;
    main.append(nameRow, desc);

    const actions = document.createElement('div');
    actions.className = 'pack-actions';
    const toggle = document.createElement('label');
    toggle.className = 'pack-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = enabled.includes(pack.id);
    checkbox.disabled = pack.entries.length === 0;
    checkbox.addEventListener('change', () => togglePack(pack, checkbox.checked));
    toggle.append(checkbox, document.createTextNode(' 启用'));

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'btn-chip';
    uploadBtn.textContent = '上传';
    uploadBtn.title = `向「${pack.name}」类别上传术语库（JSON）`;
    uploadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      glossaryUploadInput?.click();
    });
    actions.append(toggle, uploadBtn);

    if (!pack.builtIn) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-chip';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeletePack(pack);
      });
      actions.append(delBtn);
    }

    card.append(main, actions);
    card.addEventListener('click', () => previewPack(pack));
    glossaryPackListEl.appendChild(card);
  }
}

function togglePack(pack: GlossaryPack, enabledOn: boolean): void {
  const current = getEnabledPackIds();
  const next = enabledOn
    ? Array.from(new Set([...current, pack.id]))
    : current.filter((id) => id !== pack.id);
  currentSettings.glossaryPacks = next;
  persistSettings(true);
  renderGlossaryPackList();
  showPackStatus(`「${pack.name}」已${enabledOn ? '启用' : '停用'}`, 'ok');
}

function previewPack(pack: GlossaryPack): void {
  if (!packPreviewEl) return;
  packPreviewEl.classList.remove('hidden');
  packPreviewEl.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'pack-preview-title';
  title.textContent = `${pack.name} · ${pack.entries.length} 条${pack.entries.length > 60 ? '（显示前 60 条）' : ''}`;
  packPreviewEl.appendChild(title);

  if (pack.entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'glossary-empty';
    empty.textContent = '该类别暂无内容，可通过「上传」导入术语库 JSON';
    packPreviewEl.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const entry of pack.entries.slice(0, 60)) {
    const row = document.createElement('div');
    row.className = 'glossary-item';
    const main = document.createElement('div');
    main.className = 'glossary-item-main';
    const ja = document.createElement('span');
    ja.className = 'glossary-ja';
    ja.textContent = entry.ja;
    const arrow = document.createElement('span');
    arrow.className = 'glossary-arrow';
    arrow.textContent = '→';
    const zh = document.createElement('span');
    zh.className = 'glossary-zh';
    zh.textContent = entry.zh;
    main.append(ja, arrow, zh);
    const meta = document.createElement('span');
    meta.className = 'glossary-meta';
    meta.textContent = GLOSSARY_CATEGORY_LABELS[entry.category] || '用语';
    meta.title = `来源：${entry.source}`;
    row.append(main, meta);
    frag.appendChild(row);
  }
  packPreviewEl.appendChild(frag);
}

async function handleDeletePack(pack: GlossaryPack): Promise<void> {
  if (!window.confirm(`确定删除自定义术语库「${pack.name}」？该操作不可恢复。`)) return;
  const packs = customPacks.glossaries.filter((p) => p.id !== pack.id);
  const ok = await saveGlossaryPacks(packs);
  if (!ok) {
    showPackStatus('删除失败：本地存储不可用', 'error');
    return;
  }
  customPacks = { ...customPacks, glossaries: packs };
  currentSettings.glossaryPacks = getEnabledPackIds().filter((id) => id !== pack.id);
  persistSettings(true);
  renderGlossaryPackList();
  if (packPreviewEl) {
    packPreviewEl.classList.add('hidden');
    packPreviewEl.innerHTML = '';
  }
  showPackStatus(`已删除「${pack.name}」`, 'ok');
}

async function handleGlossaryUpload(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const result = validateGlossaryPack(json);
    if (!result.ok || !result.pack) {
      showPackStatus(`上传失败：${result.errors.slice(0, 3).join('；')}`, 'error');
      return;
    }
    const newPack = result.pack;
    if (BUILTIN_GLOSSARY_PACKS.some((p) => p.name === newPack.name)) {
      newPack.name = `${newPack.name}（自定义）`;
    }
    const packs = [...customPacks.glossaries.filter((p) => p.name !== newPack.name), newPack];
    const ok = await saveGlossaryPacks(packs);
    if (!ok) {
      showPackStatus('保存失败：本地存储不可用', 'error');
      return;
    }
    customPacks = { ...customPacks, glossaries: packs };
    currentSettings.glossaryPacks = Array.from(new Set([...getEnabledPackIds(), newPack.id]));
    persistSettings(true);
    renderGlossaryPackList();
    previewPack(newPack);
    showPackStatus(`已导入「${newPack.name}」${newPack.entries.length} 条，并自动启用`, 'ok');
  } catch (err: any) {
    showPackStatus(`解析失败：${err?.message || '不是合法 JSON'}`, 'error');
  }
}

async function handleSceneUpload(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const result = validateScenePack(json);
    if (!result.ok || !result.pack) {
      showPackStatus(`上传失败：${result.errors.slice(0, 3).join('；')}`, 'error');
      return;
    }
    const newPack = result.pack;
    if (BUILTIN_SCENES.some((p) => p.name === newPack.name)) {
      newPack.name = `${newPack.name}（自定义）`;
    }
    const packs = [...customPacks.scenes.filter((p) => p.name !== newPack.name), newPack];
    const ok = await saveScenePacks(packs);
    if (!ok) {
      showPackStatus('保存失败：本地存储不可用', 'error');
      return;
    }
    customPacks = { ...customPacks, scenes: packs };
    renderSceneList();
    showPackStatus(`已导入场景「${newPack.name}」，在列表中点击「使用」即可切换`, 'ok');
  } catch (err: any) {
    showPackStatus(`解析失败：${err?.message || '不是合法 JSON'}`, 'error');
  }
}
