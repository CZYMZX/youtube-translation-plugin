/**
 * 需求 7 测试：AI 精翻字幕持久化 / 断点续翻 / 上文语境 / TTL / 清空
 * ----------------------------------------------------------------------------
 * 两部分：
 *   A. 纯函数与设置层断言（本进程内跑，不需要浏览器 API）
 *   B. 端到端（必做项）：用 esbuild 把本文件连同 utils/ai-track-cache、
 *      utils/ephemeral-subtitle-store、utils/translator、entrypoints/background
 *      打成 IIFE，配 chrome 桩 + 自带最小 IndexedDB 桩，然后**每条用例起一个
 *      独立 node 进程**执行 —— 只有这样「重新打开视频」才是真的冷启动（模块级
 *      内存镜像清空、只剩 IndexedDB 里的数据）。
 *
 * IndexedDB 桩的数据落在一个 JSON 文件里，正是为了让跨进程「刷新后还在」可信。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { DEFAULT_SETTINGS } from '../types/index.ts';
import { sanitizeSettings } from '../utils/storage.ts';
import {
  AI_TRACK_ALIGN_MIN_RATIO,
  AI_TRACK_BATCH_SIZE,
  AI_TRACK_CONTEXT_WINDOW,
  ALLOWED_AI_CACHE_TTL_HOURS,
  DEFAULT_AI_CACHE_TTL_HOURS,
  buildAiTrackKey,
  buildAiTrackRecord,
  buildResumeBatches,
  decideAiRunAction,
  hashSource,
  isAiTrackExpired,
  planResume,
  loadAiTrack,
  saveAiTrack,
  clearAiTrack,
  clearAllAiTracks,
  pruneAiTracks,
  getAiTrackStats
} from '../utils/ai-track-cache.ts';
import { EphemeralSubtitleStore } from '../utils/ephemeral-subtitle-store.ts';

const HERE = path.join(process.cwd(), 'test');
const REPO = process.cwd();

/* ═══════════════════════ 样本数据（各阶段共用，保证指纹一致） ═══════════════════════ */

const VIDEO_ID = 'dQw4w9WgXcQ';
const META = { videoId: VIDEO_ID, targetLang: 'zh-CN', scenario: 'vtuber' };

const TEXTS = [
  'Hello everyone and welcome back to the stream.',
  'Today we are going to talk about something different.',
  'I have been thinking about this for a while.',
  'It started when I saw a comment last week.',
  'Somebody asked me why I always play at night.',
  'And honestly I never really thought about it.',
  'The answer is simpler than you might expect.',
  'My schedule just works better that way.',
  'Anyway let us get into the main topic.',
  'There is a lot to cover today.',
  'So grab a drink and get comfortable.',
  'Let us begin with the first question.'
];

function makeSentences() {
  return TEXTS.map((text, i) => ({
    id: i,
    start: i * 4000,
    end: i * 4000 + 3600,
    text,
    status: 'idle',
    translation: undefined,
    isAi: false
  }));
}

/* ═══════════════════════ 最小 IndexedDB 桩 ═══════════════════════ */

function createIdbStub(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    data = { dbs: {} };
  }
  if (!data || !data.dbs) data = { dbs: {} };

  const flush = () => {
    try {
      fs.writeFileSync(file, JSON.stringify(data));
    } catch {
      /* 桩自身失败不该影响被测代码 */
    }
  };
  const later = (fn) => setTimeout(fn, 0);
  const req = () => ({ result: undefined, error: null, onsuccess: null, onerror: null });

  class Txn {
    constructor(dbName, mode) {
      this.dbName = dbName;
      this.mode = mode;
      this.pending = 0;
      this.done = false;
      this.oncomplete = null;
      this.onerror = null;
      this.onabort = null;
      later(() => {
        if (this.pending <= 0) this.finish();
      });
    }
    objectStore(name) {
      return new Store(this, name);
    }
    addOp() {
      this.pending++;
    }
    doneOp() {
      this.pending--;
      if (this.pending <= 0) this.finish();
    }
    finish() {
      if (this.done) return;
      this.done = true;
      if (this.mode !== 'readonly') flush();
      later(() => this.oncomplete && this.oncomplete());
    }
  }

  const dbStore = (dbName, storeName) => {
    data.dbs[dbName] = data.dbs[dbName] || { meta: {}, stores: {} };
    data.dbs[dbName].stores[storeName] = data.dbs[dbName].stores[storeName] || {};
    return data.dbs[dbName].stores[storeName];
  };
  const dbMeta = (dbName) => {
    data.dbs[dbName] = data.dbs[dbName] || { meta: {}, stores: {} };
    data.dbs[dbName].meta = data.dbs[dbName].meta || {};
    return data.dbs[dbName].meta;
  };

  class Store {
    constructor(txn, name) {
      this.txn = txn;
      this.name = name;
      this.keyPath = (dbMeta(txn.dbName)[name] || {}).keyPath || 'key';
    }
    rows() {
      const store = dbStore(this.txn.dbName, this.name);
      return Object.keys(store).map((k) => ({ key: k, value: store[k] }));
    }
    createIndex(name) {
      const meta = dbMeta(this.txn.dbName);
      meta[this.name] = meta[this.name] || { keyPath: 'key', indexes: [] };
      meta[this.name].indexes = meta[this.name].indexes || [];
      if (!meta[this.name].indexes.includes(name)) meta[this.name].indexes.push(name);
      return { name };
    }
    get indexNames() {
      const meta = dbMeta(this.txn.dbName)[this.name] || {};
      const list = meta.indexes || [];
      return { contains: (n) => list.includes(n), length: list.length };
    }
    index(name) {
      const store = this;
      return {
        name,
        openCursor(range) {
          const rows = store.rows().filter((r) => {
            if (!range || typeof range.upper !== 'number') return true;
            return Number(r.value[name]) <= range.upper;
          });
          return runCursor(store, rows);
        }
      };
    }
    get(key) {
      const r = req();
      this.txn.addOp();
      later(() => {
        const row = dbStore(this.txn.dbName, this.name)[key];
        r.result = row ? JSON.parse(JSON.stringify(row)) : undefined;
        r.onsuccess && r.onsuccess();
        this.txn.doneOp();
      });
      return r;
    }
    put(value) {
      const r = req();
      this.txn.addOp();
      const key = String(value[this.keyPath]);
      later(() => {
        dbStore(this.txn.dbName, this.name)[key] = JSON.parse(JSON.stringify(value));
        r.result = key;
        r.onsuccess && r.onsuccess();
        this.txn.doneOp();
      });
      return r;
    }
    delete(key) {
      const r = req();
      this.txn.addOp();
      later(() => {
        delete dbStore(this.txn.dbName, this.name)[key];
        r.onsuccess && r.onsuccess();
        this.txn.doneOp();
      });
      return r;
    }
    clear() {
      const r = req();
      this.txn.addOp();
      later(() => {
        data.dbs[this.txn.dbName].stores[this.name] = {};
        r.onsuccess && r.onsuccess();
        this.txn.doneOp();
      });
      return r;
    }
    count() {
      const r = req();
      this.txn.addOp();
      later(() => {
        r.result = Object.keys(dbStore(this.txn.dbName, this.name)).length;
        r.onsuccess && r.onsuccess();
        this.txn.doneOp();
      });
      return r;
    }
    openCursor() {
      return runCursor(this, this.rows());
    }
  }

  function runCursor(store, rows) {
    const r = req();
    store.txn.addOp();
    let i = 0;
    const step = () => {
      if (i >= rows.length) {
        r.result = null;
        later(() => {
          r.onsuccess && r.onsuccess();
          store.txn.doneOp();
        });
        return;
      }
      const row = rows[i];
      r.result = {
        key: row.key,
        value: JSON.parse(JSON.stringify(row.value)),
        delete: () => delete dbStore(store.txn.dbName, store.name)[row.key],
        continue: () => {
          i += 1;
          step();
        }
      };
      later(() => r.onsuccess && r.onsuccess());
    };
    step();
    return r;
  }

  const makeDb = (name) => {
    const db = {
      name,
      close() {},
      createObjectStore(storeName, opts) {
        const meta = dbMeta(name);
        meta[storeName] = { keyPath: (opts && opts.keyPath) || 'key', indexes: [] };
        dbStore(name, storeName);
        return new Store(new Txn(name, 'versionchange'), storeName);
      },
      transaction(storeName, mode) {
        return new Txn(name, mode);
      }
    };
    Object.defineProperty(db, 'objectStoreNames', {
      get() {
        const names = Object.keys(dbMeta(name));
        return { contains: (n) => names.includes(n), length: names.length };
      }
    });
    return db;
  };

  const indexedDB = {
    open(name, version) {
      const r = req();
      later(() => {
        const meta = dbMeta(name);
        const hasSchema = Object.keys(meta).length > 0;
        const db = makeDb(name);
        // 先挂 result 再触发 onupgradeneeded：真实实现同样在 upgrade 阶段就能拿到 db
        r.result = db;
        if (!hasSchema) {
          const tx = new Txn(name, 'versionchange');
          r.transaction = tx;
          r.onupgradeneeded && r.onupgradeneeded({ target: r, transaction: tx });
          flush();
        }
        r.onsuccess && r.onsuccess();
      });
      return r;
    },
    deleteDatabase(name) {
      const r = req();
      later(() => {
        delete data.dbs[name];
        flush();
        r.onsuccess && r.onsuccess();
      });
      return r;
    }
  };

  const IDBKeyRange = {
    upperBound: (value) => ({ upper: value, lower: undefined })
  };

  return { indexedDB, IDBKeyRange };
}

/* ═══════════════════════ chrome / fetch 桩 ═══════════════════════ */

function installChromeStub(onSend) {
  const listeners = [];
  const chromeStub = {
    runtime: {
      lastError: undefined,
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: (message, callback) => {
        if (onSend) onSend(message);
        for (const fn of listeners) {
          try {
            fn(message, { url: 'https://www.youtube.com/watch?v=' + VIDEO_ID }, (res) => {
              if (callback) callback(res);
            });
            return true;
          } catch (e) {
            if (callback) callback({ success: false, error: String(e && e.message) });
            return true;
          }
        }
        if (callback) callback({ success: false, error: 'no listener' });
        return true;
      },
      getManifest: () => ({ version: '0.0.0-test' })
    },
    storage: {
      // 同时兼容回调式（utils/storage.ts）与 Promise 式（utils/packs.ts）
      sync: {
        get: (keys, cb) => (cb ? cb({}) : Promise.resolve({})),
        set: (items, cb) => (cb ? cb() : Promise.resolve())
      },
      local: {
        get: (keys, cb) => (cb ? cb({}) : Promise.resolve({})),
        set: (items, cb) => (cb ? cb() : Promise.resolve())
      },
      onChanged: { addListener: () => {} }
    },
    tabs: { query: () => {}, sendMessage: () => {} }
  };
  globalThis.chrome = chromeStub;
  return chromeStub;
}

function installFetchStub(responder) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    let body = null;
    try {
      body = init && init.body ? JSON.parse(init.body) : null;
    } catch {
      body = null;
    }
    calls.push({ url: String(url), body });
    const payload = responder(calls.length, body);
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    };
  };
  return calls;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ═══════════════════════ 阶段实现（子进程内执行） ═══════════════════════ */

const SETTINGS = sanitizeSettings({
  ...DEFAULT_SETTINGS,
  service: 'openai',
  apiKey: 'sk-test-key',
  apiBaseUrl: 'https://api.example.com/v1',
  modelName: 'gpt-4o-mini',
  scenario: 'vtuber',
  targetLang: 'zh-CN',
  aiResumeMode: 'auto'
});

async function installEnv(file) {
  const { indexedDB, IDBKeyRange } = createIdbStub(file);
  globalThis.indexedDB = indexedDB;
  globalThis.IDBKeyRange = IDBKeyRange;
  // EphemeralSubtitleStore.init 会注册 pagehide / beforeunload 的 flush 钩子
  if (typeof globalThis.window === 'undefined') {
    const handlers = {};
    globalThis.window = {
      addEventListener: (name, fn) => {
        handlers[name] = handlers[name] || [];
        handlers[name].push(fn);
      },
      removeEventListener: () => {},
      __handlers: handlers
    };
  }
  return indexStub();
}

function indexStub() {
  return { indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange };
}

/** 等到 IndexedDB 桩真的把数据写进 JSON 文件 */
async function waitForPersist(file, predicate, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (predicate(parsed)) return true;
    } catch {
      /* 文件还没写出来 */
    }
    await sleep(25);
  }
  return false;
}

const PHASES = {
  /** p1：翻到一半（12 句完成 5 句）后落盘 */
  async p1_write_partial(file) {
    await installEnv(file);
    const sentences = makeSentences();
    for (let i = 0; i < 5; i++) {
      sentences[i].translation = `译文${i + 1}`;
      sentences[i].status = 'done';
      sentences[i].isAi = true;
    }
    EphemeralSubtitleStore.init(VIDEO_ID);
    EphemeralSubtitleStore.save(VIDEO_ID, sentences, {
      ...META,
      service: SETTINGS.service,
      modelName: SETTINGS.modelName
    });
    EphemeralSubtitleStore.flushNow(VIDEO_ID);

    const persisted = await waitForPersist(file, (db) => {
      const store = db?.dbs?.['yt_sub_ai_tracks']?.stores?.tracks || {};
      const rec = store[`${VIDEO_ID}::zh-CN::vtuber`];
      return !!rec && rec.done === 5;
    });

    // 再确认一次「内存里也是 5 句完成」
    const mem = EphemeralSubtitleStore.load(VIDEO_ID) || [];
    return {
      persisted,
      memDone: mem.filter((s) => s.translation).length,
      total: mem.length
    };
  },

  /** p2：冷启动（新进程）→ 恢复 5 句、pending 7、不发请求 */
  async p2_reload_manual(file) {
    installEnv(file);
    let requests = 0;
    installChromeStub(() => {
      requests++;
    });
    await import('../entrypoints/background.ts').catch(() => null);

    const record = await EphemeralSubtitleStore.hydrate(VIDEO_ID, {
      ...META,
      service: SETTINGS.service,
      modelName: SETTINGS.modelName
    });
    const plan = planResume(record, makeSentences(), META);
    const action = decideAiRunAction(plan, 'manual');

    // 手动模式下的行为：只恢复 + 提示，不构造任何批次
    let batches = [];
    if (action === 'run') {
      batches = buildResumeBatches(plan.sentences, {
        batchSize: AI_TRACK_BATCH_SIZE,
        contextWindow: AI_TRACK_CONTEXT_WINDOW
      });
      requests += batches.length;
    }

    return {
      hasRecord: !!record,
      reusable: plan.reusable,
      reason: plan.reason,
      restored: plan.restored,
      pending: plan.pending,
      action,
      requests,
      translated: plan.sentences.filter((s) => s.translation).length
    };
  },

  /** p3：auto 模式 → 只对 7 句发请求，且请求里带 2 句上文 */
  async p3_auto_resume(file) {
    installEnv(file);
    const sent = [];
    // 顺序要紧：chrome 桩必须先于 background 导入，否则 onMessage.addListener 无处可挂
    installChromeStub((message) => sent.push(message));
    await import('../entrypoints/background.ts');

    const fetchCalls = installFetchStub((n, body) => {
      const items = (body && body.messages && body.messages[1] ? body.messages[1].content : '[]');
      // 从 user 消息里抠出待译 JSON 数组，按条目数返回译文
      const tail = items.slice(items.lastIndexOf('['));
      let arr = [];
      try {
        arr = JSON.parse(tail);
      } catch {
        arr = [];
      }
      return {
        choices: [
          {
            message: {
              content: JSON.stringify(arr.map((it, i) => ({ id: i, translation: `AI-${it.id}-${i}` })))
            }
          }
        ]
      };
    });

    const record = await EphemeralSubtitleStore.hydrate(VIDEO_ID, {
      ...META,
      service: SETTINGS.service,
      modelName: SETTINGS.modelName
    });
    const plan = planResume(record, makeSentences(), META);
    const action = decideAiRunAction(plan, 'auto');
    const batches = buildResumeBatches(plan.sentences, {
      batchSize: AI_TRACK_BATCH_SIZE,
      contextWindow: AI_TRACK_CONTEXT_WINDOW
    });

    const results = [];
    for (const batch of batches) {
      const res = await new Promise((resolve) => {
        globalThis.chrome.runtime.sendMessage(
          {
            type: 'TRANSLATE_BATCH',
            payload: {
              texts: batch.texts,
              targetLang: SETTINGS.targetLang,
              settings: SETTINGS,
              noFallback: true,
              bypassCache: true,
              contextBefore: batch.contextBefore
            }
          },
          resolve
        );
      });
      results.push(res);
      for (let i = 0; i < batch.indices.length; i++) {
        const target = plan.sentences[batch.indices[i]];
        if (res && res.success && res.translations[i]) {
          target.translation = res.translations[i];
          target.status = 'done';
          target.isAi = true;
        }
      }
    }

    // 续翻完再落盘，验证「翻完就完整」
    EphemeralSubtitleStore.save(VIDEO_ID, plan.sentences, {
      ...META,
      service: SETTINGS.service,
      modelName: SETTINGS.modelName
    });
    EphemeralSubtitleStore.flushNow(VIDEO_ID);
    await waitForPersist(file, (db) => {
      const store = db?.dbs?.['yt_sub_ai_tracks']?.stores?.tracks || {};
      const rec = store[`${VIDEO_ID}::zh-CN::vtuber`];
      return !!rec && rec.done === 12;
    });
    const after = await loadAiTrack(META);

    const body = fetchCalls.length > 0 ? fetchCalls[0].body : null;
    const systemPrompt = body && body.messages ? body.messages[0].content : '';
    const userContent = body && body.messages ? body.messages[1].content : '';
    return {
      action,
      batchCount: batches.length,
      requestedTexts: batches.reduce((n, b) => n + b.texts.length, 0),
      contextCount: batches[0] ? batches[0].contextBefore.length : 0,
      contextFirst: batches[0] && batches[0].contextBefore[0] ? batches[0].contextBefore[0] : null,
      contextSecond: batches[0] && batches[0].contextBefore[1] ? batches[0].contextBefore[1] : null,
      sendMessageCount: sent.length,
      fetchCount: fetchCalls.length,
      resError: results.length > 0 && results[0] ? results[0].error || '' : 'no result',
      resKeys: results.length > 0 && results[0] ? Object.keys(results[0]) : [],
      systemHasContext: /上文参考/.test(systemPrompt),
      userHasContext: /上文参考/.test(userContent),
      userContextLines: (userContent.match(/原文：/g) || []).length,
      userItemCount: (() => {
        const tail = userContent.slice(userContent.lastIndexOf('['));
        try {
          return JSON.parse(tail).length;
        } catch {
          return -1;
        }
      })(),
      promptUnchanged: /你是/.test(systemPrompt),
      afterDone: after ? after.done : -1,
      afterTotal: after ? after.total : -1
    };
  },

  /** p4：源字幕变了 → 不可复用；只改一句 → 仍然对齐复用 */
  async p4_source_changed(file) {
    installEnv(file);
    const record = await loadAiTrack(META);

    const changedAll = makeSentences().map((s, i) => ({ ...s, text: `Totally different line ${i}.` }));
    const allChanged = planResume(record, changedAll, META);

    const oneEdit = makeSentences();
    oneEdit[0].text = 'Hello everyone and welcome BACK to the stream!!';
    const single = planResume(record, oneEdit, META);

    const otherLang = planResume(record, makeSentences(), { targetLang: 'ja', scenario: 'vtuber' });

    return {
      allChangedReusable: allChanged.reusable,
      allChangedReason: allChanged.reason,
      allChangedRestored: allChanged.restored,
      singleReusable: single.reusable,
      singleReason: single.reason,
      singleRestored: single.restored,
      singlePending: single.pending,
      otherLangReusable: otherLang.reusable,
      otherLangReason: otherLang.reason
    };
  },

  /** p5：TTL=24h 且记录 25 小时前 → 清理后查不到；TTL=0 永久不清理 */
  async p5_ttl(file) {
    installEnv(file);
    const now = Date.now();
    const stale = buildAiTrackRecord(
      { videoId: 'stale_video_1', targetLang: 'zh-CN', scenario: 'vtuber' },
      makeSentences().slice(0, 2),
      now - 25 * 3600 * 1000
    );
    const staleKeep = buildAiTrackRecord(
      { videoId: 'stale_video_2', targetLang: 'zh-CN', scenario: 'vtuber' },
      makeSentences().slice(0, 2),
      now - 2 * 3600 * 1000
    );
    await saveAiTrack(stale);
    await saveAiTrack(staleKeep);

    const beforeStats = await getAiTrackStats();
    const prunedZero = await pruneAiTracks(0);
    const afterZero = await getAiTrackStats();
    const pruned = await pruneAiTracks(24);

    return {
      expiredFlag: isAiTrackExpired(stale.updatedAt, 24, now),
      freshFlag: isAiTrackExpired(staleKeep.updatedAt, 24, now),
      permanentFlag: isAiTrackExpired(stale.updatedAt, 0, now),
      prunedZero,
      countBefore: beforeStats.count,
      countAfterZero: afterZero.count,
      pruned,
      staleGone: (await loadAiTrack({ videoId: 'stale_video_1', targetLang: 'zh-CN', scenario: 'vtuber' })) === null,
      freshKept: (await loadAiTrack({ videoId: 'stale_video_2', targetLang: 'zh-CN', scenario: 'vtuber' })) !== null
    };
  },

  /** p6：清空按钮 → 记录消失、统计归零 */
  async p6_clear(file) {
    installEnv(file);
    const beforeClear = await loadAiTrack(META);
    const removedOne = await clearAiTrack(VIDEO_ID);
    const afterClear = await loadAiTrack(META);
    const statsAfterVideoClear = await getAiTrackStats();
    const removedAll = await clearAllAiTracks();
    const statsFinal = await getAiTrackStats();
    return {
      hadRecord: !!beforeClear,
      removedOne,
      afterClearNull: afterClear === null,
      countAfterVideoClear: statsAfterVideoClear.count,
      removedAll,
      countFinal: statsFinal.count,
      bytesFinal: statsFinal.bytes
    };
  },

  /** p7：contextBefore 不进缓存键（带上下文再问一次 → 0 次新请求） */
  async p7_context_not_in_cache_key(file) {
    installEnv(file);
    const translator = await import('../utils/translator.ts');
    installChromeStub();
    const fetchCalls = installFetchStub((n, body) => {
      const items = body && body.messages ? JSON.parse(body.messages[1].content.slice(body.messages[1].content.lastIndexOf('['))) : [];
      return {
        choices: [
          { message: { content: JSON.stringify(items.map((it, i) => ({ id: i, translation: `T${it.id}` }))) } }
        ]
      };
    });

    const texts = ['alpha line one', 'beta line two'];
    const first = await translator.translateSentenceBatchDetailed(texts, 'zh-CN', SETTINGS, { noFallback: true });
    const fetchAfterFirst = fetchCalls.length;
    const second = await translator.translateSentenceBatchDetailed(texts, 'zh-CN', SETTINGS, {
      noFallback: true,
      contextBefore: [{ text: 'previous line', translation: '上一句译文' }]
    });

    return {
      fetchAfterFirst,
      fetchTotal: fetchCalls.length,
      firstOk: first.translations.length === 2 && first.failed.filter(Boolean).length === 0,
      secondOk: second.translations.length === 2,
      sameTranslations: JSON.stringify(first.translations) === JSON.stringify(second.translations),
      contextBlockInUserMessage: /上文参考/.test(
        fetchCalls[0] && fetchCalls[0].body ? String(fetchCalls[0].body.messages[1].content) : ''
      )
    };
  }
};

/* ═══════════════════════ 父进程：构建 IIFE 并逐阶段跑 ═══════════════════════ */

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function buildBundle() {
  const esbuild = await import('esbuild');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-track-e2e-'));
  const outFile = path.join(outDir, 'session.cjs');

  const wxtDefineStub = `
    export function defineBackground(main) { try { main(); } catch (e) {} ; return main; }
    export function defineContentScript(def) { return def; }
  `;

  await esbuild.build({
    entryPoints: [path.join(HERE, 'test-ai-track.js')],
    outfile: outFile,
    bundle: true,
    format: 'iife',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
    absWorkingDir: REPO,
    plugins: [
      {
        name: 'wxt-stub',
        setup(build) {
          build.onResolve({ filter: /^wxt\// }, (args) => ({ path: args.path, namespace: 'wxtstub' }));
          build.onLoad({ filter: /.*/, namespace: 'wxtstub' }, () => ({
            contents: wxtDefineStub,
            loader: 'js'
          }));
        }
      }
    ]
  });
  return { outDir, outFile };
}

function runPhase(phase, dbFile) {
  const { outFile } = bundle;
  const res = spawnSync(process.execPath, [outFile, `--phase=${phase}`], {
    cwd: REPO,
    env: { ...process.env, AI_TEST_DB_FILE: dbFile },
    encoding: 'utf8',
    timeout: 120000
  });
  const stdout = res.stdout || '';
  const marker = `RES::${phase}::`;
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith(marker));
  if (!line) {
    return { ok: false, error: (res.stderr || stdout || '').slice(0, 900) || `exit=${res.status}` };
  }
  try {
    return { ok: true, value: JSON.parse(line.slice(marker.length)) };
  } catch (e) {
    return { ok: false, error: '无法解析阶段输出: ' + String(e && e.message) };
  }
}

let bundle = null;

async function runSuite() {
  console.log('--- 测试: AI 精翻字幕持久化 / 续翻 / 上下文（需求 7）---');

  /* ── A1. 主键与指纹 ── */
  check(
    '主键 = videoId::targetLang::scenario',
    buildAiTrackKey({ videoId: 'abc', targetLang: 'zh-CN', scenario: 'vtuber' }) === 'abc::zh-CN::vtuber',
    buildAiTrackKey({ videoId: 'abc', targetLang: 'zh-CN', scenario: 'vtuber' })
  );
  check(
    '主键不含源指纹（换轨后仍能读到旧记录并判断「轨道变了」）',
    !buildAiTrackKey({ videoId: 'abc', targetLang: 'zh-CN', scenario: 'vtuber' }).includes(hashSource(makeSentences()))
  );
  check(
    '主键区分目标语言与场景',
    buildAiTrackKey({ videoId: 'abc', targetLang: 'ja', scenario: 'vtuber' }) !==
      buildAiTrackKey({ videoId: 'abc', targetLang: 'zh-CN', scenario: 'vtuber' })
  );
  check('缺省语言/场景有兜底，不会产出空主键', buildAiTrackKey({ videoId: 'abc' }) === 'abc::zh-CN::general');

  const h1 = hashSource(makeSentences());
  const h2 = hashSource(makeSentences());
  check('源指纹稳定（同一序列两次结果一致）', h1 === h2, `${h1} vs ${h2}`);
  check('源指纹对单句改动敏感', h1 !== hashSource([...TEXTS.slice(0, 11), TEXTS[11] + ' extra'].map((t, i) => ({ id: i, text: t }))));
  check(
    '源指纹忽略空白差异（同一句多一个空格不算换轨）',
    hashSource([{ text: 'a  b' }, { text: 'c' }]) === hashSource([{ text: ' a b ' }, { text: 'c' }])
  );
  check('源指纹对句数变化敏感', hashSource([{ text: 'a' }]) !== hashSource([{ text: 'a' }, { text: 'b' }]));

  /* ── A2. planResume 四分支 ── */
  const full = buildAiTrackRecord(META, makeSentences().map((s, i) => ({
    ...s,
    translation: i < 5 ? `译文${i + 1}` : undefined,
    status: i < 5 ? 'done' : 'idle',
    isAi: i < 5
  })));

  const noCache = planResume(null, makeSentences(), META);
  check('分支1：无记录 → 不可复用且全部 pending', !noCache.reusable && noCache.reason === 'no_cache' && noCache.pending === 12);
  check('分支1：返回的句子与输入等长', noCache.sentences.length === 12);

  const exact = planResume(full, makeSentences(), META);
  check('分支2：指纹一致 → 可复用（exact）', exact.reusable && exact.reason === 'exact', exact.reason);
  check('分支2：只灌回已翻的 5 句，其余保持 idle', exact.restored === 5 && exact.pending === 7, `${exact.restored}/${exact.pending}`);
  check(
    '分支2：灌回的句子标 done + isAi',
    exact.sentences.slice(0, 5).every((s) => s.status === 'done' && s.isAi === true && !!s.translation) &&
      exact.sentences.slice(5).every((s) => s.status === 'idle' && !s.translation)
  );

  const metaMismatch = planResume(full, makeSentences(), { targetLang: 'ja', scenario: 'vtuber' });
  check('分支3：目标语言不一致 → 不可复用', !metaMismatch.reusable && metaMismatch.reason === 'meta_mismatch');

  const changed = makeSentences().map((s, i) => ({ ...s, text: `line ${i} rewritten` }));
  const mismatch = planResume(full, changed, META);
  check('分支4：源字幕全变 → 不可复用', !mismatch.reusable && mismatch.reason === 'no_text_match', mismatch.reason);
  check('分支4：不可复用时 restored=0 且句子被重置为空译', mismatch.restored === 0 && mismatch.sentences.every((s) => !s.translation));

  const partialEdit = makeSentences();
  partialEdit[0].text = 'Hello everyone and welcome back to the STREAM.';
  const aligned = planResume(full, partialEdit, META);
  check(
    '分支2b：只改一句（其余逐字相同）→ 对齐复用 4 句',
    aligned.reusable && aligned.reason === 'aligned' && aligned.restored === 4,
    `${aligned.reason}/${aligned.restored}`
  );
  check('对齐阈值有明确下限（低于则判换轨）', AI_TRACK_ALIGN_MIN_RATIO > 0 && AI_TRACK_ALIGN_MIN_RATIO <= 1);
  check(
    '改过的那句绝不复用旧译文（原文不完全一致就不认）',
    !aligned.sentences[0].translation
  );

  /* ── A3. 续翻批次与上文 ── */
  const batches = buildResumeBatches(exact.sentences, { batchSize: 12, contextWindow: 2 });
  check('续翻只切出 1 批（7 句待翻）', batches.length === 1 && batches[0].texts.length === 7, `batches=${batches.length}`);
  check(
    '续翻批次只含缺译文的句子（跳过已完成的 5 句）',
    batches[0].indices.join(',') === '5,6,7,8,9,10,11',
    batches[0].indices.join(',')
  );
  check('批次带 2 句上文参考', batches[0].contextBefore.length === 2);
  check(
    '上文用的是紧邻本批的两句（第 3、4 句）的原文 + 已有译文',
    batches[0].contextBefore[0].text === TEXTS[3] &&
      batches[0].contextBefore[1].text === TEXTS[4] &&
      batches[0].contextBefore[1].translation === '译文5',
    JSON.stringify(batches[0].contextBefore)
  );
  check(
    '批内句子不重复出现在上文里（上下文只取本批之前）',
    !batches[0].contextBefore.some((c) => batches[0].texts.includes(c.text))
  );
  const firstBatch = buildResumeBatches(exact.sentences, { batchSize: 12, contextWindow: 2 })[0];
  check('全篇未翻时首批没有上文（避免凭空造语境）', buildResumeBatches(makeSentences(), { batchSize: 12 })[0].contextBefore.length === 0);
  check('批次大小默认 12 且可覆盖', AI_TRACK_BATCH_SIZE === 12 && buildResumeBatches(makeSentences(), { batchSize: 5 }).length === 3);
  check('上文窗口默认 2', AI_TRACK_CONTEXT_WINDOW === 2 && firstBatch.contextBefore.length <= 2);

  // 「已完成」以 isAi 为准：机翻先铺满缺口时，续翻按钮不能变成空转
  const machineFilled = makeSentences().map((s, i) =>
    i < 5
      ? { ...s, translation: `译文${i + 1}`, status: 'done', isAi: true }
      : { ...s, translation: `机翻${i + 1}`, status: 'done', isAi: false }
  );
  check(
    '机翻填满缺口后，AI 续翻仍有 7 句要翻（不以「有译文」判完成）',
    buildResumeBatches(machineFilled, { batchSize: 12 })[0].texts.length === 7,
    String(buildResumeBatches(machineFilled, { batchSize: 12 })[0].texts.length)
  );
  check(
    '已是 AI 译文的句子不会被重复精翻',
    buildResumeBatches(
      makeSentences().map((s) => ({ ...s, translation: 'AI译文', status: 'done', isAi: true })),
      { batchSize: 12 }
    ).length === 0
  );

  /* ── A4. 动作决策（content 脚本就是照这个分支走） ── */
  check('全篇完整 → restore_only（零请求）', decideAiRunAction({ ...exact, pending: 0, restored: 12 }, 'auto') === 'restore_only');
  check('半截 + manual → prompt_resume（只提示不请求）', decideAiRunAction(exact, 'manual') === 'prompt_resume');
  check('半截 + auto → run（只翻缺的）', decideAiRunAction(exact, 'auto') === 'run');
  check('无缓存 → run', decideAiRunAction(null, 'manual') === 'run');

  /* ── A5. TTL 判定 ── */
  const now = Date.now();
  check('TTL 24h：25 小时前的记录算过期', isAiTrackExpired(now - 25 * 3600 * 1000, 24, now));
  check('TTL 24h：2 小时前的记录不过期', !isAiTrackExpired(now - 2 * 3600 * 1000, 24, now));
  check('TTL 0 = 永久：永不过期', !isAiTrackExpired(now - 100000 * 3600 * 1000, 0, now));
  check('TTL 允许值恰好 24/168/720/0', JSON.stringify([...ALLOWED_AI_CACHE_TTL_HOURS]) === '[24,168,720,0]');
  check('默认保留时长 720（30 天）', DEFAULT_AI_CACHE_TTL_HOURS === 720);

  /* ── A6. 设置项：默认值唯一来源 + sanitize 回落 ── */
  check('默认 aiCacheTtlHours = 720', DEFAULT_SETTINGS.aiCacheTtlHours === 720, String(DEFAULT_SETTINGS.aiCacheTtlHours));
  check('默认 aiResumeMode = manual', DEFAULT_SETTINGS.aiResumeMode === 'manual', String(DEFAULT_SETTINGS.aiResumeMode));
  check(
    '四个合法 TTL 原样落盘',
    [24, 168, 720, 0].every((v) => sanitizeSettings({ ...DEFAULT_SETTINGS, aiCacheTtlHours: v }).aiCacheTtlHours === v)
  );
  check(
    '分段控件写回的字符串 TTL 也被接受',
    sanitizeSettings({ ...DEFAULT_SETTINGS, aiCacheTtlHours: '168' }).aiCacheTtlHours === 168
  );
  check(
    '非法 TTL 一律回落 720（不就近取整）',
    [25, 100, -1, 1, 999, null, 'abc', NaN].every(
      (v) => sanitizeSettings({ ...DEFAULT_SETTINGS, aiCacheTtlHours: v }).aiCacheTtlHours === 720
    )
  );
  check('null 不会被误当成 0（永久）', sanitizeSettings({ ...DEFAULT_SETTINGS, aiCacheTtlHours: null }).aiCacheTtlHours === 720);
  check(
    'aiResumeMode 只接受 auto/manual',
    sanitizeSettings({ ...DEFAULT_SETTINGS, aiResumeMode: 'auto' }).aiResumeMode === 'auto' &&
      sanitizeSettings({ ...DEFAULT_SETTINGS, aiResumeMode: 'always' }).aiResumeMode === 'manual' &&
      sanitizeSettings({ ...DEFAULT_SETTINGS, aiResumeMode: 1 }).aiResumeMode === 'manual'
  );

  /* ── A7. content / options 的接线（结构性补充，行为由下面端到端验证） ── */
  const contentTs = fs.readFileSync(path.join(REPO, 'entrypoints/content/index.ts'), 'utf8');
  const optionsTs = fs.readFileSync(path.join(REPO, 'entrypoints/options/main.ts'), 'utf8');
  const optionsHtml = fs.readFileSync(path.join(REPO, 'entrypoints/options/index.html'), 'utf8');
  const storeTs = fs.readFileSync(path.join(REPO, 'utils/ephemeral-subtitle-store.ts'), 'utf8');

  check('切视频只 release 内存，不再 clear 磁盘', /EphemeralSubtitleStore\.release\(currentVideoId\)/.test(contentTs) && !/handleVideoChange[\s\S]{0,300}?EphemeralSubtitleStore\.clear\(/.test(contentTs));
  check('存储器不再在 pagehide/beforeunload 上销毁', !/beforeunload[\s\S]{0,400}?(removeItem|memoryCache\.clear\(\))/.test(storeTs) && !/(sessionStorage|localStorage)\./.test(storeTs));
  check('pagehide 只 flush（flushNow）', /pagehide[\s\S]{0,120}?flushNow/.test(storeTs));
  check('续翻走 planResume + buildResumeBatches', /planResume\(/.test(contentTs) && /buildResumeBatches\(/.test(contentTs));
  check('请求里带 contextBefore', /contextBefore:\s*batch\.contextBefore/.test(contentTs));
  check('清空按钮同时清 IDB 并改文案', /await EphemeralSubtitleStore\.clear\(currentVideoId\)/.test(contentTs) && /已清空当前视频的 AI 字幕缓存/.test(contentTs));
  check('命中缓存打一行 [AiTrack] 日志且每部视频只打一次', /\[AiTrack\] 命中 videoId=/.test(contentTs) && /aiTrackHitLoggedFor/.test(contentTs));
  check('设置页有「保留时长」4 档分段控件', /data-seg="aiCacheTtlHours"/.test(optionsHtml) && (optionsHtml.match(/data-setting="aiCacheTtlHours" data-value="/g) || []).length === 4);
  check('设置页有「续翻模式」2 档分段控件', /data-seg="aiResumeMode"/.test(optionsHtml) && (optionsHtml.match(/data-setting="aiResumeMode" data-value="/g) || []).length === 2);
  check('清空 AI 缓存有二次确认', /btn-clear-ai-cache[\s\S]{0,200}?window\.confirm/.test(optionsTs));
  check('TTL 变短时立即清理一次', /pruneAiTracks\(next\)/.test(optionsTs));
  check('设置页不重复定义默认值', !/aiCacheTtlHours\s*[:=]\s*7|aiResumeMode\s*[:=]\s*'/.test(optionsTs));
  check(
    '手动续翻提示不置灰 AI 按钮（updateAiProgress 会 disabled=true，点了就永远点不动）',
    /action === 'prompt_resume'[\s\S]{0,220}?resetAiProgress\(\)/.test(contentTs) &&
      !/action === 'prompt_resume'[\s\S]{0,220}?updateAiProgress\(/.test(contentTs)
  );
  check('打开视频（不是点按钮）也会提示上次只翻了一半', /restoreAiTrackThenStartPipeline[\s\S]{0,1200}?检测到上次精翻完成/.test(contentTs));

  /* ── B. 端到端（esbuild IIFE + chrome 桩 + IDB 桩 + 独立进程冷启动） ── */
  console.log('  · 构建 esbuild IIFE 会话包…');
  bundle = await buildBundle();
  const dbFile = path.join(bundle.outDir, 'idb.json');
  fs.writeFileSync(dbFile, JSON.stringify({ dbs: {} }));

  const p1 = runPhase('p1_write_partial', dbFile);
  check('E2E-0 会话包可执行（退出码 0 且有结构化输出）', p1.ok, p1.ok ? '' : p1.error);
  if (p1.ok) {
    check('E2E-0 翻到一半落盘成功（12 句中 5 句有译文）', p1.value.persisted && p1.value.memDone === 5 && p1.value.total === 12, JSON.stringify(p1.value));
  }

  const p2 = runPhase('p2_reload_manual', dbFile);
  check('E2E-a 冷启动进程可执行', p2.ok, p2.ok ? '' : p2.error);
  if (p2.ok) {
    const v = p2.value;
    check('E2E-a 重新打开后读到 IndexedDB 记录', v.hasRecord === true);
    check('E2E-a 指纹一致、可复用', v.reusable === true && v.reason === 'exact', `${v.reason}`);
    check('E2E-a 恢复 5 句、pending 7', v.restored === 5 && v.pending === 7, `${v.restored}/${v.pending}`);
    check('E2E-a 页面里真的有 5 句译文', v.translated === 5, String(v.translated));
    check('E2E-a manual 模式只提示不动手', v.action === 'prompt_resume');
    check('E2E-a 整个冷启动过程 0 次请求', v.requests === 0, String(v.requests));
  }

  const p3 = runPhase('p3_auto_resume', dbFile);
  check('E2E-b auto 续翻进程可执行', p3.ok, p3.ok ? '' : p3.error);
  if (p3.ok) {
    const v = p3.value;
    check('E2E-b 决策为 run', v.action === 'run');
    check('E2E-b 只发 1 批、共 7 句（不重翻已有 5 句）', v.batchCount === 1 && v.requestedTexts === 7, `${v.batchCount}/${v.requestedTexts}`);
    check('E2E-b 只走了 1 次后台请求', v.sendMessageCount === 1, String(v.sendMessageCount));
    check('E2E-b 请求真的发到了模型（1 次 fetch）', v.fetchCount === 1, String(v.fetchCount));
    check('E2E-b contextBefore 带 2 句上文', v.contextCount === 2, String(v.contextCount));
    check(
      'E2E-b 上文是紧邻本批的两句（原文+已有译文）',
      v.contextFirst &&
        v.contextFirst.text === TEXTS[3] &&
        v.contextFirst.translation === '译文4' &&
        v.contextSecond &&
        v.contextSecond.text === TEXTS[4] &&
        v.contextSecond.translation === '译文5',
      JSON.stringify(v.contextFirst) + ' / ' + JSON.stringify(v.contextSecond)
    );
    check('E2E-b user 消息里出现「上文参考」段', v.userHasContext === true);
    check('E2E-b user 消息里上文只有 2 条', v.userContextLines === 2, String(v.userContextLines));
    check('E2E-b user 消息里的待译条目恰好 7 条（上下文没被算成条目）', v.userItemCount === 7, String(v.userItemCount));
    check('E2E-b system prompt 里没有上下文（骨架未动）', v.systemHasContext === false);
    check('E2E-b system prompt 仍是原骨架', v.promptUnchanged === true);
    check('E2E-b 续翻完成后落盘为 12/12', v.afterDone === 12 && v.afterTotal === 12, `${v.afterDone}/${v.afterTotal}`);
  }

  const p4 = runPhase('p4_source_changed', dbFile);
  check('E2E-c 换轨判定进程可执行', p4.ok, p4.ok ? '' : p4.error);
  if (p4.ok) {
    const v = p4.value;
    check('E2E-c 源字幕文本变化 → reusable=false', v.allChangedReusable === false, String(v.allChangedReusable));
    check('E2E-c 原因标记为 no_text_match', v.allChangedReason === 'no_text_match', v.allChangedReason);
    check('E2E-c 变化后不复用任何旧译文', v.allChangedRestored === 0, String(v.allChangedRestored));
    check('E2E-c 只改一句仍可对齐复用（12 条已有译文里 11 条对上）', v.singleReusable === true && v.singleRestored === 11, `${v.singleReason}/${v.singleRestored}`);
    check('E2E-c 目标语言不一致 → meta_mismatch', v.otherLangReusable === false && v.otherLangReason === 'meta_mismatch');
  }

  const p5 = runPhase('p5_ttl', dbFile);
  check('E2E-d TTL 进程可执行', p5.ok, p5.ok ? '' : p5.error);
  if (p5.ok) {
    const v = p5.value;
    check('E2E-d 25 小时前的记录判为过期', v.expiredFlag === true);
    check('E2E-d 2 小时前的记录未过期', v.freshFlag === false);
    check('E2E-d 永久模式下永不过期', v.permanentFlag === false);
    check('E2E-d TTL=0 不清理任何记录', v.prunedZero === 0 && v.countAfterZero === v.countBefore, `${v.prunedZero}/${v.countBefore}→${v.countAfterZero}`);
    check('E2E-d TTL=24h 清理掉 1 条', v.pruned === 1, String(v.pruned));
    check('E2E-d 清理后查不到过期记录', v.staleGone === true);
    check('E2E-d 未过期记录仍然在', v.freshKept === true);
  }

  const p6 = runPhase('p6_clear', dbFile);
  check('E2E-e 清空进程可执行', p6.ok, p6.ok ? '' : p6.error);
  if (p6.ok) {
    const v = p6.value;
    check('E2E-e 清空前记录存在', v.hadRecord === true);
    check('E2E-e 按视频清空后读不到记录', v.afterClearNull === true && v.removedOne >= 1, String(v.removedOne));
    check('E2E-e 全部清空后统计归零', v.removedAll >= 1 && v.countFinal === 0 && v.bytesFinal === 0, `${v.removedAll}/${v.countFinal}/${v.bytesFinal}`);
  }

  const p7 = runPhase('p7_context_not_in_cache_key', dbFile);
  check('E2E-f 缓存键独立性进程可执行', p7.ok, p7.ok ? '' : p7.error);
  if (p7.ok) {
    const v = p7.value;
    check('E2E-f 首次请求确实发了 1 次 fetch', v.fetchAfterFirst === 1, String(v.fetchAfterFirst));
    check('E2E-f 带 contextBefore 再问同一句 → 命中缓存 0 新请求', v.fetchTotal === 1, String(v.fetchTotal));
    check('E2E-f 两次译文一致', v.sameTranslations === true);
    check('E2E-f 无上下文时 user 消息不含「上文参考」', v.contextBlockInUserMessage === false);
  }

  // 收尾：清理临时目录
  try {
    fs.rmSync(bundle.outDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }

  console.log(`\n汇总: ${passed} 通过, ${failed} 失败`);
  if (failed > 0) {
    process.exitCode = 1;
    console.log('存在失败用例。');
  } else {
    console.log('AI 精翻缓存测试全部通过！');
  }
}

/* ═══════════════════════ 入口 ═══════════════════════ */

const phaseArg = process.argv.find((a) => a.startsWith('--phase='));

(async () => {
  if (phaseArg) {
    const name = phaseArg.slice('--phase='.length);
    const fn = PHASES[name];
    if (!fn) {
      console.error(`未知阶段: ${name}`);
      process.exitCode = 2;
      return;
    }
    const dbFile = process.env.AI_TEST_DB_FILE;
    try {
      const value = await fn(dbFile);
      console.log(`RES::${name}::${JSON.stringify(value)}`);
      // 给 IDB 桩留下 flush 时间
      await sleep(30);
      process.exitCode = 0;
    } catch (e) {
      console.error(`PHASE_ERROR ${name}: ${e && e.stack ? e.stack : e}`);
      process.exitCode = 1;
    }
    return;
  }

  try {
    await runSuite();
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
})();
