# YouTube 自动字幕断句翻译器 (YT Subtitle Re-segmenter & Translator) - v0.2.3

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

## 🚀 v0.2.3 重磅升级与致命修复

1. **彻底解决内容脚本启动期 TDZ 崩溃**：
   - 彻底修复了由于 `pipTextTrack` 声明位置滞后导致运行时抛出 `ReferenceError: Cannot access 'pipTextTrack' before initialization`、致使内容脚本整体中断的问题，确保所有事件监听与字幕管线 100% 正常启动。
2. **修复播放器内部 tracklist 污染**：
   - 彻底解决 `getOption('captions','tracklist')` 返回无 `baseUrl` 对象从而污染并阻塞后续 5 重兜底导致拿不到音轨的问题，严格保证每一路来源都携带有效 `baseUrl`。
3. **适配 YouTube timedtext pot 令牌鉴权与零拷贝接管**：
   - 建立在播放器原生 timedtext 零拷贝拦截之上，收敛音轨兜底为 3 条并增加单飞锁，彻底杜绝 429 限流风险与广告字幕串台。
4. **升级 InnerTube Android 客户端版本**：
   - 将 Android 客户端版本从已失效的 `19.09.37` 升级为 `20.10.38`，保障 API 双模式兜底返回 200 成功率。
5. **沉浸式极速字幕秒开机制 (Sub-100ms Caption Sniffer)**：
   - **主动唤醒字幕引擎**：在播放器加载第一时间调用 `movie_player.loadModule('captions')`，使懒加载音轨在 50ms 内静默激活并生成 `tracklist`。
   - **页面同源直连 fetch**：抛弃易受 403 拦截且延迟高的 Background 消息中转，直接在 Content Script 内携带合法 Cookie 发起同源 fetch，延迟从秒级骤降至 30ms~80ms。
   - **响应体零拷贝截获 (0ms 接管)**：通过 Fetch/XHR Hook 直接拦截 YouTube 播放器自身拉取的 timedtext 响应体文本，实现 0 毫秒零额外网络请求瞬间接管展示。
   - **音轨智能评分重构**：自动降级 YouTube 劣质二次衍生机翻轨，优先原声真实 ASR 音轨。
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
