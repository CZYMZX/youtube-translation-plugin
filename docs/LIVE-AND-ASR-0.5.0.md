# 两项新能力设计：无字幕 ASR 回退 + 直播实时翻译

> 日期：2026-11-09
> 基线：`E:\Antigravity\youtube-translation-plugin`，tag `v0.4.3`，`package.json` 0.4.3，工作区干净、与 `origin/master` 同步。
> 本文是**设计文档**，不含代码改动。落地按 §八 的阶段推进，每阶段独立验收。
> 目标版本号建议 `0.5.0`（两项能力都是结构性新增）。

---

## 一、结论摘要

| 问题 | 结论 |
| --- | --- |
| 无字幕时字幕从哪来 | 只能抓音频。`tabCapture` → offscreen document → 16k PCM16 分片 → 云端 STT / 本地 WASM Whisper。**`createMediaElementSource(video)` 不可用**（见 §4.1） |
| 直播字幕从哪来 | 优先消费 YouTube 自带的滚动窗口 timedtext（被动截获，零成本零请求），8 秒无 cue 才降级到 ASR |
| 直播现有代码能不能直接用 | **不能**。`content/index.ts` 有四处"只加载一次"闸门，与滚动窗口模型正面冲突（§2.3） |
| 延迟能不能做到 2–4 秒 | CC 路径 P50 ≈1.5–3.0s；ASR 路径 P50 ≈1.4–4.3s。关键是 VAD 静音即 flush，不等分片满 |
| VOD 行为会不会变 | 不会。所有新逻辑由 `mode`（默认 `vod`）+ `liveMode` 双重开关保护，`processCaptionData` 只做"搬移 + 分发" |
| 最大不确定性 | ①`tabCapture` 在 Edge 上的用户手势要求（V2）②截获的 `pot` 能否复用到续拉请求（V3）。两者都不影响 CC 路径 |

---

## 二、现状基线（逐行核实）

### 2.1 字幕来源

唯一权威源是 MAIN world 里对 `XMLHttpRequest` / `fetch` 的 hook，零拷贝截获 `/api/timedtext` 响应（`entrypoints/youtube-bridge.content.ts:174-269`），再 `postMessage` 给隔离世界。

主动拉取路线基本不可用：直接 GET `baseUrl&fmt=json3` 返回 **200 + 0 字节**，只有播放器原生请求带 `pot=…&potc=1&c=WEB&cver=…` 才有数据（实测记录见 `docs/CHANGES-0.2.3-FOR-ANTIGRAVITY.md:156-166`）。因此 `MAX_CANDIDATES = 3`（`content/index.ts:839`），主路径始终是截获。

### 2.2 时间与渲染

- 显示由 `<video>` 的 `timeupdate`（约 4Hz）驱动，`overlay.onTimeUpdate` 用 `currentTime + 200（ACOUSTIC_LEAD_IN_MS）+ syncOffsetMs` 二分查找当前句（`overlay.ts:447-451`）。
- 浮层是**单节点双行**（`.original-text` / `.translated-text`），每帧只写 `textContent`，O(1)。
- 全仓**不读 `duration`**，本来就适配直播；也没有 `getProgressState` / `isLive` 调用。

### 2.3 四处"只加载一次"闸门（直播的头号障碍）

| 位置 | 现状 | 直播下的后果 |
| --- | --- | --- |
| `content/index.ts:537` | `if (currentSentences.length > 0) return;` | 首窗之后不再探测 |
| `content/index.ts:696` | 只接受 `tokens.length > lastCaptionTokenCount` | 滚动窗口长度会**变短或不变**，之后全部被拒 |
| `content/index.ts:820` | `handleCaptionTracks()` 首行同款闸门 | 轨道广播全部空转 |
| `content/index.ts:929-932` | `processCaptionData()` 无条件全量替换 | 无增量合并，每窗重建整轨 |

结论：现有结构是"一次性全量 VOD 快照"，与直播增量流模型不兼容。

### 2.4 翻译链路

- 全部经 background service worker：`TRANSLATE_BATCH` → `translateSentenceBatch(texts, targetLang, settings, opts)`。
- 队列默认 `maxConcurrency=2` / `batchSize=8` / `requestTimeoutMs=20000`（`utils/translation-queue.ts:22-25`）。
- **不支持流式**：无 `stream:true`、无 SSE、无 `EventSource`；输出契约是整段 JSON 数组 `[{"id":0,"translation":"…"}]`。
- 失败句带 ±1 句上下文单句重试（`MAX_SENTENCE_RETRIES=2`、预算 8000ms），再降级 `fallbackOrder` → Google 免费 → MyMemory → 占位符。
- 缓存纯内容寻址（`utils/db-cache.ts:117-132`，键里没有 videoId），30 天 TTL，内存 Map 上限 8000；另有 `translator.ts:259` 的进程内 Map **无上限**。

### 2.5 四个既有缺陷（会被直播放大）

1. **`hydrateSentencesFromCache` 死键**：`content/index.ts:1066-1102` 用裸 `settings.scenario` 作键且不带 glossaryTag，写入侧是 `buildScenarioTag()`（`s2.{场景}#{hash}`）+ glossaryTag，两者永不相等 → 该函数实际是死代码。
2. **`failed[]` 未透传**：`background.ts:219` 只回 `translations`，占位符被队列当成功（`translation-queue.ts:175-180` 只看非空），直播下会永久不重试。
3. **`translationCache` 无上限**（`translator.ts:259`）：长直播线性膨胀。
4. **`syncOffsetMs` 符号相反**：`overlay.ts:448` 用 `+`，`translation-queue.ts:85` 用 `-`。默认 0 无感，非 0 时"显示"与"预取"朝相反方向偏。

---

## 三、总体架构

### 3.1 数据流

```
MAIN world ──(postMessage: CAPTION_TRACKS / CAPTURED_TIMEDTEXT_RESPONSE / LIVE_STATE / AD_STATE)
   │
ISOLATED (entrypoints/content/index.ts)
   SourceCoordinator ── 选源 + 模式机：vod | live-cc | live-asr
      ├── TimedtextSnapshotSource   VOD，一次性全量、不修订 → 走现有 processCaptionData
      ├── TimedtextLiveSource       直播 CC，滚动窗口增量、尾部可修订
      └── AsrSource                 无 CC，offscreen 转写流
      ▼ onCue(cues: RawCue[])
   CueRingBuffer          去重 / 合并 / 裁剪 / seek rebase      （纯函数）
      ▼
   StreamingSegmenter     stable 句 + pending 尾巴              （纯函数）
      ├── vod  → 现有管线（零变化）
      └── live → LiveScheduler（批 1–3 / 并发 1 / 8s 超时 / 不落库 / 滚动上下文）
      ▼
   SubtitleOverlay        新增 renderLivePair + .live-tail，不动 onTimeUpdate 二分
   │
Background SW ── TRANSLATE_BATCH（加 failed[] 透传）+ ASR_START / ASR_STOP / ASR_RELAY
   │
Offscreen document ── getUserMedia(tab) → AudioWorklet → 重采样 16k → PCM16/WAV
                      → VAD → STT（云 / 本地 Whisper）→ transcript → SW → content
```

### 3.2 字幕源抽象（新文件 `utils/subtitle-source.ts`）

核心是把"VOD 全量快照"降级成"只 emit 一次 cue、永不修订"的退化情形，这样三条通道共用一个下游。

```ts
export interface RawCue {
  key: string;          // `${startMs}#${fingerprint(text)}`
  startMs: number;
  endMs: number;
  text: string;
  provisional: boolean; // 尾部可能被后续窗口 / 下一分片改写
}

export interface SourceCapabilities {
  incremental: boolean;                       // 是否持续产出
  rewritable: boolean;                        // 尾部是否可能被改写
  seekable: boolean;
  needsUserGesture: boolean;                  // tabCapture
  latencyClass: 'low' | 'elevated';           // 用于 UI 提示与调度参数
}

export interface SourceStatus {
  state: 'idle' | 'starting' | 'running' | 'degraded' | 'stopped' | 'error';
  reason?: string;
  lastCueAtMs?: number;
}

export interface PlaybackState {
  currentTimeMs: number;
  paused: boolean;
  playbackRate: number;
  wallMs: number;     // performance.now 基准
  isAd: boolean;
  muted: boolean;
}

export interface SourceStartContext {
  videoId: string;
  sessionStartedAt: number;                   // 直播会话起点，用于缓存隔离
  settings: ExtensionSettings;
  getPlaybackState: () => PlaybackState;
  requestNativeCaptions: () => void;          // 复用现有 TRIGGER_SUBTITLES
}

export interface SubtitleSource {
  readonly kind: 'timedtext-snapshot' | 'timedtext-live' | 'asr';
  capabilities(): SourceCapabilities;
  start(ctx: SourceStartContext): Promise<void>;
  stop(reason: string): void;
  onCue(cb: (cues: RawCue[]) => void): () => void;
  onStatus(cb: (s: SourceStatus) => void): () => void;
}
```

三个实现如何统一：

| 实现 | 产出方式 | `provisional` | 统一手段 |
| --- | --- | --- | --- |
| `TimedtextSnapshotSource` | 复用现有 `CAPTURED_TIMEDTEXT_RESPONSE` / `FETCH_CAPTIONS`，整轨一次 emit 后 `state='stopped'` | 全 `false` | 把 `extractCaptionTokens()`（`segmenter.ts:517`）的输出按 `start/end` 包成 `RawCue` |
| `TimedtextLiveSource` | 被动截获每个滚动窗口 → 只 emit 水位之后的 cue | 窗口末尾 2 条为 `true` | 同一个 `parseEventsToCues()` |
| `AsrSource` | 订阅 `ASR_TRANSCRIPT` → 每段转写一条 cue，时间由 timebase 映射 | 与上一分片重叠段为 `true` | 同一 `RawCue` 结构 |

### 3.3 模式状态机（`utils/live/source-coordinator.ts`）

```
idle ──isLiveNow=false──► vod（现有逻辑，路径不变）
     └─isLiveNow=true───► probe（试 CC 通道 8s）
                            ├ 有 cue ────────────► live-cc
                            └ 8s 无 cue + asrEnabled ──► live-asr（首次需用户手势）
live-asr 期间 CC 出现 ──► 按 liveSourcePriority 切回 live-cc
```

每次切换递增 `sourceGen`，旧源在途回调一律丢弃（沿用现有 `aiRunToken` 的代际思路）。**切换不清空 `currentSentences`**，只重置消费水位与调度器，避免字幕闪断。

---

## 四、能力一：无字幕 ASR

### 4.1 抓音路线结论

**`tabCapture` + offscreen 是唯一可交付主路径。**

`createMediaElementSource(video)` 看似更省权限，但有四个硬伤，不能作主路径：

| 维度 | 问题 |
| --- | --- |
| 不可逆 | 一旦 `connect()`，该 `<video>` 的音频永久走 AudioContext 图，无法恢复直通；YouTube 换 video 元素后状态错乱 |
| 静音风险 | content script 无用户手势时 `AudioContext` 常为 `suspended`，此时视频**直接没声音** |
| DRM | 受保护媒体（EME）按规范输出静音 |
| 路由冲突 | YouTube 自身可能已在用 WebAudio，双重路由会叠音或抢主线程 |

只作为实验开关保留（验证项 V8），不进生产。

### 4.2 采集链路

```
SW:  chrome.tabCapture.getMediaStreamId({ targetTabId })
     → ensureOffscreen()            // runtime.getContexts 判存 + 模块级 creating 单飞
     → sendMessage({ type:'ASR_STREAM_ID', streamId })

Off: navigator.mediaDevices.getUserMedia({
       audio: { mandatory: { chromeMediaSource:'tab', chromeMediaSourceId: streamId } },
       video: false })
     → const ctx = new AudioContext({ sampleRate: 48000 }); await ctx.resume();
     → src = ctx.createMediaStreamSource(stream)
     → src.connect(gain); gain.connect(ctx.destination)   // ★ passthrough，不可省
     → await ctx.audioWorklet.addModule(chrome.runtime.getURL('pcm-tap-worklet.js'))
     → src.connect(workletNode)
```

> **passthrough 是硬要求**：tab 音频被采集后，Chrome/Edge 会把它从默认输出设备"摘走"，不接 `destination` 用户就听不到声音。这是 tabCapture 类扩展最常见的"采完没声音"事故。

`pcm-tap-worklet.js` 必须放 `public/`（AudioWorklet 不支持 import），由 WXT 原样拷到产物根目录。

### 4.3 分片参数

| 参数 | 建议值 | 理由 |
| --- | --- | --- |
| 采样 | 采集 48k → **重采样 16k 单声道** | 云端 STT / Whisper 通用采样率 |
| 编码 | **PCM16 WAV 自封装**（`utils/asr/wav-encoder.ts`） | 零依赖；OpenAI / Gemini 均接受 `audio/wav` |
| 码率 | 32KB/s，2.4s ≈ 77KB | 远低于 OpenAI 25MB 上限 |
| 窗口 / 步进 | `asrChunkMs=2000` / `asrHopMs=1000`（50% 重叠） | 重叠用于修补被切断的词 |
| 硬上限 | 连续语音强制切 4000ms | 防长独白无限累积 |
| VAD | RMS 双阈值：说话 −42 dBFS / 静音 −48 dBFS；静音 600ms **立即 flush** | **把 P50 从 4s 拉到 2s 的关键**，不等分片满 |
| 静音丢弃 | RMS < −50 dBFS 且 < 300ms → 不发 | 省钱 + 防 Whisper 对静音编造文本 |
| 重叠去重 | `mergeOverlappingTranscript(prevTail, next)`：最长后缀 = 最长前缀 | 纯函数、可单测 |

### 4.4 STT 调用形态（`utils/asr/stt-client.ts`，同一接口）

```ts
export interface SttChunk {
  seq: number;
  wav: Blob;            // 16k mono pcm16 wav
  wallStartMs: number;  // performance.now 基准
  wallEndMs: number;
  prevTail: string;     // 重叠去重 + prompt 连续性
}

export interface SttResult {
  seq: number;
  text: string;
  segments?: Array<{ startMs: number; endMs: number; text: string }>; // 本地 Whisper 可给
}

export interface SttClient {
  transcribe(chunk: SttChunk, opts: {
    language?: string;
    signal: AbortSignal;
    glossaryPrompt?: string;   // 复用 glossary.ts 的命中术语，≤40 条
  }): Promise<SttResult | null>;
}
```

| 形态 | 端点 | 约束 |
| --- | --- | --- |
| OpenAI 兼容（`asrProvider='openai'`） | `POST {base}/audio/transcriptions`，multipart，`model=gpt-4o-mini-transcribe`、`language`、`prompt=prevTail+术语` | 25MB 上限（我们最大 ~128KB）；`verbose_json` 才带 segments |
| Gemini（`'gemini'`） | `generateContent` + `inline_data: audio/wav`（base64） | inline 上限需实测（V7） |
| 自建（`'custom'`） | OpenAI 兼容协议 + 用户端点 | 需 `asrCustomApiKey`，**必须进 `SECRET_FIELDS`** |
| 本地 WASM（`asrEngine='local'`） | 同接口，offscreen 内跑 | 需 CSP `wasm-unsafe-eval`（V6） |

**降级方向必须单向，避免来回横跳：**

- `asrEngine='cloud'`：连续失败且本地模型已就绪 → 切本地；否则 `status='degraded'` 并提示。
- `asrEngine='local'`：失败**不自动上云**（选本地多为隐私诉求），只提示。
- 不做"云端与本地对同一分片并行投票"——成本翻倍且对延迟无收益。

### 4.5 时间基准映射（`utils/asr/asr-timebase.ts`）

ASR 只给"分片相对时间"，必须映射到 `video.currentTime`：

```
videoMs = anchor.videoMs + (wallMs - anchor.wallMs) * anchor.playbackRate
```

| 情况 | 判定 | 处理 |
| --- | --- | --- |
| 正常抖动 | `\|drift\| ≤ 300ms` | 线性插值，不重锚 |
| 缓冲抖动 | `300ms < \|drift\| ≤ 1500ms` | 以实测值重锚 |
| seek / DVR 跳转 | `\|drift\| > 1500ms` | `rebase()` + 在途分片（`seq` 未返回）作废 |
| 暂停 | `paused === true` 期间产出的分片 | 直接丢弃（残留噪声），恢复后 `rebase()` |
| 倍速 | `rate !== 1` | `asrChunkMs` 按 `1/rate` 缩放（2× 下切 4s 只覆盖 2s 内容） |

本地 Whisper 若返回片内 `segments`，用 `wallToVideo(chunk.wallStartMs + seg.startMs)` 拿更细粒度；否则整片当一条 cue。

### 4.6 offscreen 生命周期

| 场景 | 处理 |
| --- | --- |
| create | `asrEnabled` **且** `isLiveNow` **且**（CC 8s 无 cue 或 `liveSourcePriority='asr-first'`）→ content 发 `ASR_START` |
| 幂等 | `chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})` 判存。**不要用 `hasDocument()`**——类型标注 `@since Chrome 150`。加模块级 `creating` 单飞，避免 "Only a single offscreen document may be created" |
| close | tab 关闭 / 离开 YouTube / 关开关 / `paused` 连续 60s / 无分片 30s |
| SW 休眠 | offscreen **不随 SW 终止**；它每 1–2s 发消息会唤醒 SW。**STT 请求放在 offscreen 发**，绕开 SW 30s 生命周期 |
| AudioContext suspended | 建后立即 `resume()`；收到 `ASR_STREAM_ID` 再 resume 一次；5s 自检，连续 3 次失败上报 `error: audio-suspended` |
| 文档崩溃 | SW 侧 30s 心跳（`getContexts` 为空）→ 重建 + 重新取 streamId（可能需再次授权）→ 发 `ASR_NEED_GESTURE`，浮层出「重新开始听译」 |

### 4.7 抓整标签页的保护

`tabCapture` 抓的是**整个标签页音频**，必须做保护：

| 风险 | 保护 |
| --- | --- |
| 广告音频被转写 | MAIN 桥已有 `isAdPlaying()`（`youtube-bridge.content.ts:113-120`，`getAdState()>0`）→ 广播 `AD_STATE` → offscreen `pauseEmission()` 并清 buffer；广告结束 `resumeEmission()+rebase()` |
| 聊天提示音 / 系统通知 | VAD 能量门限 + `paused` 一律丢弃；**无法完全排除**，必须在 UI 与文档里明写"采集整标签页音频" |
| 用户静音 | `video.muted \|\| volume===0` 时暂停 ASR（采到的也是静音，白花钱） |
| 切后台 / 失焦 | **继续采集**（后台听直播是常态），仅 `paused` 时停 |
| 戴蓝牙耳机 | tabCapture 采的是 tab 输出，与听感一致，不做额外补偿 |

### 4.8 权限与商店审核

`wxt.config.ts:8` → `permissions: ['storage', 'offscreen', 'tabCapture']`。

`tabCapture` 属敏感权限，对策：

1. **ASR 默认关闭**（`asrEnabled:false`），CC 路径零新权限；
2. 首次开启弹明确同意（说明音频会发送到用户自己配置的识别服务）；
3. `justification` 写清用途；README 增"数据流向"章节；
4. 注意已有 `https://*/*`（自定义端点）可能叠加触发"宽泛主机权限"人工复核。

---

## 五、能力二：直播实时翻译

### 5.1 直播判定

MAIN 桥新增 `getLiveState()`，三源合一（任一为真即直播）：

- `player.getPlayerResponse().videoDetails.isLiveContent | isLive`
- `microformat.playerMicroformatRenderer.liveBroadcastDetails.isLiveNow`
- `player.getProgressState()?.isLive`

广播时机：`broadcastTracks()` 附带 + `onCaptionsTrackListChanged` + `yt-navigate-finish` + 现有 600ms 桥轮询。

内容侧只在 `isLive !== mode && isLiveNow === true` 时切模式——避免"预约页 `isLiveContent=true` 但还没开播"误判为直播。

### 5.2 增量 cue 模型（`utils/live/cue-ring-buffer.ts`）

去重 / 合并规则（**直播正确性的核心**）：

1. 候选按 `startMs` 升序；`|newStart - existStart| ≤ 120ms` 视为同一句。
2. 文本先归一化（trim / 折叠连续空格 / 去尾部标点 / 全角转半角 / 小写）再比：
   - **相等** → 丢弃（滚动窗口最常见的重复）；
   - **旧文本是新文本前缀** → 原地替换为更长版本，记入 `revised`；
   - **新文本是旧文本前缀**（窗口回退）→ 保留更长的旧值，不产生事件；
   - 其余 → 同 `startMs` 下的不同句，`key` 追加 `#2`。
3. **禁止**用"token 总数变多"当唯一判据——`content/index.ts:696` 就是这个问题。
4. 裁剪：`size > 400` 或 `startMs < current - 180s` 时从头部丢，但**跳过当前显示句与最近 10 句**。
5. seek / DVR 回退：`|ΔcurrentTime − Δwall × rate| > 1500ms` 判 seek → `onSeek()` 只重置消费水位，**不清 buffer**（用户可能回看刚错过的 30 秒）。

```ts
const MAX_CUES = 400;          // ≈ 8–12 分钟滚动窗口
const MAX_AGE_MS = 180_000;
const SAME_START_TOL_MS = 120;

export interface BufferIngestResult {
  added: RawCue[];
  revised: RawCue[];
  dupDropped: number;
}

export class CueRingBuffer {
  ingest(cues: RawCue[], nowVideoMs: number): BufferIngestResult;
  onSeek(deltaMs: number): void;
  snapshot(): RawCue[];
  stats(): { size: number; oldestMs: number; newestMs: number };
}
```

### 5.3 四处闸门的改造（保证 VOD 零影响）

| 位置 | 改造 | VOD 影响 |
| --- | --- | --- |
| `:537` | `if (mode==='vod' && currentSentences.length>0) return;` / live 分支改判 `liveSourceActive()` | 无（`mode` 默认 `vod`） |
| `:696` | `mode==='live' ? hasNewCue(incoming) : tokens.length > lastCaptionTokenCount` | 无（走原 else，一字节未变） |
| `:820` | 同上，保留 `trackCascadeActive` 单飞 | 无 |
| `:929` | 拆 `applyVodSnapshot()`（原 911-942 逐字搬入）+ `applyLiveDelta()`，`processCaptionData` 只做分发 | 无（VOD 调用链未变） |
| `:714 / :723` | URL 兜底改为"`currentSentences` 为空 **或** `!liveSourceActive()`" | 无 |
| `:1382` | 直播 / ASR 下禁用 DOM 观察器（避免与增量源双写） | 无 |

### 5.4 轮询策略

- **主路径：被动截获**。CC 开着时播放器自己会持续请求滚动窗口，现有 hook 已经都在，**不发请求就没有 pot 问题**。
- **加速路径（需验证 V3）**：捕获到含 `pot` 的 URL 后，2s 一轮 `GET <url>&t=<lastEndMs/1000>&fmt=json3`；单飞锁 `livePollInFlight`；连续 2 次空响应或 4xx → 关闭主动 poll 只留被动；退避 2 → 4 → 8 → 15s，成功即复位。
- **看门狗**：新增 `startLiveStallWatchdog()`（30s 无新 cue → 强制点一次 CC 按钮，最多 3 次 → `status='degraded'`）。**不能复用** `startCaptionsWatchdog()`（`content/index.ts:486-516`，15s 判"无字幕"，直播里是误判）。
- 轮询用独立 `setInterval`，**不挂** `handleTimeUpdate`（4Hz 会重复触发）。

### 5.5 流式断句（`utils/live/streaming-segmenter.ts`）

内部**复用** `segmentCaptionTokens()`（`segmenter.ts:747`），但只喂 `[consumedUpToMs - 800, windowEnd - tailGuard]` 这一段，避免长直播 O(n²)。

```ts
export interface StreamingSegmentOptions {
  tailGuardMs: number;      // 250：窗口末尾这么久的 token 视为未定稿
  tailGuardTokens: number;  // 2：至少保留几个 token 不进 stable
}

export interface StreamingSegmentResult {
  added: SubtitleSentence[];    // 首次出现的稳定句
  revised: SubtitleSentence[];  // 已有句文本被扩展（id 不变）
  tailText: string;             // 未定稿尾巴，只用于 partial 显示，不送翻译
  consumedUpToMs: number;
}
```

- **稳定判定**：`end ≤ 最后保留 token 的 start` 且 `end ≤ windowEnd - liveTailGuardMs`。
- **幂等**：以 `startMs` 为键，同 `startMs` 只 append 一次；文本变长走 `revised`。
- **`revised` 重译门槛**：增量 < 6 字符或仅补标点 → 只更新原文不重译；否则标 `status='idle'` 进低优先队列（最多 1 条在途）。

### 5.6 直播调度（`utils/live/live-scheduler.ts`，独立类，**不改** `TranslationQueue` 默认值）

| 项 | VOD 现状 | 直播 |
| --- | --- | --- |
| 批大小 | 8 | 1–3（默认 2） |
| 并发 | 2 | 1（可设 2） |
| 超时 | 20000ms，允许 2 次重试 | 8000ms，**0 次重试**（重试只会让延迟翻倍） |
| 免费兜底 | Google + MyMemory | **默认关闭**（`liveAllowFreeFallback=false`），避免拖尾字幕 |
| 队列语义 | 窗口 [cur−1, cur+12] + 预取 30 句 | 严格 FIFO + `maxLagMs(12000)` 丢弃过期句 |
| 缓存 | 内容寻址 + IDB 30 天 | `persist:false`，不落 IDB、不写进程内 Map |
| 上下文 | 无 | `contextBefore` = 最近 2 句原文 + 译文 |

**上下文怎么给**：复用**已经存在且不进缓存键**的 `contextBefore` 通道（`types/index.ts:351` 定义、`background.ts:214` 透传、`translator.ts:101-117 buildContextBlock` 只拼进 user 消息）。直播专用指令走 `extraInstruction`（`translator.ts:700`，只追加 system 尾部、不进骨架指纹）。

> **严禁新增 prompt 层**。新增 `PromptLayerKey` 会改 `buildPromptSkeleton()`（`prompt-layers.ts:61-68`）进而改 `buildScenarioTag()` 指纹（`translator.ts:292-295`），等于让所有老用户的 IDB 缓存全部失效。

### 5.7 尾巴渲染与防闪烁

新增 `overlay.renderLivePair(orig, trans, { tail })`（紧挨现有 `renderLiveCaption()` `overlay.ts:499-511`）：

- 尾巴用**独立 span** + `opacity: .55`。**只许 `opacity` / `color`，禁 `filter` / `backdrop-filter`**——`test/test-vsr-styles.js` 断言的是声明数，出现即红（VSR 红线）。
- 防闪烁三条：①尾巴区 `min-height: 1.2em` 占位，防容器跳动；②文本差 ≤ 1 字符不写 DOM；③稳定句渲染后 300ms 内不覆盖，复用 `overlay.ts:460` 的 1800ms 平滑保留窗口。
- live 模式驱动频率从 `timeupdate`（~4Hz）提升为 200ms ticker，并把 `ACOUSTIC_LEAD_IN_MS` 由 200 调 0（ASR 延迟已算进时间基准）。

### 5.8 缓存隔离（三层）

1. `TranslationOptions` 新增 `persist?: boolean`（默认 `true`）；直播传 `false` → 跳过 `setCachedSentencesBatch()`（`translator.ts:1321-1325`）与 `translationCache.set()`。
2. 直播模式**完全禁用** `EphemeralSubtitleStore.save()` 与 `ai-track-cache`——`ephemeral-subtitle-store.ts:40` 每 2s 全量序列化整轨，长直播是 O(n²)。
3. `translationCache` 改 LRU 2000（顺手修既有缺陷 3）。

副作用：同一场直播重看不命中缓存 → 可接受（直播回放通常只看一次），换来 IDB 不膨胀。

---

## 六、延迟与性能预算

### 6.1 端到端（P50 / P90，单位 ms）

**A. 直播 CC 路径**

| 段 | P50 | P90 | 旋钮 |
| --- | --- | --- | --- |
| YouTube 生成 + 播放器拉窗 | 800–1500 | 2000 | 被动不可控；主动 poll 2s 一轮 |
| 截获 → 解析（只处理新 events） | 5–20 | 50 | 增量解析，不重解析全窗 |
| 尾部稳定判定 | 250–600 | 900 | `liveTailGuardMs` |
| 入队 → 发请求 | 0–50 | 100 | 立即调度，不 debounce |
| LLM TTFT（1–3 短句） | 350–900 | 1500 | 模型 / `reasoningEffort='none'` |
| 渲染 | 8–16 | 32 | 200ms ticker |
| **合计** | **≈1.5–3.0s** | **≈4.0s** | |

**B. 无 CC → ASR 路径**

| 段 | P50 | P90 | 旋钮 |
| --- | --- | --- | --- |
| 分片等待（VAD flush） | 600–2400 | 3000 | `asrChunkMs` / `asrHopMs` / `asrVadSilenceMs` |
| WAV 编码 + 传输 | 5–15 | 30 | PCM16 |
| STT 往返 | 400–900 | 1800 | 端点就近 / 分片大小 |
| 重叠去重 + 断句 | 20–80 | 150 | |
| LLM TTFT | 350–900 | 1500 | |
| 渲染 | 8–16 | 32 | |
| **合计** | **≈1.4–4.3s** | **≈6.0s** | |

**验收口径**：CC 路径 P50 < 3.0s；ASR 路径 P50 < 4.5s（无 CC 属降级场景，允许比 2–4s 目标多 0.5s）。

### 6.2 资源约束

| 项 | 风险 | 处置 |
| --- | --- | --- |
| offscreen 常驻 | AudioWorklet ~1–2% CPU | 空闲 30s 自动 close |
| WASM 模型常驻 | base q5 ~140MB | 单例，一次只跑一个分片 |
| `currentSentences` 无限增长 | 直播必须裁剪 | 保留最近 400 句 + 已译映射 |
| 抽屉 4000+ 节点 | 长直播持续膨胀 | live 模式只渲染最近 100 条 / 虚拟滚动 |
| `body` 级 MutationObserver | 直播页聊天高频 | live 改为观察 `#movie_player`，节流 150 → 500ms |
| `translationCache` 无上限 | 线性膨胀 | LRU 2000 |

---

## 七、影响范围

### 7.1 新增（不改现有行为）

| 文件 | 职责 |
| --- | --- |
| `utils/subtitle-source.ts` | `RawCue` / `SubtitleSource` / `SourceCapabilities` / `PlaybackState` |
| `utils/live/source-coordinator.ts` | 选源状态机 + `sourceGen` 代际 |
| `utils/live/cue-ring-buffer.ts` | 去重 / 合并 / 裁剪 / seek（纯函数，可测） |
| `utils/live/streaming-segmenter.ts` | stable / tail 切分（纯函数，可测） |
| `utils/live/live-scheduler.ts` | 直播翻译调度 |
| `utils/live/live-mode.ts` | 直播状态归一化与模式判定（纯函数） |
| `utils/timedtext-snapshot-source.ts` | VOD 源（包现有逻辑） |
| `utils/timedtext-live-source.ts` | 增量源 + 主动 poll |
| `utils/asr/asr-source.ts` | 转写流 → `RawCue` |
| `utils/asr/asr-timebase.ts` | 墙钟 ↔ 视频时间映射（纯函数） |
| `utils/asr/wav-encoder.ts` | PCM16 / WAV 封装（纯函数） |
| `utils/asr/stt-client.ts` | OpenAI / Gemini / 自建 |
| `utils/asr/whisper-local.ts` | 本地 WASM Whisper（P4） |
| `utils/audio-capture-client.ts` | content 侧 ASR 控制封装 |
| `entrypoints/offscreen/{index.html,main.ts}` | 采集 / 分片 / STT / 心跳 |
| `public/pcm-tap-worklet.js` | AudioWorklet 源码（必须独立文件） |

### 7.2 修改（按风险排序）

| 文件:行 | 改动 | 风险 |
| --- | --- | --- |
| `utils/storage.ts:25 / 202-339 / 427-446` | 新设置清洗 + `SECRET_FIELDS` 加 `asrCustomApiKey` | **高**：漏改会把 Key 写进 `storage.sync` 上云 |
| `entrypoints/content/index.ts:537/696/820/929/714/723/1382` | 闸门按 mode 分支 + 分发器 | **中**：改错会让 VOD 加载不出来 |
| `entrypoints/options/*` + `test/test-options-ui.js:51/52/58/60` | 第 9 分区「实时与听译」，断言 8 → 9 | **高**：静态测试必红 |
| `entrypoints/content/overlay-styles.ts` | `.live-tail` | **高**：VSR 红线 |
| `entrypoints/content/index.ts:1066-1102` | 修 hydrate 死键（统一出 `buildCacheKeyForSentence()`） | 中：修好会"突然多出缓存命中"，需日志 + 测试 |
| `entrypoints/background.ts:213-226` + 新 case | `failed[]` 透传；`ASR_START/STOP/RELAY`、`tabs.onRemoved` | 中 |
| `entrypoints/youtube-bridge.content.ts:113-141 / 278-291` | `LIVE_STATE` / `AD_STATE` 广播 | 低 |
| `utils/translator.ts:21-41 / 259 / 1301-1332` | `persist` / LRU / live 指令 | 低 |
| `entrypoints/popup/*` | 常规页加「直播实时翻译 / ASR」开关与引擎 | 中：settings 是整份 payload，两处都要加控件 |
| `wxt.config.ts:8` | `permissions` + 可选 CSP | 中：审核 |
| 版本号 9 处 + `CHANGELOG.md` | 同步 | 低 |

### 7.3 不动

`utils/segmenter.ts`（只调用不改）、`caption-parser.ts`、`glossary.ts`、`packs.ts`、`models.ts`、`ai-track-cache.ts`、`db-cache.ts`（键格式不变）、`control-bar-button.ts`、`prompt-layers.ts`（**严禁新增层**）、`overlay.onTimeUpdate` / `findSentenceAt` 二分逻辑。

---

## 八、分阶段实施

> 全局纪律：每阶段开工前 `git fetch origin && git status -sb`（behind 就 `pull --ff-only`，ahead 或分叉停下问）；不自行 commit / tag / push；`npx tsc --noEmit` 必须 0 error；`npm test` 只看退出码；版本号 9 处同步。

| 阶段 | 内容 | 验收口径 | 依赖 / 回滚 |
| --- | --- | --- | --- |
| **P0** 基线 | 本文件入库；记录 `npm test` 基线 | `npm test` 退出码 0；打印项 1260 / 断言约 1341 与 README:88 一致 | 仅新增 md |
| **P1** 源抽象 + 直播判定 + CC 增量 | `utils/subtitle-source.ts`、`utils/live/*`、`timedtext-live-source`；bridge 加 `LIVE_STATE`；改 4+2 处闸门；`mode` 默认 `vod` | ①`test-live-cues.js` ≥40 条绿 ②`test-streaming-segmenter.js` ≥30 条绿 ③原 13 套件退出码 0 ④10 分钟有 CC 直播：cue 单调增长、无重复句、`stats().size ≤ 400`、堆波动 < ±5MB ⑤VOD 播放/切视频/seek/刷新与 0.4.3 一致 | 无依赖；删新文件 + 闸门改回 |
| **P2** 直播调度 + 浮层 partial | `live-scheduler.ts`；`translator.ts` persist / LRU / failed；`renderLivePair` + `.live-tail` | ①`test-live-scheduler.js` ≥25 条绿 ②`test-vsr-styles.js` 仍绿（filter 声明数 0）③50 句样本 P50 < 3.0s、P90 < 4.5s ④10 分钟直播后抽屉节点 ≤ 3000 ⑤断网 30s 注入无 >8s 排队 | 依赖 P1；`liveMode:'off'` 退回只显原文 |
| **P3** 云端 ASR | `offscreen/*`、`utils/asr/*`（除 whisper-local）、worklet、background 4 个 case、权限 | ①`test-asr-timebase.js` + `test-wav-encoder.js` 绿 ②无 CC 直播首条译文 P50 ≤ 4.5s、10 分钟不断流 ③**开 ASR 后本机仍有声**（passthrough）④广告期零转写、结束 1s 内恢复 ⑤seek ±60s 不串字幕 ⑥关 tab 5s 后 `getContexts` 为空 ⑦两份 build manifest 均含 offscreen / tabCapture | 依赖 P1；`asrEnabled:false` 默认，权限可整块移除 |
| **P4** 本地 Whisper | `whisper-local.ts` + `wasm-unsafe-eval` CSP | ①断网 + `local` 仍出字幕 ②模型加载有进度、失败有明确错误 ③常驻 + 峰值 < 300MB ④持续识别 < 70% 单核 ⑤同一 `SttChunk` 两实现返回同构 `SttResult` | 依赖 P3 接口；分支 + CSP 一起移除 |
| **P5** UI / 文档 / 版本 | options 第 9 分区、popup 控件、`test-options-ui` 8→9、`test-live-settings.js`、README 计数、CHANGELOG、版本 9 处 | ①options-ui 全绿 ②popup-ui 仍绿（4 页签不变）③`asrCustomApiKey` 不出现在 `memory.sync[SETTINGS_KEY]` ④两产物版本一致 ⑤`npm test` 退出码 0 | 依赖 P2/P3/P4；分区可独立回退 |

```
P0 ──► P1 ──► P2 ──┬──► P3 ──► P4
                   └──► P5 ◄── P3/P4
```

### 8.1 新增设置项（`types/index.ts` + `DEFAULT_SETTINGS`）

```ts
// 直播
liveMode: 'auto' | 'off';                                   // 'auto'
liveSourcePriority: 'cc-first' | 'asr-first' | 'asr-only';  // 'cc-first'
liveTailGuardMs: number;                                    // 250  (150–600)
liveBatchMax: number;                                       // 2    (1–3)
liveTimeoutMs: number;                                      // 8000 (5000–15000)
liveMaxLagMs: number;                                       // 12000 (5000–30000)
liveAllowFreeFallback: boolean;                             // false
// ASR
asrEnabled: boolean;                                        // false
asrEngine: 'cloud' | 'local';                               // 'cloud'
asrProvider: 'openai' | 'gemini' | 'custom';                // 'openai'
asrEndpoint: string;                                        // ''（openai/gemini 用官方端点）
asrModel: string;                                           // 'gpt-4o-mini-transcribe'
asrLanguage: string;                                        // ''（空 = 用 currentSourceLang）
asrChunkMs: number;                                         // 2000 (1500–4000)
asrHopMs: number;                                           // 1000 (500–2000)
asrVadSilenceMs: number;                                    // 600  (300–1500)
asrLocalModel: 'tiny' | 'base';                             // 'tiny'
```

> 控件成本控制：`asrChunkMs / asrHopMs / asrVadSilenceMs` 可在界面上合并为"低延迟 / 均衡 / 准确"三档预设，但字段保留，便于清洗与测试。

### 8.2 新增消息（`types/index.ts:331` union 追加）

```ts
| { type: 'ASR_START'; payload: { tabId?: number; settings: ExtensionSettings } }
| { type: 'ASR_STOP'; payload: { reason: string } }
| { type: 'ASR_STATE'; state: 'starting'|'running'|'degraded'|'error'|'stopped'; reason?: string }
| { type: 'ASR_NEED_GESTURE' }
| { type: 'ASR_TRANSCRIPT'; payload: { seq: number; text: string; wallStartMs: number; wallEndMs: number;
                                      segments?: Array<{startMs:number;endMs:number;text:string}> } }
| { type: 'LIVE_STATE'; isLive: boolean; isLiveNow: boolean; isAd: boolean }
```

`TRANSLATE_BATCH` 响应扩展（向后兼容）：

```ts
sendResponse({ success: true, translations: detail.translations, failed: detail.failed, service });
```

### 8.3 新增测试文件（6 个，纯函数优先）

| 文件 | 估断言数 | 关键用例 |
| --- | --- | --- |
| `test/test-live-cues.js` | ~40 | 重复窗口去重、前缀扩展合并、窗口回退保留长文、400 上限裁剪、seek 不清 buffer、`consumedUpToMs` 单调 |
| `test/test-streaming-segmenter.js` | ~30 | stable / tail 切分、同 `startMs` 不重复 append、扩展走 revise、tailGuard 生效 |
| `test/test-live-scheduler.js` | ~25 | batch ≤ 3、并发 ≤ 1、`maxLagMs` 丢弃、超时 0 重试、`persist:false` 不落库 |
| `test/test-asr-timebase.js` | ~30 | 线性映射、两档漂移、seek rebase、paused 丢弃、倍速换算 |
| `test/test-wav-encoder.js` | ~10 | RIFF 头字节、16k/16bit 长度、奇数样本补齐 |
| `test/test-live-settings.js` | ~12 | 新枚举回落、clamp、`asrCustomApiKey` 不落 sync |

---

## 九、待验证技术点

| ID | 待验证 | 影响 | 验证方法 |
| --- | --- | --- | --- |
| V1 | WXT 0.21 产出 offscreen entrypoint | 已核实：`PATH_GLOB_TO_TYPE_MAP` 的 `*/index.html → unlisted-page`，`entrypoints/offscreen/index.html` 产出 `offscreen.html`，无需 manifest 声明 | 落地后查 `.output/*/offscreen.html`，再实测 `createDocument({url:'/offscreen.html'})` |
| **V2** | `tabCapture.getMediaStreamId({targetTabId})` 在 Edge 156 是否需用户手势 / `activeTab` | **阻塞 P3** | 最小复现扩展（仅 `offscreen` + `tabCapture`），不点图标直接调；失败则加点击路径。Chrome / Edge 各测一次 |
| **V3** | 截获的 `pot` 能否复用到 `&t=` 续拉 | 只影响"加速路径"，被动路径不受影响 | MAIN world 用捕获 URL 原样 fetch，再换 `&t=+5` 重放，比 `events.length`，5 次成功率 |
| V4 | tabCapture 是否导致 tab 静音 | 决定 passthrough 是否必须 | 不接 `destination` 听一次，再接听一次 |
| V5 | 采集后切换输出设备声音是否跟随 | 体验 | Windows 切设备观察 |
| V6 | `wasm-unsafe-eval` 在 Edge 的 CSP 行为 | 阻塞 P4 | 加 CSP 后 offscreen `WebAssembly.compile()` 看是否 `CompileError` |
| V7 | Gemini inline 音频真实上限 | 分片大小 | 1 / 5 / 10 / 15 / 20MB 逐步放大，记首次 400 阈值 |
| V8 | `MediaElementSource` 在 YouTube MSE 上是否静音 | 仅为结论背书 | 控制台实验（有无声、切视频后是否永久失声），**只做实验不进生产** |
| V9 | `chrome.runtime.getContexts` 在 Edge 的最低版本 | offscreen 判存 | `typeof chrome.runtime.getContexts` 判空，降级 `hasDocument` |
| V10 | 直播 timedtext 窗口实际刷新频率 | 决定被动通路是否够用 | hook 里打时间戳，统计 10 分钟请求间隔分布 |

---

## 十、红线与风险

1. **VOD 行为不能变**：所有直播逻辑由 `mode`（默认 `vod`）+ `liveMode` 双重开关保护；`processCaptionData` 只做"搬移 + 分发"。
2. **prompt 骨架不能动**：不新增 `PromptLayerKey`，直播指令只走 `extraInstruction`，否则全量用户 IDB 缓存失效。
3. **VSR 红线**：`.live-tail` 只用 `opacity` / `color`，`filter` / `backdrop-filter` 声明数必须为 0。
4. **Key 只落 local**：新 Key 必须进 `SECRET_FIELDS`；content 侧不新增 Key 字段（现有 settings 整份过消息通道已能读到 Key，属既有风险，本轮不扩大）。
5. **tabCapture 审核风险**：ASR 默认关闭、首次明确同意、文档登记数据流向。
6. **最大不确定性**：V2 与 V3。若 V2 失败，ASR 路径降级为"必须用户点击扩展图标后才启动"；若 V3 失败，直播只走被动截获（依然可用，只是最坏情况下窗口刷新更慢）。

---

## 十一、待确认（不自行决策）

1. **本地 Whisper 的实现选型**：`whisper.cpp` 的 WASM 构建（体积小、需自己编 wasm + 绑定）vs `@huggingface/transformers` + `onnxruntime-web`（工程量小，但**引入运行时第三方依赖**，与"运行时无第三方依赖"的现状冲突）。选后者需明确接受该约束变更。
2. **ASR 相关 Key 是否复用现有 `providerKeys`**：默认复用 `providerKeys.openai` / `providerKeys.gemini`；仅自定义端点需要独立的 `asrCustomApiKey`。
3. **`liveMode` 是否默认 `'auto'`**：若默认开，所有直播观众（含无 CC、未配 ASR Key 的用户）都会看到"实时模式"提示，需确认是否接受。
4. **断句金标集**（`docs/断句金标集标注任务包.xlsx`）仍未标注，直播/ASR 的断句质量只能靠人工听感验收，无法给 P/R/F1。
