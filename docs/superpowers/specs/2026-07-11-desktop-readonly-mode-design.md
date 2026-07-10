# Desktop read-only mode — design

Date: 2026-07-11 · Issue: [#3](https://github.com/doge-liang/obsidian-drawio/issues/3) · Status: approved (phase 1 scope agreed with maintainer)

## Problem

Users whose primary editor is drawio-desktop want Obsidian to act as a **viewer**:
opening a `.drawio` file should show a static preview (what phones/tablets already
get) instead of the embedded iframe editor, and clicking a preview should be able
to hand the file to the system default app instead of launching the built-in
editor. Phase 1 covers exactly that; Copy/Replace buttons for code blocks are
deferred to a possible phase 2, pending confirmation from the issue author.

## Scope (phase 1)

1. **Opt-in read-only file view on desktop** — a setting that makes `.drawio`
   files open in the static preview view instead of the embedded editor.
2. **Configurable preview click action** — built-in editor (default) / system
   default app / do nothing — for file-backed surfaces (embeds and read-only
   file tabs). Code blocks have no underlying file, so "default app" cannot
   apply to them; they keep the built-in editor unless the action is "none".

Out of scope: Copy/Replace buttons (phase 2), mobile behavior changes, any
change to the embedded editor itself.

## Settings model (`src/settings.ts`)

```ts
export type PreviewClickAction = 'editor' | 'defaultApp' | 'none';

readonlyFileView: boolean;            // default false
previewClickAction: PreviewClickAction; // default 'editor'
```

Both are desktop-only in effect (mobile is already read-only and its click
behavior — a notice — is unchanged); the settings rows render only on desktop.

## Click-action resolution (`src/preview/clickAction.ts`, new)

A pure function plus one side-effecting helper, unit-testable in isolation:

```ts
type PreviewSurface = 'codeblock' | 'file';
resolveClickAction(action: PreviewClickAction, surface: PreviewSurface): ResolvedClickAction
openWithDefaultApp(app: App, path: string): void
```

| action       | surface   | resolved kind | hover hint            | tooltip                          |
|--------------|-----------|---------------|-----------------------|----------------------------------|
| `editor`     | any       | `editor`      | pencil "Edit"         | "Click to edit diagram"          |
| `defaultApp` | codeblock | `editor`      | pencil "Edit"         | "Click to edit diagram"          |
| `defaultApp` | file      | `defaultApp`  | external-link "Open"  | "Click to open in default app"   |
| `none`       | any       | `none`        | none                  | "Drawio diagram"                 |

`openWithDefaultApp` feature-detects `app.openWithDefaultApp(path)` — an
Obsidian internal that is not in the public typings — the same way
`EmbedRenderer` feature-detects `app.embedRegistry`. If absent, it shows a
Notice instead of throwing. No Node/Electron import anywhere (mobile-safe by
construction).

Surfaces resolve the action **at click time** (so a settings change applies to
already-rendered previews); the hover hint and tooltip are resolved at render
time and catch up on the next re-render.

## Read-only file view (`src/preview/DrawioPreviewFileView.ts`, renamed)

`DrawioMobileFileView` is renamed to `DrawioPreviewFileView` (container CSS
class `drawio-preview-file-view`, replacing `drawio-mobile-file-view`) and
generalized:

- **Mobile** (unchanged behavior): fixed banner + preview, no click action.
- **Desktop**: no banner; hover hint, tooltip, and click behavior follow
  `previewClickAction` with surface `file` (`editor` opens the modal editor via
  `FileSource`; saves flow back through `vault.modify`, which re-renders the
  view through the normal `setViewData` path).
- **Both**: multi-page diagrams get the same page switcher as embeds and code
  blocks (an existing gap in the mobile view, fixed in passing).

No write path: `getViewData()` returns the last data set and `requestSave` is
never called, exactly as the mobile view behaves today.

## Wiring

- `src/main.ts` — the desktop view factory branches per leaf creation:
  `readonlyFileView ? DrawioPreviewFileView : DrawioFileView`. Already-open
  tabs keep their view; the setting applies to newly opened tabs (stated in the
  setting description). The mobile branch uses `DrawioPreviewFileView`
  unconditionally, as before the rename.
- `src/codeblock/DrawioCodeBlock.ts` and `src/file/EmbedRenderer.ts` (both the
  registry embed and the reading-view fallback) — hint/tooltip from
  `resolveClickAction` at render, action dispatch at click time.
- `src/settingsTab.ts` — two new desktop-only rows using the existing
  imperative `display()` pattern and shared `save()` closure:
  - Toggle "Open diagram files read-only".
  - Dropdown "Preview click action" (Open built-in editor / Open in system
    default app / Do nothing).

## Testing

- `tests/clickAction.test.ts` (new): resolution matrix; `openWithDefaultApp`
  calls the app method when present and falls back to a Notice when absent.
- `tests/drawioPreviewFileView.test.ts` (renamed): existing mobile assertions
  under `Platform.isDesktopApp = false`; new desktop cases (no banner, hint
  per action, click dispatch per action, page control for multi-page files).
- `tests/settings.test.ts`: new defaults + shape-drift key list.
- Embed/code-block tests: desktop cases for `defaultApp` and `none`.
- `tests/settingsTab.test.ts`: the two new rows render on desktop only.

## Review-checklist compliance (CLAUDE.md)

No Node/Electron imports touched; no new typed Obsidian API (the one internal,
`openWithDefaultApp`, is feature-detected with a graceful fallback, per the
`embedRegistry` precedent); no regex literals added; `onunload` untouched;
render paths keep using element-scoped handlers (popout-safe); settings tab
stays on `display()`.
