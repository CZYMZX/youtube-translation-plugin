/**
 * 扩展运行时安全层（0.5.1）
 *
 * 背景：MV3 扩展被重载/更新后，**已经注入页面的老内容脚本**会立刻失去上下文，
 * 此时 `chrome.runtime.sendMessage` 不是「回调带 lastError」，而是**同步 throw**
 * `Extension context invalidated.`。而内容脚本里 300ms / 1.5s 的看门狗还在跑，
 * 于是控制台每 300ms 刷一条未捕获异常，直到用户刷新页面。
 *
 * 本模块只做两件事：
 *   1. 探测上下文是否还活着（`chrome.runtime.id` 失效后为 undefined）；
 *   2. 把 `sendMessage` 包成**永不同步抛错、且总是消费 lastError** 的调用。
 *
 * 纯工具，零依赖 —— 不 import 任何项目内模块，也不碰 DOM。
 */

export type SafeSendResult<T = unknown> =
  | { ok: true; response: T }
  | { ok: false; reason: 'invalidated' | 'lastError' | 'throw'; message?: string };

/** 上下文失效的官方错误文案（大小写与结尾标点各版本略有差异，用正则兜住） */
const INVALIDATED_PATTERN = /extension context invalidated/i;

/** 扩展上下文是否仍然存活（重载/更新后 chrome.runtime.id 会变成 undefined） */
export function isExtensionAlive(): boolean {
  try {
    return (
      typeof chrome !== 'undefined' &&
      !!chrome.runtime &&
      typeof chrome.runtime.id === 'string' &&
      chrome.runtime.id.length > 0
    );
  } catch {
    // 极端情况下访问 chrome.runtime 本身就会抛（上下文已彻底销毁）
    return false;
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return String(e);
  } catch {
    return '';
  }
}

/**
 * sendMessage 的安全包装：
 * - 上下文已失效 → 不抛异常，直接回调 { ok:false, reason:'invalidated' }
 * - 正常但 lastError（端口关闭 / 无接收方）→ 回调 { ok:false, reason:'lastError', message }
 * - 正常响应 → 回调 { ok:true, response }
 *
 * 保证：**永不同步抛错**、**总是消费 lastError**（不产生 Unchecked runtime.lastError 噪音）。
 * 不传 `cb` 时等价于「只发不管」，同样不会抛错，也不会留下 lastError 警告。
 */
export function safeSendMessage<T = unknown>(
  msg: unknown,
  cb?: (r: SafeSendResult<T>) => void
): void {
  const settle = (r: SafeSendResult<T>) => {
    if (cb) cb(r);
  };

  if (!isExtensionAlive()) {
    settle({ ok: false, reason: 'invalidated', message: 'Extension context invalidated.' });
    return;
  }

  try {
    chrome.runtime.sendMessage(msg, (response: T) => {
      // 无条件读一次 lastError：读到即消费，避免「Unchecked runtime.lastError」噪音。
      // 上下文在「发送成功后、回包前」失效时也会落到这里（lastError 文案同上）。
      const err = chrome.runtime.lastError;
      if (err) {
        const message = err.message || '';
        settle({
          ok: false,
          reason: INVALIDATED_PATTERN.test(message) ? 'invalidated' : 'lastError',
          message
        });
        return;
      }
      settle({ ok: true, response });
    });
  } catch (e) {
    const message = describeError(e);
    settle({
      ok: false,
      reason: INVALIDATED_PATTERN.test(message) ? 'invalidated' : 'throw',
      message
    });
  }
}
