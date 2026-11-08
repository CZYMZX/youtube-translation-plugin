# AI 深度精翻字幕 · 本地持久化与断点续翻（需求 7）

> 对应需求原话：
> 「解决字幕缓存问题，视频刷新或者重看 ai 精翻完的字幕消失，需要重翻，把精翻完的字幕保存到本地
> （保留时间让用户自己选，也可以没有保留时间），然后视频开启后，插件检索是否有本地已翻译字幕。
> 如果翻译一半，也自动保留，再打开视频后继续翻译（需要用户手动点 ai 精翻，也可给用户选项
> ——是否在视频继续时 ai 精翻未完成的字幕，但注意翻译一半导致后续未翻译的句子继续进行时
> 上下文语境问题）。」

## 1. 旧行为与病根

| 位置 | 旧实现 | 后果 |
| --- | --- | --- |
| `utils/ephemeral-subtitle-store.ts` | 内存 + `sessionStorage` | 关标签页即丢 |
| 同上，`init()` 注册的 `beforeunload` / `pagehide` | **主动 `removeItem` + `memoryCache.clear()`** | 刷新即清空，是「重看必须重翻」的直接原因 |
| `entrypoints/content/index.ts#handleVideoChange` | 切视频 `clear(上一部)` | 连 SPA 跳转都会把上一部抹掉 |
| AI 请求 | 每批都带 `bypassCache: true` | 句子级缓存也不帮忙，必定重翻 |

结论：只要离开页面，AI 精翻成果 100% 丢失，且没有任何持久化层可用。

## 2. 存储结构

**独立 IndexedDB 库**，不动 `utils/db-cache.ts` 的库与版本：

```
库名   yt_sub_ai_tracks     版本 1（独立，不与 v2_cache 混用）
store  tracks               主键 keyPath = 'key'
索引   updatedAt            TTL 清理用
```

为什么另开一个库：`yt_sub_translator_v2_cache` 已升到版本 2 且承载 30 天句子缓存，
往里加 store 必须升版本，升级时若被其他标签页的旧连接阻塞（`onblocked`），
一次失败就会连带毁掉用户已有的句子缓存。独立库把风险隔离成零。

记录结构（`AiTrackRecord`）：

| 字段 | 含义 |
| --- | --- |
| `key` | `videoId::targetLang::scenario`（**不含源指纹**） |
| `videoId` / `targetLang` / `scenario` | 归属维度，换语言/场景必须重翻 |
| `sourceHash` | 源字幕指纹（FNV-1a 32bit，带句数前缀，折叠空白） |
| `sentences[]` | `{ id, start, end, text, translation, status, isAi }`（不存 `rawTokens`，省一半体积） |
| `total` / `done` | 进度快照，用于「命中 N/M」日志与统计 |
| `createdAt` / `updatedAt` | `updatedAt` 是 TTL 判定依据 |
| `service` / `modelName` | 记录是哪家模型翻的，便于排查 |

**为什么 key 不含指纹**：指纹若进 key，换轨后连记录都读不到，就无法判断
「是换了 CC 轨道」还是「根本没缓存过」，也无法覆盖掉旧记录（会留下永远读不到的垃圾）。
指纹留在字段里，`planResume` 才能比较并给出 `reason`。

## 3. 时序：什么时候写、什么时候读、刷新后发生什么

**写**（全部经过 `EphemeralSubtitleStore`）：

1. 每批 AI 翻译结束 → `save(videoId, sentences, meta)` + `flushNow(videoId)`（立即写盘，
   不等 2s 防抖）；
2. 全篇完成 → 再 flush 一次；
3. 页内普通保存 → `save()` 只排 2s 防抖定时器，避免长视频每批都全量序列化；
4. `pagehide` / `beforeunload` → **只把内存里还没落盘的 flush 一次，不删除**；
5. 切视频 → `release(旧 videoId)`：先落盘，再丢内存镜像，**磁盘记录保留**。

**读**（打开视频 / 点按钮）：

1. 页内内存镜像（`EphemeralSubtitleStore.load`）→ 命中且等长，直接复用（重复点按钮 / 重渲染）；
2. 否则 `hydrate()` → `loadAiTrack()` 读 IndexedDB；
3. `planResume()` 判定能不能复用、能灌回几句；
4. 灌回的那几句立刻标 `done + isAi` 并渲染（用户马上看到上次的成果）；
5. 剩下的按设置项决定：`manual` 只提示，`auto` 直接续翻。

**刷新之后**：内存清空、`sessionStorage` 无关，IndexedDB 里的整轨记录还在 →
`processCaptionData` 分句后走第 2 步 → 已翻部分立刻恢复，缺口继续（或等用户点按钮）。

## 4. 续翻判定：`planResume`

纯函数，无 IO，可单测。返回 `{ reusable, reason, restored, pending, sentences }`。

| reason | 触发条件 | reusable |
| --- | --- | --- |
| `no_cache` | 没有记录 / 记录为空 | false |
| `meta_mismatch` | 目标语言或场景与记录不一致 | false |
| `exact` | 源指纹完全一致 | true |
| `aligned` | 指纹不一致，但按 id+原文对齐后能复用足够多 | true |
| `no_text_match` | 文本全变了（典型：换了 CC 轨） | false |
| `low_overlap` | 对齐率低于阈值 | false |

两条细则：

* **原文不完全一致就不复用**。同 id 但原文变了 → 不认这条译文；否则会把上一版断句的
  译文贴到新句子上。匹配顺序是「同 id 且原文一致」→「全表里原文唯一命中」。
* **对齐率的分母是「缓存里本来有多少条译文」**，不是当前总句数。用总句数当分母时，
  一条只翻了 5/12 的记录只要用户改一句，比例就掉到 0.33，把 4 条还能用的译文一起丢掉
  —— 正好毁掉续翻的价值。阈值 `AI_TRACK_ALIGN_MIN_RATIO = 0.5`：译文只在原文完全一致时
  才灌回，复用本身不会写错字，阈值只决定「要不要告诉用户轨道变了」。同一轨被 YouTube
  重新生成时比例接近 1，换轨时接近 0，0.5 落在两个簇中间。

## 5. 批次规划与上文语境

`buildResumeBatches(sentences, { batchSize, contextWindow })`：

* **只挑还没 AI 精翻过的句子**。「完成」以 `isAi === true` 为准，不以「有没有译文」为准。
  原因：页内机器翻译管线几十毫秒就把当前窗口铺满，若机翻也算完成，用户点
  「AI 深度精翻」会看到「已完成 12/12」却一句没翻 —— 续翻按钮直接变空转。
* 按句序切批（默认 12 句），每批带 `contextBefore`：**本批第一句之前紧邻的 2 句**
  （原文 + 已有译文）。不取批内的句子，因为批内句子在同一次请求里，模型自己能看前后关系。

## 6. 上下文怎么进请求（为什么不动 system prompt / 缓存键）

链路：`content` → `TRANSLATE_BATCH.payload.contextBefore`（可选）
→ `background` 原样透传 → `translateSentenceBatch(options.contextBefore)`
→ `callOpenAiRaw` / `callGeminiRaw` 拼进 **user 消息**。

拼接形态（`utils/translator.ts#buildContextBlock`）：

```
【上文参考（仅用于理解指代、人称与语气，不要翻译、不要输出）】
1. 原文：… / 已有译文：…
2. 原文：… / 已有译文：…
以上仅作参考：不要翻译、不要输出、不要计入输出条目；只输出下面 JSON 数组中每一条的译文，
输出条数必须与输入条目数严格一致，id 从 0 连续编号。

待翻译内容：
[{"id":0,"text":"…"}, …]
```

三条硬约束：

1. **不改 system prompt 骨架**。system prompt 由 `buildPromptSkeleton()` 决定，
   它同时是缓存指纹的唯一输入。往里加一行，指纹就变，用户已翻的全量译文**整体失效**。
   这是红线，也是为什么单句重试契约（`RETRY_CONTRACT`）当初就只追加在重试请求里。
2. **不进缓存键**。缓存键 = `service:model:scenario:reasoning:lang:text:glossaryTag`，
   上下文只存在于 `options` 里，`planBatch` / `getCacheKey` 完全看不到它。
   已用端到端验证：带 `contextBefore` 再问同一批句子，命中缓存、0 次新请求。
3. **不参与输出条目计数**。上下文句不带 `id`，不在 JSON 数组里；`translatable` 仍只有
   本批待译句，`mapRawItemsToSlots(raw, count)` 只认 `0..count-1` 的 id。
   若模型仍把上下文翻了导致条目对不上，会走**既有**路径：缺槽位 → 该句标失败 →
   带前后文的单句重试（不是整批重发）。首轮还额外打印一行条数告警，便于自查。

token 量级：`buildContextBlock` 新增约 14 行固定说明 + 每批最多 2 条
`原文 + 已有译文`。按 12 句一批估算，prompt 增加约 **60~160 token / 批**，
相对一批 12 句原文（通常 400~900 token）约 **+15%** 输入侧；只有续翻的第一批之后每批都带，
总调用次数不变（不多发请求）。

## 7. 设置项

默认值只在 `types/index.ts#DEFAULT_SETTINGS` 定义一份，`utils/storage.ts#sanitizeSettings` 兜底：

| 项 | 取值 | 默认 | 非法值 |
| --- | --- | --- | --- |
| `aiCacheTtlHours` | `24 \| 168 \| 720 \| 0`（0 = 永久） | `720` | **一律回落 720**，不就近取整 |
| `aiResumeMode` | `'auto' \| 'manual'` | `'manual'` | 回落 `'manual'` |

分段控件写回的是字符串（`'720'`、`'0'`），`sanitizeSettings` 先转数字再判白名单；
`null` / `''` / `'abc'` / `NaN` / `25` 全部回落 720（`null` 不会被误当成 0 = 永久）。

设置页「同步与缓存」分区新增三行（`entrypoints/options/index.html`）：

1. **AI 精翻字幕保留时长**：4 档分段（1 天 / 7 天 / 30 天 / 永久）；
2. **视频续播时自动继续精翻**：2 档（手动 / 自动）；
3. **AI 精翻缓存**：统计「已缓存 N 个视频 · 约 X KB」+「清空 AI 精翻缓存」按钮
   （`window.confirm` 二次确认，与删除术语条目 / 恢复默认一致）。

TTL 改成更短的档位时**立即按新 TTL 清理一次**；打开设置页也会先按当前 TTL 清一次过期记录。
永久（0）不做任何清理。

## 8. 降级与可观测性

* 打不开库 / 无痕 / `put` 配额超限 → `[AiTrack] 不可用（原因）…` 只告警一次，
  全程降级为内存 Map，**不抛到界面**，本页 AI 精翻照常可用（只是刷新后不保留）。
  日志前缀统一为 `[AiTrack]`。
* 命中本地缓存时打一行（每部视频一次，不刷屏）：
  `[AiTrack] 命中 videoId=… 完成 N/M`（全篇完整时追加「全篇完整，零请求」）。
* 未复用时打一行 `[AiTrack] 未复用 videoId=… 原因=<reason>`。
* **手动续翻的提示不能用 `updateAiProgress()`**：它会把 AI 按钮 `disabled = true`，
  然后再也没有任何地方能恢复（`overlay.ts` 不在本轮改动范围，无法新增
  「只显示进度但不置灰」的方法）。因此部分恢复走 `resetAiProgress()` + toast 的
  「完成 N/M」文案，按钮保持可点。若后续要给进度条，需要 overlay 侧补一个
  `setAiPending(restored, total)`。已用断言锁住这条（防止回退）。

## 9. 验证

`npm test`（新增 `test/test-ai-track.js`，104 断言）包含：

* 纯函数：key 生成、指纹稳定性/敏感性、`planResume` 六分支、TTL 判定、
  `sanitizeSettings` 回落、`decideAiRunAction` 四分支；
* 端到端（esbuild 打成 IIFE + `chrome` 桩 + 自带最小 IndexedDB 桩 +
  **每条用例一个独立 node 进程**，用文件持久化的 IDB 桩模拟真实冷启动）：
  1. 翻到一半（12 句完成 5 句）→ 冷启动 → 恢复 5/12、pending 7、0 次请求；
  2. `auto` → 只发 1 批 7 句，`contextBefore` 2 句为紧邻上文，user 消息含 7 条待译、
     system prompt 未被污染；
  3. 源字幕文本变化 → `reusable=false`；只改一句 → 对齐复用 11/12；
  4. TTL=24h 且记录 25 小时前 → 清理后查不到；TTL=0 不清理；
  5. 清空 → 记录消失、统计归零；
  6. 带 `contextBefore` 再问同一批 → 0 次新请求（上下文不进缓存键）。

另有一组结构性断言锁住接线（切视频只 release 不 clear、pagehide 只 flush、
请求带 `contextBefore`、手动提示不置灰按钮、设置页有 4+2 档控件等），
它们是补充，行为本身由上面的端到端用例验证。

## 10. 已知缺口

* 多标签页同时看同一视频时，两边各写各的整轨记录，后写覆盖先写；暂未做合并。
* `pagehide` 的 flush 是「发起事务后立即离开」，极端情况下浏览器可能来不及提交；
  但每批结束都已 `flushNow`，最坏只丢最后 1 批。
* 上下文只带「上文 2 句」，未带下文；后续若发现指代仍出错，可扩到 ±N。
* `service = 'google'` 通道没有 LLM user 消息，`contextBefore` 被忽略（AI 精翻本身要求大模型）。
