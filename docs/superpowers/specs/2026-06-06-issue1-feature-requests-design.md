# Design: issue #1 feature requests (0.2.0)

Date: 2026-06-06. Approved by owner in-session.

Implements the three requests from GitHub issue #1 (GandalfUFR), in the
requester's priority order:

1. Preference for a default folder for new diagrams.
2. "New diagram" entry points: file-explorer folder context menu + ribbon button.
3. Option to left-align rendered previews instead of centered.

## 1. Settings model (`src/settings.ts`)

```ts
export type NewDiagramLocation = 'root' | 'current' | 'folder';
export type PreviewAlignment = 'center' | 'left';

// added to DrawioSettings:
newDiagramLocation: NewDiagramLocation; // default 'root'  (= current behaviour)
newDiagramFolder: string;               // used when newDiagramLocation === 'folder'
previewAlignment: PreviewAlignment;     // default 'center' (= current behaviour)
```

Defaults preserve existing behaviour exactly.

## 2. Creation flow (new module `src/file/createDiagram.ts`)

- `resolveNewDiagramFolder(settings, activeFileParentPath: string | null): string`
  — **pure function**, unit-tested:
  - `'root'` → `''`
  - `'current'` → the active file's parent path; `''` when there is no active file
  - `'folder'` → `settings.newDiagramFolder` normalized (trim, strip leading/
    trailing slashes, collapse `\` → `/`); `''` if the setting is empty
- `createNewDiagram(plugin, folderOverride?: TFolder): Promise<void>`
  - `folderOverride` (from the context menu) wins over settings resolution.
  - Ensures the target folder exists, creating it **segment by segment**
    (`vault.createFolder` per missing segment — avoids relying on recursive
    creation working across `minAppVersion` 1.0.0).
  - If a path segment exists but is a **file**, show a `Notice` and abort.
  - Filename stays `Untitled Diagram <Date.now()>.drawio` (not in scope).
  - Creates the file with `EMPTY_DIAGRAM` and opens it in a new tab
    (same as the existing command).
  - Any create failure → `Notice` with the error, no throw.

## 3. Entry points (registered in `src/main.ts`, all call `createNewDiagram`)

- The existing **command** `Create new diagram` — now routes through
  `createNewDiagram(this)` so it honours the location setting.
- **Ribbon**: `addRibbonIcon('workflow', 'Create new drawio diagram', ...)`.
- **Folder context menu**: `registerEvent(workspace.on('file-menu', ...))` —
  only when the target is a `TFolder`, add item "New drawio diagram"
  (icon `workflow`) creating in that folder.

## 4. Preview alignment (`src/preview/`, `styles.css`)

- `RenderOptions` gains `align: PreviewAlignment`; `renderPreview` toggles the
  `drawio-align-left` class on the container. Single point — all callers
  (code block, embed both paths) pass `plugin.settings.previewAlignment`.
- CSS: `.drawio-preview.drawio-align-left { text-align: left; }` and
  `.drawio-preview.drawio-align-left svg { margin: 0; }`.
- Applies to **both embeds and code blocks** for visual consistency.
- Takes effect on (re-)render — i.e. when a note is reopened/switched after
  changing the setting. No body-class instant-apply: it would need per-popout
  document handling for marginal UX gain.

## 5. Settings tab (`src/settingsTab.ts`, existing `display()` style)

- "New diagram location" dropdown: Vault root / Same folder as current note /
  In the folder specified below.
- "New diagram folder" text field — shown only when location is `'folder'`
  (conditional re-display, same pattern as the custom-URL field).
- "Preview alignment" dropdown: Center (default) / Left.

## 6. Testing

- `tests/createDiagram.test.ts` — `resolveNewDiagramFolder` covering the three
  modes, no-active-file fallback, and path normalization.
- `tests/viewerRenderer.sizing.test.ts` — extend: `align: 'left'` adds the
  class; `'center'` does not.
- Creation flow (vault mutations) is exercised manually in the dev vault.

## 7. Release

- Version **0.2.0** (features, backwards compatible), `versions.json` entry,
  GitHub release with `main.js` + `manifest.json` + `styles.css`.
- Reply on issue #1 after release.

## Out of scope

- Per-embed alignment override (`![[x.drawio|left]]`).
- Filename pattern changes.
- Multi-page preview / `#Page-N` subpaths.
