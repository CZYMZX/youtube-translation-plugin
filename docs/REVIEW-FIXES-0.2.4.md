# v0.2.4 全量审查修复报告

> 日期：2026-11-04  
> 原始版本：`E:\Antigravity\油管翻译插件`（v0.2.3，保持只读，未再做任何修改）  
> 新版本目录：`E:\Antigravity\油管翻译插件_v0.2.4`  
> 存档目录：`E:\Antigravity\油管翻译插件_archive_v0.2.3_20261104_0520`



---

## 一、存档与隔离说明

### 1. 存档内容

- 存档路径：`E:\Antigravity\油管翻译插件_archive_v0.2.3_20261104_0520`
- 存档方式：`cp -a` 全量复制（含 `node_modules`、`.output`、`.wxt`、docs）
- 文件数：5490（与原始目录一致）
- 校验：`package.json`、`wxt.config.ts`、`content/index.ts`、`overlay.ts`、`background.ts`、`translator.ts`、`.output/chrome-mv3/manifest.json` 的 SHA-1 与原始目录逐一相同。

### 2. 隔离方式

- 存档完成后，所有修改只发生在 `油管翻译插件_v0.2.4`。
- 原始目录 `油管翻译插件` 未执行构建、未写入任何文件；事后复核 7 个关键文件哈希仍与存档一致，文件数仍为 5490。

---

## 二、版本差异总览

| 维度   | v0.2.3（原始/存档）                                        | v0.2.4（新版本）                                                |
| ---- | ---------------------------------------------------- | ---------------------------------------------------------- |
| 版本号  | 0.2.3                                                | 0.2.4（package.json / lock / manifest / banner / popup 全同步） |
| 内容脚本 | 启动崩溃已修，但仍有 30 项审查问题                                  | 4 高危 + 14 中危 + 12 低危全部处理（27 项完整、3 项部分）                     |
| 安全边界 | 消息只看 `source` 字符串；后台可抓任意 URL；popup 用 innerHTML 拼接口返回 | 同源校验 + URL 白名单 + 发送者校验 + 全量 textContent                    |
| 缓存   | 键不含模型、强制小写；IDB 无 TTL                                 | 键含模型；30 天 TTL；分块读；内存上限                                     |
| 性能   | 全页观察器无节流；抽屉每次全量重建；临时缓存 O(n²)                         | 观察器节流/限域；抽屉增量；落盘防抖；二分查找                                    |
| 结构   | `overlay.ts` 3212 行；`bridge.ts` 死代码；三份缓存逻辑重复         | 样式外置（`overlay-styles.ts` 1344 行，`overlay.ts` 降至 2041 行）；死代码删除；缓存逻辑合并                                  |
| 测试   | 无 `test` 脚本，`test/*.js` 无法运行                         | `npm test`（tsx）可运行 4 个测试文件（5 组用例）                                   |
| 产物   | 仅 chrome/edge 旧产物                                    | 两套产物均已重建，manifest 均为 0.2.4                                 |

> 行数复核（按仓库 tag `v0.2.4` 的 `entrypoints/content/` 实测）：`overlay-styles.ts` 1344 行、`overlay.ts` 2041 行。
> 早前记录里的「样式外置 2052 行」无法在任何快照中复现，已按实测值更正；`overlay.ts` 3212 行为当时对 v0.2.3 旧目录的计数，保留不动。

---

## 三、逐项修复清单

### 🔴 高危（4/4 已修复）

| # | 问题                                  | 修复方式                                                                                                          | 关键文件                                           |
| - | ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1 | AI 精翻切视频后把旧字幕写入新视频缓存                | 新增 `aiRunToken` + `runVideoId/runSentences` 快照；切视频自增 token、置 `isFullAiRunning=false`；循环内两处 token 校验；落盘只用快照 ID | `entrypoints/content/index.ts`                 |
| 2 | 音轨评分硬编码 `ja > en`，英文视频选日语轨          | 三级原声语言推断（`defaultAudioLanguage` → ASR 轨语言 → 历史偏好）；原声 +200；目标语言 -120；派生翻译轨 -60                                 | `youtube-bridge.content.ts`、`content/index.ts` |
| 3 | 内容脚本信任伪造消息；后台可抓任意 URL（SSRF 面）       | 校验 `event.source === window` 与同源；后台校验发送者 tab 为 YouTube、URL 必须 `https://*.youtube.com/api/timedtext`；响应体限制 8MB | `content/index.ts`、`background.ts`             |
| 4 | 接口/模型返回内容经 `innerHTML` 注入 popup 与浮层 | 新增 `renderStatus()` 与安全徽章构建，全部改 `textContent`；仅固定 SVG 常量允许 innerHTML                                          | `popup/main.ts`、`content/overlay.ts`           |

### 🟠 中危（14/14 已修复）

| #  | 问题                                             | 修复方式                                                                 |
| -- | ---------------------------------------------- | -------------------------------------------------------------------- |
| 5  | 两个全页 `MutationObserver` 在直播页形成回调风暴             | 播放器 observer 150ms 节流；字幕 observer 限缩到 `#movie_player` 容器 + 200ms 节流  |
| 6  | 抽屉每批翻译全量重建、每帧 `querySelector` 高亮               | 关闭时只标脏；打开时渲染；之后按签名增量更新译文；`Map<id,node>` 高亮；搜索 180ms 防抖               |
| 7  | 临时字幕每次 `JSON.stringify` 全量句子（O(n²)）+ 配额静默失败    | 1.5s 防抖落盘；捕获 `QuotaExceededError` 后降级纯内存并告警；清理定时器                    |
| 8  | overlay 每次 mount 叠加 window/document 监听器；状态位不复位 | 全局监听器统一 `attach/detach`；拖拽状态收敛到字段；`destroy` 重置抽屉/面板状态                |
| 9  | 设置读取 350ms 超时静默锁定默认值                           | 超时记录告警，改为 sync→local→默认；新增 `sanitizeSettings` 枚举/范围/颜色清洗             |
| 10 | DOM 兜底用非贪婪正则截断嵌套 JSON                          | 新增 `extractJsonArrayAfterKey()` 括号配对扫描（字符串/转义感知）                     |
| 11 | 翻译队列无超时，消息丢失永久卡 `translating`；重断句丢结果           | 20s 超时 + 每句 2 次重试 + generation 代际校验；旧结果丢弃                            |
| 12 | IndexedDB 逐 key 批量读、无淘汰                        | 200 key/块事务；DB v2 增 `updatedAt` 索引；30 天 TTL 清理；`onblocked` 兜底        |
| 13 | 缓存键缺模型维度且强制小写                                  | 键改为 `service:model:scenario:reasoning:targetLang:text`；保留原文大小写       |
| 14 | InnerTube 先试 WEB（实测 UNPLAYABLE）且无 visitorData  | ANDROID 20.10.38 优先；WEB 补 `visitorData` 与 client headers；统一 12s 超时   |
| 15 | 取轨失败时原生字幕已被隐藏                                  | `updateNativeSubtitleVisibility` 增加 `currentSentences.length > 0` 条件 |
| 16 | `timeupdate` 热路径重复按钮全页查询 + O(n) 扫描             | 移除 `checkAndMount`；浮层/队列改二分查找；按钮仅保留自身 350ms 看门狗                      |
| 17 | popup 防抖保存关闭即丢、读取失败静默                          | `pagehide/visibilitychange` flush；`lastError` 提示；保存串行化               |
| 18 | 后台抓取无超时                                        | `fetchWithTimeout` 统一 12s，Google 连通性检测 4s                            |

### 🟡 低危 / 可维护性（12 项：9 完整、3 部分）

| #  | 问题                                   | 处理                                                                       |
| -- | ------------------------------------ | ------------------------------------------------------------------------ |
| 19 | `content/bridge.ts` 死代码              | 已删除（85 行）                                                                |
| 20 | 4 个未使用 db-cache API、`lookaheadCount` | 已删除；`STORE_VIDEOS` 仅为兼容旧库保留，不再写入                                         |
| 21 | 三个翻译通道重复缓存逻辑                         | 合并为 `planBatch/commitBatch`，减少约 140 行                                    |
| 22 | `overlay.ts` 3212 行单类                | **部分完成**：CSS 外置为 `overlay-styles.ts`（1344 行）；组件级拆分未做，避免高风险重构             |
| 23 | 21 处空 catch、53 处 any                 | **部分完成**：关键路径（消息、抓取、缓存、设置、字幕解析）已补告警；播放器 API 探测类空 catch 保留为降级策略           |
| 24 | 测试无法运行、无 test 脚本                     | 引入 `tsx`；`npm test` 运行 4 个测试文件（5 组用例）；新增解析与设置清洗测试                                 |
| 25 | `ExtensionMessage` 未覆盖全部消息           | 补齐 `FETCH_TRACKS_BY_VIDEO_ID / CHECK_GOOGLE... / SETTINGS_UPDATED` 及可选字段 |
| 26 | `String.fromCharCode` 解码 astral 实体错误 | 改 `String.fromCodePoint`；新增 `😀` 用例                                      |
| 27 | 日文标点前多空格（`うふ 。`）                     | `shouldInsertSpace()` 处理 CJK 标点/括号；实测输出 `うふ。`                            |
| 28 | `host_permissions` 含 `http://*/*`    | **部分完成**：移除明文 HTTP；保留 `https://*/*` 以支持自定义 OpenAI 兼容端点（README 已注明）       |
| 29 | CHANGELOG 与实现漂移                      | CHANGELOG 新增 0.2.4；README 更正 v0.2.1 的 `loadModule`/同源 fetch 描述           |
| 30 | 广告期 `videoData.video_id` 触发切视频清缓存    | bridge 广播 `isAd`；内容脚本广告期忽略；新增“播放中自动重新探测（最多 2 次）”修复广告后无字幕                 |

---

## 四、验证记录（已实际执行）

### 1. 静态与单元测试

```text
> npm run compile
tsc --noEmit                       # 通过，0 error

> npm test
--- 测试: 提取词级 Token ---        17 tokens
--- 测试: 智能断句与标点重组 ---    3 句，疑问句补 ? 通过
--- 测试: 字幕格式解析 ---          JSON3 / WebVTT / srv3 XML / 非法 JSON 全部通过
--- 测试: 设置项校验与清洗 ---      非法枚举、越界、颜色、空语言全部通过
--- 测试: 场景与推理配置 ---        通过
```

### 2. 构建

```text
npm run build:chrome  → .output/chrome-mv3/manifest.json version = 0.2.4
npm run build:edge    → .output/edge-mv3/manifest.json   version = 0.2.4
```

### 3. Edge 156 实机（加载 `.output/chrome-mv3`）

- 测试视频：`https://www.youtube.com/watch?v=XMJi8I_9pp4`（主播 KikiraraVivi 的 ARK 直播回放 #25，含 `ja/asr` 音轨）
- 结果：
  - 候选音轨 `Attempting track [1/1]: ja asr`（原声语言命中）
  - 零拷贝截获 5527 tokens → 分段 **4169 句**，徽章 `VTuber直播字幕已就绪 (4169 句)`
  - 跳转 123s：浮层 `うふ。` / `呵呵。`，`display:flex`、`rgba(15,23,42,0.75)`、`border-radius:12px`（样式外置后正常）
  - 剧本抽屉：打开后 4169 行，当前句高亮 1 行
  - 页面 `pageerror`：**0**
  - popup：`v0.2.4`，service=`google`，target=`zh-CN`，无报错
- 附加场景：广告播放期间不切正片上下文；广告结束后自动重新探测成功取到字幕。

---

## 五、已知边界与建议

1. **字幕可用性仍依赖播放器自身请求**：YouTube 现要求 `pot` 令牌，`baseUrl` 直连只作 3 条兜底。若未来播放器改为 Worker 内请求或 `get_transcript`，零拷贝截获会失效。
2. **后台标签页**：YouTube 在后台标签页可能不发起 timedtext 请求，实测需保持前台；这属于平台行为。
3. **自定义 HTTP 端点**：已移除 `http://*/*`，如确有明文内网端点需求，需要改用 `optional_host_permissions` 动态申请（本版未实现）。
4. **`overlay.ts` 仍有约 2050 行**：样式已外置，但快捷面板/抽屉/拖拽逻辑仍在单类中；建议后续在测试覆盖下拆分为独立模块。
5. **播放器 API 探测中的空 catch**：属于“某一路不可用就换下一路”的降级策略，未逐个加日志，避免控制台噪声。

---

## 六、如何运行新版本

> 迁移说明（2026-11-06 起）：当前工作基线是 `E:\Antigravity\youtube-translation-plugin`（`package.json` 0.4.0，分支 master）。
> 下面的命令与加载路径按 v0.2.4 快照目录书写，在当前仓库执行时把目录换成 `E:\Antigravity\youtube-translation-plugin` 即可，产物路径同为 `.output\chrome-mv3`。
> `油管翻译插件_v0.2.x` / `_v0.4.0` 等旧目录只读，仅作对照与回滚，不得当工作基线。

```bash
cd E:\Antigravity\油管翻译插件_v0.2.4
npm install          # 已安装 tsx，可跳过
npm test
npm run build:chrome # 或 build:edge
```

1. 打开 `edge://extensions/`，开启开发人员模式。
2. 「加载解压缩的扩展」选择 `E:\Antigravity\油管翻译插件_v0.2.4\.output\chrome-mv3`。
3. 打开任意有字幕的 YouTube 视频，保持标签页在前台并开启 CC。
4. 预期 Console：`零拷贝装载原生字幕 (N tokens)` → `Segmented into N sentences`，浮层出现双语字幕。

> 原始版本 `E:\Antigravity\油管翻译插件` 未被修改，可随时与存档逐文件比对回滚。
