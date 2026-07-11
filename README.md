# Drawio for Obsidian

[![Release](https://img.shields.io/github/v/release/doge-liang/obsidian-drawio?label=release&color=blue)](https://github.com/doge-liang/obsidian-drawio/releases/latest)
[![Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22drawio-editor%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json)](https://obsidian.md/plugins?id=drawio-editor)
[![License](https://img.shields.io/github/license/doge-liang/obsidian-drawio)](LICENSE)

Embed, preview, and edit [draw.io](https://www.drawio.com/) (diagrams.net) diagrams directly in your notes. Previews render fully offline on every platform, and diagrams are stored as readable, diff-friendly XML.

![Embed preview with the multi-page switcher](https://raw.githubusercontent.com/doge-liang/obsidian-drawio/main/docs/assets/hero.png)

## Highlights

- **Three surfaces, one plugin** — inline `` ```drawio `` code blocks, standalone `.drawio` files (Excalidraw-style: the editor lives right in the file's tab), and `![[file.drawio]]` embeds. All three render live SVG previews in both editing and reading views; click any preview to edit.
- **Offline previews, always** — previews are produced by drawio's own viewer bundled into the plugin: no iframe, no network, on desktop and mobile alike.
- **Offline editor, optionally** — the editor defaults to a bundled, fully offline drawio build served from a local server. Store installs don't include the bundle (~145 MB); install it with one click from the plugin settings, or switch the editor source to Online.
- **Readable, git-friendly storage** — diagrams are saved as uncompressed, pretty-printed XML rather than a compressed blob, so diffs, sync, and version history stay meaningful.
- **Multi-page aware** — multi-page diagrams get a compact page switcher (‹ 2 / 5 ›) under the preview, and `![[file.drawio#Page-2]]` opens the embed on the page named "Page-2".
- **Fits into Obsidian** — follows your light/dark theme, keeps working in popped-out windows, sanitizes rendered SVG before insertion, and supports phones and tablets (preview-only there — see [Platform support](#platform-support)).

## Quick start

1. Install **Drawio** from the [community plugin store](https://obsidian.md/plugins?id=drawio-editor) and enable it (requires Obsidian 1.4.0+).
2. Click the **ribbon button**, run the **Create new diagram** command, or right-click a folder in the file explorer and choose **New drawio diagram**.
3. A new `.drawio` file opens with the editor embedded in its tab. Draw — changes autosave back to the file.

The editor needs one of: the offline editor installed (one click in settings, ~53 MB download), or **Editor source → Online** in the plugin settings. See [Offline editor](#offline-editor-optional).

## Usage

| Surface | Create | Edit |
| --- | --- | --- |
| **Code block** | Add a `` ```drawio `` block in any note (start empty, or paste drawio XML) | Click the preview → full-screen modal |
| **`.drawio` file** | Ribbon button / **Create new diagram** command / folder context menu | Editor embedded directly in the file's tab |
| **Embed** | `![[your-diagram.drawio]]` in any note | Click the preview → quick-edit modal |

All three render as SVG previews in both editing and reading views, and every edit autosaves back to its source — the code block's XML or the `.drawio` file. Embeds re-render automatically when the underlying file changes.

![The drawio editor embedded in a file tab](https://raw.githubusercontent.com/doge-liang/obsidian-drawio/main/docs/assets/file-editor.png)

**Multi-page diagrams:** previews show a page switcher (‹ N / M ›) below the diagram when it has more than one page. `![[file.drawio#Page-2]]` selects the initial page by its name (falling back to the first page if no page matches). Opening the editor always shows all page tabs.

### Platform support

| Feature | Desktop | Tablet | Phone |
| --- | :---: | :---: | :---: |
| Code block & embed previews (editing and reading views) | Yes | Yes | Yes |
| Standalone `.drawio` file tab | Inline editor (or read-only preview, opt-in) | Read-only preview | Read-only preview |
| Multi-page page switcher & `#Page-N` embeds | Yes | Yes | Yes |
| Light/dark theme following | Yes | Yes | Yes |
| Editing diagrams (modal / inline editor) | Yes | — | — |
| Creating diagrams (ribbon, command, folder menu) | Yes | — | — |
| Offline editor (bundled webapp + local server) | Yes | — | — |

Phones and tablets behave identically: previews everywhere, no editing. Tapping a preview there shows a notice that editing needs desktop; the creation entry points are hidden as well, since their sole purpose is opening the editor.

<img src="https://raw.githubusercontent.com/doge-liang/obsidian-drawio/main/docs/assets/mobile-preview.png" alt="Read-only preview on mobile" width="320">

## Settings

| Setting | Description |
| --- | --- |
| **Editor source** | **Offline** (bundled webapp, default), **Online** (diagrams.net), or a **Custom URL**. Offline requires the one-time install below — there is no automatic fallback. |
| **Custom drawio URL** | Used when Editor source is "Custom URL" (e.g. `https://embed.diagrams.net/`). |
| **New diagram location** | Where the command and ribbon button create diagrams: vault root (default), the current note's folder, or a fixed folder (created if missing). The folder context menu always creates in the clicked folder. |
| **Open diagram files read-only** | Desktop: show a static preview instead of the embedded editor when opening `.drawio` files — for workflows centred on drawio-desktop. Applies to newly opened tabs. |
| **Preview click action** | Desktop: what clicking a preview does — open the built-in editor (default), open the file in the system default app, or nothing. Code blocks always use the built-in editor (they have no file). |
| **Preview alignment** | Center (default) or left-align rendered previews. |
| **Follow Obsidian theme** | Match the editor to Obsidian's light/dark theme. |
| **Show shape libraries** | Toggle the editor's shape panel. |
| **Server idle timeout** | Stop the local server after this idle period (minimum 5 s). Only relevant in Offline mode. |

On mobile, only **Preview alignment** and **Follow Obsidian theme** are shown — the other settings configure the desktop editor.

## Network use

- **Previews never use the network.** They are rendered by drawio's `viewer.min.js`, which is bundled into the plugin.
- **With the bundled offline editor**, the plugin makes **no network requests at all** — the editor is served from a local `127.0.0.1` HTTP server.
- **When the bundle isn't installed**, Offline mode shows an install prompt instead of silently going online. If you choose **Online** (or a Custom URL), the editor UI is loaded from that origin. Your diagram content still stays on your device — it is passed to the editor in the page and is **not uploaded**; only the editor's assets are fetched.

## Offline editor (optional)

A store install ships without the offline drawio webapp (it is ~145 MB, beyond store limits). To install it, open **Settings → Drawio**, select **Editor source → Offline (bundled webapp)**, and click **Install** — a one-time ~53 MB download from GitHub; editing is fully offline afterwards.

Building from source also works and produces the same layout: run `npm run fetch-drawio` before `npm run build` and copy the `webapp/` folder alongside `main.js` (see Development below).

## Notes & limitations

- **Editing is desktop-only** — it needs the iframe-based drawio editor and, in Offline mode, a local HTTP server. Mobile gets previews (see [Platform support](#platform-support)).
- **Bundle size**: `main.js` is ~2.4 MB because drawio's viewer (~2.3 MB) is inlined for offline previews. This is expected.
- **Security**: rendered SVG previews are sanitized before insertion — script/embedding elements, inline event handlers, script-bearing URL schemes, external `<use>` references, SMIL injection, and dangerous CSS are removed, while drawio's `foreignObject` text labels are preserved. The bundled viewer runs without injecting any `<script>` element, and its one external-script loader (an unused MathJax-from-CDN helper) is stripped at build time, so previews fetch and execute no external code. In Offline mode the local server binds to `127.0.0.1` only and serves solely the bundled `webapp/` directory.

## Development

```bash
npm install
npm run fetch-drawio   # once per clone: fetch the drawio webapp + preview viewer
npm run dev            # watch build
npm test               # unit tests (vitest)
npm run build          # type-check + production bundle
```

Bug reports and pull requests are welcome — please open an [issue](https://github.com/doge-liang/obsidian-drawio/issues) first for larger changes.

## License

[MIT](LICENSE)
