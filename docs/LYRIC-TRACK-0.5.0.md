# 歌词轨（逐词字幕）识别 + 零宽清洗 + 字符级时间估算

> 日期：2026-11-09
> 基线：`E:\Antigravity\youtube-translation-plugin`，HEAD `bf0e511`（`v0.4.3-2-gbf0e511`），`package.json` 0.4.3，开工时与 `origin/master` 同步、工作区干净。
> 本轮**只做纯逻辑层**（`utils/` 下新增两个文件 + `test/` 新增一个套件 + 本文）。**未 commit / tag / push**，版本号保持 0.4.3。
> 渲染（`entrypoints/`）、翻译、术语库、模型、packs 一行未动。

---

## 一、前提事实（实测，本轮作为前提，不重新推翻）

样本：`D:\edge\_ui\yt-probe\captured.json` —— 单条 848 KB 的 `/api/timedtext?...&fmt=json3` 响应（视频 `Mfcj1AdnzhQ`，hololive FLOW GLOW《BOUNCE BACK！》，官方歌词轨 —— URL 上挂着 `caps=asr`，项目内历来记作 `a.ja`）。

| # | 事实 | 本轮复核结果 |
| --- | --- | --- |
| 1 | 只拿得到 `fmt=json3`；带 `pot` 的 URL 换 fmt → 200 + 0 字节 | 一致（`manual.json` / `fmt-probe*.json` 里 srv3 / vtt / srv1 全是 `len:0`） |
| 2 | ~~json3 没有颜色字段，颜色是播放器端渲染的~~ **【2026-11-10 纠正，原结论是错的】** 颜色就在 `pens[].fcForeColor`（24bit `#RRGGBB`），逐字下发 | **反证**：231 支笔中 230 支带 `fcForeColor`（第 0 支为 `{}`）。正文按字符数：`#FEFEFE` 11600（未唱）、`#37BABA` 3502、`#71E5FF` 3350、`#FE3480` 2386、`#FF90CC` 2206、`#F58017` 1558。`tStartMs=10828` 的 event 内部逐字变色：`O`=#71E5FF → `k`=#7ADFFB → `a`=#83D9F8 → … → 后缀 `there be there be`=#FEFEFE |
| 3 | **本样本 Mfcj1AdnzhQ 的日本歌词轨**（`caps=asr`）`tOffsetMs` 全为 0 | 一致：该轨 14288 个 seg，正数 `tOffsetMs` 计数 **0** |
| 4 | 零宽 U+200B 恒定 7–13 个/event，不是逐字进度标记；1238 event 里文本高度重复 | 一致：不可见字符 8966 / 39208 = **22.87%**；去零宽后唯一文本 **62** / 1238 = **5.01%** |

> **适用范围（0.5.0 阶段 B 补充）**：事实 3 与本文所有「`tOffsetMs` 全 0 / 没有官方字级时间」的表述，**只针对 Mfcj1AdnzhQ 这一条日本歌词轨**，不是所有 `caps=asr` / 自动轨的共性。实测另两条普通 ASR 轨恰恰带正数 `tOffsetMs`（英文 XGxIE1hr0w4：378 词 / 313 个正数偏移；日文 VyV7nxzYEqA：275 词 / 237 个正数偏移，仅此 1 个日文样本、不外推），词级时间可直接读取、无需帧推断。两套机制的完整对照见 `docs/LIVE-AND-ASR-0.5.0.md`。

补充实测（本轮新测，供调参参考）：

| 指标 | 实测值 |
| --- | --- |
| event 数 | 1238 |
| seg 总数 / 平均 seg/event | 14288 / **11.5** |
| 平均 event 时长 | **370.3 ms**（dDurationMs 全部 > 0，无缺失） |
| 轨道时间跨度（maxEnd − minStart） | **214.0 s**（视频 241 s） |
| event 密度 | **5.79 个/秒**（分母用轨道跨度；任务书按视频 241s 算得 5.14，两者都远 > 阈值 3） |
| 纯零宽 event（剥完变空串） | **0** |
| 同一毫秒重复帧（同一句的两个着色笔） | 有，例：`tStartMs=7524` 连出 2 帧，`pPenId` 不同 |

> 关于事实 4 的一个**修正结论**：这些重复帧并不是「同一句被切成多个 event」，而是**同一句的卡拉OK 着色状态序列**（每帧换一支笔）。所以折叠的正确单位是「文本 + 连续时间窗」，不是单纯的文本去重——否则副歌重复出现会把一行拉成整首歌那么长（见 §四）。

---

## 二、新增文件与职责

| 文件 | 职责 | 体积 |
| --- | --- | --- |
| `utils/invisible-text.ts` | 不可见字符清洗（纯字符串处理） | 小，零依赖 |
| `utils/lyric-track.ts` | 歌词轨识别 + 去重合并 + 字符级时间估算 | 中，只依赖上一个文件与 `types/` |
| `test/test-lyric-track.js` | 119 条断言 + 前 3 句字符时间表可视化 | 新增套件 |
| `test/fixtures/lyric-track-sample.json` | 实测样本的紧凑夹具（见 §六；v0.5.x 补了 `pens` 231 支，才能读颜色） | 452 KB |

### 2.1 `utils/invisible-text.ts`

```ts
export function isInvisibleChar(ch: string): boolean;      // 单字符判定
export function hasInvisible(text: string): boolean;       // 是否含不可见字符
export function countInvisible(text: string): number;      // 精确计数（算占比用）
export function removeInvisible(text: string): string;     // 只剥，不动空白（下标对齐用）
export function stripInvisible(text: string): string;      // 剥 + 压空白 + trim
```

- 剥的字符集**只有**这 7 个：`U+200B U+200C U+200D U+200E U+200F U+FEFF U+2060`。
- **不做**任何标点改动：不清理 `，。`、不补句号、不做全半角转换 —— 那属于断句层，混进来会让指标无法归因。
- 连续空白压成一个半角空格，去首尾空白；全角空格 `U+3000`、NBSP `U+00A0` 一并归一（它们在 JS 的 `\s` 里，属于「空白压缩」而非「标点改动」）。
- 刻意**不**处理 `U+00AD` 软连字符、`U+2028/2029`、`U+3164` 填充符（不在本任务口径内；韩语本版不做专项）。
- `removeInvisible` 单独存在的理由：真实字级偏移分支里字符下标必须与 `seg.utf8` 严格对齐，一旦压缩空白就错位。字符清单仍只有一份，避免两个文件各写一遍零宽表后漂移。

### 2.2 `utils/lyric-track.ts`

```ts
// 识别
export function detectLyricTrack(data: Json3CaptionData, hint?: LyricTrackHint): LyricTrackVerdict;

// 去重合并
export function dedupeLyricEvents(data: Json3CaptionData): LyricDedupeResult;
export function toCaptionData(lines: LyricLine[], options?: { perLine?: boolean }): Json3CaptionData;
export function lyricKeyOf(text: string): string;

// 字符时间
export function estimateCharTimings(input: CharTimingInput): CharTiming[];
export function charWeight(ch: string): number;
export function buildLineCharTimings(line: LyricLine, display: LyricDisplay): CharTiming[];
export const CHAR_WEIGHTS;   // { cjk: 1.0, latin: 0.55, digit: 0.6, space: 0.25, punct: 0.15 }
```

`Json3CaptionData` / `Json3Seg` / `Json3Event` 直接用 `types/index.ts` 里已有的定义，**没有新增类型**到 `types/`。`utils/segmenter.ts` **一行没改**（没有需要加的导出）。

---

## 三、歌词轨识别：信号权重表与实测命中

`confidence = 命中信号权重和 / 总权重（13）`；`isLyric = confidence >= 0.6 且命中信号数 >= 3`。

| 信号 key | 权重 | 命中条件 | 实测值 | 命中 |
| --- | --- | --- | --- | --- |
| `time-density` | 3 | eventsPerSec > 3 | 5.79 | ● |
| `repeat-ratio` | 3 | uniqueRatio < 0.35 | 0.050 | ● |
| `invisible-density` | 2 | invisibleRatio > 0.03 | 0.2287 | ● |
| `short-event` | 2 | 0 < avgEventMs < 900 | 370.3 ms | ● |
| `asr-kind` | 1 | `kind === 'asr'` 或 vssId 指向自动轨 | `asr` / `a.ja` | ● |
| `no-char-time` | 2 | segsPerEvent >= 3 **且** 正数 tOffsetMs 数 == 0 | 本样本 11.5 / 0 | ● |

**实测判定（仅 Mfcj1AdnzhQ 歌词轨）：`isLyric = true`，`confidence = 1.000`（13/13），6 条全中。**

> `no-char-time` 这一行是**本样本**的实测值。普通 ASR 轨带正数 `tOffsetMs`（英文 313 / 日文 237），该信号对它们不命中；识别口径不变，只是不能把「本样本 11.5 / 0」当成所有 asr 轨的共性。

### 3.1 为什么加权而不是单条硬阈值

`no-char-time` 与 `asr-kind` 这两条在**普通 CC 轨**上也很容易成立（手动轨没有 `tOffsetMs`、自动生成轨遍地都是）。若用「任一命中即判」，会把一大堆正常字幕误判成歌词轨。所以这两条只给 1–2 分；只有「文本高度重复 + 密度高 + 时长短 + 满屏零宽」这种**组合**才能把 confidence 推过 0.6。

> **0.5.0 阶段 B 补充（判断不变，只补边界）**：这里的「自动生成轨」包含两类机制不同的轨 —— 本样本这种「偏移全 0 + 笔色」的日本歌词轨，以及**普通 ASR 轨恰恰带正数 `tOffsetMs`**（英文 313 / 日文 237 个，见 `docs/LIVE-AND-ASR-0.5.0.md`）。`asr-kind` 对两者都命中、权重仍只有 1 分；但 `no-char-time` 只对前者命中。二者不可混为一谈，加权组合的判定逻辑不变。

### 3.2 反例验证（必须判 false）

| 反例 | confidence | 命中信号 | 结果 |
| --- | --- | --- | --- |
| 4 句手工 CC（30s，唯一文本、零零宽、每句 3s） | 0.000 | 0 | `false` ✓ |
| 40 event 自动轨，每 seg 都带真实 `tOffsetMs` | 0.077 | `asr-kind` | `false` ✓ |
| 空轨 / 0 字节响应（`{}`） | 0.000 | — | `false` ✓ |
| 1.5s 塞 6 句正常短句（密度 3.87、avg 250ms） | 0.385 | `time-density` + `short-event` | `false` ✓ |

最后一行是专门设计的边界：密度和时长信号都命中，但没有重复 → 2 条命中（< 3）且 0.385 < 0.6，仍判 false。**权重表把「重复」当成不可替代的一票。**

### 3.3 口径修正（重要，与任务书表述不一致的两处）

1. **`vssId` 形态**：任务书写「`vssId` 以 `.a` 结尾」。实测 YouTube 用的是**前缀**：手动轨 `.ja`、自动轨 `a.ja`（`D:\edge\_ui\yt-probe\info.json` 三条轨全是这个形态）。所以实现兼容 `^a\.` 与 `\.a$` 两种写法，避免照着错误描述写得永不命中。
2. **`eventsPerSec` 分母**：用**轨道自身时间跨度**（maxEnd − minStart = 214.0s），不用视频总长 241s。理由：直播 / 切片拿不到 `duration`，且本仓《LIVE-AND-ASR-0.5.0》已确认「全仓不读 duration」。两种口径分别是 5.79 与 5.14，对结论无影响。
3. **`no-char-time` 的「seg 数 >= 3」**：按**平均 seg/event >= 3** 实现。「seg 总数 >= 3」对任何字幕轨都恒真（会变成永远命中），没有区分力。实测 11.5，普通 CC 约 1–2。

---

## 四、去重与合并：1238 → 62

比较键 = `stripInvisible` + 去尾标点（`lyricKeyOf`）。**句中**标点保留在键里（它参与断句，动它会越界）。

| 项 | 实测 |
| --- | --- |
| 输入 event | 1238 |
| 输出行（唯一文本） | **62**（目标 62 ± 3，偏差 **0**） |
| 折叠率 | 94.99% |
| occurrences 总数 | 1238（**一个 event 都没丢**） |
| 单行最多出现次数 | 72 次 |
| 屏幕显示段总数 | **143** |
| 出现多段的行 | 14 行（最多一行出现 15 次 —— 副歌） |
| 每行文本字数合计 | 1278 字（平均 20.6 字/行） |

### 4.1 为什么还保留 `displays`：一个真实的坑

单纯按文本键合并会踩坑：副歌在 20s 和 200s 各出现一次，**同键**，于是 `endMs` 被撑到整首歌那么长（本样本实测会产出 **130.6s / 166.4s 的单行**），下游拿它做字符均分就是「一个字亮 5 秒」。

所以合并分两级：

- **行**（`LyricLine`，62 条）= 文本维度，`startMs` 取最早出现、`endMs` 取**第一段**显示的结束；
- **显示段**（`LyricLine.displays`，143 条）= 时间维度，**连续**同键帧算一段（无阈值、不靠 gap 猜：karaoke 帧在数组里天然连续）。

实测收益：行时长 p50 **1701ms** / p90 **2903ms** / max **10677ms** / min **166ms**；不再出现跨整首歌的怪物行（测试断言「没有任何一行 > 15s」）。

> 曾试过用「同键相邻帧间隔 > 1200ms 就断段」，但实测帧间隔 p90 已达 1035ms、p95 5005ms，阈值法两者都不可靠。改用「数组里连续同键」判段后不需要任何阈值。

### 4.2 下游兼容

`toCaptionData(lines)` 保持 `Json3CaptionData` 形状（一段显示 = 一个 event，所以 62 行 → 143 个 event，`perLine: true` 则 62 个）。渲染层与断句层都不用改结构。

---

## 五、字符级时间估算

### 5.1 权重与边界

| 类别 | 权重 | 备注 |
| --- | --- | --- |
| CJK（汉字 / 假名 / 谚文） | 1.00 | 判定顺序在空格、数字、标点之后，避免 `。`（U+3002，落在 CJK 符号区）拿到 1.0 |
| 拉丁字母及其他字母 | 0.55 | |
| 数字（半角 + 全角） | 0.60 | |
| 空格（半角 / 全角 / NBSP） | 0.25 | 只停留、不发声 |
| 标点与符号（`\p{P}` + `\p{S}`） | 0.15 | |

优先级（严格按序）：

1. **seg 全部带正数 `tOffsetMs`** → 用真实值，`estimated: false`；
2. **过短句**（句时长 < 400ms **或** 字符数 < 3）→ 整句一个时间片，`estimated: true`（防「字闪一下」）；
3. 其余 → 权重归一化切分，`estimated: true`；
4. 兜底：`span < 字符数`（每字符连 1ms 都分不到）→ 整句一片，不伪造字边界。

分配算法（`allocateByWeight`）：每片先给 1ms，剩余 `span − n` 按**最大余数法**分配。三条硬性质由构造保证：每片 ≥ 1ms（边界**严格**递增）、总和**精确**等于 span、首尾与句边界对齐。不用浮点累加，避免累积误差导致末片越界。

### 5.2 实测前 3 句（`npm test` 的 stdout 可视化，相对句首 ms）

```
行「Okay, be there be there back to」  7524–15532ms（8008ms, 48 帧）
 O[0-297) k[297-594) a[594-891) y[891-1188) ,[1188-1270) ␠[1270-1405) b[1405-1702) e[1702-1999)
 ␠[1999-2134) t[2134-2431) h[2431-2728) e[2728-3025) r[3025-3322) e[3322-3619) ␠[3619-3754) b[3754-4051)
 …

行「3,2,1」  15532–17134ms（1602ms, 6 帧）
 3[0-458) ,[458-573) 2[573-1030) ,[1030-1145) 1[1145-1602)

行「Okay, yea」  17134–18168ms（1034ms, 6 帧）
 O[0-134) k[134-268) a[268-402) y[402-536) ,[536-573) ␠[573-634) y[634-768) e[768-901) a[901-1034)
```

读起来**合理**的部分：字母拿满权重、逗号 82ms、空格 135ms，比例正确；第 2、3 句 320ms / 115ms 每字符，符合念白节奏。

**不合理也需要讲清楚的部分**：第 1 句 8008ms / 31 字符 = 258ms 每字母，偏慢。原因不是算法，是**数据**：这一行的 48 帧覆盖了 8 秒（引子处的重复 ad-lib），而实际唱出来只有不到 1 秒。我们能确定的只有「这一行在屏幕上挂了 8 秒」，字在 8 秒里怎么分布是未知的。当前实现按「均分整个显示窗口」处理 —— 这是**保守且诚实**的选择（宁可亮得慢，也不要猜错位置后与音频错位）。

---

## 六、夹具说明（可复算）

`test/fixtures/lyric-track-sample.json` = `captured.json` 里那条 848KB json3 的**紧凑化**版本：

- 保留 `wireMagic` + 每个 event 的 `tStartMs` / `dDurationMs` / `segs[].utf8`；
- 丢弃 `pens` / `wsWinStyles` / `wpWinPositions` / `pPenId` / `wpWinPosId` 等渲染样式字段（识别与去重一个都不用）；
- **event 数 1238、seg 数 14288、字节内容（utf8）与原始响应完全一致**，所以 `0.0501` / `0.2287` / `370.3` / `62` 这些数字都能在仓库内复算，不依赖 `D:` 盘的外部文件。

生成方式（一次性，node 直接跑）：

```js
const probe = JSON.parse(fs.readFileSync('D:/edge/_ui/yt-probe/captured.json', 'utf8'));
const src = JSON.parse(probe[0].text);
const slim = {
  wireMagic: src.wireMagic,
  events: src.events.map((e) => ({
    tStartMs: e.tStartMs,
    dDurationMs: e.dDurationMs,
    segs: (e.segs || []).map((s) => ({ utf8: s.utf8 }))
  }))
};
fs.writeFileSync('test/fixtures/lyric-track-sample.json', JSON.stringify(slim));
```

---

## 七、与渲染层（另一个子智能体）的接口约定

渲染侧**只需要 import 两个函数**，不要自己算时间：

```ts
import { detectLyricTrack, dedupeLyricEvents, buildLineCharTimings } from '@/utils/lyric-track';

const verdict = detectLyricTrack(captionData, { kind: track.kind, vssId: track.vssId });
if (!verdict.isLyric) { /* 走普通字幕路径，零改动 */ }

const { lines, stats } = dedupeLyricEvents(captionData);
// lines: 62 条，按 startMs 升序
// 每行 → 若干显示段（副歌会多段）。画卡拉OK 时按段推进：
for (const display of line.displays) {
  const timings = buildLineCharTimings(line, display); // CharTiming[]，连续无重叠
}
```

约定细节：

| 项 | 约定 |
| --- | --- |
| 文本 | `line.text` 已**零宽全清、空白压缩、无首尾空白**；标点原样保留（未修补，渲染层不要补句号） |
| 时间基准 | 毫秒，与 `video.currentTime * 1000` 同一基准，不做任何偏移；浮层既有的 `ACOUSTIC_LEAD_IN_MS` 由渲染层自己决定是否加 |
| 显示段 | `endMs - startMs` 是该行**在屏幕上停留**的时长（p50 1701ms / max 10677ms），不是演唱时长 |
| 字符时间 | `CharTiming[]` 连续、无重叠、严格递增、首尾与段边界对齐；渲染层可安全按 index 推进，不需要防重叠 |
| `estimated` | 本样本**恒为 true**（该轨没有任何字级时间）。UI 若要做「卡拉OK 精度」提示，看这个字段 |
| `char` | 正常情况是单字符；短句（< 400ms 或 < 3 字）时**是整句**，渲染层需按 `timing.char.length` 而不是 1 处理 |
| 空/异常 | `event` 为 0 时 `detectLyricTrack` 返回 `confidence 0 / isLyric false`，不抛错 |
| 性能 | 全是 O(n) 字符串扫描，1238 event 实测 `detectLyricTrack` ≈ 3ms、`dedupeLyricEvents` ≈ 3–12ms（首次含 JIT 预热），合计 < 15ms；不需要缓存层 |

红线提醒：渲染层**不要**因为拿不到字级时间就自己去猜；`estimated: true` 就是「这是估算」的正式声明。

---

## 八、验证记录

| 项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **0 error**（退出码 0） |
| `npm test` | **EXIT=0** |
| 新增套件 `test-lyric-track.js` | **119 通过 / 0 失败** |
| 打印项变化 | 1260 → **1379**（+119）；断言约 1341 → **约 1460** |
| 既有套件 | 全绿，无一条因本轮改动变红 |

**这个数字变化需要有人跟进（见 §九-1）**：`README.md:88` 与 `docs/LIBRARY-BASELINE.json` 里写的仍是 `1260 / 约 1341`，本轮**不许改**这两处（README 不在允许改动范围，锚点描述的是云端资料库现状），所以现在 `npm run doc:check -- --full` 会报计数不一致。请质量组在同步资料库时把两处一起改成 `1379 / 约 1460`。

### 8.1 覆盖清单（对应验收项）

| 验收要求 | 对应断言 |
| --- | --- |
| 实测样本 `isLyric === true` / `confidence >= 0.6` | ✓（1.000） |
| `stats.events === 1238` | ✓ |
| `uniqueRatio < 0.35` | ✓（0.0501，另加「≈0.0501」的紧断言） |
| 去重后 62 ± 3 | ✓（62，另加「=== 62」） |
| 零宽全清（`hasInvisible` false） | ✓（逐行断言 + occurrences 总数 1238 不丢 event） |
| 普通 VOD 反例 `isLyric === false` | ✓（4 组：手工 CC / 带真实偏移的 ASR / 空轨 / 高密度短片段） |
| 字符时间严格单调、无重叠、总时长 == 句时长 | ✓（`assertContiguous` 复用于 6 组用例） |
| 短句走整片分支 | ✓（300ms / 2 字符 / 空串 / 极窄区间） |
| CJK 比拉丁更均匀（数值断言） | ✓（cv 0.0000 vs 0.1769；CJK 每字符时长差 ≤ 1ms） |

---

## 九、未解决项与风险

**事实**

1. `README.md:88`（1260 / 约 1341）与 `docs/LIBRARY-BASELINE.json`（printed 1260 / assertions 1341）已过期，实际为 1379 / 约 1460。本轮按纪律未改，`npm run doc:check -- --full` 会红。
2. **本样本 Mfcj1AdnzhQ 日本歌词轨**的 `estimated` 永远为 `true`：该轨 14288 个 seg 无一个正数 `tOffsetMs`，没有任何官方字级时间可用（逐字真实时间改由笔色「首帧非白」推得，见 §十）。此结论不外推到普通 ASR 轨 —— 后者带正数 `tOffsetMs`，时间直接可读。
3. 第 1 行「Okay, be there be there back to」的显示窗 8008ms 远长于演唱时长，字符时间按整窗均分 → 258ms/字母，读起来偏慢（§5.2 已说明原因在数据）。
4. 单行最长 10677ms、最短 166ms；166ms 的行会走「整句一片」分支（< 400ms），此时 `char` 是整句字符串。
5. 本轮 `utils/segmenter.ts` **零改动**，因此 `，。` 伪影、相邻句重叠、>7.4s 占比、≥32 字占比这四组断句指标的口径与数值**完全不变**，无需复测；歌词轨路径尚未接入断句层。

**推断（未验证，别当结论）**

6. `pPenId` 很可能就是卡拉OK 的着色笔（每帧把已唱部分切到另一支笔）。若成立，则「某字符第一次被切到已唱着色笔的时刻」≈ 真实字级时间，能显著改善 §5.2 第 1 行的偏慢问题，也能把 `estimated` 降到 `false`。**本轮未实现**：需要先对多首歌验证笔序假设，否则等于用猜测替换猜测。
7. `displays` 的「连续同键」判段假设「同一句的着色帧在 event 数组里连续」。本样本成立（143 段，段间不重叠，已验证）；若某首歌出现帧交错（A、B、A 交替），会被切成 A/B/A 三段，属于保守方向的误切（多切不会丢文本），无数据损坏风险。
8. 识别阈值全部集中在 `THRESHOLDS` 与 `SIGNAL_WEIGHTS` 两个常量里，只有 1 首歌的正样本 + 4 组构造反例。**没有第二首歌的歌词轨样本**，阈值泛化性未验证；若遇到判 false 的真歌词轨，先看 `signals[].detail` 打印的实测值再调权重，不要直接改 `isLyric` 的通过线。

**边界（明确不做）**

9. ~~不做颜色解析（json3 无颜色字段，`pens` 只有字号/描边；颜色是播放器端渲染）。~~ **【2026-11-10 纠正】** 该结论与样本矛盾：`pens[i].fcForeColor` 就是 24bit 颜色，正文 230/231 支笔带值、逐字下发。v0.5.x 已实现读取与渲染，见 §十。
10. 不做韩语专项、不改 `types/index.ts`（复用既有 `Json3*` 类型）、不新增运行时依赖、不引入网络请求、不动 manifest 权限。

---

## 十、官方笔色与真实字级时间（v0.5.x，2026-11-10）

> **机制归属（0.5.0 阶段 B 补注）**：本节整节描述的是 **A 机制 · 歌词轨**（Mfcj1AdnzhQ 日本歌词轨）：重复帧 + `tOffsetMs` 全 0 + 231 支带色笔 → 逐字上色，逐字真实时间取「首帧非白」。
> 它**不适用于普通 ASR 轨**：后者是 **B 机制**，一次给全片 + 每词正数 `tOffsetMs` + `pens=[{}]`，词级时间直接可读、无需笔色，也不做逐字上色。
> 两者不可混为一谈，完整对照见 `docs/LIVE-AND-ASR-0.5.0.md`「A/B 两套机制」一节。

### 10.1 颜色数据在哪

`json3` 顶层 `pens` 是画笔数组（本样本 231 支，第 0 支为 `{}`），`seg.pPenId` 是数组下标：

| 字段 | 含义 |
| --- | --- |
| `fcForeColor` | 24bit `#RRGGBB`，正文颜色（230/231 支有值） |
| `szPenSize` / `etEdgeType` | 字号 / 描边类型 |
| `rbRuby` | 振假名专用笔的尺寸分级 |

正文按字符数：`#FEFEFE` 11600（**未唱**）、`#37BABA` 3502、`#71E5FF` 3350、`#FE3480` 2386、`#FF90CC` 2206、`#F58017` 1558。

### 10.2 逐字分层在**单个 event 内部**

不是跨 event 互补。同一句随时间重复下发，每个 event 内部**已唱前缀逐字各占一支笔**、**未唱后缀整段一支 `#FEFEFE`**：

```text
t=10828  O(#71E5FF) k(#7ADFFB) a(#83D9F8) y(#8DD4F4) ,(#96CEF1) b(#A9C3EA) e(#B3BDE7)
         └──────────────── 已唱，逐字变色 ────────────────┘  there be there be(#FEFEFE)
                                                            └──── 未唱，一段白 ────┘
```

已唱前缀逐帧变长：10828ms 6 字 → 11161 13 → 11495 18 → 11662 23 → 11795 28 → 12129 31。

### 10.3 真实字级时间

某字**第一次拿到非 `#FEFEFE` 颜色**的那一帧 `tStartMs`，就是它的起始时间。

- `extractLineColors(data, line)` → `{ colors, startMs, mainColor, isRainbow }`
- `attachCharColors(timings, info)` → 有笔色时用真实时间覆盖 `startMs/endMs`，`source='pen'`
- 本样本 62 行里 **42 行**拿到真实时间，其余退回 `CHAR_WEIGHTS` 估算（`source='estimated'`）

### 10.4 渲染规则

| 情况 | 行为 |
| --- | --- |
| 有官方笔色 | 建 span 时写内联 `style.color`，官方色**透传**，零配置 |
| 无笔色 · 未到该字 | `--k-pend` = 白 |
| 无笔色 · 已过/当前 | `--k-done` / `--k-cur` = 用户选的原文色（`k-cur` 另加光晕） |
| 译文轨 | **不上色**，保持现状 |

注意：`k-pend` 用 `!important` 把颜色压回白色 —— 否则内联色会让整行一打开就全亮，"未到=白"和"回退不残留全亮"都会失效。

颜色是**展示属性**：不进缓存键、不触发重新翻译。

### 10.5 与 `detectKaraokeHighlight` 的关系（避免再次误读）

该函数比的是「同一 `tStartMs` 的两条 event **文本是否互补**」，本样本判 `false`。

但逐字着色在**单个 event 内部**，所以 `hasHighlight=false` **不能推出"没有逐字着色"** —— 这条轨就是反例（同文本双套 606、互补 0，却有 996 个字符带笔色、3 行彩虹）。

因此 v0.5.x 起它**不再作为 karaoke 路径的门禁**，只输出诊断日志；是否走逐字由 `isLyric && settings.lyricKaraoke` 决定。
