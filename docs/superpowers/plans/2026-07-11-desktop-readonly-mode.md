# Desktop Read-only Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in desktop read-only mode for `.drawio` files plus a configurable preview click action (built-in editor / system default app / do nothing) — issue #3, phase 1.

**Architecture:** A new pure `resolveClickAction()` module maps the setting to per-surface behavior; the mobile file view is renamed to `DrawioPreviewFileView` and generalized for desktop; the view factory in `main.ts` branches on the new `readonlyFileView` setting per leaf creation. Spec: `docs/superpowers/specs/2026-07-11-desktop-readonly-mode-design.md`.

**Tech Stack:** TypeScript, Obsidian plugin API, vitest (jsdom), esbuild.

## Global Constraints

- No static top-level `node:*`/`electron` imports outside `src/server/**`/`src/desktop/**` (this feature needs none at all).
- `app.openWithDefaultApp` is an untyped Obsidian internal: feature-detect it (like `embedRegistry` in `EmbedRenderer.ts`), never cast to a typed API; Notice fallback, no throw.
- No regex literals with lookbehind/named groups/`\p{}` anywhere.
- Settings tab stays on the imperative `display()` API with the shared `save()` closure.
- Mobile behavior is unchanged: banner, notice-on-tap for embeds/code blocks, no click action on the file view.
- `window.setTimeout`-style rules and popout safety (`activeDocument`) as per CLAUDE.md (no new timers/window references are needed here).

---

### Task 1: Settings model

**Files:**
- Modify: `src/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces: `PreviewClickAction = 'editor' | 'defaultApp' | 'none'` (exported type), `DrawioSettings.readonlyFileView: boolean` (default `false`), `DrawioSettings.previewClickAction: PreviewClickAction` (default `'editor'`).

- [ ] **Step 1: Write the failing tests** — in `tests/settings.test.ts` add:

```ts
  it('defaults to the editable file view with the built-in editor click action', () => {
    expect(DEFAULT_SETTINGS.readonlyFileView).toBe(false);
    expect(DEFAULT_SETTINGS.previewClickAction).toBe('editor');
  });
```

and add `'previewClickAction'`, `'readonlyFileView'` to the key list in the shape-drift test.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/settings.test.ts` → FAIL (missing keys).

- [ ] **Step 3: Implement** — in `src/settings.ts` add after `PreviewAlignment`:

```ts
export type PreviewClickAction = 'editor' | 'defaultApp' | 'none';
```

to `DrawioSettings`:

```ts
  /** Desktop: open .drawio files as a static preview instead of the editor. */
  readonlyFileView: boolean;
  /** Desktop: what clicking a preview does (embeds and read-only file tabs). */
  previewClickAction: PreviewClickAction;
```

to `DEFAULT_SETTINGS`:

```ts
  readonlyFileView: false,
  previewClickAction: 'editor',
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/settings.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/settings.ts tests/settings.test.ts && git commit -m "feat: add readonlyFileView and previewClickAction settings"`

### Task 2: Click-action module

**Files:**
- Create: `src/preview/clickAction.ts`
- Test: `tests/clickAction.test.ts`

**Interfaces:**
- Consumes: `PreviewClickAction` from Task 1.
- Produces: `resolveClickAction(action: PreviewClickAction, surface: 'codeblock' | 'file'): ResolvedClickAction` where `ResolvedClickAction = { kind: 'editor' | 'defaultApp' | 'none'; hint?: { label: string; icon: string }; title: string }`; `openWithDefaultApp(app: App, path: string): void`.

- [ ] **Step 1: Write the failing tests** — create `tests/clickAction.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import { resolveClickAction, openWithDefaultApp } from '../src/preview/clickAction';

describe('resolveClickAction', () => {
  it('maps "editor" to the built-in editor on every surface', () => {
    for (const surface of ['codeblock', 'file'] as const) {
      const r = resolveClickAction('editor', surface);
      expect(r.kind).toBe('editor');
      expect(r.hint).toEqual({ label: 'Edit', icon: 'pencil' });
      expect(r.title).toBe('Click to edit diagram');
    }
  });

  it('maps "defaultApp" to the system default app for file-backed surfaces', () => {
    const r = resolveClickAction('defaultApp', 'file');
    expect(r.kind).toBe('defaultApp');
    expect(r.hint).toEqual({ label: 'Open', icon: 'external-link' });
    expect(r.title).toBe('Click to open in default app');
  });

  it('falls back to the built-in editor for "defaultApp" on code blocks (no file)', () => {
    const r = resolveClickAction('defaultApp', 'codeblock');
    expect(r.kind).toBe('editor');
    expect(r.hint).toEqual({ label: 'Edit', icon: 'pencil' });
  });

  it('maps "none" to no action, no hint, and a plain tooltip on every surface', () => {
    for (const surface of ['codeblock', 'file'] as const) {
      const r = resolveClickAction('none', surface);
      expect(r.kind).toBe('none');
      expect(r.hint).toBeUndefined();
      expect(r.title).toBe('Drawio diagram');
    }
  });
});

describe('openWithDefaultApp', () => {
  it('calls the app internal with the path when available', () => {
    const open = vi.fn();
    openWithDefaultApp({ openWithDefaultApp: open } as unknown as App, 'diagram.drawio');
    expect(open).toHaveBeenCalledWith('diagram.drawio');
  });

  it('does not throw when the internal is missing', () => {
    expect(() => openWithDefaultApp({} as App, 'diagram.drawio')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/clickAction.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/preview/clickAction.ts`:

```ts
import { App, Notice } from 'obsidian';
import type { PreviewClickAction } from '../settings';

export type PreviewSurface = 'codeblock' | 'file';

export interface ResolvedClickAction {
  kind: 'editor' | 'defaultApp' | 'none';
  /** Hover-hint label and icon; absent when kind is 'none' (no hint shown). */
  hint?: { label: string; icon: string };
  /** Tooltip for the preview container. */
  title: string;
}

/**
 * Map the click-action setting to concrete per-surface behavior. Code blocks
 * have no underlying file, so 'defaultApp' falls back to the built-in editor
 * there — the only surface-dependent row in the matrix.
 */
export function resolveClickAction(
  action: PreviewClickAction,
  surface: PreviewSurface,
): ResolvedClickAction {
  if (action === 'none') return { kind: 'none', title: 'Drawio diagram' };
  if (action === 'defaultApp' && surface === 'file') {
    return {
      kind: 'defaultApp',
      hint: { label: 'Open', icon: 'external-link' },
      title: 'Click to open in default app',
    };
  }
  return { kind: 'editor', hint: { label: 'Edit', icon: 'pencil' }, title: 'Click to edit diagram' };
}

/**
 * Open a vault file in the OS default application. `App.openWithDefaultApp`
 * is an Obsidian internal that isn't in the public typings, so it's
 * feature-detected (same pattern as EmbedRenderer's embedRegistry) with a
 * Notice fallback instead of a throw.
 */
export function openWithDefaultApp(app: App, path: string): void {
  const internal = app as unknown as { openWithDefaultApp?: (path: string) => unknown };
  if (typeof internal.openWithDefaultApp === 'function') {
    internal.openWithDefaultApp(path);
  } else {
    new Notice('Drawio: this Obsidian version cannot open files in the default app.');
  }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/clickAction.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/preview/clickAction.ts tests/clickAction.test.ts && git commit -m "feat: add preview click-action resolution and default-app opener"`

### Task 3: Parameterize the edit hint

**Files:**
- Modify: `src/preview/editHint.ts`
- Test: `tests/editHint.dom.test.ts`

**Interfaces:**
- Produces: `addEditHint(parent: HTMLElement, label = 'Edit', icon = 'pencil'): void` (backwards-compatible defaults; all existing call sites stay valid).

- [ ] **Step 1: Write the failing test** — add to `tests/editHint.dom.test.ts`:

```ts
  it('renders a custom label when given one', () => {
    const parent = document.createElement('div');
    addEditHint(parent, 'Open', 'external-link');
    const labels = Array.from(parent.querySelectorAll('.drawio-edit-hint span'));
    expect(labels.some((s) => s.textContent === 'Open')).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/editHint.dom.test.ts` → FAIL (extra args ignored by current signature → label stays "Edit").

- [ ] **Step 3: Implement** — in `src/preview/editHint.ts` change the signature and body:

```ts
export function addEditHint(parent: HTMLElement, label = 'Edit', icon = 'pencil'): void {
  const hint = parent.createDiv({ cls: 'drawio-edit-hint' });
  setIcon(hint.createSpan({ cls: 'drawio-edit-hint-icon' }), icon);
  hint.createSpan({ text: label });
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/editHint.dom.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/preview/editHint.ts tests/editHint.dom.test.ts && git commit -m "feat: allow custom label and icon on the preview hover hint"`

### Task 4: Generalize the read-only file view

**Files:**
- Rename: `src/preview/DrawioMobileFileView.ts` → `src/preview/DrawioPreviewFileView.ts`
- Rename: `tests/drawioMobileFileView.test.ts` → `tests/drawioPreviewFileView.test.ts`
- Modify: `src/main.ts:22-28` (import/factory), `styles.css:59-66`

**Interfaces:**
- Consumes: `resolveClickAction`/`openWithDefaultApp` (Task 2), `addEditHint(parent, label, icon)` (Task 3), `renderPageControl`, `getDiagramPages`/`ensureMxfile`, `FileSource`.
- Produces: `class DrawioPreviewFileView extends TextFileView` with constructor `(leaf: WorkspaceLeaf, plugin: DrawioPlugin)` — consumed by Task 7's view factory.

- [ ] **Step 1: Rename files** — `git mv src/preview/DrawioMobileFileView.ts src/preview/DrawioPreviewFileView.ts && git mv tests/drawioMobileFileView.test.ts tests/drawioPreviewFileView.test.ts`

- [ ] **Step 2: Write the failing tests** — replace `tests/drawioPreviewFileView.test.ts` with:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock the viewer.min.txt file to avoid needing to fetch it
vi.mock('../src/preview/viewer.min.txt', () => ({ default: 'window.GraphViewer = window.GraphViewer || undefined;' }));

import { Platform, TFile } from 'obsidian';
import { DrawioPreviewFileView } from '../src/preview/DrawioPreviewFileView';
import type { PreviewClickAction } from '../src/settings';
import type DrawioPlugin from '../src/main';

function fakePlugin(
  previewClickAction: PreviewClickAction = 'editor',
  openEditor = vi.fn(),
  app: Record<string, unknown> = {},
): DrawioPlugin {
  return {
    app,
    settings: { previewClickAction },
    previewOpts: () => ({ dark: false, align: 'center' as const }),
    openEditor,
  } as unknown as DrawioPlugin;
}

function makeView(plugin: DrawioPlugin, withFile = true): DrawioPreviewFileView {
  const view = new DrawioPreviewFileView({} as never, plugin);
  if (withFile) {
    view.file = Object.assign(new TFile(), { path: 'diagram.drawio', basename: 'diagram' });
  }
  return view;
}

const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" ' +
  'gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" ' +
  'pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">' +
  '<root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

const MULTI_PAGE_XML = '<mxfile>' +
  '<diagram id="0" name="Page-1"><mxGraphModel/></diagram>' +
  '<diagram id="1" name="Page-2"><mxGraphModel/></diagram>' +
  '</mxfile>';

describe('DrawioPreviewFileView', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  it('on mobile renders the fixed banner and the diagram, with no iframe and no hint', () => {
    Platform.isDesktopApp = false;
    const view = makeView(fakePlugin());
    view.setViewData(XML, true);
    const banner = view.contentEl.querySelector('.drawio-mobile-banner');
    expect(banner?.textContent).toContain('preview only on mobile');
    expect(view.contentEl.querySelector('.drawio-preview')).not.toBeNull();
    expect(view.contentEl.querySelector('iframe')).toBeNull();
    expect(view.contentEl.querySelector('.drawio-edit-hint')).toBeNull();
  });

  it('on mobile ignores clicks (no editor, no default app)', () => {
    Platform.isDesktopApp = false;
    const openEditor = vi.fn();
    const openWithDefaultApp = vi.fn();
    const view = makeView(fakePlugin('editor', openEditor, { openWithDefaultApp }));
    view.setViewData(XML, true);
    view.contentEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(openWithDefaultApp).not.toHaveBeenCalled();
  });

  it('on desktop skips the banner and opens the modal editor on click ("editor")', () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const view = makeView(fakePlugin('editor', openEditor));
    view.setViewData(XML, true);
    expect(view.contentEl.querySelector('.drawio-mobile-banner')).toBeNull();
    const hintLabels = Array.from(view.contentEl.querySelectorAll('.drawio-edit-hint span'));
    expect(hintLabels.some((s) => s.textContent === 'Edit')).toBe(true);
    view.contentEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('on desktop opens the system default app on click ("defaultApp")', () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const openWithDefaultApp = vi.fn();
    const view = makeView(fakePlugin('defaultApp', openEditor, { openWithDefaultApp }));
    view.setViewData(XML, true);
    const hintLabels = Array.from(view.contentEl.querySelectorAll('.drawio-edit-hint span'));
    expect(hintLabels.some((s) => s.textContent === 'Open')).toBe(true);
    view.contentEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openWithDefaultApp).toHaveBeenCalledWith('diagram.drawio');
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('on desktop does nothing on click ("none"), with no hint', () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const openWithDefaultApp = vi.fn();
    const view = makeView(fakePlugin('none', openEditor, { openWithDefaultApp }));
    view.setViewData(XML, true);
    expect(view.contentEl.querySelector('.drawio-edit-hint')).toBeNull();
    view.contentEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(openWithDefaultApp).not.toHaveBeenCalled();
  });

  it('renders the page switcher for multi-page diagrams', () => {
    Platform.isDesktopApp = true;
    const view = makeView(fakePlugin());
    view.setViewData(MULTI_PAGE_XML, true);
    expect(view.contentEl.querySelector('.drawio-page-control')).not.toBeNull();
  });

  it('getViewData returns the last data set (no write path)', () => {
    Platform.isDesktopApp = false;
    const view = makeView(fakePlugin());
    view.setViewData(XML, true);
    expect(view.getViewData()).toBe(XML);
  });

  it('clear() empties the content element and resets the data', () => {
    Platform.isDesktopApp = false;
    const view = makeView(fakePlugin());
    view.setViewData(XML, true);
    view.clear();
    expect(view.contentEl.children.length).toBe(0);
    expect(view.getViewData()).toBe('');
  });

  it('reports the shared drawio view type and a pencil-ruler icon', () => {
    const view = makeView(fakePlugin(), false);
    expect(view.getViewType()).toBe('drawio-file-view');
    expect(view.getIcon()).toBe('pencil-ruler');
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run tests/drawioPreviewFileView.test.ts` → FAIL (`DrawioPreviewFileView` not exported).

- [ ] **Step 4: Implement** — replace `src/preview/DrawioPreviewFileView.ts` with:

```ts
import { Platform, TextFileView, WorkspaceLeaf } from 'obsidian';
import { DRAWIO_VIEW_TYPE } from '../constants';
import { renderPreview } from './ViewerRenderer';
import { renderPageControl } from './pageControl';
import { addEditHint } from './editHint';
import { resolveClickAction, openWithDefaultApp } from './clickAction';
import { getDiagramPages, ensureMxfile } from '../model/xmlUtils';
import { FileSource } from '../file/FileSource';
import type DrawioPlugin from '../main';

/**
 * Read-only view for `.drawio` files: a static preview rendered via the same
 * renderPreview used by code blocks and embeds. No iframe, no editor. Used
 * unconditionally on mobile (no editor there), and on desktop when the
 * "Open diagram files read-only" setting is enabled — there the click action
 * follows the "Preview click action" setting.
 */
export class DrawioPreviewFileView extends TextFileView {
  constructor(leaf: WorkspaceLeaf, private plugin: DrawioPlugin) {
    super(leaf);
    this.data = '';
    // One listener for the view's lifetime; render() only refreshes children.
    this.contentEl.addEventListener('click', () => { this.onPreviewClick(); });
  }

  getViewType(): string { return DRAWIO_VIEW_TYPE; }
  getIcon(): string { return 'pencil-ruler'; }
  getViewData(): string { return this.data; }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    this.render();
  }

  clear(): void {
    this.data = '';
    this.contentEl.empty();
  }

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass('drawio-preview-file-view');

    const action = resolveClickAction(this.plugin.settings.previewClickAction, 'file');
    if (Platform.isDesktopApp) {
      c.setAttribute('title', action.title);
      c.toggleClass('drawio-clickable', action.kind !== 'none');
    } else {
      c.createDiv({
        cls: 'drawio-mobile-banner',
        text: 'Drawio: preview only on mobile — open this file on desktop to edit.',
      });
    }

    const preview = c.createDiv({ cls: 'drawio-preview' });
    const pages = getDiagramPages(ensureMxfile(this.data));
    renderPreview(preview, this.data, { ...this.plugin.previewOpts(), page: 0 });

    if (pages.length > 1) {
      const pageControlEl = c.createDiv({ cls: 'drawio-page-control' });
      renderPageControl(pageControlEl, {
        pages,
        initialPage: 0,
        onPageChange: (page) => {
          renderPreview(preview, this.data, { ...this.plugin.previewOpts(), page });
        },
      });
    }

    if (Platform.isDesktopApp && action.hint) {
      addEditHint(c, action.hint.label, action.hint.icon);
    }
  }

  private onPreviewClick(): void {
    if (!Platform.isDesktopApp || !this.file) return;
    // Resolve at click time so a settings change applies without reopening.
    const action = resolveClickAction(this.plugin.settings.previewClickAction, 'file');
    if (action.kind === 'editor') {
      this.plugin.openEditor(new FileSource(this.plugin.app, this.file));
    } else if (action.kind === 'defaultApp') {
      openWithDefaultApp(this.plugin.app, this.file.path);
    }
  }
}
```

- [ ] **Step 5: Update the mobile import in `src/main.ts`** (keeps the build green until Task 7 wires the desktop factory; change ONLY the else-branch lines 25-28):

```ts
    } else {
      const { DrawioPreviewFileView } = await import('./preview/DrawioPreviewFileView');
      this.registerView(DRAWIO_VIEW_TYPE, (leaf) => new DrawioPreviewFileView(leaf, this));
    }
```

- [ ] **Step 6: Update `styles.css`** — replace the mobile-view block (lines 59-66) with:

```css
/* ---- Read-only file view (.drawio files: always on mobile, opt-in on desktop) ---- */
.drawio-preview-file-view { position: relative; height: 100%; overflow: auto; padding: 12px; }
.drawio-preview-file-view.drawio-clickable { cursor: pointer; }
.drawio-preview-file-view:hover .drawio-edit-hint,
.drawio-preview-file-view:focus-within .drawio-edit-hint { opacity: .92; }
.drawio-mobile-banner {
  margin-bottom: 12px; padding: 6px 12px;
  border: 1px solid var(--background-modifier-border); border-radius: 6px;
  background: var(--background-secondary); color: var(--text-muted);
  font-size: var(--font-ui-small);
}
```

- [ ] **Step 7: Run to verify pass** — `npx vitest run tests/drawioPreviewFileView.test.ts` then `npx tsc -noEmit` → PASS, no type errors (no remaining references to `DrawioMobileFileView`).
- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: generalize the read-only file view for desktop use"`

### Task 5: Code-block click action

**Files:**
- Modify: `src/codeblock/DrawioCodeBlock.ts`
- Test: `tests/drawioCodeBlockMobile.test.ts`

**Interfaces:**
- Consumes: `resolveClickAction` (Task 2), `addEditHint(parent, label, icon)` (Task 3).

- [ ] **Step 1: Write the failing tests** — in `tests/drawioCodeBlockMobile.test.ts`, extend `fakePlugin` to accept a click action (default `'editor'`) and add `settings` to the raw object:

```ts
function fakePlugin(openEditor: DrawioPlugin['openEditor'], previewClickAction = 'editor') {
  let processor: Processor | undefined;
  const raw = {
    app: {},
    settings: { previewClickAction },
    previewOpts: () => ({ dark: false, align: 'center' as const }),
    openEditor,
    registerMarkdownCodeBlockProcessor: (_lang: string, cb: Processor) => { processor = cb; },
  };
  return {
    plugin: raw as unknown as DrawioPlugin,
    run: (source: string, el: HTMLElement, ctx: unknown) => processor!(source, el, ctx),
  };
}
```

and add two desktop cases:

```ts
  it('still opens the built-in editor under "defaultApp" (code blocks have no file)', () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor, 'defaultApp');
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('does nothing on click under "none", with no edit hint', () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor, 'none');
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(el.querySelector('.drawio-edit-hint')).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/drawioCodeBlockMobile.test.ts` → the `"none"` case FAILS (editor still opens).

- [ ] **Step 3: Implement** — in `src/codeblock/DrawioCodeBlock.ts`: add `import { resolveClickAction } from '../preview/clickAction';`; in `renderCodeBlock` replace the `wrapper.setAttribute('title', ...)` line, the `addEditHint` block, and the click listener with:

```ts
  const action = resolveClickAction(plugin.settings.previewClickAction, 'codeblock');
  wrapper.setAttribute('title', Platform.isDesktopApp ? action.title : 'Drawio diagram');
  wrapper.toggleClass('drawio-no-action', Platform.isDesktopApp && action.kind === 'none');
```

```ts
  if (Platform.isDesktopApp && action.hint) {
    addEditHint(wrapper, action.hint.label, action.hint.icon);
  }

  // Click anywhere on the diagram (the centered hint shows on hover). The
  // action is re-resolved at click time so settings changes apply to
  // already-rendered blocks. Mobile has no editor — show a Notice instead.
  wrapper.addEventListener('click', () => {
    if (!Platform.isDesktopApp) {
      new Notice('Drawio: editing is only available on desktop');
      return;
    }
    const current = resolveClickAction(plugin.settings.previewClickAction, 'codeblock');
    if (current.kind === 'editor') {
      plugin.openEditor(new CodeBlockSource(plugin.app, ctx, el, source));
    }
  });
```

and add to `styles.css` (after the `.drawio-edit-hint` hover rules):

```css
/* Previews whose click action is "Do nothing" shouldn't advertise clickability. */
.drawio-codeblock.drawio-no-action, .drawio-embed.drawio-no-action { cursor: default; }
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/drawioCodeBlockMobile.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/codeblock/DrawioCodeBlock.ts tests/drawioCodeBlockMobile.test.ts styles.css && git commit -m "feat: honor the preview click action in code blocks"`

### Task 6: Embed click action

**Files:**
- Modify: `src/file/EmbedRenderer.ts` (both the registry embed and the reading-view fallback)
- Test: `tests/embedRendererMobile.test.ts`

**Interfaces:**
- Consumes: `resolveClickAction`/`openWithDefaultApp` (Task 2), `addEditHint(parent, label, icon)` (Task 3).

- [ ] **Step 1: Write the failing tests** — in `tests/embedRendererMobile.test.ts`, extend `fakePlugin` with a click action and an app-level `openWithDefaultApp` spy:

```ts
function fakePlugin(openEditor: DrawioPlugin['openEditor'], previewClickAction = 'editor') {
  let creator: Creator | undefined;
  const openWithDefaultApp = vi.fn();
  const file = Object.assign(new TFile(), { path: 'diagram.drawio', basename: 'diagram' });
  const raw = {
    app: {
      embedRegistry: {
        registerExtension: (_ext: string, c: Creator) => { creator = c; },
      },
      vault: { read: async () => XML, on: vi.fn(() => ({})) },
      openWithDefaultApp,
    },
    settings: { previewClickAction },
    previewOpts: () => ({ dark: false, align: 'center' as const }),
    openEditor,
    register: vi.fn(),
  };
  return {
    plugin: raw as unknown as DrawioPlugin,
    create: (containerEl: HTMLElement) => creator!({ containerEl }, file, undefined),
    openWithDefaultApp,
  };
}
```

and add two desktop cases:

```ts
  it('opens the system default app on click under "defaultApp"', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, create, openWithDefaultApp } = fakePlugin(openEditor, 'defaultApp');
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();
    containerEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openWithDefaultApp).toHaveBeenCalledWith('diagram.drawio');
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('does nothing on click under "none", with no edit hint', async () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, create, openWithDefaultApp } = fakePlugin(openEditor, 'none');
    registerDrawioEmbeds(plugin);
    const containerEl = document.createElement('div');
    const embed = create(containerEl);
    await embed.loadFile();
    containerEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(openWithDefaultApp).not.toHaveBeenCalled();
    expect(containerEl.querySelector('.drawio-edit-hint')).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/embedRendererMobile.test.ts` → both new cases FAIL.

- [ ] **Step 3: Implement** — in `src/file/EmbedRenderer.ts`: add `import { resolveClickAction, openWithDefaultApp } from '../preview/clickAction';`.

In `DrawioFileEmbed.render()` replace the title line with:

```ts
    const action = resolveClickAction(this.plugin.settings.previewClickAction, 'file');
    el.setAttribute('title', Platform.isDesktopApp ? action.title : 'Drawio diagram');
    el.toggleClass('drawio-no-action', Platform.isDesktopApp && action.kind === 'none');
```

replace the `addEditHint` block with:

```ts
      if (Platform.isDesktopApp && action.hint) {
        addEditHint(el, action.hint.label, action.hint.icon);
      }
```

and replace the click listener body with:

```ts
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!Platform.isDesktopApp) {
          new Notice('Drawio: editing is only available on desktop');
          return;
        }
        // Re-resolved at click time so settings changes apply immediately.
        const current = resolveClickAction(this.plugin.settings.previewClickAction, 'file');
        if (current.kind === 'editor') {
          this.plugin.openEditor(new FileSource(this.plugin.app, this.file));
        } else if (current.kind === 'defaultApp') {
          openWithDefaultApp(this.plugin.app, this.file.path);
        }
      });
```

In `registerEmbedPostProcessor` replace the title line and the click listener with:

```ts
      const action = resolveClickAction(plugin.settings.previewClickAction, 'file');
      span.setAttribute('title', Platform.isDesktopApp ? action.title : 'Drawio diagram');
      span.addEventListener('click', () => {
        if (!Platform.isDesktopApp) {
          new Notice('Drawio: editing is only available on desktop');
          return;
        }
        const current = resolveClickAction(plugin.settings.previewClickAction, 'file');
        if (current.kind === 'editor') {
          plugin.openEditor(new FileSource(plugin.app, file));
        } else if (current.kind === 'defaultApp') {
          openWithDefaultApp(plugin.app, file.path);
        }
      });
```

In `renderEmbedInto` replace the `addEditHint` block with:

```ts
    const action = resolveClickAction(plugin.settings.previewClickAction, 'file');
    span.toggleClass('drawio-no-action', Platform.isDesktopApp && action.kind === 'none');
    if (Platform.isDesktopApp && action.hint) {
      addEditHint(span, action.hint.label, action.hint.icon);
    }
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/embedRendererMobile.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/file/EmbedRenderer.ts tests/embedRendererMobile.test.ts && git commit -m "feat: honor the preview click action in embeds"`

### Task 7: View factory and settings tab

**Files:**
- Modify: `src/main.ts:22-28`, `src/settingsTab.ts`
- Test: `tests/settingsTab.test.ts`

**Interfaces:**
- Consumes: `DrawioPreviewFileView` (Task 4), `readonlyFileView`/`previewClickAction`/`PreviewClickAction` (Task 1).

- [ ] **Step 1: Write the failing tests** — in `tests/settingsTab.test.ts` add to the desktop case:

```ts
    expect(names).toContain('Open diagram files read-only');
    expect(names).toContain('Preview click action');
```

and to the mobile case:

```ts
    expect(names).not.toContain('Open diagram files read-only');
    expect(names).not.toContain('Preview click action');
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/settingsTab.test.ts` → desktop case FAILS.

- [ ] **Step 3: Implement settings rows** — in `src/settingsTab.ts`: extend the type-only import to `import type { DrawioMode, NewDiagramLocation, PreviewAlignment, PreviewClickAction } from './settings';` and append inside the first `if (Platform.isDesktopApp)` block (after the "New diagram folder" conditional):

```ts
      new Setting(containerEl)
        .setName('Open diagram files read-only')
        .setDesc(
          'Show a static preview instead of the embedded editor when opening .drawio files. ' +
          'Applies to newly opened tabs. Pair with "Preview click action" below for a ' +
          'drawio-desktop-centred workflow.',
        )
        .addToggle((t) => t
          .setValue(s.readonlyFileView)
          .onChange((v) => { s.readonlyFileView = v; save(); }));

      new Setting(containerEl)
        .setName('Preview click action')
        .setDesc(
          'What clicking a diagram preview does (embeds and read-only file tabs). Code blocks ' +
          'have no underlying file, so they always open the built-in editor unless ' +
          '"Do nothing" is selected.',
        )
        .addDropdown((d) => d
          .addOption('editor', 'Open built-in editor')
          .addOption('defaultApp', 'Open in system default app')
          .addOption('none', 'Do nothing')
          .setValue(s.previewClickAction)
          .onChange((v) => { s.previewClickAction = v as PreviewClickAction; save(); }));
```

- [ ] **Step 4: Implement the view factory** — in `src/main.ts` replace the desktop branch of the view registration (lines 22-25):

```ts
    if (Platform.isDesktopApp) {
      const { DrawioFileView } = await import('./file/DrawioFileView');
      const { DrawioPreviewFileView } = await import('./preview/DrawioPreviewFileView');
      // Decided per leaf creation, so toggling the setting affects newly
      // opened tabs without a plugin reload (already-open tabs keep their view).
      this.registerView(DRAWIO_VIEW_TYPE, (leaf) =>
        this.settings.readonlyFileView
          ? new DrawioPreviewFileView(leaf, this)
          : new DrawioFileView(leaf, this));
    } else {
```

- [ ] **Step 5: Run to verify pass** — `npx vitest run tests/settingsTab.test.ts` then `npx tsc -noEmit` → PASS.
- [ ] **Step 6: Commit** — `git add src/main.ts src/settingsTab.ts tests/settingsTab.test.ts && git commit -m "feat: wire read-only file view and click-action settings"`

### Task 8: Docs, full verification

**Files:**
- Modify: `README.md` (Platform support table, Settings table)

- [ ] **Step 1: README** — in the Platform support table change the `.drawio` tab row to:

```markdown
| Standalone `.drawio` file tab | Inline editor (or read-only preview, opt-in) | Read-only preview | Read-only preview |
```

and add to the Settings table:

```markdown
| **Open diagram files read-only** | Desktop: show a static preview instead of the embedded editor when opening `.drawio` files (for workflows centred on drawio-desktop). |
| **Preview click action** | Desktop: what clicking a preview does — open the built-in editor (default), open the file in the system default app, or nothing. Code blocks always use the built-in editor (they have no file). |
```

- [ ] **Step 2: Full test suite** — `npm test` → all green.
- [ ] **Step 3: Build** — `npm run build` (run `npm run fetch-drawio` first if `webapp/`/`viewer.min.txt` are missing) → succeeds; grep `main.js` for `import(` regressions is already enforced by the build plugin.
- [ ] **Step 4: CLAUDE.md checklist sweep** — confirm: no `node:*`/`electron` imports added; no regex literals added; no `createElement('script')`; `onunload` untouched; no typed-API additions (only the feature-detected internal).
- [ ] **Step 5: Commit** — `git add README.md && git commit -m "docs: document read-only mode and preview click action"`

## Self-Review Notes

- Spec coverage: settings (Task 1), click-action module + matrix (Task 2), hint parameterization (Task 3), view rename/generalization + styles (Task 4), code block (Task 5), embeds incl. fallback path (Task 6), factory + settings tab (Task 7), README + verification (Task 8). The spec's "resolve at click time" requirement is implemented in Tasks 4-6; "hint at render time" likewise.
- Type consistency: `ResolvedClickAction.hint?: { label, icon }` used identically in Tasks 4-6; `addEditHint(parent, label, icon)` matches Task 3.
- The `main.ts` factory branch has no direct unit test (constructing the full plugin is out of proportion for the existing harness — the pre-existing registerView call was equally untested); it is covered by `tsc`, the build, and manual verification.
