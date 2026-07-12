[English](README.md) | **中文**

# Drawio for Obsidian

[![Release](https://img.shields.io/github/v/release/doge-liang/obsidian-drawio?label=release&color=blue)](https://github.com/doge-liang/obsidian-drawio/releases/latest)
[![Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22drawio-editor%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json)](https://obsidian.md/plugins?id=drawio-editor)
[![License](https://img.shields.io/github/license/doge-liang/obsidian-drawio)](LICENSE)

在笔记中直接嵌入、预览并编辑 [draw.io](https://www.drawio.com/)（diagrams.net）图表。预览在所有平台上完全离线渲染，图表以可读、便于 diff 的 XML 形式存储。

![带多页翻页控件的嵌入预览](https://raw.githubusercontent.com/doge-liang/obsidian-drawio/main/docs/assets/hero.png)

## 亮点

- **三种载体，一个插件** —— 行内 `` ```drawio `` 代码块、独立的 `.drawio` 文件（Excalidraw 风格：编辑器直接嵌在文件所在标签页中），以及 `![[file.drawio]]` 嵌入。三者都会在编辑视图和阅读视图中实时渲染 SVG 预览；点击任意预览即可编辑。
- **预览始终离线** —— 预览由打包进插件的 drawio 自带 viewer 生成：无 iframe、无网络请求，桌面端与移动端皆然。
- **编辑器可选离线** —— 编辑器默认使用打包的、完全离线的 drawio 构建，由本地服务器提供。商店安装不包含该构建（约 145 MB）；可在插件设置中一键安装，或将编辑器来源切换为 Online。
- **可读、对 git 友好的存储** —— 图表保存为未压缩、经过美化排版的 XML，而非压缩后的二进制块，因此 diff、同步和版本历史都保持有意义。
- **支持多页** —— 多页图表会在预览下方显示紧凑的翻页控件（‹ 2 / 5 ›），且 `![[file.drawio#Page-2]]` 会让嵌入在名为 “Page-2” 的页面上打开。
- **融入 Obsidian** —— 跟随亮色/暗色主题，在弹出窗口中依然可用，在插入前对渲染的 SVG 做净化处理，并支持手机和平板（在这些设备上仅预览 —— 参见[平台支持](#平台支持)）。

## 快速开始

1. 从[社区插件商店](https://obsidian.md/plugins?id=drawio-editor)安装 **Drawio** 并启用（需要 Obsidian 1.4.0 及以上）。
2. 点击**侧边栏按钮**、运行 **Create new diagram** 命令，或在文件浏览器中右键某个文件夹并选择 **New drawio diagram**。
3. 一个新的 `.drawio` 文件会打开，编辑器嵌在其标签页中。开始绘制 —— 更改会自动保存回文件。

编辑器需要二者之一：已安装的离线编辑器（在设置中一键完成，下载约 53 MB），或在插件设置中选择 **Editor source → Online**。参见[离线编辑器（可选）](#离线编辑器可选)。

## 用法

| 载体 | 创建 | 编辑 |
| --- | --- | --- |
| **代码块** | 在任意笔记中添加 `` ```drawio `` 代码块（可留空，或粘贴 drawio XML） | 点击预览 → 全屏模态框 |
| **`.drawio` 文件** | 侧边栏按钮 / **Create new diagram** 命令 / 文件夹右键菜单 | 编辑器直接嵌入文件的标签页 |
| **嵌入** | 在任意笔记中写 `![[your-diagram.drawio]]` | 点击预览 → 快速编辑模态框 |

三者都在编辑视图和阅读视图中渲染为 SVG 预览，每次编辑都会自动保存回其源头 —— 代码块的 XML 或 `.drawio` 文件。当底层文件变化时，嵌入会自动重新渲染。

![嵌入文件标签页中的 drawio 编辑器](https://raw.githubusercontent.com/doge-liang/obsidian-drawio/main/docs/assets/file-editor.png)

**多页图表：** 当图表包含多个页面时，预览会在图表下方显示翻页控件（‹ N / M ›）。`![[file.drawio#Page-2]]` 按名称选择初始页面（若无匹配页面则回退到第一页）。打开编辑器时始终显示所有页面标签。

### 平台支持

| 功能 | 桌面 | 平板 | 手机 |
| --- | :---: | :---: | :---: |
| 代码块与嵌入预览（编辑视图和阅读视图） | 是 | 是 | 是 |
| 独立 `.drawio` 文件标签页 | 内联编辑器（或只读预览，需手动开启） | 只读预览 | 只读预览 |
| 多页翻页控件与 `#Page-N` 嵌入 | 是 | 是 | 是 |
| 跟随亮色/暗色主题 | 是 | 是 | 是 |
| 编辑图表（模态框 / 内联编辑器） | 是 | — | — |
| 创建图表（侧边栏、命令、文件夹菜单） | 是 | — | — |
| 离线编辑器（打包 webapp + 本地服务器） | 是 | — | — |

手机和平板行为一致：处处可预览，但不能编辑。在这些设备上点按预览会提示编辑需要桌面端；创建入口也会被隐藏，因为它们的唯一用途就是打开编辑器。

<img src="https://raw.githubusercontent.com/doge-liang/obsidian-drawio/main/docs/assets/mobile-preview.png" alt="移动端的只读预览" width="320">

## 设置

| 设置项 | 说明 |
| --- | --- |
| **Editor source**（编辑器来源） | **Offline**（打包 webapp，默认）、**Online**（diagrams.net），或 **Custom URL**（自定义 URL）。Offline 需要完成下文的一次性安装 —— 没有自动回退。 |
| **Custom drawio URL**（自定义 drawio URL） | 当 Editor source 为 “Custom URL” 时使用（例如 `https://embed.diagrams.net/`）。 |
| **New diagram location**（新图表位置） | 命令和侧边栏按钮创建图表的位置：库根目录（默认）、当前笔记所在文件夹，或固定文件夹（不存在则创建）。文件夹右键菜单始终在被点击的文件夹中创建。 |
| **Open diagram files read-only**（以只读方式打开图表文件） | 桌面端：打开 `.drawio` 文件时显示静态预览而非内嵌编辑器 —— 适用于以 drawio-desktop 为中心的工作流。对新打开的标签页生效。 |
| **Preview click action**（预览点击行为） | 桌面端：点击预览的行为 —— 打开内置编辑器（默认）、用系统默认应用打开文件，或什么都不做。代码块始终使用内置编辑器（它们没有对应文件）。 |
| **Preview alignment**（预览对齐） | 渲染的预览居中（默认）或左对齐。 |
| **Follow Obsidian theme**（跟随 Obsidian 主题） | 让编辑器匹配 Obsidian 的亮色/暗色主题。 |
| **Show shape libraries**（显示形状库） | 切换编辑器的形状面板。 |
| **Server idle timeout**（服务器空闲超时） | 空闲达到此时长后停止本地服务器（最小 5 秒）。仅在 Offline 模式下有意义。 |

在移动端只显示 **Preview alignment** 和 **Follow Obsidian theme** —— 其余设置项配置的是桌面编辑器。

## 网络使用

- **预览从不使用网络。** 它们由 drawio 的 `viewer.min.js` 渲染，而该文件已打包进插件。
- **使用打包的离线编辑器时**，插件**完全不发起任何网络请求** —— 编辑器由本地 `127.0.0.1` HTTP 服务器提供。
- **当打包构建未安装时**，Offline 模式会显示安装提示，而不是悄悄转用在线编辑器。若你选择 **Online**（或 Custom URL），编辑器界面将从该来源加载。你的图表内容仍留在本地设备上 —— 它在页面内传给编辑器，**不会被上传**；只有编辑器自身的资源会被获取。

## 离线编辑器（可选）

商店安装不包含离线 drawio webapp（约 145 MB，超出商店限制）。若要安装：打开 **设置 → Drawio**，选择 **Editor source → Offline (bundled webapp)**，然后点击 **Install** —— 一次性从 GitHub 下载约 53 MB；此后编辑完全离线。当某次插件更新提升了内置的 drawio 版本后，同一设置行会显示 **Update**，直到已安装的 webapp 与之重新一致。

从源码构建同样可行，产物布局相同：先运行 `npm run fetch-drawio` 再 `npm run build`，并将 `webapp/` 文件夹与 `main.js` 一并复制（参见下文的[开发](#开发)章节）。

## 注意事项与限制

- **编辑仅限桌面端** —— 它需要基于 iframe 的 drawio 编辑器，且在 Offline 模式下需要本地 HTTP 服务器。移动端可预览（参见[平台支持](#平台支持)）。
- **包体积**：`main.js` 约 2.4 MB，因为 drawio 的 viewer（约 2.3 MB）为离线预览而内联其中。这是预期之内的。
- **安全性**：渲染的 SVG 预览在插入前会被净化 —— 移除脚本/嵌入元素、内联事件处理器、携带脚本的 URL scheme、外部 `<use>` 引用、SMIL 注入以及危险的 CSS，同时保留 drawio 的 `foreignObject` 文本标签。打包的 viewer 运行时不注入任何 `<script>` 元素，其唯一的外部脚本加载器（一个未使用的、从 CDN 加载 MathJax 的辅助代码）在构建时被剥除，因此预览不会获取或执行任何外部代码。在 Offline 模式下，本地服务器只绑定 `127.0.0.1`，且只提供打包的 `webapp/` 目录。

## 开发

```bash
npm install
npm run fetch-drawio   # 每次克隆后运行一次：获取 drawio webapp + 预览 viewer
npm run dev            # 监听构建
npm test               # 单元测试（vitest）
npm run build          # 类型检查 + 生产构建
```

欢迎提交 bug 报告和 pull request —— 较大的改动请先开一个 [issue](https://github.com/doge-liang/obsidian-drawio/issues)。

## 许可证

[MIT](LICENSE)
