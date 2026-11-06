# v0.2.3 改动说明（给 Antigravity 的交接文档）

> 项目：`E:\Antigravity\油管翻译插件`（WXT + TypeScript，Edge / Chrome MV3）
> 日期：2026-11-04
> 主题：修复「字幕检索功能完全失效、无法获取 YouTube 字幕」

---

## 一、结论摘要

本次不是网络问题，也不是跨域问题，而是**内容脚本启动期的 TDZ 崩溃**：

- `entrypoints/content/index.ts` 中 `setupPlayerAndOverlay()` 在 `main()` 第 69 行就被调用，
  函数体执行 `pipTextTrack = null`，但 `let pipTextTrack` 的声明在 12 行之后（原第 258 行）才求值。
- 运行时报 `ReferenceError: Cannot access 'pipTextTrack' before initialization`（压缩后变量名为 `E`），
  `main()` 在此中断，后续所有能力均未注册：
  - `window.addEventListener('message', ...)` 字幕消息监听（原第 520 行）
  - `video` 的 `timeupdate` 监听（字幕渲染的唯一驱动）
  - `startUrlWatchdog()` 与 `initDomCaptionObserver()`
- 表象就是：扩展图标存在、浮层宿主已创建，但字幕永远为空，Console 无任何取轨日志。

修复该崩溃后，又收敛了三处会导致「偶发失败 / 429 / 广告串台」的次生缺陷。

---

## 二、版本号变更（1.2.2 → 0.2.3）

| 文件 | 位置 |
|---|---|
| `package.json` | `"version"` |
| `package-lock.json` | 根 `version` 与 `packages[""].version`（原为 1.0.0，一并校正） |
| `wxt.config.ts` | `manifest.version` |
| `entrypoints/content/index.ts` | 启动 banner 字符串 |
| `entrypoints/youtube-bridge.content.ts` | 启动 banner 字符串 |
| `entrypoints/background.ts` | 启动 banner 字符串 |
| `entrypoints/popup/index.html` | 底部版本提示 |
| `CHANGELOG.md` | 新增 `[0.2.3]` 条目 |

已重新构建 `chrome-mv3` 与 `edge-mv3` 两套产物，`manifest.json` 的 `version` 均为 `0.2.3`。

---

## 三、代码改动明细

### 1) `entrypoints/content/index.ts` —— 修复 TDZ 崩溃（核心）

```diff
  let captionsWatchdogAttempts = 0;
  let cachedHostClientInfo: { apiKey?: string; clientVersion?: string } = {};
+ // 必须在 setupPlayerAndOverlay() 调用前完成声明，否则 TDZ 崩溃
+ let pipTextTrack: TextTrack | null = null;
+ // 单飞锁：防止多次 CAPTION_TRACKS_FOUND 广播触发多条并发的音轨拉取瀑布
+ let trackCascadeActive = false;
+ // 已消费的 token 数，允许更完整的截获结果覆盖先到的分片/广告字幕
+ let lastCaptionTokenCount = 0;

- let pipTextTrack: TextTrack | null = null;
  function getOrCreatePipTrack(): TextTrack | null {
```

### 2) `entrypoints/content/index.ts` —— 截获响应增加视频校验与覆盖策略

```diff
  } else if (event.data.type === 'CAPTURED_TIMEDTEXT_RESPONSE') {
    const { url, responseText } = event.data;
-   if (responseText && currentSentences.length === 0) {
+   if (!responseText) return;
+
+   // 广告/预加载也会走 timedtext，必须校验视频 ID
+   const capturedVid = (String(url).match(/[?&]v=([^&]+)/) || [])[1];
+   if (capturedVid && currentVideoId && capturedVid !== currentVideoId) return;
+
    const data = normalizeCaptionResponse(responseText);
    const tokens = extractCaptionTokens(data);
-   if (tokens.length > 0) {
+   if (tokens.length > 0 && tokens.length > lastCaptionTokenCount) {
+     lastCaptionTokenCount = tokens.length;
      processCaptionData(data);
```

### 3) `entrypoints/content/index.ts` —— 音轨兜底收敛为 3 条 + 单飞

```diff
  function handleCaptionTracks(tracks: YouTubeCaptionTrack[]) {
    if (!tracks || tracks.length === 0) return;
    if (currentSentences.length > 0) return;
+   if (trackCascadeActive) return;
+   trackCascadeActive = true;

    const candidateTracks = sortCaptionTracks(tracks);
-   console.log(`Candidate tracks (${candidateTracks.length})`, ...);
+   // YouTube 的 baseUrl 现需 pot 令牌才返回数据，逐条试 41 条只会触发 429
+   const MAX_CANDIDATES = 3;
+   const maxAttempts = Math.min(candidateTracks.length, MAX_CANDIDATES);
+   console.log(`Candidate tracks (${candidateTracks.length}), will try ${maxAttempts}:`, ...);
```

成功 / 失败 / 耗尽三条路径均调用 `finishCascade()` 释放锁；
`handleVideoChange()` 中同时重置 `lastCaptionTokenCount` 与 `trackCascadeActive`。

### 4) `entrypoints/youtube-bridge.content.ts` —— 修复内部 tracklist 污染

`player.getOption('captions','tracklist')` 返回的内部音轨对象**不含 `baseUrl`**。
旧逻辑只看 `list.length > 0` 就采纳，导致后续 5 重兜底全部跳过，最终 `filter(!!baseUrl)` 得到空数组，
广播 `tracks: []`，内容脚本自然拿不到任何音轨。

```ts
function normalizeTracks(list: any): any[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => ({
      baseUrl: t?.baseUrl || t?.url || '',
      name: t?.name || { simpleText: t?.languageName || t?.languageCode || 'Caption' },
      vssId: t?.vssId || '',
      languageCode: t?.languageCode || t?.lang || '',
      kind: t?.kind,
      isTranslatable: t?.isTranslatable ?? true
    }))
    .filter((t) => !!t.baseUrl);
}

// 六路来源逐一路由，只有真正带 baseUrl 才采纳
for (const getTracks of providers) {
  try {
    const tracks = normalizeTracks(getTracks());
    if (tracks.length > 0) return tracks;
  } catch (e) {}
}
```

### 5) `entrypoints/background.ts` —— ANDROID 兜底客户端版本

```diff
- clientName: 'ANDROID', clientVersion: '19.09.37'
+ clientName: 'ANDROID', clientVersion: '20.10.38'
```

实测：`19.09.37` → HTTP 400；`20.10.38` → 200，返回 41 条 captionTracks。

---

## 四、根因证据（真实请求实测）

### 1. 崩溃证据（Edge 156 实机）

```
ReferenceError: Cannot access 'E' before initialization
    at w (chrome-extension://<id>/content-scripts/content.js:1867:1376)
    at y (chrome-extension://<id>/content-scripts/content.js:1867:41)
    at main (chrome-extension://<id>/content-scripts/content.js:1861:617)
```

对应压缩代码片段：`o=r,E=null,o.addEventListener('timeupdate',M)...`
即 `videoElement = video; pipTextTrack = null;` —— `E` 就是 `pipTextTrack`。

### 2. timedtext 鉴权证据

| 请求方式 | 结果 |
|---|---|
| 直接 GET `captionTracks[0].baseUrl + &fmt=json3` | `200`，**0 字节**，`content-type: text/html` |
| 携带 `pot` 的播放器原生请求 | `200`，`41,348` 字节（TED）/ `176,613` 字节（长回放） |
| 播放器响应 URL 参数 | `potc=1&pot=...&c=WEB&cver=2.20261030.02.00&fmt=json3` |
| `player.getPlayerResponse()` 里的 baseUrl | `pot` 检测结果为 `false` |

结论：**baseUrl 自身不可直接复用**，必须依赖对播放器响应的零拷贝截获。
跨域不是原因：扩展具备 `host_permissions`，失败形态是 200 空响应而非 CORS 报错。

### 3. 音轨污染证据

修复前页面日志反复出现 `CAPTION_TRACKS_FOUND` 且 `tracks` 长度为 `0`，
而 `player.getPlayerResponse()` 明明有 41 条 —— 正是内部 tracklist 抢先占位所致。

---

## 五、验证记录（已实际执行）

| 项目 | 结果 |
|---|---|
| `npm run compile` | 通过，0 error |
| `npm run build:chrome` | 通过，2.3s，`.output/chrome-mv3/manifest.json` version=0.2.3 |
| 修复前（Edge 实机） | 抛 TDZ 异常，浮层永久空白，无取轨日志 |
| 修复后 TED 视频 | 41,348 字节 → 363 tokens → **148 句**，原文/译文正常 |
| 修复后 Vivi 回放 `XMJi8I_9pp4` | 176,613 字节 → **4114 句**，浮层显示 `うふ 。` / `呵呵。` |
| 修复后无字幕视频 | 正常提示「暂未检测到字幕轨道」 |

> 说明：Vivi 的 `wnjd9XuuXg0` 是 422 天后的预约直播，`8a_G_WJL-RE` 的 `captionTracks` 为 0，
> 这两条本身没有字幕，不能作为插件失败的判据。可用 `XMJi8I_9pp4`（ARK #25，ja/asr）验收。
> 另：后台标签页中 YouTube 播放器可能根本不发起 timedtext 请求，验收时请保持标签页在前台。

---

## 六、验收步骤

```bash
cd E:\Antigravity\油管翻译插件
npm run compile
npm run build:chrome
```

1. 打开 `edge://extensions/`，开启开发人员模式，重新加载 `.output/chrome-mv3`（或点卡片上的「重新加载」）。
2. 打开 `https://www.youtube.com/watch?v=XMJi8I_9pp4`，保持标签页在前台。
3. 确认右下角 CC 为开启状态（插件会自动点击，若未生效可手动开一次）。
4. 预期 Console：
   - 不再出现 `Cannot access ... before initialization`
   - `Candidate tracks (41), will try 3`
   - `零拷贝装载原生字幕 (N tokens)`
   - `Segmented into N sentences`
5. 预期界面：双语浮层出现，右上角徽章显示 `VTuber直播字幕已就绪 (N 句)`。
6. 回归：SPA 切换到另一个视频、无字幕视频提示、进度跳转、翻译队列继续工作。

---

## 七、遗留风险与后续建议

1. **pot 依赖**：当前可用性建立在「播放器自己会请求 timedtext」这一前提上。
   若 YouTube 改为 Worker 内请求或改用 `get_transcript`，零拷贝截获会失效，
   需要改为拦截 `youtubei/v1/get_transcript` 或接入 BotGuard 获取 pot。
2. **后台标签页**：YouTube 在后台标签页可能不请求字幕，属于平台行为，非插件缺陷；
   若要在后台也工作，需要改为主动调用 transcript 接口（需 pot）。
3. **断句标点**：日文输出存在 `うふ 。` 这类「标点前多余空格」，
   属于 `utils/segmenter.ts` 的拼接细节，建议单独修复，不与本次 Bug 混在一起。
4. **ESLint**：建议启用 `no-use-before-define`，从规则层面阻断同类 TDZ 问题。
5. **构建产物**：`.output/` 已按 0.2.3 重建；提交前请确认 `manifest.json` 的 version 与 `package.json` 一致。
