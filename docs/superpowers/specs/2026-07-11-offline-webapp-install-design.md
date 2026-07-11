# 设计：离线编辑器（webapp）的检测与一键安装

日期：2026-07-11
状态：已与用户确认方向，待实施

## 背景与动机

插件默认编辑器模式为 `offline`，依赖插件目录下约 145 MB 的 `webapp/`
（解压自 drawio 官方 `draw.war`）。商店安装无法携带该目录，现行为是
`resolveBaseUrl()` 检测到缺失后**静默回退**到 `ONLINE_DRAWIO_URL`
（一次性 Notice）。

本变更移除自动回退，改为**显式检测 + 设置页一键安装**：

- 用户选择 offline 即意味着 offline——不再悄悄改用在线编辑器。
- 未安装时给出明确、可操作的引导（设置页安装按钮），而非降级。

用户已确认的决定：

1. 默认模式**保持 `offline`**（不改为 online）。
2. 插件生命周期中加入环境检测；检测到未安装时设置页提供安装按钮。
3. 进度粒度：下载阶段显示百分比，解压阶段仅显示"解压中…"。
4. 已安装状态下保留"重新安装"按钮（用于损坏修复/升级）。

## 范围

- 桌面端专属。mobile 本就只有预览，不受影响（`settingsTab.ts` 的
  offline 区块已在 `Platform.isDesktopApp` 内）。
- 不改动预览引擎（viewer）、不改动 online/custom 模式行为。

## 组件设计

### 1. 检测 `DrawioPlugin.isWebappInstalled(): Promise<boolean>`

- 判据与现行 `resolveBaseUrl()` 一致：`<pluginDir>/webapp/index.html`
  存在即视为已安装。
- 方法体内动态 `await import('node:fs')`/`import('node:path')`，仅桌面
  调用（与 `pluginDir()` 同一纪律，见 CLAUDE.md 移动端导入约束）。
- 调用方（生命周期三触点）：
  1. **加载时**：`registerDesktopFeatures()` 中，若 `drawioMode ===
     'offline'` 且未安装，弹一次性 Notice 引导去设置页（每次会话最多
     一次；不自动打开设置页）。
  2. **设置页**：渲染检测状态与安装按钮（见 §4）。
  3. **编辑入口**：`resolveBaseUrl()`（见 §3）。

### 2. 安装流水线 `src/desktop/webappInstaller.ts`

位于 `src/desktop/**`（该目录允许静态 node 导入；只被设置页点击
处理器动态 import，mobile 永不加载）。

```
installWebapp(pluginDir: string, onProgress: (p: InstallProgress) => void): Promise<void>
type InstallProgress =
  | { phase: 'download'; received: number; total: number | null }
  | { phase: 'extract' }
```

步骤：

1. **下载**：`node:https` GET `draw.war`（约 53 MB，版本与 URL 见
   §5），手动跟随 30x 重定向（GitHub releases 302 到对象存储）。选
   `node:https` 而非 `fetch`/`requestUrl`：可流式报进度、无 CORS 顾虑。
   数据累积在内存 Buffer（53 MB 桌面端可接受，免去临时文件清理）。
2. **完整性**：若响应带 `content-length`，接收完成后核对字节数，不符
   即报错。
3. **解压**：`fflate.unzipSync` 解压 Buffer，写入
   `<pluginDir>/webapp.installing/`；跳过 `WEB-INF/`、`META-INF/`
   （与 `scripts/fetch-drawio.mjs` 一致）。
4. **校验**：`index.html` 与 `js/viewer.min.js` 必须存在；写
   `DRAWIO_VERSION` 文件（内容同构建脚本格式）。
5. **原子落位**：删除旧 `webapp/`（若存在），`fs.renameSync`
   `webapp.installing` → `webapp`。
6. **失败清理**：任一步失败删除 `webapp.installing/`，原 `webapp/`
   保持不动，错误上抛给设置页展示。

依赖：`fflate` 加入 **devDependencies**（esbuild 内联进 `main.js`，
运行时零外部依赖；tree-shaking 后体积增量很小）。它是真实被导入使用
的——不同于历史上被移除的未使用 `dompurify`。

**重装的文件锁问题（Windows）**：本地服务器可能正持有 `webapp/` 内
文件句柄。安装流程开始前由调用方（设置页）先 `plugin.server?.stop()`；
按钮说明注明重装会中断正在进行的离线编辑会话。

### 3. `resolveBaseUrl()` 行为变更（移除回退）

- offline + 已安装 → 不变（起本地服务器）。
- offline + 未安装 → 抛 `OfflineEditorNotInstalledError`（定义于
  `src/model/errors.ts`，纯 TS 无 node 依赖，可被任意端安全导入）。
  message 即面向用户的文案：提示到设置页安装离线编辑器，或切换
  Online 模式。
- 删除 `warnedOfflineFallback` 字段与回退 Notice。
- 错误路径复用两个编辑入口**现有**的错误处理：
  - `DrawioModal.onOpen` 的 try/catch：识别该错误类型时，Notice 直接
    展示其 message（替代泛化的 "failed to open editor" 文案），错误
    div 同样展示 message。
  - `DrawioFileView.mountEditor` 的 `.catch`：错误 div 展示 message。
- 不会出现空白 iframe：`mount()` 在 `resolveBaseUrl()` 抛出时尚未创建
  iframe。

### 4. 设置页 UI（`settingsTab.ts`，仅 `drawioMode === 'offline'` 时渲染，紧随 Editor source 之后）

- `display()` 同步渲染"检测中…"占位；异步 `isWebappInstalled()` 完成
  后就地回填（不整页重渲染）。
- **未安装**：状态"离线编辑器未安装" + 按钮 `Install offline editor`
  + 说明（约 53 MB 下载、安装时需联网、装好后编辑完全离线）。
- **安装中**：按钮禁用；就地更新进度文本（`Downloading… 45%` /
  `Extracting…`）。
- **已安装**：状态"已安装"，版本号从 `webapp/DRAWIO_VERSION` 文件
  实读（手动安装可能无此文件或版本不同——无文件则不显示版本号）；
  附次级按钮 `Reinstall`（同一流水线，先停服务器）。
- **失败**：就地显示错误信息，按钮恢复可点（重试）。
- **重渲染韧性**：安装状态（idle/installing+进度/error）保存在
  plugin 实例字段上；`display()` 每次渲染读取当前状态并重新订阅进度
  回调，因此安装期间用户改动其他设置触发的整页重渲染不会丢失进度
  显示。安装完成后刷新整页（`this.display()`）以切到"已安装"态。
- "Editor source" 下拉的描述文案更新：删去"未安装时自动使用在线
  编辑器"的表述。

### 5. 版本固定与防漂移

- `src/constants.ts` 新增 `DRAWIO_VERSION = 'v30.0.4'` 与
  `DRAWIO_WAR_URL`（或构造函数），运行时安装器使用，保证与内联
  `viewer.min.txt` 同版本。
- `scripts/fetch-drawio.mjs` 保持自带版本字符串（ESM node 脚本直接
  import TS 常量不便），以单测断言两处版本一致来防漂移（见测试 §4）。

## 错误处理汇总

| 场景 | 行为 |
| --- | --- |
| offline 编辑但未安装 | 类型化错误，入口展示可操作文案（设置页安装 / 切 Online） |
| 下载网络失败 / 字节数不符 | 清理临时目录，设置页显示错误，可重试 |
| zip 解析失败 / 校验缺文件 | 同上 |
| 重装时服务器占用文件 | 先停服务器规避；rename 仍失败则同上报错 |
| 安装中途关闭 Obsidian | 残留 `webapp.installing/` 不影响检测（判据是 `webapp/index.html`）；下次安装开始时先删除残留 |

## 测试

均为 vitest 单测，无网络：

1. `isWebappInstalled`：临时目录两分支。
2. 解压/过滤：测试内用 `fflate.zipSync` 构造含
   `index.html`、`js/viewer.min.js`、`WEB-INF/x`、`META-INF/x` 的小
   zip，断言输出目录正确、WEB-INF/META-INF 被剔除、`DRAWIO_VERSION`
   写入、rename 落位。
3. 校验失败路径：缺 `index.html` 的 zip → 抛错且 `webapp.installing`
   被清理、原 `webapp/` 未动。
4. 版本同步：断言 `scripts/fetch-drawio.mjs` 文本中的版本与
   `constants.ts` 一致。
5. `resolveBaseUrl`：offline 未安装 → 抛 `OfflineEditorNotInstalledError`；
   已安装分支不变（现有测试若覆盖回退行为则更新）。

真实下载不进单测：实施第一步先做一次性可行性脚本（真下载 + fflate
解压到临时目录）验证最大风险点，通过后再建 UI。

## 文档更新

- **CLAUDE.md**："Default editor mode is offline with automatic online
  fallback" 条目重述为新行为（无回退、检测、安装按钮、fflate 内联）。
- **README**：删去自动回退表述，改为设置页一键安装说明。
- **发布说明**：显著标注行为变更——商店安装且从未改过设置的用户，
  升级后首次编辑会看到安装引导而非静默使用在线编辑器。

## 兼容性核对（CLAUDE.md 检查单逐项）

- node 导入：新增 node API 调用要么在 `src/desktop/**`（静态导入
  允许），要么方法体内动态 import（`isWebappInstalled`）。依赖
  esbuild `supported: { 'dynamic-import': false }` 降级，不动该配置。
- 无新增 Obsidian API（`Notice`/`Setting`/`ButtonComponent` 均为
  基线 API，现有代码已在用）。
- 无 regex 字面量新风险；不创建 `<script>`；不触碰 viewer/sanitizer。
- `onunload` 不变。
