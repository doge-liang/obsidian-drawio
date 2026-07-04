# Multi-Page Preview Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact prev/next page-switcher to drawio previews (code blocks
and `![[file.drawio]]` embeds) so multi-page diagrams can be browsed without
opening the full editor, and wire up the currently-ignored `![[file.drawio#Page-2]]`
subpath as an embed's initial page.

**Architecture:** A new pure-function page parser (`getDiagramPages`) and a new,
framework-agnostic UI component (`renderPageControl`) are composed into the three
existing preview render call sites (code block, embed-registry path, embed
post-processor fallback). `ViewerRenderer.renderPreview` gains an optional `page`
index threaded into drawio's `GraphViewer` config (which already supports
per-page rendering). A page switch re-invokes `renderPreview` with a new page
index and the same in-memory XML — no new re-render machinery.

**Tech Stack:** TypeScript, esbuild, vitest + jsdom, Obsidian Plugin API
(`obsidian` npm package, types-only).

## Global Constraints

- `minAppVersion` is `1.13.0` — do not use any Obsidian API whose `obsidian.d.ts`
  `@since` tag exceeds this without a `requireApiVersion` guard.
- No new runtime `dependencies` in `package.json` — this plan adds no npm
  packages.
- Match the codebase's prevailing comment density: comment the non-obvious
  *why*, not line-by-line *what*.
- `npm test` (vitest) and `npm run build` (`tsc -noEmit` + esbuild) must both
  stay green after every task.
- Full design rationale lives in
  `docs/superpowers/specs/2026-07-04-multipage-preview-design.md` — this plan
  implements it; consult it for anything a task references but doesn't restate.

---

### Task 1: Diagram-page parsing (`src/model/xmlUtils.ts`)

**Files:**
- Modify: `src/model/xmlUtils.ts`
- Test: `tests/xmlUtils.test.ts`

**Interfaces:**
- Produces: `export interface DiagramPage { id: string; name: string; }`,
  `export function getDiagramPages(xml: string): DiagramPage[]`,
  `export function resolvePageFromSubpath(pages: DiagramPage[], subpath: string | undefined | null): number`
- Consumes: nothing (pure functions, no imports beyond what's already in the file)

**Note on scope**: the design spec suggested rewriting the existing
`extractDiagramTitle` as a thin wrapper over `getDiagramPages`. On closer
inspection while writing this plan, that would silently change its behavior:
`extractDiagramTitle('<mxfile><diagram>x</diagram></mxfile>')` currently returns
`null` (no `name` attribute present), but `getDiagramPages` deliberately
synthesizes a fallback name (`Page-1`) for unnamed pages, since the page-control
UI needs *some* displayable label for every page. Rewriting `extractDiagramTitle`
in terms of `getDiagramPages` would flip that specific case from `null` to
`"Page-1"`, breaking its existing (still-passing) test for no benefit —
`extractDiagramTitle` is unused anywhere in `src/` today. Leave it untouched;
this task is purely additive.

- [ ] **Step 1: Write the failing tests**

In `tests/xmlUtils.test.ts`, replace the existing import line:

```ts
import { isValidDrawioXml, ensureMxfile, extractDiagramTitle } from '../src/model/xmlUtils';
```

with:

```ts
import { isValidDrawioXml, ensureMxfile, extractDiagramTitle, getDiagramPages, resolvePageFromSubpath } from '../src/model/xmlUtils';
```

Keep the existing `describe('xmlUtils', ...)` block and its tests exactly as
they are; add these as two new, separate `describe` blocks at the bottom of
the same file:

```ts
describe('getDiagramPages', () => {
  it('returns one page for a single-diagram mxfile', () => {
    const xml = '<mxfile><diagram id="0" name="Page-1">x</diagram></mxfile>';
    expect(getDiagramPages(xml)).toEqual([{ id: '0', name: 'Page-1' }]);
  });

  it('returns all pages in document order for a multi-page mxfile', () => {
    const xml = '<mxfile>' +
      '<diagram id="a" name="Overview">x</diagram>' +
      '<diagram id="b" name="Details">y</diagram>' +
      '</mxfile>';
    expect(getDiagramPages(xml)).toEqual([
      { id: 'a', name: 'Overview' },
      { id: 'b', name: 'Details' },
    ]);
  });

  it('falls back to a generated id/name when attributes are missing', () => {
    const xml = '<mxfile><diagram>x</diagram></mxfile>';
    expect(getDiagramPages(xml)).toEqual([{ id: '0', name: 'Page-1' }]);
  });

  it('returns an empty array for a bare mxGraphModel with no diagram tags', () => {
    expect(getDiagramPages('<mxGraphModel><root/></mxGraphModel>')).toEqual([]);
  });

  it('does not leak regex lastIndex state across calls', () => {
    const longXml = '<mxfile>' +
      '<diagram id="a" name="A">x</diagram>' +
      '<diagram id="b" name="B">y</diagram>' +
      '<diagram id="c" name="C">z</diagram>' +
      '</mxfile>';
    const shortXml = '<mxfile><diagram id="a" name="A">x</diagram></mxfile>';
    getDiagramPages(longXml);
    expect(getDiagramPages(shortXml)).toEqual([{ id: 'a', name: 'A' }]);
  });
});

describe('resolvePageFromSubpath', () => {
  const pages = [{ id: '0', name: 'Page-1' }, { id: '1', name: 'Page-2' }];

  it('returns 0 when there is no subpath', () => {
    expect(resolvePageFromSubpath(pages, undefined)).toBe(0);
    expect(resolvePageFromSubpath(pages, null)).toBe(0);
    expect(resolvePageFromSubpath(pages, '')).toBe(0);
  });

  it('matches a page by name, with or without a leading #', () => {
    expect(resolvePageFromSubpath(pages, 'Page-2')).toBe(1);
    expect(resolvePageFromSubpath(pages, '#Page-2')).toBe(1);
  });

  it('falls back to 0 when no page name matches', () => {
    expect(resolvePageFromSubpath(pages, 'Nope')).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/xmlUtils.test.ts`
Expected: FAIL — `getDiagramPages`/`resolvePageFromSubpath` are not exported
from `../src/model/xmlUtils` (import error or `undefined is not a function`).

- [ ] **Step 3: Implement `getDiagramPages` and `resolvePageFromSubpath`**

Add to the end of `src/model/xmlUtils.ts` (after the existing
`extractDiagramTitle` function):

```ts
const DIAGRAM_TAG_RE = /<diagram\b([^>]*)>/g;
const ID_ATTR_RE = /\bid="([^"]*)"/;
const NAME_ATTR_RE = /\bname="([^"]*)"/;

export interface DiagramPage { id: string; name: string; }

/** Parse every `<diagram id="..." name="...">` opening tag from an mxfile, in
 *  document order. Missing id/name attributes get a generated fallback so every
 *  page always has a displayable label. */
export function getDiagramPages(xml: string): DiagramPage[] {
  const pages: DiagramPage[] = [];
  DIAGRAM_TAG_RE.lastIndex = 0; // the shared `g`-flagged regex is stateful across calls
  let match: RegExpExecArray | null;
  while ((match = DIAGRAM_TAG_RE.exec(xml))) {
    // noUncheckedIndexedAccess is on: match[1] types as `string | undefined`
    // even though this capture group always matches here.
    const attrs = match[1] ?? '';
    const id = ID_ATTR_RE.exec(attrs)?.[1] ?? String(pages.length);
    const name = NAME_ATTR_RE.exec(attrs)?.[1] ?? `Page-${pages.length + 1}`;
    pages.push({ id, name });
  }
  return pages;
}

/** Resolve a `![[file.drawio#Page-2]]`-style subpath (with or without the
 *  leading `#`) to a page index by matching `name`. Falls back to 0 (first
 *  page) when there's no subpath or no matching page name. */
export function resolvePageFromSubpath(
  pages: DiagramPage[],
  subpath: string | undefined | null,
): number {
  if (!subpath) return 0;
  const target = subpath.replace(/^#/, '');
  const index = pages.findIndex((p) => p.name === target);
  return index >= 0 ? index : 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/xmlUtils.test.ts`
Expected: PASS, all tests in the file (existing + new).

- [ ] **Step 5: Full test suite and type-check**

Run: `npm test && npx tsc -noEmit -skipLibCheck`
Expected: all suites PASS, `tsc` exits with no output.

- [ ] **Step 6: Commit**

```bash
git add src/model/xmlUtils.ts tests/xmlUtils.test.ts
git commit -m "feat: parse mxfile diagram pages and resolve #Page-N subpaths"
```

---

### Task 2: Thread a page index through `ViewerRenderer.renderPreview`

**Files:**
- Modify: `src/preview/ViewerRenderer.ts`
- Test: `tests/viewerRenderer.sizing.test.ts`

**Interfaces:**
- Consumes: nothing new from Task 1.
- Produces: `RenderOptions` gains `page?: number` (default `0`), threaded into
  the `data-mxgraph` config's `page` field that `renderPreview` already builds.
  No change to `renderPreview`'s exported signature or behavior otherwise.

- [ ] **Step 1: Write the failing test**

Add to `tests/viewerRenderer.sizing.test.ts`, inside the existing
`describe('renderPreview standalone-svg sizing', ...)` block (after the existing
two `it(...)` blocks, before the closing `});`):

```ts
  it('threads opts.page into the data-mxgraph config passed to GraphViewer', () => {
    const el = document.createElement('div');
    patchEl(el);
    let capturedConfig: any = null;
    const originalCreate = fakeViewer.createViewerForElement;
    fakeViewer.createViewerForElement = (mount: HTMLElement) => {
      capturedConfig = JSON.parse(mount.getAttribute('data-mxgraph')!);
      originalCreate(mount);
    };

    renderPreview(el, '<mxfile></mxfile>', { dark: false, page: 2 });

    expect(capturedConfig.page).toBe(2);
    fakeViewer.createViewerForElement = originalCreate;
  });

  it('defaults opts.page to 0 when not passed', () => {
    const el = document.createElement('div');
    patchEl(el);
    let capturedConfig: any = null;
    const originalCreate = fakeViewer.createViewerForElement;
    fakeViewer.createViewerForElement = (mount: HTMLElement) => {
      capturedConfig = JSON.parse(mount.getAttribute('data-mxgraph')!);
      originalCreate(mount);
    };

    renderPreview(el, '<mxfile></mxfile>', { dark: false });

    expect(capturedConfig.page).toBe(0);
    fakeViewer.createViewerForElement = originalCreate;
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/viewerRenderer.sizing.test.ts`
Expected: FAIL — `capturedConfig.page` is `undefined`, not `2` (the `data`
object built in `renderPreview` doesn't have a `page` field yet).

- [ ] **Step 3: Implement**

In `src/preview/ViewerRenderer.ts`, change the `RenderOptions` interface:

```ts
export interface RenderOptions {
  dark: boolean;
  /** Horizontal alignment of the rendered SVG; defaults to 'center'. */
  align?: PreviewAlignment;
  /** Which diagram page to render (0-indexed); defaults to 0 (first page). */
  page?: number;
}
```

And in `renderPreview`, change the `data` object construction:

```ts
  const data = {
    highlight: '#0000ff', nav: false, lightbox: false, toolbar: '', edit: null,
    // Render even when the mount is detached/hidden (reading view, lazy embeds).
    'check-visible-state': false,
    'dark-mode': opts.dark ? 'auto' : 'off',
    page: opts.page ?? 0,
    xml: ensureMxfile(xml),
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/viewerRenderer.sizing.test.ts`
Expected: PASS, all 4 tests in the file.

- [ ] **Step 5: Full test suite and type-check**

Run: `npm test && npx tsc -noEmit -skipLibCheck`
Expected: all suites PASS, `tsc` exits with no output.

- [ ] **Step 6: Commit**

```bash
git add src/preview/ViewerRenderer.ts tests/viewerRenderer.sizing.test.ts
git commit -m "feat: support rendering a specific diagram page in renderPreview"
```

---

### Task 3: Page-control UI component

**Files:**
- Create: `src/preview/pageControl.ts`
- Modify: `tests/setup.ts` (add a global Obsidian DOM-helper shim, needed for
  this task's test — see Step 1 rationale)
- Modify: `styles.css`
- Test: `tests/pageControl.test.ts`

**Interfaces:**
- Consumes: `DiagramPage` from `../src/model/xmlUtils` (Task 1).
- Produces: `export function renderPageControl(container: HTMLElement, opts: { pages: DiagramPage[]; initialPage: number; onPageChange: (page: number) => void }): void`

**Design note**: the codebase consistently uses Obsidian's DOM sugar
(`createDiv`/`createSpan`/`createEl`, added to `HTMLElement.prototype` at
runtime by Obsidian itself) rather than plain `document.createElement`. To keep
using that convention here (matching `editHint.ts`, `EmbedRenderer.ts`, etc.)
while still being able to unit-test this component in jsdom (which doesn't have
Obsidian's runtime prototype extensions), this task adds a small **global**
shim to `tests/setup.ts`. Existing test files that hand-roll a local
`patchEl`-style helper (`viewerRenderer.sizing.test.ts`, `viewerRenderer.dom.test.ts`)
are unaffected: those helpers assign the methods as *own properties* on
specific elements, which safely shadows the new prototype-level shim — nothing
to change there.

- [ ] **Step 1: Add the global DOM-helper shim to `tests/setup.ts`**

Current file:
```ts
// Obsidian exposes `activeDocument`/`activeWindow` globals (popout-window aware).
// jsdom doesn't, so map them to the test document/window for code that defaults
// to them.
const g = globalThis as unknown as { activeDocument?: Document; activeWindow?: Window };
g.activeDocument = document;
g.activeWindow = window;
```

Append to it:
```ts

// Obsidian's runtime extends HTMLElement with these DOM-building helpers.
// jsdom doesn't have them; shim the common ones globally so source code that
// uses them (createDiv/createSpan/createEl/empty) works in tests without each
// test file re-inventing the same patch.
interface ElAttrs { cls?: string | string[]; text?: string; }

function applyElAttrs(el: HTMLElement, attrs?: ElAttrs): void {
  if (!attrs) return;
  if (attrs.cls) el.className = Array.isArray(attrs.cls) ? attrs.cls.join(' ') : attrs.cls;
  if (attrs.text !== undefined) el.textContent = attrs.text;
}

const proto = HTMLElement.prototype as any;
proto.empty = function (this: HTMLElement) {
  while (this.firstChild) this.removeChild(this.firstChild);
};
proto.createDiv = function (this: HTMLElement, attrs?: ElAttrs) {
  const child = document.createElement('div');
  applyElAttrs(child, attrs);
  this.appendChild(child);
  return child;
};
proto.createSpan = function (this: HTMLElement, attrs?: ElAttrs) {
  const child = document.createElement('span');
  applyElAttrs(child, attrs);
  this.appendChild(child);
  return child;
};
proto.createEl = function (this: HTMLElement, tag: string, attrs?: ElAttrs) {
  const child = document.createElement(tag);
  applyElAttrs(child, attrs);
  this.appendChild(child);
  return child;
};
```

- [ ] **Step 2: Write the failing tests**

Create `tests/pageControl.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderPageControl } from '../src/preview/pageControl';
import type { DiagramPage } from '../src/model/xmlUtils';

const pages: DiagramPage[] = [
  { id: '0', name: 'Page-1' },
  { id: '1', name: 'Page-2' },
  { id: '2', name: 'Page-3' },
];

describe('renderPageControl', () => {
  it('shows "1 / 3" and disables the prev button at the first page', () => {
    const container = document.createElement('div');
    renderPageControl(container, { pages, initialPage: 0, onPageChange: () => {} });
    const [prevBtn, nextBtn] = Array.from(container.querySelectorAll('button'));
    expect(container.textContent).toContain('1 / 3');
    expect((prevBtn as HTMLButtonElement).disabled).toBe(true);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables the next button at the last page', () => {
    const container = document.createElement('div');
    renderPageControl(container, { pages, initialPage: 2, onPageChange: () => {} });
    const [prevBtn, nextBtn] = Array.from(container.querySelectorAll('button'));
    expect((prevBtn as HTMLButtonElement).disabled).toBe(false);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('advances the page, updates the indicator, and calls onPageChange when next is clicked', () => {
    const container = document.createElement('div');
    const onPageChange = vi.fn();
    renderPageControl(container, { pages, initialPage: 0, onPageChange });
    const [, nextBtn] = Array.from(container.querySelectorAll('button'));
    (nextBtn as HTMLButtonElement).click();
    expect(onPageChange).toHaveBeenCalledWith(1);
    expect(container.textContent).toContain('2 / 3');
  });

  it('goes back a page and calls onPageChange when prev is clicked', () => {
    const container = document.createElement('div');
    const onPageChange = vi.fn();
    renderPageControl(container, { pages, initialPage: 1, onPageChange });
    const [prevBtn] = Array.from(container.querySelectorAll('button'));
    (prevBtn as HTMLButtonElement).click();
    expect(onPageChange).toHaveBeenCalledWith(0);
    expect(container.textContent).toContain('1 / 3');
  });

  it('does not advance past the last page or call onPageChange', () => {
    const container = document.createElement('div');
    const onPageChange = vi.fn();
    renderPageControl(container, { pages, initialPage: 2, onPageChange });
    const [, nextBtn] = Array.from(container.querySelectorAll('button'));
    (nextBtn as HTMLButtonElement).click();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('does not go before the first page or call onPageChange', () => {
    const container = document.createElement('div');
    const onPageChange = vi.fn();
    renderPageControl(container, { pages, initialPage: 0, onPageChange });
    const [prevBtn] = Array.from(container.querySelectorAll('button'));
    (prevBtn as HTMLButtonElement).click();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('stops click propagation so a wrapper click handler is not also triggered', () => {
    const wrapper = document.createElement('div');
    const container = wrapper.createDiv();
    const wrapperClick = vi.fn();
    wrapper.addEventListener('click', wrapperClick);
    renderPageControl(container, { pages, initialPage: 0, onPageChange: () => {} });
    const [, nextBtn] = Array.from(container.querySelectorAll('button'));
    (nextBtn as HTMLButtonElement).click();
    expect(wrapperClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/pageControl.test.ts`
Expected: FAIL — cannot find module `../src/preview/pageControl` (file doesn't
exist yet).

- [ ] **Step 4: Implement `src/preview/pageControl.ts`**

```ts
import type { DiagramPage } from '../model/xmlUtils';

export interface PageControlOptions {
  pages: DiagramPage[];
  initialPage: number;
  onPageChange: (page: number) => void;
}

/**
 * Render a compact "‹ N / M ›" page-switcher bar into `container`. Caller is
 * responsible for only invoking this when `pages.length > 1` — this function
 * does not check that itself.
 */
export function renderPageControl(container: HTMLElement, opts: PageControlOptions): void {
  const { pages, onPageChange } = opts;
  let current = opts.initialPage;

  const prevBtn = container.createEl('button', { text: '‹' });
  const indicator = container.createSpan();
  const nextBtn = container.createEl('button', { text: '›' });

  function update(): void {
    indicator.textContent = `${current + 1} / ${pages.length}`;
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === pages.length - 1;
  }

  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (current === 0) return;
    current -= 1;
    update();
    onPageChange(current);
  });

  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (current === pages.length - 1) return;
    current += 1;
    update();
    onPageChange(current);
  });

  update();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/pageControl.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 6: Add CSS**

Append to `styles.css` (after the `.drawio-error` block, before the
`/* ---- Modal editor ---- */` comment):

```css
/* Multi-page navigation, rendered below the diagram when a file has >1 page. */
.drawio-page-control {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  margin-top: 4px; font-size: var(--font-ui-small); color: var(--text-muted);
}
.drawio-page-control button {
  background: none; border: none; padding: 2px 6px; margin: 0;
  font: inherit; color: inherit; cursor: pointer; line-height: 1;
}
.drawio-page-control button:disabled { opacity: .35; cursor: default; }
.drawio-page-control button:not(:disabled):hover { color: var(--text-normal); }
```

- [ ] **Step 7: Full test suite and type-check**

Run: `npm test && npx tsc -noEmit -skipLibCheck`
Expected: all suites PASS (including the 7 new `pageControl` tests and the
existing `viewerRenderer.dom`/`viewerRenderer.sizing` suites, unaffected by the
new global shim), `tsc` exits with no output.

- [ ] **Step 8: Commit**

```bash
git add src/preview/pageControl.ts tests/pageControl.test.ts tests/setup.ts styles.css
git commit -m "feat: add a prev/next page-control component for multi-page previews"
```

---

### Task 4: Wire the page control into code-block previews

**Files:**
- Modify: `src/codeblock/DrawioCodeBlock.ts`

**Interfaces:**
- Consumes: `getDiagramPages` from `../model/xmlUtils` (Task 1), `page` option
  on `RenderOptions` (Task 2), `renderPageControl` from `../preview/pageControl`
  (Task 3).
- Produces: no new exports; `renderCodeBlock`'s behavior changes (unaffected
  callers: `registerDrawioCodeBlock` calls it exactly as before).

This file has no existing unit tests (it depends on Obsidian's
`registerMarkdownCodeBlockProcessor` callback context, not mocked anywhere in
this repo) — validate with `tsc -noEmit` plus the consolidated manual test pass
in Task 7.

- [ ] **Step 1: Implement**

Replace the full contents of `src/codeblock/DrawioCodeBlock.ts`:

```ts
import { MarkdownPostProcessorContext } from 'obsidian';
import { renderPreview } from '../preview/ViewerRenderer';
import { renderPageControl } from '../preview/pageControl';
import { addEditHint } from '../preview/editHint';
import { getDiagramPages, ensureMxfile } from '../model/xmlUtils';
import { CodeBlockSource } from './CodeBlockSource';
import type DrawioPlugin from '../main';

export function registerDrawioCodeBlock(plugin: DrawioPlugin) {
  plugin.registerMarkdownCodeBlockProcessor('drawio', (source, el, ctx) => {
    renderCodeBlock(plugin, source, el, ctx);
  });
}

function renderCodeBlock(
  plugin: DrawioPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
) {
  const wrapper = el.createDiv({ cls: 'drawio-codeblock' });
  wrapper.setAttribute('title', 'Click to edit diagram');
  const preview = wrapper.createDiv({ cls: 'drawio-preview' });

  const wrapped = ensureMxfile(source);
  const pages = getDiagramPages(wrapped);
  let currentPage = 0;
  renderPreview(preview, source, { ...plugin.previewOpts(), page: currentPage });

  if (pages.length > 1) {
    const pageControlEl = wrapper.createDiv({ cls: 'drawio-page-control' });
    renderPageControl(pageControlEl, {
      pages,
      initialPage: currentPage,
      onPageChange: (page) => {
        currentPage = page;
        renderPreview(preview, source, { ...plugin.previewOpts(), page });
      },
    });
  }

  addEditHint(wrapper);

  // Click anywhere on the diagram to edit (the centered hint shows on hover).
  wrapper.addEventListener('click', () => {
    plugin.openEditor(new CodeBlockSource(plugin.app, ctx, el, source));
  });
}
```

- [ ] **Step 2: Full test suite and type-check**

Run: `npm test && npx tsc -noEmit -skipLibCheck`
Expected: all suites PASS (no existing test covers this file, so the count is
unchanged from Task 3), `tsc` exits with no output.

- [ ] **Step 3: Commit**

```bash
git add src/codeblock/DrawioCodeBlock.ts
git commit -m "feat: show a page-switcher on multi-page drawio code blocks"
```

---

### Task 5: Wire the page control into embeds (embed-registry path)

**Files:**
- Modify: `src/file/EmbedRenderer.ts`

**Interfaces:**
- Consumes: `getDiagramPages`, `resolvePageFromSubpath`, `ensureMxfile` from
  `../model/xmlUtils` (Task 1), `page` option on `RenderOptions` (Task 2),
  `renderPageControl` from `../preview/pageControl` (Task 3).
- Produces: `DrawioFileEmbed`'s constructor gains a 4th parameter,
  `subpath?: string`. No change to `registerDrawioEmbeds`'s exported behavior
  (still registers the same extension) or to the post-processor fallback (that's
  Task 6).

This task only touches `DrawioFileEmbed` and the `registerExtension` call site
that constructs it — leave `registerEmbedPostProcessor`/`renderEmbedInto`
untouched here (Task 6).

- [ ] **Step 1: Implement**

In `src/file/EmbedRenderer.ts`, change the imports at the top of the file:

```ts
import { MarkdownPostProcessorContext, MarkdownRenderChild, TFile } from 'obsidian';
import { renderPreview } from '../preview/ViewerRenderer';
import { renderPageControl } from '../preview/pageControl';
import { addEditHint } from '../preview/editHint';
import { getDiagramPages, resolvePageFromSubpath, ensureMxfile } from '../model/xmlUtils';
import { FileSource } from './FileSource';
import { DRAWIO_FILE_EXT } from '../constants';
import type DrawioPlugin from '../main';
```

Change the `registerExtension` call site inside `registerDrawioEmbeds` from:

```ts
      registry.registerExtension(DRAWIO_FILE_EXT, (ctx, file) =>
        new DrawioFileEmbed(plugin, file, ctx.containerEl));
```

to:

```ts
      registry.registerExtension(DRAWIO_FILE_EXT, (ctx, file, subpath) =>
        new DrawioFileEmbed(plugin, file, ctx.containerEl, subpath));
```

Replace the whole `DrawioFileEmbed` class with:

```ts
/** An embed component Obsidian drives in either editing mode. */
class DrawioFileEmbed extends MarkdownRenderChild {
  private currentPage = 0;
  private pageResolvedFromSubpath = false;

  constructor(
    private plugin: DrawioPlugin,
    private file: TFile,
    containerEl: HTMLElement,
    private subpath?: string,
  ) {
    super(containerEl);
  }

  /** Called by the embed system to (re)render the file's diagram. */
  async loadFile(file?: TFile): Promise<void> {
    if (file && file.path !== this.file.path) {
      // Target file actually changed: any subpath was resolved for the old
      // file and no longer applies. Start over at page 0 for the new one.
      this.file = file;
      this.currentPage = 0;
      this.pageResolvedFromSubpath = false;
      this.subpath = undefined;
    }
    await this.render();
  }

  onload(): void {
    // Reflect edits made elsewhere (e.g. the modal or the file view).
    this.registerEvent(this.plugin.app.vault.on('modify', (f) => {
      if (f instanceof TFile && f.path === this.file.path) void this.render();
    }));
  }

  private async render(): Promise<void> {
    const el = this.containerEl;
    el.empty();
    el.addClass('drawio-embed');
    el.setAttribute('title', 'Click to edit diagram');
    try {
      const xml = await this.plugin.app.vault.read(this.file);
      const wrapped = ensureMxfile(xml);
      const pages = getDiagramPages(wrapped);

      if (!this.pageResolvedFromSubpath) {
        this.pageResolvedFromSubpath = true;
        this.currentPage = resolvePageFromSubpath(pages, this.subpath);
      } else {
        // A modify-triggered refresh: keep whatever page the user was looking
        // at, clamped in case the page count shrank.
        this.currentPage = Math.min(this.currentPage, Math.max(pages.length - 1, 0));
      }

      const preview = el.createDiv({ cls: 'drawio-preview' });
      renderPreview(preview, xml, { ...this.plugin.previewOpts(), page: this.currentPage });

      if (pages.length > 1) {
        const pageControlEl = el.createDiv({ cls: 'drawio-page-control' });
        renderPageControl(pageControlEl, {
          pages,
          initialPage: this.currentPage,
          onPageChange: (page) => {
            this.currentPage = page;
            renderPreview(preview, xml, { ...this.plugin.previewOpts(), page });
          },
        });
      }

      addEditHint(el);
    } catch (err) {
      el.createDiv({ cls: 'drawio-error', text: `Failed to render diagram: ${String(err)}` });
    }
    // Wire click-to-edit once (survives re-renders; el.empty() keeps the listener).
    if (!el.dataset.drawioClick) {
      el.dataset.drawioClick = '1';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.plugin.openEditor(new FileSource(this.plugin.app, this.file));
      });
    }
  }
}
```

Leave `EmbedRegistry` interface, `registerEmbedPostProcessor`, and
`renderEmbedInto` (further down in the file) unchanged for now — Task 6 handles
those.

- [ ] **Step 2: Full test suite and type-check**

Run: `npm test && npx tsc -noEmit -skipLibCheck`
Expected: all suites PASS, `tsc` exits with no output.

- [ ] **Step 3: Commit**

```bash
git add src/file/EmbedRenderer.ts
git commit -m "feat: show a page-switcher and resolve #Page-N on drawio embeds"
```

---

### Task 6: Wire the page control into the post-processor fallback path

**Files:**
- Modify: `src/file/EmbedRenderer.ts`

**Interfaces:**
- Consumes: same as Task 5 (already imported there).
- Produces: `renderEmbedInto` gains a 4th parameter, `subpath?: string`.

**Context**: this path (`registerEmbedPostProcessor`/`renderEmbedInto`) only
runs when Obsidian's `embedRegistry` is unavailable — a defensive fallback for
an already-rare case. Whether Obsidian's `.internal-embed` span exposes a
`#Page-2`-style subpath as part of its `src` attribute (e.g. `"file.drawio#Page-2"`)
or strips it before setting `src` is unverified from documentation alone. The
implementation below handles **both** possibilities correctly by construction
— split on the first `#` in `src` before checking the file extension, rather
than assuming either way:

```ts
const hashIndex = rawSrc.indexOf('#');
const path = hashIndex === -1 ? rawSrc : rawSrc.slice(0, hashIndex);
const subpath = hashIndex === -1 ? undefined : rawSrc.slice(hashIndex + 1);
```

If Obsidian does include the subpath in `src`, this correctly recovers it. If
Obsidian already strips it, `rawSrc` simply never contains a `#`, `path` equals
`rawSrc`, and `subpath` is `undefined` — identical to today's behavior (default
to page 0). Either way this is strictly a fix, never a regression: **today's
code checks the raw, unstripped `src` against `.endsWith('.' + DRAWIO_FILE_EXT)`
directly** — if Obsidian does append the subpath to `src`, that check would
currently fail for any multi-page embed carrying a `#Page-N` subpath, and the
embed wouldn't render *at all* via this fallback path. Splitting before the
extension check fixes that latent bug regardless of which behavior Obsidian
actually has.

- [ ] **Step 1: Implement**

Replace `registerEmbedPostProcessor` and `renderEmbedInto` at the bottom of
`src/file/EmbedRenderer.ts`:

```ts
/** Reading-view-only fallback when the embed registry is unavailable. */
function registerEmbedPostProcessor(plugin: DrawioPlugin) {
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    for (const span of Array.from(el.querySelectorAll<HTMLElement>('.internal-embed'))) {
      if (span.dataset.drawioEmbed === '1') continue;
      const rawSrc = span.getAttribute('src');
      if (!rawSrc) continue;
      // Obsidian's exact behavior for whether a `#subpath` ends up in `src` for
      // an unrecognized (non-.md) embed extension isn't guaranteed — split it
      // off before the extension check so this works either way (see Task 6
      // in the implementation plan for why).
      const hashIndex = rawSrc.indexOf('#');
      const path = hashIndex === -1 ? rawSrc : rawSrc.slice(0, hashIndex);
      const subpath = hashIndex === -1 ? undefined : rawSrc.slice(hashIndex + 1);
      if (!path.toLowerCase().endsWith('.' + DRAWIO_FILE_EXT)) continue;
      const file = plugin.app.metadataCache.getFirstLinkpathDest(path, ctx.sourcePath);
      if (!(file instanceof TFile)) continue;
      span.dataset.drawioEmbed = '1';
      span.setAttribute('title', 'Click to edit diagram');
      span.addEventListener('click', () => plugin.openEditor(new FileSource(plugin.app, file)));
      void renderEmbedInto(plugin, span, file, subpath);
    }
  });
}

async function renderEmbedInto(
  plugin: DrawioPlugin,
  span: HTMLElement,
  file: TFile,
  subpath?: string,
) {
  span.empty();
  span.addClass('drawio-embed');
  span.removeClasses(['file-embed', 'mod-generic', 'is-loaded']);
  try {
    const xml = await plugin.app.vault.read(file);
    const wrapped = ensureMxfile(xml);
    const pages = getDiagramPages(wrapped);
    const currentPage = resolvePageFromSubpath(pages, subpath);

    const preview = span.createDiv({ cls: 'drawio-preview' });
    renderPreview(preview, xml, { ...plugin.previewOpts(), page: currentPage });

    if (pages.length > 1) {
      const pageControlEl = span.createDiv({ cls: 'drawio-page-control' });
      renderPageControl(pageControlEl, {
        pages,
        initialPage: currentPage,
        onPageChange: (page) => {
          renderPreview(preview, xml, { ...plugin.previewOpts(), page });
        },
      });
    }

    addEditHint(span);
  } catch (err) {
    span.empty();
    span.createDiv({ cls: 'drawio-error', text: `Failed to render diagram: ${String(err)}` });
  }
}
```

(Note: unlike `DrawioFileEmbed`, this function-based path has no persistent
instance to store `currentPage` on across re-renders — but this path also has
no `modify`-listener re-render trigger today, so there's no cross-render state
to preserve; a plain local variable per call is sufficient, matching the
code-block pattern from Task 4.)

- [ ] **Step 2: Full test suite and type-check**

Run: `npm test && npx tsc -noEmit -skipLibCheck`
Expected: all suites PASS, `tsc` exits with no output.

- [ ] **Step 3: Commit**

```bash
git add src/file/EmbedRenderer.ts
git commit -m "fix: recover #Page-N subpath and fix extension check in embed post-processor fallback"
```

---

### Task 7: Docs, build verification, and manual test pass

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:** none — this task is verification and documentation only.

- [ ] **Step 1: Update README's known-limitations section**

Find this bullet in `README.md` (under "Notes & limitations"):

```
- **Multi-page diagrams**: a code-block or embed **preview shows only the first page** of a multi-page diagram. Click to edit to reach the other pages (the editor shows all page tabs).
```

Replace it with:

```
- **Multi-page diagrams**: code-block and embed previews show a compact page-switcher (‹ N / M ›) below the diagram when it has more than one page. Click to edit still opens the full editor with all page tabs.
```

Find this bullet:

```
- **Multi-page embed subpaths**: a page selector like `![[file.drawio#Page-2]]` is ignored — the embed always shows the first page.
```

Replace it with:

```
- **Multi-page embed subpaths**: `![[file.drawio#Page-2]]` opens the embed showing the page named "Page-2" (matched by the diagram's `name` attribute) as its initial page; falls back to the first page if no page has that name.
```

- [ ] **Step 2: Add a module-map entry for the new file**

In `CLAUDE.md`, find this line in the `## Module map` section:

```
- `src/preview/` — `ViewerRenderer` (`renderPreview`), `loadViewer`, `svgSanitizer`,
  `editHint`, and the vendored `viewer.min.txt`.
```

Replace it with:

```
- `src/preview/` — `ViewerRenderer` (`renderPreview`), `loadViewer`, `svgSanitizer`,
  `editHint`, `pageControl` (multi-page prev/next control), and the vendored
  `viewer.min.txt`.
```

- [ ] **Step 3: Full test suite, build, and vault install**

```bash
npm test
npm run build
DEST="/mnt/d/Knowledge/.obsidian/plugins/obsidian-drawio"
cp main.js manifest.json styles.css "$DEST/"
```

Expected: `npm test` — all suites pass (should now include the new
`getDiagramPages`/`resolvePageFromSubpath`/`pageControl` tests plus the two new
`viewerRenderer.sizing` tests, on top of the pre-existing suite). `npm run
build` completes with no `tsc` errors and produces `main.js`.

- [ ] **Step 4: Manual verification in the dev vault**

This step cannot be automated from this environment (no way to drive a real
Obsidian window here) — reload the plugin in Obsidian (or restart it), then
check each of the following:

1. Create a multi-page `.drawio` file (or code block) with 3 pages named
   `Page-1`, `Page-2`, `Page-3` (draw.io's own editor lets you add/rename pages
   via the page tabs at the bottom).
2. **Code block**: paste its XML into a ` ```drawio ` block. Confirm a `‹ 1 / 3 ›`
   bar appears below the diagram; clicking `›` advances the SVG and the
   indicator, disables `›` at page 3, re-enables it after clicking `‹`.
3. **Embed**: `![[multi-page.drawio]]` in a note. Same page-switcher behavior.
   Click the diagram itself (not an arrow) — confirm the editor still opens.
   Click an arrow — confirm the editor does **not** open.
4. **Subpath**: `![[multi-page.drawio#Page-2]]` — confirm the embed initially
   shows page 2 (indicator reads `2 / 3`), and arrows still navigate all 3
   pages from there.
5. **Single-page file**: embed or code-block a single-page diagram — confirm
   no page-switcher bar appears at all (unchanged from before this feature).
6. **Live refresh**: with the embed from step 3 open and showing page 2 (click
   `›` once), edit the same file's page 2 content via the full editor (click
   the diagram, change something, save) — confirm the embed refreshes and
   **stays on page 2** (doesn't jump back to page 1).
7. **Reading view**: switch the note to Reading view and repeat steps 2-4 —
   confirm identical behavior (this is what exercises the `embedRegistry` path
   if available, or the post-processor fallback path from Task 6 if not).

If any of these don't match, note exactly what happened before making further
changes — this is real Obsidian runtime behavior this plan's author couldn't
verify directly.

- [ ] **Step 5: Commit docs**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document multi-page preview navigation and #Page-N support"
```
