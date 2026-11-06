/**
 * 高级设置页（v0.4.0）
 * ----------------------------------------------------------------------------
 * 与弹窗共用同一套设置与存储：
 *   - 设置：utils/storage.ts（chrome.storage.sync → local 降级）
 *   - 术语库：utils/packs.ts（自定义包存 local，内置包在代码里）
 * 两处任一改动都会通过 storage.onChanged 同步到另一处，不存在"两份设置"。
 */
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../../types';
import { getStoredSettings, saveStoredSettings } from '../../utils/storage';
import {
  getAllGlossaryPacks,
  getAllScenes,
  loadCustomPacks,
  saveGlossaryPacks,
  validateGlossaryPack,
  BUILTIN_GLOSSARY_PACKS,
  type CustomPacks,
  type GlossaryPack
} from '../../utils/packs';
import { GLOSSARY_CATEGORY_LABELS, type GlossaryCategory, type GlossaryEntry } from '../../utils/glossary';
import { clearSentenceCache } from '../../utils/db-cache';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string): T[] => Array.from(document.querySelectorAll<T>(sel));

let settings: ExtensionSettings;
let customPacks: CustomPacks = { glossaries: [], scenes: [] };
let activePackId = '';
let editingIndex = -1;
let searchTerm = '';
let categoryFilter: GlossaryCategory | 'all' = 'all';

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
  renderScenarios();
  reflectSettings();
  applyPreview();

  activePackId = getAllGlossaryPacks(customPacks)[0]?.id ?? '';
  renderPackList();
  renderTable();

  bindGlossaryEvents();
  bindMiscEvents();

  // 弹窗侧改动 → 本页实时反映
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' && area !== 'local') return;
    if (Object.prototype.hasOwnProperty.call(changes, 'yt_sub_translator_settings')) {
      void getStoredSettings().then((next) => {
        settings = next;
        reflectSettings();
        applyPreview();
        renderScenarios();
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
      } else if (el.value !== String(value ?? '')) {
        el.value = String(value ?? '');
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

/* ══════════════════════════ 保存 ══════════════════════════ */

let saveTimer: number | undefined;
/* 防抖窗口内可能有多次改动（例如先切「括注」再切「ASR 纠错」），
   只留最后一个 patch 会把前一个静默丢掉。这里把窗口内的改动累积起来一起写。 */
let pendingPatch: Partial<ExtensionSettings> = {};

async function update(patch: Partial<ExtensionSettings>): Promise<void> {
  settings = { ...settings, ...patch };
  pendingPatch = { ...pendingPatch, ...patch };
  // 预览必须读合并后的 settings：早期把 applyPreview() 放在合并之前，
  // 导致滑块/取色器改动整整滞后一次输入才反映到预览上。
  applyPreview();
  if (patch.scenario) renderScenarios();
  if (patch.service) reflectSettings();

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
    hint.textContent = scene.prompt ? scene.hint || scene.description || '' : '待上传场景包';

    card.append(name, hint);
    card.addEventListener('click', () => void update({ scenario: scene.id }));
    grid.appendChild(card);
  }
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
      renderPackList();
      renderTable();
    });
    list.appendChild(btn);
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

/* ══════════════════════════ 其他动作 ══════════════════════════ */

function bindMiscEvents(): void {
  $('#btn-toggle-key')?.addEventListener('click', () => {
    const input = $('[data-setting="apiKey"]') as HTMLInputElement | null;
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  $('#btn-open-popup')?.addEventListener('click', () => {
    // 弹窗没有 API 可直接打开，这里提示用户点工具栏图标
    toast('点浏览器工具栏上的扩展图标即可打开快捷面板');
  });

  $('#btn-test-service')?.addEventListener('click', () => void testService());

  $('#btn-clear-cache')?.addEventListener('click', async () => {
    const ok = await clearSentenceCache();
    toast(ok ? '翻译缓存已清空' : '清空失败：数据库被占用，请刷新视频页后重试');
  });

  $('#btn-reset-settings')?.addEventListener('click', () => void resetSettings());
  $('#btn-reset-all')?.addEventListener('click', () => void resetSettings());
}

async function testService(): Promise<void> {
  const btn = $('#btn-test-service') as HTMLButtonElement | null;
  const latency = $('#service-latency');
  const desc = $('#service-test-desc');

  if (settings.service === 'google') {
    toast('Google 免费通道无需配置，视频页可直接使用');
    return;
  }

  const defaults: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    openai: 'https://api.openai.com/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai'
  };
  const base = (settings.apiBaseUrl || defaults[settings.service] || '').replace(/\/$/, '');

  if (!settings.apiKey) {
    toast('请先填写 API Key');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '测试中…';
  }

  const started = performance.now();
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${settings.apiKey}` }
    });
    const cost = Math.round(performance.now() - started);

    if (res.ok) {
      if (latency) {
        latency.classList.remove('hidden');
        latency.textContent = `${cost} ms`;
        latency.style.color = 'var(--state-ok)';
      }
      if (desc) desc.textContent = `连通正常，${cost} ms 内返回模型列表。`;
    } else {
      if (latency) {
        latency.classList.remove('hidden');
        latency.textContent = `HTTP ${res.status}`;
        latency.style.color = 'var(--state-error)';
      }
      if (desc) desc.textContent = `服务返回 HTTP ${res.status}，请检查 Key 与 Base URL。`;
    }
  } catch (err) {
    if (latency) {
      latency.classList.remove('hidden');
      latency.textContent = '请求失败';
      latency.style.color = 'var(--state-error)';
    }
    if (desc) desc.textContent = `请求未发出或被拦截：${(err as Error).message.slice(0, 60)}`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '测试连接';
    }
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
