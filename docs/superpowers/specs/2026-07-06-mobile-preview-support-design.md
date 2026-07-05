# Mobile Preview Support — Design Spec

## Goal

Let the plugin install and run on Obsidian mobile (phone/tablet), supporting
**preview only**: rendered code-block and embed diagrams, plus a read-only view
for standalone `.drawio` files. Editing (the iframe-based drawio embed app,
online or offline) stays desktop-only in this phase.

## Background: why the plugin currently can't even load on mobile

`manifest.json` currently declares `isDesktopOnly: true`. Independent of that
flag, the plugin would fail to load on mobile anyway: `main.ts` has a
top-level, static `import { ServerManager } from './server/ServerManager'`,
and `ServerManager.ts` has top-level static imports of `node:http`, `node:fs`,
and `node:path`. `main.ts` itself also has top-level static imports of
`node:path` (`join`) and `node:fs` (`existsSync`).

`esbuild.config.mjs` marks all Node built-ins (`builtinModules` plus `'node:*'`)
as `external` — they are not bundled, just left as `require(...)` calls in the
compiled CJS output. Because these imports are **static** (not inside a
function or a dynamic `import()`), esbuild hoists the corresponding
`require("node:http")` etc. calls to unconditional, module-top-level
statements in the bundled `main.js`. On mobile (Obsidian's Capacitor-based
app, no Node.js runtime), evaluating `main.js` would throw immediately at that
`require` call — crashing the **entire plugin load**, before `onload()` even
runs. This would break even the mobile-safe preview features, since nothing
plugin-specific runs until the module finishes loading.

Fixing this load-time crash is required no matter how large or small the
mobile-support scope ends up being. The codebase already has a working
precedent for the fix: `onload()` already uses dynamic `await import(...)` for
several feature modules (codeblock, file view, embeds, createDiagram,
settingsTab). A dynamic `import()` is not hoisted — the underlying `require()`
call it compiles to only executes when that `import()` expression actually
runs. Converting the Node-built-in imports (and the `ServerManager` import)
from static to dynamic, gated behind `Platform.isDesktopApp`, removes the
crash without needing to relocate any file's *contents* — only its import
style and the call sites that reach it.

`Platform` (`Platform.isDesktopApp` / `isMobile` / `isPhone` / `isTablet`) is
Obsidian's own stable, public API, `@since 0.12.2` — long publicly released,
well below this project's `minAppVersion` floor of `1.4.0`. No version guard
or `minAppVersion` bump is needed to use it.

## Scope decision

Two independent capabilities were considered: (a) preview-only mobile support,
and (b) preview + editing (forcing the online/custom iframe editor mode on
mobile, since the offline bundled webapp + local Node server are fundamentally
desktop-only). **This spec covers (a) only.** Editing on mobile is
substantially riskier (touch UI concerns, mobile WebView/CSP behavior for a
third-party iframe, and — critically — requires real-device testing this
project has no way to automate or simulate) and is left as a candidate
follow-up project, not part of this spec.

## Architecture

`manifest.json`: `isDesktopOnly` changes from `true` to `false`.

A new module, `src/desktop/registerDesktopFeatures.ts`, becomes the **only**
path through which anything Node/Electron-touching is reached. It houses:
building and holding the local `ServerManager` (and registering its
teardown), the ribbon icon, the `create-drawio-file` command, and the
folder-context-menu item. It does not register the `.drawio` file view — see
below, that stays a single unconditional call in `main.ts`.

`main.ts`'s `onload()`:

1. Registers everything mobile-safe unconditionally: the code-block
   processor, embed rendering, the settings tab, and the file-view
   registration for `.drawio` files (see below — the *class* it instantiates
   is chosen by platform, but the registration call itself is unconditional
   and lives in `main.ts`, not in the desktop module).
2. `if (Platform.isDesktopApp) { const { registerDesktopFeatures } = await import('./desktop/registerDesktopFeatures'); await registerDesktopFeatures(this); }`

**Standing constraint** (to be added to CLAUDE.md's "Non-obvious decisions"
during implementation): top-level imports of `node:*` built-ins, or of
`electron`, may only appear inside `src/server/**` or `src/desktop/**`. Both
directories are only ever reached through the single dynamic-import chain
above. Any other file adding a top-level Node/Electron import silently
reintroduces the mobile load-time crash — this is exactly the kind of
easy-to-reintroduce regression this project's CLAUDE.md exists to guard
against, so the constraint must be written down, not just implied by the
current file layout.

## Files

**New:**

- `src/desktop/registerDesktopFeatures.ts` — takes the plugin instance;
  builds the `ServerManager` and assigns it to `plugin.server`, registers its
  teardown (`plugin.register(() => plugin.server?.stop())`), adds the ribbon
  icon, the `create-drawio-file` command, and the folder-context-menu item.
  Does **not** call `registerView` — that single call stays in `main.ts` (see
  below), since it must run unconditionally on both platforms, just picking a
  different class. Everything currently in `main.ts.onload()` that only makes
  sense on desktop moves here unchanged in behavior, except that one
  `registerView` call.
- `src/preview/DrawioMobileFileView.ts` — a read-only `TextFileView` for
  `.drawio` files on mobile. Renders a small fixed banner ("Drawio: preview
  only on mobile — open this file on desktop to edit") followed by the
  diagram rendered via the same `renderPreview` used by code blocks and
  embeds. Implements `getViewData`/`setViewData`/`clear` as required by
  `TextFileView`, but `setViewData` only ever (re-)renders; there is no write
  path, no iframe, no editor.

**Changed:**

- `main.ts` — `server` field becomes `server: ServerManager | null = null`
  (honest about mobile never assigning it; `onunload()`'s existing
  `this.server?.stop()` already handles this correctly, no change needed
  there). The `ServerManager` import and the `node:path`/`node:fs` imports
  move from top-level static imports to dynamic imports at their point of use
  (inside the desktop-gated code paths). `onload()` gains the
  `Platform.isDesktopApp` branch described above, and its single
  `registerView(DRAWIO_VIEW_TYPE, ...)` call branches on
  `Platform.isDesktopApp` to dynamically import and instantiate either
  `DrawioFileView` (desktop, already dynamically imported today — unchanged)
  or `DrawioMobileFileView` (mobile, new). `registerExtensions([DRAWIO_FILE_EXT], DRAWIO_VIEW_TYPE)`
  stays a single unconditional call after that branch, unchanged on both
  platforms.
- `src/settingsTab.ts` — in `display()`, the "Editor source", "Custom drawio
  URL", and "Server idle timeout" rows, plus "Show shape libraries" (an
  editor-only concern), are wrapped in `if (Platform.isDesktopApp) { ... }`.
  "Preview alignment" and "Follow Obsidian theme" are shown on both
  platforms, unchanged.
- `src/codeblock/DrawioCodeBlock.ts`, `src/file/EmbedRenderer.ts` — the
  `addEditHint(...)` call is skipped on mobile (`Platform.isDesktopApp`
  check); the click handler on mobile shows
  `new Notice('Drawio: editing is only available on desktop')` instead of
  calling `plugin.openEditor(...)`.

## Behavior on mobile

- Code-block and embed previews render identically to desktop (the
  rendering path — `renderPreview`/`loadViewer`/`svgSanitizer` — has no
  platform dependency and needs no changes); only the click affordance
  differs (Notice instead of opening the editor).
- Opening a standalone `.drawio` file shows `DrawioMobileFileView`: a fixed
  banner plus the rendered diagram, no editing.
- The settings tab shows only "Preview alignment" and "Follow Obsidian
  theme".
- The ribbon icon, "Create new diagram" command, and the folder
  right-click "New drawio diagram" item are not registered at all — their
  only purpose is opening the editor, which doesn't exist on mobile in this
  phase.

## Error handling / edge cases

- `main.ts`'s `server` field changes from `server!: ServerManager` (definite
  assignment assertion) to `server: ServerManager | null = null`, since
  mobile never assigns it. `onunload()`'s existing `this.server?.stop()`
  already tolerates `null` correctly.
- `buildServer()` (constructing the `ServerManager` and registering its
  teardown) moves entirely inside `registerDesktopFeatures`, so it never runs
  on mobile and never touches `node:http`/`node:fs`/`node:path` there.
- No fallback branch is needed for `Platform.isDesktopApp` misdetection —
  it's Obsidian's own stable, public API; trust it the same way the rest of
  the codebase trusts other Obsidian-provided platform facts.

## Testing

**Automated (vitest/jsdom):**

- Mock `obsidian`'s `Platform` export to assert `onload()` registers
  `registerDesktopFeatures` only when `Platform.isDesktopApp` is true, and
  never touches `ServerManager` when it's false.
- `DrawioMobileFileView`: given XML, renders the expected SVG container, no
  iframe created, no write path exercised.
- Settings tab: `display()` renders the desktop-only rows only when
  `Platform.isDesktopApp` is true.
- Code block / embed click handling: on mobile, clicking shows a `Notice`
  and does not call `openEditor`; `addEditHint` is not invoked.

**Manual only (real device, the user's own environment — this project has no
way to run or simulate Obsidian mobile):**

- The plugin actually installs and loads without crashing on real mobile
  Obsidian — the core problem this project fixes.
- Rendering fidelity and performance of previews in the mobile WebView.
- Touch tap-target sizing for the page-switcher control and the
  edit-Notice tap target.
- The Notice's actual on-device appearance/timing.
