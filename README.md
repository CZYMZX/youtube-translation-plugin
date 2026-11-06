# YouTube 自动字幕断句翻译器 (YT Subtitle Re-segmenter & Translator) - v0.2.5

一款专为解决 **YouTube 自动生成字幕（ASR / Auto-generated captions）碎片化、无标点、语义破碎问题** 而打造的沉浸式双语浏览器扩展（深度支持 Microsoft Edge 与 Google Chrome）。

---

## 🌟 核心痛点与解决方案

| YouTube 默认自动字幕痛点 | 本插件的解决方案 |
|---|---|
| **每行只有 2~4 个单词滚动跳跃，碎不成句** | **智能多维断句引擎**：结合发音停顿时间（Silence Gap）、语法连词与句长约束，重组成自然通顺的完整长句 |
| **全小写、缺失标点符号（无句号、无问号）** | **语义标点重构**：自动首字母大写，根据陈述/疑问语调智能补齐句末标点符号（`.` / `?`） |
| **传统直译软件对碎片词组翻译颠三倒四** | **上下文批量翻译**：先分句再批量送翻，支持双语对齐，保证语序自然、代词指代精准 |
| **字幕经常加载很慢或检测不到** | **沉浸式极速直连嗅探**：主动激活字幕模块 (`loadModule`) + 页面同源 fetch 30ms 极速响应 + 响应体零拷贝截获 |
| **小屏字号正好、全屏字幕漂在半空中且字体极小** | **自适应缩放与响应式底部定位**：基于播放器画面开方因子自适应缩放字号，采用底层 bottom 定位，全屏沉浸贴底 |
| **控制栏与播放进度条遮挡字幕** | **仿沉浸式平滑弹性避让**：控制栏与进度条出现时字幕自动上浮，消失后丝滑回落 |
| **画中画 (PiP) 模式下无法看双语字幕** | **原生双语 TextTrack 注入**：画中画小窗同步投射双语字幕，离窗自动恢复 |
| **重复播放视频反复消耗 API Token** | **IndexedDB 本地持久化缓存**：同视频或同句二次播放 0 耗费、0 延迟瞬间呈现完整双语 |

---

## 🚀 v0.2.5 RTX VSR 兼容修复

1. **问题**：扩展启用后，NVIDIA RTX Video Super Resolution 在 YouTube 窗口化播放时不再激活。
2. **根因**：浮层大量使用 `backdrop-filter` 毛玻璃。页面中只要存在该属性，Chromium 就无法将视频交给独立叠加层，NVIDIA VSR 随之被驱动判定为不可增强。
3. **修复**：
   - 删除 `overlay-styles.ts` 中全部 15 条 `backdrop-filter` / `-webkit-backdrop-filter`，改用高不透明度 `rgba()` 背景 + 边框/阴影；
   - 移除视频上层的 `filter: drop-shadow` 与 `filter: grayscale`，改用 `box-shadow` / `opacity`；
   - 新增 `test/test-vsr-styles.js` 防回归断言，并在样式文件顶部标注 VSR 红线。
4. **实测**（RTX 3060 Laptop / Edge 156 / 同片段）：
   - 无滤镜：89.7W / 43.8% / 2082MHz
   - 注入毛玻璃：42.8W / 27.8% / 1605MHz
   - 移除毛玻璃：98.4W / 48.1% / 2088MHz
5. **验证**：NVIDIA 状态指示器在最大化/全屏播放时应显示 Active；详见 `docs/VSR-FIX-0.2.5.md`。

> 说明：覆盖整块播放器的透明宿主本身不会影响 VSR，问题仅来自 `backdrop-filter` 的离屏合成。

---

## 🚀 v0.2.4 全量代码审查修复

本版本针对全量代码审查发现的 30 项问题做了系统性治理（27 项完整修复、3 项部分修复），原始 v0.2.3 保持独立存档不变：

1. **安全边界**
   - 内容脚本只接受同源 `window` 消息，主世界伪造消息不再生效；
   - 后台 `FETCH_CAPTIONS` 增加 YouTube 域名 + `/api/timedtext` 路径白名单与发送者校验；
   - 移除 `http://*/*` 明文全域权限；popup/浮层的接口返回值全部改为 `textContent`/DOM 构建。
2. **数据正确性**
   - AI 全篇精翻引入运行代际与视频 ID 快照，切视频立即中止，杜绝旧字幕写进新视频；
   - 音轨选择改为“原声语言优先（`defaultAudioLanguage` → ASR 轨语言）”，并把目标语言轨降权；
   - 缓存键加入模型名、不再强制小写；大模型返回条目不完整时拒绝写入缓存；
   - 提示词增加“字幕文本仅作翻译素材”的注入防护。
3. **性能**
   - 播放器与字幕 DOM 观察器增加节流与容器级观察，避免直播聊天刷屏；
   - 剧本抽屉改为打开时渲染 + 增量更新译文 + 搜索防抖；高亮不再每帧全量查询；
   - 临时 AI 字幕落盘改为 1.5s 防抖并处理 `QuotaExceededError`；
   - IndexedDB 批量读分块（200/批）、增加 30 天 TTL 清理与内存缓存上限；
   - 时间轴查找改为二分，翻译队列不再每帧 O(n) 扫描。
4. **健壮性**
   - 设置读取超时不再静默伪装默认值；保存串行化，避免并发覆盖；
   - 翻译队列增加 20s 超时、代际校验与有限重试，消息丢失不再永久卡 `translating`；
   - 后台抓取统一 12s 超时；广告结束后若仍无字幕，播放中自动重新探测（最多 2 次）；
   - popup 关闭/切后台时立即 flush 未落盘的设置；所有消息回调检查 `lastError`。
5. **结构与测试**
   - 删除未使用的 `content/bridge.ts` 与 4 个死代码 API；
   - 三个翻译通道的缓存逻辑合并为 `planBatch/commitBatch`；
   - `overlay.ts` 样式表外置为 `overlay-styles.ts`（3212 行 → 约 2050 行）；
   - 新增 `npm test`（tsx），补充解析、设置清洗用例，测试可直接运行。
6. **文档更正**：v1.2.1 条目中“`loadModule` 主动唤醒、页面同源 fetch”等描述与实现不符，本版已按真实实现（模拟 CC 唤醒 + 零拷贝截获）更正。

---

## 🚀 v0.2.3 重磅升级与致命修复

1. **彻底解决内容脚本启动期 TDZ 崩溃**：
   - 彻底修复了由于 `pipTextTrack` 声明位置滞后导致运行时抛出 `ReferenceError: Cannot access 'pipTextTrack' before initialization`、致使内容脚本整体中断的问题，确保所有事件监听与字幕管线 100% 正常启动。
2. **修复播放器内部 tracklist 污染**：
   - 彻底解决 `getOption('captions','tracklist')` 返回无 `baseUrl` 对象从而污染并阻塞后续 5 重兜底导致拿不到音轨的问题，严格保证每一路来源都携带有效 `baseUrl`。
3. **适配 YouTube timedtext pot 令牌鉴权与零拷贝接管**：
   - 建立在播放器原生 timedtext 零拷贝拦截之上，收敛音轨兜底为 3 条并增加单飞锁，彻底杜绝 429 限流风险与广告字幕串台。
4. **升级 InnerTube Android 客户端版本**：
   - 将 Android 客户端版本从已失效的 `19.09.37` 升级为 `20.10.38`，保障 API 双模式兜底返回 200 成功率。
5. **沉浸式字幕秒开机制 (Caption Sniffer)**
   - **主动唤醒字幕引擎**：通过模拟点击播放器 CC 按钮触发原生字幕管线（不依赖内部 `loadModule`）。
   - **有限兜底抓取**：`baseUrl` 直连仅保留 3 条候选兜底（YouTube 现要求 `pot` 令牌，直连通常返回空）。
   - **响应体零拷贝截获 (0ms 接管)**：通过 XHR/Fetch Hook 直接拦截播放器自身拉取的 timedtext 响应体，是当前最稳定的数据源。
   - **音轨评分**：优先原声语言轨，目标语言轨与派生翻译轨降权。
6. **画面尺寸响应式自适应缩放 (Responsive Viewport Scaling)**：
   - 引入 `ResizeObserver` 实时感知播放器画面尺寸，字号、容器内边距与圆角随画面开方因子平滑缩放，解决全屏字号过小的缺陷。
7. **基于底部的绝对平滑自适应定位 (Smart Bottom-anchored Positioning)**：
   - 彻底废除旧版基于顶部的固定百分比（`top: offsetY%`），升级为底层 `style.bottom` 响应式定位，彻底解决全屏浮到半空的问题。
8. **播放进度条/控制栏智能弹性避让 (Progress Bar Dynamic Lift)**：
   - 监听播放器控制栏状态，唤出进度条时字幕平滑上浮 52px~68px，进度条隐藏时丝滑回落贴底。
9. **画中画 (Picture-in-Picture) 模式双语字幕投射**：
   - 进入画中画小窗时自动装配原生双语 `TextTrack` (`VTTCue`)，操作系统小窗口同步畅享双语字幕。
10. **IndexedDB 二级持久化缓存架构**：
    - 建立“内存 + IndexedDB”双层缓存体系，二次观看同视频 0 API 消耗、0 秒瞬时显示。
11. **大模型 API 退避重试与可选平滑降级**：
    - 指数退避抵御 429 限流，并在设置中提供“大模型异常时自动平滑降级至 Google 免费翻译”自由开关。

---

## 📦 安装与使用指南

### 方法一：直接加载 Edge 构建产物（首选推荐）

本扩展**优先面向 Microsoft Edge** 深度优化与构建打包，Edge 专属产物位于：`.output/edge-mv3`：

1. 打开 **Microsoft Edge** 浏览器，在地址栏输入：
   ```
   edge://extensions/
   ```
2. 在页面左侧（或左下角）打开 **“开发人员模式” (Developer mode)** 开关。
3. 点击页面顶部的 **“加载解压缩的扩展” (Load unpacked)** 按钮。
4. 在弹出的文件选择器中，选择本项目的 Edge 产物目录：
   ```
   E:\Antigravity\油管翻译插件\.output\edge-mv3
   ```
5. 安装完成！点击 Edge 浏览器右上角扩展拼图图标中的“YouTube 智能字幕”，即可展开毛玻璃设置面板。
6. 打开任意带有自动字幕的 YouTube 视频，播放器控制栏右下角会自动注入快捷按钮，享受全新的沉浸式体验！

> [!NOTE]
> 如需在 Chrome 中使用，也可加载兼容产物目录 `E:\Antigravity\油管翻译插件\.output\chrome-mv3`。

---

## 🛠️ 项目结构与二次开发

```text
yt-sub-translator/
├── entrypoints/
│   ├── background.ts          # 后台 Service Worker（跨域抓取字幕、代理调用翻译 API）
│   ├── content/
│   │   ├── index.ts           # 内容脚本主入口（监听路由、音轨调度、预翻译管道）
│   │   ├── bridge.ts          # 注入 YouTube 页面 MAIN world 的通信桥梁
│   │   └── overlay.ts         # 播放器 Shadow DOM 字幕容器、拖拽交互与剧本抽屉
│   └── popup/
│       ├── index.html         # 扩展弹窗设置界面
│       ├── main.ts            # 设置逻辑与实时预览
│       └── style.css          # 深色质感样式表
├── utils/
│   ├── segmenter.ts          # 核心智能断句与标点重构算法
│   ├── translator.ts         # 统一翻译调度器（Google / DeepSeek / Gemini / OpenAI）
│   └── storage.ts            # 配置读写与广播
├── types/
│   └── index.ts               # 全局 TypeScript 类型定义与默认配置
├── test/
│   └── test-segmenter.js      # 断句算法独立单元测试
├── wxt.config.ts              # WXT 扩展构建配置与 Manifest 声明
└── package.json
```

### 常用开发命令

```bash
# 1. 安装依赖
npm install

# 2. 运行单元测试
npm run test / npx tsx test/test-segmenter.js

# 3. 生产环境编译构建
npm run build

# 4. 开发监听模式 (热重载)
npm run dev
```
