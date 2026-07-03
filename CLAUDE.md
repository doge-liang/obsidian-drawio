# CLAUDE.md

Guidance for working on this repo. The plugin is **shipped** (GitHub releases cut,
in/through Obsidian community review). Most future work is adding features or
fixing bugs on a stable base — so the priority is **not regressing the non-obvious
decisions below**, many of which were made to satisfy the plugin-review scanner or
to work around drawio/Obsidian quirks.

## What this is

An Obsidian **desktop-only** plugin that embeds, previews, and edits
[draw.io](https://www.drawio.com/) (diagrams.net) diagrams. Plugin **id is
`drawio-editor`** (the bare `drawio` id is reserved — do not change it back).

Three surfaces:
- **Code blocks** — ` ```drawio ` blocks: rendered as an SVG preview, click to edit.
- **Standalone `.drawio` files** — opened in a dedicated tab with the editor embedded inline (Excalidraw-style).
- **Embeds** — `![[file.drawio]]` in any note: inline preview in both editing and reading views, click to edit.

## Two independent rendering engines (important mental model)

1. **Editing** uses the drawio **embed app** in an `<iframe>` over the `postMessage`
   JSON protocol (`src/editor/`). Source = online `embed.diagrams.net`, the bundled
   offline webapp via a local server, or a custom URL.
2. **Previews** use the bundled **`viewer.min.js`** (drawio's `GraphViewer`) to
   produce a static, sanitized SVG (`src/preview/`). Fully offline, **no iframe, no
   network** — the viewer is bundled into `main.js`.

These are separate; a change to one rarely affects the other.

## Module map

- `src/main.ts` — plugin entry: settings, local server, registers the code-block
  processor / file view / embeds / `Create new diagram` command / settings tab.
  `resolveBaseUrl()` picks the editor URL (offline → local server, with **automatic
  online fallback** when the webapp isn't installed).
- `src/constants.ts` — view type, file ext, `ONLINE_DRAWIO_URL`, `EMPTY_DIAGRAM`, `buildEmbedQuery`.
- `src/settings.ts` / `src/settingsTab.ts` — settings model + settings tab.
- `src/model/` — `DrawioSource` (edit-target abstraction: code block or file),
  `xmlUtils` (`isValidDrawioXml`/`ensureMxfile`), `formatXml` (pretty-print),
  `codeBlockEdit`/`locateBlock` (find & replace a block's XML in a note).
- `src/codeblock/` — code-block processor + `CodeBlockSource`.
- `src/file/` — `DrawioFileView` (inline-editor tab, a `TextFileView`),
  `EmbedRenderer` (via `app.embedRegistry`, with a Reading-view post-processor
  fallback), `FileSource`.
- `src/editor/` — `DrawioEditor` (iframe + postMessage), `DrawioModal`, `embedMessages`.
- `src/preview/` — `ViewerRenderer` (`renderPreview`), `loadViewer`, `svgSanitizer`,
  `editHint`, and the vendored `viewer.min.txt`.
- `src/server/` — `ServerManager` (local `127.0.0.1` HTTP server serving the offline
  webapp, with idle shutdown) + `portDetector`.

## Build / test / dev

- `npm run fetch-drawio` — **run once before building.** Downloads pinned drawio
  (`draw.war`, v30.0.4) into `webapp/` and copies `js/viewer.min.js` →
  `src/preview/viewer.min.txt`. Both `webapp/` and `viewer.min.txt` are **gitignored**
  (so a fresh clone must run this first). Needs network + `unzip` or `python3`.
- `npm run build` — `tsc -noEmit` then esbuild production bundle → `main.js` (gitignored).
- `npm run dev` — esbuild watch.
- `npm test` — vitest (unit tests in `tests/`).

Local manual testing installs to a vault by copying `main.js` + `manifest.json` +
`styles.css` (and optionally `webapp/`) into `<vault>/.obsidian/plugins/<folder>/`.
The vault used during development is
`/mnt/d/Knowledge/.obsidian/plugins/obsidian-drawio/` (folder name is the old
`obsidian-drawio`; the manifest id inside is `drawio-editor`).

## Non-obvious decisions — DO NOT casually revert

- **Previews run the viewer via *indirect eval*, not a `<script>` element**
  (`src/preview/loadViewer.ts`). The plugin-review scanner flags
  `createElement("script")` as a blocking error; indirect eval (`win.eval(src)`) has
  identical global-scope semantics (top-level `var GraphViewer` → `window.GraphViewer`)
  without creating a script element. **Don't reintroduce `createElement('script')`.**
- **Build-time viewer sanitization** (`esbuild.config.mjs`,
  `sanitizeDrawioViewerPlugin`). drawio's `viewer.min.js` contains one
  external-`<script>` loader (a MathJax-from-CDN helper, unused offline). It is
  stripped at build time, with an **assertion that exactly one match is removed** —
  so a drawio version bump that changes the minified shape **fails the build loudly**
  instead of silently shipping it. If you bump drawio, expect to update the
  `VIEWER_SCRIPT_LOADER` pattern.
- **`svgSanitizer.ts` is a custom scrub, NOT DOMPurify.** DOMPurify strips
  `foreignObject`, which erases drawio's `html=1` text labels. Do **not** swap back to
  DOMPurify. It still removes script/embedding elements, `on*` handlers,
  script-bearing URL schemes (normalised against control-char obfuscation), external
  `<use>`, SMIL injection, and dangerous CSS. Covered by `tests/svgSanitizer.test.ts`.
- **`settingsTab.ts` uses `display()`, not `getSettingDefinitions()`** on purpose.
  The declarative API is Obsidian 1.13+; `minAppVersion` is `1.0.0`, so
  `getSettingDefinitions` trips `obsidianmd/no-unsupported-api` (an error). `display()`
  only carries a deprecation *warning* — accepted tradeoff. Keep it unless
  `minAppVersion` is raised.
- **`onunload()` must NOT `detachLeavesOfType`.** Detaching resets the user's view to
  its default location on next load. Only stop the server.
- **Default editor mode is `offline`** with automatic online fallback. The ~145 MB
  `webapp/` can't ship via the store, so store installs have no webapp and
  `resolveBaseUrl()` falls back to `ONLINE_DRAWIO_URL` (one-time Notice, not a throw).
- **Popout-window safety**: use `activeDocument`/`activeWindow` (baseline-supported),
  not `document`/`window`, in render paths.
- **`Vault.createFolder()` requires Obsidian 1.4.0+** (it carries a `@since 1.4.0`
  JSDoc tag in `obsidian.d.ts`) — newer than our `minAppVersion` of `1.0.0`, so a bare
  call trips `obsidianmd/no-unsupported-api`. `src/file/createDiagram.ts` guards it
  with `if (requireApiVersion('1.4.0')) { vault.createFolder(...) } else {
  vault.adapter.mkdir(...) }` — `requireApiVersion` is the pattern the lint rule
  itself recognizes as a valid guard (see `isGuardedByRequireApiVersion` in
  `eslint-plugin-obsidianmd`'s `no-unsupported-api` rule), and `DataAdapter.mkdir` is
  untagged (available since the first plugin API). **If you add any new Obsidian API
  call, don't assume "it's basic, it must be old"** — check for a `@since` tag in
  `node_modules/obsidian/obsidian.d.ts` before assuming it's minAppVersion-safe. To
  reproduce a `no-unsupported-api` finding locally instead of guessing from a
  reviewer-relayed line number (those can be off by a few lines in transcription):
  `npm install --no-save eslint-plugin-obsidianmd typescript-eslint`, then run
  ```js
  // eslint.check.config.mjs (delete after use; don't commit)
  import obsidianmd from 'eslint-plugin-obsidianmd';
  import tseslint from 'typescript-eslint';
  export default tseslint.config({
    files: ['src/**/*.ts'],
    languageOptions: { parser: tseslint.parser, parserOptions: {
      project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } },
    plugins: { obsidianmd },
    rules: { 'obsidianmd/no-unsupported-api': 'error' },
  });
  ```
  via `npx eslint --no-config-lookup -c ./eslint.check.config.mjs src/`. `--no-save`
  keeps `package.json`/`package-lock.json` untouched (`node_modules` is gitignored
  anyway).

## Release process

- **`env -u GITHUB_TOKEN`** is required for all `gh`/`git` write ops (the ambient PAT
  lacks scope; the `doge-liang` oauth login has it).
- Bump `manifest.json` `version` **and** add the matching entry to `versions.json`.
- The release **tag must exactly equal** `manifest.version` (no `v` prefix) **and
  point to a commit whose `manifest.json` already has that version** (a past failure
  was a tag landing on a pre-bump commit).
- Attach `main.js`, `manifest.json`, `styles.css` as release assets:
  `env -u GITHUB_TOKEN gh release create <ver> main.js manifest.json styles.css --target main`.
- Publishing a new release is how the Obsidian review **re-runs**.

## Review status (as of 0.2.1)

All blocking **Errors** found so far are fixed: dynamic `<script>` creation (0.1.3)
and `Vault.createFolder` outrunning `minAppVersion` (0.2.1, see above). Whenever you
add a new feature that touches an Obsidian API you haven't used before, run the local
`no-unsupported-api` repro (above) before shipping — it's cheap and catches this
class of error before a review round-trip. Remaining findings are non-blocking and
mostly inherent to the vendored drawio viewer:
- `fs` access (Warning) — ours: the local offline server + webapp existence check. Necessary, desktop-only.
- Clipboard / Local Storage / Dynamic Code Execution (Recommendations) — all from the
  vendored drawio `viewer.min.js`, not our code (our one indirect eval adds to the
  eval recommendation but stays non-blocking).
- `display` deprecation (Warning) — deliberate, see above.
- Missing artifact attestations (Recommendation) — would require a GitHub Actions
  build with `actions/attest-build-provenance`; not yet set up.
