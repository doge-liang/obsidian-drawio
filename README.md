# Obsidian Drawio

Embed, preview, and edit [draw.io](https://www.drawio.com/) (diagrams.net) diagrams directly in your notes. Fully offline by default with a bundled editor; falls back to the online diagrams.net editor when the bundle isn't installed.

## Features

- **Code blocks**: store diagram XML inline in a ` ```drawio ` block, preview it as SVG (in both editing and reading views), and click to edit it in a full-screen modal.
- **Standalone `.drawio` files**: open a `.drawio` file in a dedicated tab with the drawio editor embedded inline (Excalidraw-style), edited directly in place.
- **Embeds**: embed a diagram file in any note with `![[diagram.drawio]]`; it renders inline in both editing and reading views, and click opens a quick-edit modal.
- **Offline or online editor**: by default the editor is the bundled, fully offline build (served from a local HTTP server) embedded in the tab. If the bundled webapp isn't installed it automatically falls back to the online diagrams.net editor, so it works out of the box either way. A custom embed URL is also supported.
- **Readable storage**: diagrams are saved as uncompressed, pretty-printed multi-line XML, so the underlying source stays diff-friendly and readable.
- **Theme-aware**: the editor follows Obsidian's light/dark theme.

## Network use

With the **bundled offline editor** (the default when installed), this plugin makes **no network requests** — the editor is served from a local `127.0.0.1` HTTP server. If the bundled webapp isn't present, the editor falls back to loading the UI from **diagrams.net** (`https://embed.diagrams.net/`); in that case your diagram content still stays on your device (it is passed to the editor in the page and is **not uploaded**), but the editor's assets are fetched over the network. You can also explicitly choose **Online** or a **Custom URL** in settings. Diagram **previews** never use the network: they are rendered by drawio's `viewer.min.js`, which is bundled into the plugin.

## Requirements

- **Desktop only.** The plugin uses Node/Electron APIs (and a local HTTP server for the offline editor), so it does not run on Obsidian mobile.

## Install

- **From the Community Plugins store**: install **Drawio** and enable it. The bundled offline webapp isn't part of the store download, so the editor automatically uses the online diagrams.net editor — it works immediately, no extra setup. To switch to the fully offline editor, see below.

### Offline editor (optional)

The Online editor needs a network connection. For a fully offline editor, build from source so the bundled webapp is available:

1. `npm install`
2. `npm run fetch-drawio` — downloads the offline drawio webapp (~40 MB `draw.war` download; requires network access to GitHub, plus either `unzip` or `python3` on PATH for extraction). This populates `webapp/` (~145 MB extracted on disk — the full offline editor with all shape libraries) and generates `src/preview/viewer.min.txt`.
3. `npm run build`
4. Copy `main.js`, `manifest.json`, `styles.css`, and the `webapp/` folder into your vault at `<vault>/.obsidian/plugins/drawio/`. Note: `webapp/` is ~145 MB, so the installed plugin folder is large.
5. Enable **Drawio**, then set **Editor source → Offline (bundled webapp)** in the plugin settings.

## Usage

- **New diagram file**: run the command **"Create new diagram"**, click the **ribbon button**, or **right-click a folder** in the file explorer and choose **"New drawio diagram"**. A new `.drawio` file is created (in the folder configured by **New diagram location**, or in the right-clicked folder) and opened with the editor embedded in the tab.
- **Inline diagram**: add a ` ```drawio ` code block (paste drawio XML, or start empty and edit). It renders as a preview in both editing and reading views.
- **Embed a file**: `![[your-diagram.drawio]]` in any note.
- **To edit**, click anywhere on a preview (a centered **Edit** hint appears on hover) to open the editor; standalone `.drawio` files open the editor directly in their tab. Changes autosave back to the source (the code block, or the file).

## Settings

- **Editor source** — Offline (bundled webapp, default), Online (diagrams.net), or a Custom URL. Offline falls back to Online automatically when the bundled webapp isn't installed.
- **Custom drawio URL** — used when Editor source is "Custom URL" (e.g. `https://embed.diagrams.net/`).
- **New diagram location** — where the command and the ribbon button create new diagrams: vault root (default), the same folder as the current note, or a fixed folder (created automatically if missing). The folder context menu always creates in the clicked folder.
- **Preview alignment** — center (default) or left-align rendered previews (embeds and code blocks).
- **Follow Obsidian theme** — match the editor to light/dark.
- **Show shape libraries** — toggle the editor's shape panel.
- **Server idle timeout (seconds)** — stop the local server after this idle period (minimum 5). Only relevant in Offline mode.

## Development

- `npm run dev` — watch build (rebuilds `main.js` on change).
- `npm test` — unit tests (vitest): XML utils, code-block locating/replacement, embed protocol messages, SVG sanitizer, port detection, the local server, and the preview renderer error path.
- `npm run build` — type-check + production bundle.

## Notes & limitations

- **Bundle size**: `main.js` includes drawio's `viewer.min.js` (~2.3 MB) inlined for offline previews, so the built `main.js` is ~2.4 MB. This is expected.
- **Multi-page diagrams**: a code-block or embed **preview shows only the first page** of a multi-page diagram. Click to edit to reach the other pages (the editor shows all page tabs).
- **Embed refresh**: an `![[file.drawio]]` embed re-renders automatically when the file is modified (including edits made through this plugin elsewhere).
- **Multi-page embed subpaths**: a page selector like `![[file.drawio#Page-2]]` is ignored — the embed always shows the first page.
- **Desktop only**: see Requirements above.
- **Security**: rendered SVG previews are sanitized before insertion — `<script>`/embedding elements, inline event handlers, script-bearing URL schemes (normalised to defeat control-character obfuscation), external `<use>` references, SMIL attribute injection, and dangerous CSS are removed, while drawio's `foreignObject` text labels are preserved. The bundled drawio preview engine (`viewer.min.js`) is run in the page's global scope without injecting a `<script>` element, and its one external-script loader (a MathJax-from-CDN helper, unused by offline previews) is stripped at build time — so previews fetch and execute no external code. In Offline mode the local server binds to `127.0.0.1` only and serves solely the bundled `webapp/` directory.

## License

MIT
