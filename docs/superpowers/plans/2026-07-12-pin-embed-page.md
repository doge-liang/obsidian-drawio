# Pin Embed Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pin button to the embed page control that rewrites the embed's
`![[file.drawio#Page-N]]` subpath in the note to the currently shown page.

**Architecture:** A pure rewrite function (`src/model/embedLink.ts`) splices a
new subpath into the note text at metadata-cache-provided offsets; an
Obsidian-coupled orchestrator (`src/file/pinEmbedPage.ts`) gathers candidates
from `metadataCache` and applies the rewrite atomically via `vault.process`;
`pageControl.ts` gains an optional pin button; both embed paths
(embedRegistry + reading-view fallback) wire it up. Spec:
`docs/superpowers/specs/2026-07-12-pin-embed-page-design.md`.

**Tech Stack:** TypeScript, Obsidian plugin API (`vault.process` @since 1.1.0,
`parseLinktext`, `metadataCache` — all under the 1.4.0 `minAppVersion` floor,
verified in `node_modules/obsidian/obsidian.d.ts`), vitest + jsdom.

## Global Constraints

- No static top-level `node:*`/`electron` imports outside `src/server/**`,
  `src/desktop/**` (mobile load crash — see CLAUDE.md). This feature needs none.
- No regex literals with lookbehind (`(?<=`, `(?<!`), named groups, or `\p{}`
  anywhere in `src/` (parse-time mobile crash).
- Notices start with `Drawio: `. UI copy is sentence-style English.
- The pin feature must NOT be desktop-gated — it is a pure text operation.
- `main.js` is fully bundled; no new runtime `dependencies`.
- This repo is public: no private absolute paths in committed files.
- Run all commands from the repo root on branch `feat/pin-embed-page`.

---

### Task 1: pure rewrite function `rewriteEmbedSubpath`

**Files:**
- Create: `src/model/embedLink.ts`
- Test: `tests/embedLink.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Tasks 3-5):
  ```ts
  export interface EmbedSpan {
    original: string;            // full embed text, e.g. "![[a.drawio#Page-2|alias]]"
    start: number;               // offset of `original` in the note text
    end: number;
    path: string;                // link path without subpath, e.g. "a.drawio"
    subpath: string | undefined; // subpath, with or without leading '#'
  }
  export type PinRewrite =
    | { outcome: 'ok'; text: string }
    | { outcome: 'no-match' }
    | { outcome: 'ambiguous' };
  export function rewriteEmbedSubpath(
    doc: string,
    candidates: EmbedSpan[],
    originalSubpath: string | undefined,
    newPageName: string,
  ): PinRewrite
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/embedLink.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rewriteEmbedSubpath, type EmbedSpan } from '../src/model/embedLink';

/** Build the EmbedSpan for the first occurrence of `original` in `doc`. */
function spanOf(doc: string, original: string): EmbedSpan {
  const start = doc.indexOf(original);
  if (start === -1) throw new Error(`"${original}" not in doc`);
  const inner = original.slice(3, -2);
  const target = inner.split('|')[0]!;
  const hash = target.indexOf('#');
  return {
    original,
    start,
    end: start + original.length,
    path: hash === -1 ? target : target.slice(0, hash),
    subpath: hash === -1 ? undefined : target.slice(hash + 1),
  };
}

describe('rewriteEmbedSubpath', () => {
  it('appends a subpath to a link that has none', () => {
    const doc = 'before ![[a.drawio]] after';
    const r = rewriteEmbedSubpath(doc, [spanOf(doc, '![[a.drawio]]')], undefined, 'Page-3');
    expect(r).toEqual({ outcome: 'ok', text: 'before ![[a.drawio#Page-3]] after' });
  });

  it('replaces an existing subpath', () => {
    const doc = '![[a.drawio#Page-2]]';
    const r = rewriteEmbedSubpath(doc, [spanOf(doc, '![[a.drawio#Page-2]]')], 'Page-2', 'Page-3');
    expect(r).toEqual({ outcome: 'ok', text: '![[a.drawio#Page-3]]' });
  });

  it('preserves an |alias', () => {
    const doc = '![[a.drawio#Page-2|My diagram]]';
    const r = rewriteEmbedSubpath(doc, [spanOf(doc, '![[a.drawio#Page-2|My diagram]]')], 'Page-2', 'Page-3');
    expect(r).toEqual({ outcome: 'ok', text: '![[a.drawio#Page-3|My diagram]]' });
  });

  it('normalizes a leading # on the original subpath', () => {
    const doc = '![[a.drawio#Page-2]]';
    const r = rewriteEmbedSubpath(doc, [spanOf(doc, '![[a.drawio#Page-2]]')], '#Page-2', 'Page-3');
    expect(r.outcome).toBe('ok');
  });

  it('returns no-match when no candidate carries the original subpath', () => {
    const doc = '![[a.drawio#Page-2]]';
    const r = rewriteEmbedSubpath(doc, [spanOf(doc, '![[a.drawio#Page-2]]')], 'Page-9', 'Page-3');
    expect(r).toEqual({ outcome: 'no-match' });
  });

  it('returns ambiguous when several identical candidates match', () => {
    const doc = '![[a.drawio]] and ![[a.drawio]]';
    const first = spanOf(doc, '![[a.drawio]]');
    const second: EmbedSpan = { ...first, start: 18, end: 18 + first.original.length };
    const r = rewriteEmbedSubpath(doc, [first, second], undefined, 'Page-3');
    expect(r).toEqual({ outcome: 'ambiguous' });
  });

  it('distinguishes two embeds of the same file by their original subpath', () => {
    const doc = '![[a.drawio]] then ![[a.drawio#Page-2]]';
    const plain = spanOf(doc, '![[a.drawio]]');
    const paged = spanOf(doc, '![[a.drawio#Page-2]]');
    const r = rewriteEmbedSubpath(doc, [plain, paged], 'Page-2', 'Page-3');
    expect(r).toEqual({ outcome: 'ok', text: '![[a.drawio]] then ![[a.drawio#Page-3]]' });
  });

  it('rejects stale offsets instead of corrupting the note', () => {
    const doc = 'EDITED ![[a.drawio]]';
    // Span computed against the pre-edit text: offsets no longer line up.
    const stale: EmbedSpan = {
      original: '![[a.drawio]]', start: 0, end: 13, path: 'a.drawio', subpath: undefined,
    };
    const r = rewriteEmbedSubpath(doc, [stale], undefined, 'Page-3');
    expect(r).toEqual({ outcome: 'no-match' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/embedLink.test.ts`
Expected: FAIL — `Cannot find module '../src/model/embedLink'` (or equivalent).

- [ ] **Step 3: Write the implementation**

Create `src/model/embedLink.ts`:

```ts
/** One embed link occurrence in a note, as reported by the metadata cache. */
export interface EmbedSpan {
  /** Full embed text, e.g. `![[a.drawio#Page-2|alias]]`. */
  original: string;
  /** Offset range of `original` within the note text. */
  start: number;
  end: number;
  /** Link path without the subpath, e.g. `a.drawio`. */
  path: string;
  /** Subpath, with or without its leading `#`; undefined when none. */
  subpath: string | undefined;
}

export type PinRewrite =
  | { outcome: 'ok'; text: string }
  | { outcome: 'no-match' }
  | { outcome: 'ambiguous' };

/**
 * Rewrite exactly one embed link's subpath to `newPageName`.
 *
 * The candidate to rewrite is the one whose subpath equals `originalSubpath`
 * (the page the embed instance was created with — NOT the currently flipped
 * page, which exists only in memory). Zero matches → no-match; more than one
 * (identical duplicate links) → ambiguous; in both cases the text is left
 * untouched — never guess which link the user meant.
 *
 * Stale-cache safety: a candidate only matches if the document really
 * contains its `original` text at its recorded offsets. Metadata-cache
 * offsets can lag behind fast edits; splicing at stale offsets would corrupt
 * the note.
 */
export function rewriteEmbedSubpath(
  doc: string,
  candidates: EmbedSpan[],
  originalSubpath: string | undefined,
  newPageName: string,
): PinRewrite {
  const norm = (s: string | undefined): string => (s ?? '').replace(/^#/, '');
  const wanted = norm(originalSubpath);
  const matches = candidates.filter((c) =>
    norm(c.subpath) === wanted && doc.slice(c.start, c.end) === c.original);
  if (matches.length === 0) return { outcome: 'no-match' };
  if (matches.length > 1) return { outcome: 'ambiguous' };
  const m = matches[0]!;

  // `original` is `![[` + target(#subpath)? (|alias)? + `]]` — keep the alias
  // part verbatim, replace the target with path#newPageName.
  const inner = m.original.slice(3, -2);
  const pipe = inner.indexOf('|');
  const alias = pipe === -1 ? '' : inner.slice(pipe);
  const replaced = `![[${m.path}#${newPageName}${alias}]]`;
  return { outcome: 'ok', text: doc.slice(0, m.start) + replaced + doc.slice(m.end) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/embedLink.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/model/embedLink.ts tests/embedLink.test.ts
git commit -m "feat: pure embed-subpath rewrite for page pinning"
```

---

### Task 2: pin button on the page control

**Files:**
- Modify: `src/preview/pageControl.ts`
- Modify: `styles.css` (the `.drawio-page-control` block)
- Test: `tests/pageControl.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 4-5): `PageControlOptions` gains
  ```ts
  pin?: {
    pinnedPage: number;             // page index the note's link resolves to
    onPin: (page: number) => void;  // called with the currently shown page
  };
  ```
  The pin button renders only when `pin` is provided, carries class
  `drawio-pin`, and is disabled while the shown page equals `pinnedPage`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/pageControl.test.ts` (inside the existing
`describe('renderPageControl', …)` block, after the last `it`):

```ts
  it('renders no pin button without pin support', () => {
    const container = document.createElement('div');
    renderPageControl(container, { pages, initialPage: 0, onPageChange: () => {} });
    expect(container.querySelector('.drawio-pin')).toBeNull();
  });

  it('disables the pin button while the shown page is the pinned page', () => {
    const container = document.createElement('div');
    renderPageControl(container, {
      pages, initialPage: 1, onPageChange: () => {},
      pin: { pinnedPage: 1, onPin: () => {} },
    });
    const pin = container.querySelector<HTMLButtonElement>('.drawio-pin')!;
    expect(pin.disabled).toBe(true);
  });

  it('enables the pin button after flipping away and pins the shown page', () => {
    const container = document.createElement('div');
    const onPin = vi.fn();
    renderPageControl(container, {
      pages, initialPage: 0, onPageChange: () => {},
      pin: { pinnedPage: 0, onPin },
    });
    const [, nextBtn] = Array.from(container.querySelectorAll('button'));
    (nextBtn as HTMLButtonElement).click();
    const pin = container.querySelector<HTMLButtonElement>('.drawio-pin')!;
    expect(pin.disabled).toBe(false);
    pin.click();
    expect(onPin).toHaveBeenCalledWith(1);
  });

  it('stops pin-click propagation to wrapper click handlers', () => {
    const wrapper = document.createElement('div');
    const container = wrapper.createDiv();
    const wrapperClick = vi.fn();
    wrapper.addEventListener('click', wrapperClick);
    renderPageControl(container, {
      pages, initialPage: 1, onPageChange: () => {},
      pin: { pinnedPage: 0, onPin: () => {} },
    });
    container.querySelector<HTMLButtonElement>('.drawio-pin')!.click();
    expect(wrapperClick).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run tests/pageControl.test.ts`
Expected: the 4 new tests FAIL (no `.drawio-pin` element); the 7 existing PASS.

- [ ] **Step 3: Implement the pin button**

Replace the full contents of `src/preview/pageControl.ts` with:

```ts
import { setIcon } from 'obsidian';
import type { DiagramPage } from '../model/xmlUtils';

export interface PageControlOptions {
  pages: DiagramPage[];
  initialPage: number;
  onPageChange: (page: number) => void;
  /** Optional pin support: adds a button that persists the shown page back
   *  into the note (embeds only — callers without a note omit this). */
  pin?: {
    /** Page index the note's link currently resolves to. */
    pinnedPage: number;
    /** Called with the currently shown page index. */
    onPin: (page: number) => void;
  };
}

/**
 * Render a compact "‹ N / M ›" page-switcher bar into `container`. Caller is
 * responsible for only invoking this when `pages.length > 1` — this function
 * does not check that itself.
 */
export function renderPageControl(container: HTMLElement, opts: PageControlOptions): void {
  const { pages, onPageChange, pin } = opts;
  let current = opts.initialPage;

  const prevBtn = container.createEl('button', { text: '‹' });
  const indicator = container.createSpan();
  const nextBtn = container.createEl('button', { text: '›' });
  let pinBtn: HTMLButtonElement | null = null;
  if (pin) {
    pinBtn = container.createEl('button', { cls: 'drawio-pin' });
    setIcon(pinBtn, 'pin');
    pinBtn.setAttribute('aria-label', 'Pin current page in the note');
    pinBtn.setAttribute('title', 'Pin current page in the note');
  }

  function update(): void {
    indicator.textContent = `${current + 1} / ${pages.length}`;
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === pages.length - 1;
    if (pinBtn && pin) pinBtn.disabled = current === pin.pinnedPage;
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

  pinBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!pin || current === pin.pinnedPage) return;
    pin.onPin(current);
  });

  update();
}
```

Note: `tests/setup.ts`'s `createEl` shim already supports `cls`, and the
`obsidian` stub already exports a no-op `setIcon` — no test-infra change.

- [ ] **Step 4: Add the icon-button styles**

In `styles.css`, extend the page-control block. After the existing line

```css
.drawio-page-control button:not(:disabled):hover { color: var(--text-normal); }
```

add:

```css
.drawio-page-control .drawio-pin { display: inline-flex; align-items: center; }
.drawio-page-control .drawio-pin svg { width: 14px; height: 14px; }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/pageControl.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add src/preview/pageControl.ts styles.css tests/pageControl.test.ts
git commit -m "feat: optional pin button on the page control"
```

---

### Task 3: `pinEmbedPage` orchestration

**Files:**
- Create: `src/file/pinEmbedPage.ts`
- Modify: `tests/obsidian-stub.ts` (add `parseLinktext`)
- Test: `tests/pinEmbedPage.test.ts`

**Interfaces:**
- Consumes: `rewriteEmbedSubpath`/`EmbedSpan` from Task 1; Obsidian
  `App.metadataCache.getCache(path).embeds` (entries carry `link`, `original`,
  `position.start.offset`, `position.end.offset`),
  `metadataCache.getFirstLinkpathDest`, `vault.getAbstractFileByPath`,
  `Vault.process(file, fn)` (@since 1.1.0), `parseLinktext`.
- Produces (used by Tasks 4-5):
  ```ts
  export type PinOutcome = 'pinned' | 'no-match' | 'ambiguous' | 'error';
  export async function pinEmbedPage(
    app: App,
    sourcePath: string,            // note that owns the embed
    targetFile: TFile,             // the embedded .drawio file
    originalSubpath: string | undefined, // subpath the embed was created with
    pageName: string,              // page name to write into the link
  ): Promise<PinOutcome>
  ```
  Shows its own Notices; callers only use the outcome to update local state.

- [ ] **Step 1: Add `parseLinktext` to the obsidian stub**

Append to `tests/obsidian-stub.ts` (Obsidian's real one returns the subpath
WITH its leading `#`, empty string when none — mirror that):

```ts
/** Split "path#subpath" — subpath keeps its leading '#', '' when absent. */
export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const i = linktext.indexOf('#');
  return i === -1
    ? { path: linktext, subpath: '' }
    : { path: linktext.slice(0, i), subpath: linktext.slice(i) };
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/pinEmbedPage.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { pinEmbedPage } from '../src/file/pinEmbedPage';

function makeFile(path: string): TFile {
  return Object.assign(new TFile(), { path, basename: path.replace(/\.\w+$/, '') });
}

/** In-memory note + metadata cache with offsets computed from the text. */
function makeApp(notePath: string, noteText: string, target: TFile) {
  const state = { text: noteText };
  const noteFile = makeFile(notePath);
  const embeds = () => {
    const out: { link: string; original: string; position: { start: { offset: number }; end: { offset: number } } }[] = [];
    const re = /!\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(state.text))) {
      out.push({
        link: m[1]!.split('|')[0]!,
        original: m[0],
        position: { start: { offset: m.index }, end: { offset: m.index + m[0].length } },
      });
    }
    return out;
  };
  const process = vi.fn((f: TFile, fn: (data: string) => string) => {
    if (f !== noteFile) throw new Error('unexpected file');
    state.text = fn(state.text);
    return Promise.resolve(state.text);
  });
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (p === notePath ? noteFile : null),
      process,
    },
    metadataCache: {
      getCache: (p: string) => (p === notePath ? { embeds: embeds() } : null),
      getFirstLinkpathDest: (path: string) => (path === target.path ? target : null),
    },
  } as unknown as App;
  return { app, state, process };
}

describe('pinEmbedPage', () => {
  const target = makeFile('multi.drawio');

  it('rewrites the single matching link and reports pinned', async () => {
    const { app, state } = makeApp('note.md', 'x ![[multi.drawio]] y', target);
    const outcome = await pinEmbedPage(app, 'note.md', target, undefined, 'Page-2');
    expect(outcome).toBe('pinned');
    expect(state.text).toBe('x ![[multi.drawio#Page-2]] y');
  });

  it('selects by the original subpath among several links to the same file', async () => {
    const { app, state } = makeApp('note.md', '![[multi.drawio]] ![[multi.drawio#Page-2]]', target);
    const outcome = await pinEmbedPage(app, 'note.md', target, 'Page-2', 'Page-3');
    expect(outcome).toBe('pinned');
    expect(state.text).toBe('![[multi.drawio]] ![[multi.drawio#Page-3]]');
  });

  it('leaves the note untouched and reports ambiguous on identical duplicates', async () => {
    const text = '![[multi.drawio]] ![[multi.drawio]]';
    const { app, state } = makeApp('note.md', text, target);
    const outcome = await pinEmbedPage(app, 'note.md', target, undefined, 'Page-2');
    expect(outcome).toBe('ambiguous');
    expect(state.text).toBe(text);
  });

  it('reports no-match when the note has no link to the file', async () => {
    const { app, state } = makeApp('note.md', 'no embeds here', target);
    const outcome = await pinEmbedPage(app, 'note.md', target, undefined, 'Page-2');
    expect(outcome).toBe('no-match');
    expect(state.text).toBe('no embeds here');
  });

  it('reports error without writing when the page name cannot form a link', async () => {
    const { app, state, process } = makeApp('note.md', '![[multi.drawio]]', target);
    const outcome = await pinEmbedPage(app, 'note.md', target, undefined, 'bad|name');
    expect(outcome).toBe('error');
    expect(process).not.toHaveBeenCalled();
    expect(state.text).toBe('![[multi.drawio]]');
  });

  it('reports error when the note file or cache is unavailable', async () => {
    const { app } = makeApp('note.md', '![[multi.drawio]]', target);
    const outcome = await pinEmbedPage(app, 'other.md', target, undefined, 'Page-2');
    expect(outcome).toBe('error');
  });

  it('reports error when the vault write fails', async () => {
    const { app } = makeApp('note.md', '![[multi.drawio]]', target);
    (app.vault.process as unknown as { mockRejectedValue: (e: Error) => void })
      .mockRejectedValue(new Error('disk full'));
    const outcome = await pinEmbedPage(app, 'note.md', target, undefined, 'Page-2');
    expect(outcome).toBe('error');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/pinEmbedPage.test.ts`
Expected: FAIL — `Cannot find module '../src/file/pinEmbedPage'`.

- [ ] **Step 4: Write the implementation**

Create `src/file/pinEmbedPage.ts`:

```ts
import { App, Notice, TFile, parseLinktext } from 'obsidian';
import { rewriteEmbedSubpath, type EmbedSpan } from '../model/embedLink';

export type PinOutcome = 'pinned' | 'no-match' | 'ambiguous' | 'error';

/**
 * Persist an embed's currently shown page into the note: rewrite the one
 * embed link that (a) resolves to `targetFile` and (b) carries the subpath
 * this embed instance was created with, so its subpath names `pageName`.
 *
 * Never guesses: zero or multiple matching links leave the note untouched.
 * All user feedback (Notices) happens here; callers react to the outcome
 * only to update their own state.
 */
export async function pinEmbedPage(
  app: App,
  sourcePath: string,
  targetFile: TFile,
  originalSubpath: string | undefined,
  pageName: string,
): Promise<PinOutcome> {
  // A page name with link syntax in it can't round-trip through a wikilink.
  if (/[#|[\]]/.test(pageName)) {
    new Notice(`Drawio: page name "${pageName}" can't be used in a link (contains #, | or brackets).`);
    return 'error';
  }
  const note = app.vault.getAbstractFileByPath(sourcePath);
  const cache = app.metadataCache.getCache(sourcePath);
  if (!(note instanceof TFile) || !cache?.embeds) {
    new Notice('Drawio: couldn\'t read the embedding note — page not pinned.');
    return 'error';
  }

  const candidates: EmbedSpan[] = [];
  for (const e of cache.embeds) {
    const { path, subpath } = parseLinktext(e.link);
    const dest = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (dest?.path !== targetFile.path) continue;
    candidates.push({
      original: e.original,
      start: e.position.start.offset,
      end: e.position.end.offset,
      path,
      subpath: subpath || undefined,
    });
  }

  let outcome: PinOutcome = 'error';
  try {
    await app.vault.process(note, (data) => {
      const r = rewriteEmbedSubpath(data, candidates, originalSubpath, pageName);
      if (r.outcome !== 'ok') {
        outcome = r.outcome;
        return data;
      }
      outcome = 'pinned';
      return r.text;
    });
  } catch (err) {
    new Notice(`Drawio: failed to update the note — ${String(err)}`);
    return 'error';
  }

  if (outcome === 'pinned') {
    new Notice(`Drawio: link updated to page "${pageName}".`);
  } else if (outcome === 'no-match') {
    new Notice('Drawio: couldn\'t find this embed\'s link in the note — page not pinned.');
  } else if (outcome === 'ambiguous') {
    new Notice('Drawio: several identical links to this file — edit the subpath in the note manually.');
  }
  return outcome;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/pinEmbedPage.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/file/pinEmbedPage.ts tests/pinEmbedPage.test.ts tests/obsidian-stub.ts
git commit -m "feat: pin-page orchestration over metadataCache and vault.process"
```

---

### Task 4: wire the pin into the embedRegistry embed

**Files:**
- Modify: `src/file/EmbedRenderer.ts`
- Test: `tests/embedPin.dom.test.ts` (new)

**Interfaces:**
- Consumes: `pinEmbedPage`/`PinOutcome` (Task 3), `PageControlOptions.pin`
  (Task 2), existing `resolvePageFromSubpath`.
- Produces: `DrawioFileEmbed` constructor gains a trailing
  `sourcePath?: string`; the `EmbedRegistry` creator ctx type becomes
  `{ containerEl: HTMLElement; sourcePath?: string }` (feature-detected: pin
  is only offered when Obsidian supplied `sourcePath`).

- [ ] **Step 1: Write the failing test**

Create `tests/embedPin.dom.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

// Stub viewer: renderPreview degrades to an error placeholder, but the page
// control (the subject here) renders regardless.
vi.mock('../src/preview/viewer.min.txt', () => ({ default: 'window.GraphViewer = window.GraphViewer || undefined;' }));

import { TFile } from 'obsidian';
import { registerDrawioEmbeds } from '../src/file/EmbedRenderer';
import type DrawioPlugin from '../src/main';

const XML = '<mxfile pages="2">'
  + '<diagram id="p1" name="Page-1"><mxGraphModel/></diagram>'
  + '<diagram id="p2" name="Page-2"><mxGraphModel/></diagram>'
  + '</mxfile>';

type Creator = (
  ctx: { containerEl: HTMLElement; sourcePath?: string },
  file: TFile,
  subpath?: string,
) => { loadFile: () => Promise<void> };

type PostProcessor = (el: HTMLElement, ctx: { sourcePath: string }) => void;

// `registry: false` omits the embedRegistry so registerDrawioEmbeds falls
// back to the reading-view post-processor (exercised in the fallback suite).
function makeHarness(noteText: string, opts: { registry: boolean } = { registry: true }) {
  const target = Object.assign(new TFile(), { path: 'multi.drawio', basename: 'multi' });
  const noteFile = Object.assign(new TFile(), { path: 'note.md', basename: 'note' });
  const state = { text: noteText };
  const embeds = () => {
    const out: unknown[] = [];
    const re = /!\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(state.text))) {
      out.push({
        link: m[1]!.split('|')[0]!,
        original: m[0],
        position: { start: { offset: m.index }, end: { offset: m.index + m[0].length } },
      });
    }
    return out;
  };
  let creator: Creator | undefined;
  let postProcessor: PostProcessor | undefined;
  const plugin = {
    settings: { previewClickAction: 'editor' },
    previewOpts: () => ({ dark: false }),
    registerMarkdownPostProcessor: (fn: PostProcessor) => { postProcessor = fn; },
    app: {
      ...(opts.registry
        ? { embedRegistry: { registerExtension: (_e: string, c: Creator) => { creator = c; } } }
        : {}),
      vault: {
        read: () => Promise.resolve(XML),
        on: () => ({}),
        getAbstractFileByPath: (p: string) => (p === 'note.md' ? noteFile : null),
        process: (f: TFile, fn: (d: string) => string) => {
          if (f !== noteFile) throw new Error('unexpected file');
          state.text = fn(state.text);
          return Promise.resolve(state.text);
        },
      },
      metadataCache: {
        getCache: (p: string) => (p === 'note.md' ? { embeds: embeds() } : null),
        getFirstLinkpathDest: (path: string) => (path === 'multi.drawio' ? target : null),
      },
    },
    register: () => {},
    openEditor: () => {},
  } as unknown as DrawioPlugin;
  registerDrawioEmbeds(plugin);
  return { creator, postProcessor, target, state };
}

async function tick(): Promise<void> {
  await new Promise((r) => { window.setTimeout(r, 0); });
}

describe('embed pin wiring (registry path)', () => {
  it('pins the flipped page back into the note link', async () => {
    const { creator, target, state } = makeHarness('x ![[multi.drawio]] y');
    const el = document.body.createDiv();
    const embed = creator!({ containerEl: el, sourcePath: 'note.md' }, target, undefined);
    await embed.loadFile();

    const pin = el.querySelector<HTMLButtonElement>('.drawio-pin')!;
    expect(pin).not.toBeNull();
    expect(pin.disabled).toBe(true); // shown page == linked page

    const [, next] = Array.from(el.querySelectorAll<HTMLButtonElement>('.drawio-page-control button'));
    next!.click();
    expect(pin.disabled).toBe(false);
    pin.click();
    await tick();
    expect(state.text).toBe('x ![[multi.drawio#Page-2]] y');
  });

  it('offers no pin button when Obsidian gave the creator no sourcePath', async () => {
    const { creator, target } = makeHarness('x ![[multi.drawio]] y');
    const el = document.body.createDiv();
    const embed = creator!({ containerEl: el }, target, undefined);
    await embed.loadFile();
    expect(el.querySelector('.drawio-page-control')).not.toBeNull();
    expect(el.querySelector('.drawio-pin')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/embedPin.dom.test.ts`
Expected: FAIL — `.drawio-pin` is null (pin not wired yet).

- [ ] **Step 3: Wire the embed**

In `src/file/EmbedRenderer.ts`:

(a) Add to the imports:

```ts
import { pinEmbedPage } from './pinEmbedPage';
import type { DiagramPage } from '../model/xmlUtils';
```

(b) Update the registry ctx type and creator call. Replace

```ts
      registry.registerExtension(DRAWIO_FILE_EXT, (ctx, file, subpath) =>
        new DrawioFileEmbed(plugin, file, ctx.containerEl, subpath));
```

with

```ts
      registry.registerExtension(DRAWIO_FILE_EXT, (ctx, file, subpath) =>
        new DrawioFileEmbed(plugin, file, ctx.containerEl, subpath, ctx.sourcePath));
```

and replace the `EmbedRegistry` interface's `registerExtension` line

```ts
  registerExtension(ext: string, creator: (ctx: { containerEl: HTMLElement }, file: TFile, subpath?: string) => unknown): void;
```

with

```ts
  registerExtension(ext: string, creator: (ctx: { containerEl: HTMLElement; sourcePath?: string }, file: TFile, subpath?: string) => unknown): void;
```

(c) Extend the constructor. Replace

```ts
  constructor(
    private plugin: DrawioPlugin,
    private file: TFile,
    containerEl: HTMLElement,
    private subpath?: string,
  ) {
    super(containerEl);
  }
```

with

```ts
  constructor(
    private plugin: DrawioPlugin,
    private file: TFile,
    containerEl: HTMLElement,
    private subpath?: string,
    // Note that owns this embed. An internal-but-stable ctx field — when a
    // future Obsidian stops supplying it, the pin button silently disappears
    // (feature-detect, same stance as embedRegistry itself).
    private sourcePath?: string,
  ) {
    super(containerEl);
  }
```

(d) Offer the pin from `render()`. Replace the page-control block

```ts
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
```

with

```ts
      if (pages.length > 1) {
        const pageControlEl = el.createDiv({ cls: 'drawio-page-control' });
        renderPageControl(pageControlEl, {
          pages,
          initialPage: this.currentPage,
          onPageChange: (page) => {
            this.currentPage = page;
            renderPreview(preview, xml, { ...this.plugin.previewOpts(), page });
          },
          pin: this.sourcePath === undefined ? undefined : {
            pinnedPage: resolvePageFromSubpath(pages, this.subpath),
            onPin: (page) => { void this.pin(pages, page); },
          },
        });
      }
```

(e) Add the `pin` method to `DrawioFileEmbed` (after `render()`):

```ts
  /** Persist the shown page into the note's link; on success adopt the new
   *  subpath locally so a modify-triggered re-render agrees with the note. */
  private async pin(pages: DiagramPage[], page: number): Promise<void> {
    const name = pages[page]?.name;
    if (name === undefined || this.sourcePath === undefined) return;
    const outcome = await pinEmbedPage(this.plugin.app, this.sourcePath, this.file, this.subpath, name);
    if (outcome === 'pinned') this.subpath = name;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/embedPin.dom.test.ts tests/embedRendererMobile.test.ts tests/embedPageIsolation.dom.test.ts`
Expected: PASS — the new suite plus the two existing embed suites (the
isolation suite passes `{ containerEl }` without `sourcePath`, which must
keep working, pin-free).

- [ ] **Step 5: Commit**

```bash
git add src/file/EmbedRenderer.ts tests/embedPin.dom.test.ts
git commit -m "feat: pin button on registry-path embeds"
```

---

### Task 5: wire the pin into the reading-view fallback path

**Files:**
- Modify: `src/file/EmbedRenderer.ts` (`registerEmbedPostProcessor`,
  `renderEmbedInto`)
- Modify: `tests/setup.ts` (add a `removeClasses` shim)
- Test: `tests/embedPin.dom.test.ts` (extend)

**Interfaces:**
- Consumes: `pinEmbedPage` (Task 3), `PageControlOptions.pin` (Task 2).
- Produces: `renderEmbedInto` gains a trailing `sourcePath: string` parameter
  (the fallback always has one — it comes from the public
  `MarkdownPostProcessorContext.sourcePath`).

- [ ] **Step 1: Add the `removeClasses` shim**

`renderEmbedInto` calls Obsidian's `HTMLElement.removeClasses`, which the
jsdom shim set doesn't cover yet. In `tests/setup.ts`, after the
`proto.toggleClass` definition, add:

```ts
proto.removeClasses = function (this: HTMLElement, cls: string[]) {
  this.classList.remove(...cls);
};
```

- [ ] **Step 2: Write the failing test**

Append to `tests/embedPin.dom.test.ts` (the harness from Task 4 already
supports `{ registry: false }`, which routes registration through the
reading-view post-processor):

```ts
describe('embed pin wiring (post-processor fallback path)', () => {
  it('pins through the fallback renderer too', async () => {
    const { postProcessor, state } = makeHarness('a ![[multi.drawio]] b', { registry: false });
    const section = document.body.createDiv();
    const span = section.createSpan({ cls: 'internal-embed' });
    span.setAttribute('src', 'multi.drawio');
    postProcessor!(section, { sourcePath: 'note.md' });
    await tick();

    const [, next] = Array.from(span.querySelectorAll<HTMLButtonElement>('.drawio-page-control button'));
    next!.click();
    const pin = span.querySelector<HTMLButtonElement>('.drawio-pin')!;
    pin.click();
    await tick();
    expect(state.text).toBe('a ![[multi.drawio#Page-2]] b');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/embedPin.dom.test.ts`
Expected: the fallback test FAILS (no `.drawio-pin` in the span); the two
registry tests still PASS.

- [ ] **Step 4: Wire the fallback**

In `src/file/EmbedRenderer.ts`:

(a) In `registerEmbedPostProcessor`, pass the source path through. Replace

```ts
      void renderEmbedInto(plugin, span, file, subpath);
```

with

```ts
      void renderEmbedInto(plugin, span, file, subpath, ctx.sourcePath);
```

(b) Extend `renderEmbedInto`. Replace its signature

```ts
async function renderEmbedInto(
  plugin: DrawioPlugin,
  span: HTMLElement,
  file: TFile,
  subpath?: string,
) {
```

with

```ts
async function renderEmbedInto(
  plugin: DrawioPlugin,
  span: HTMLElement,
  file: TFile,
  subpath: string | undefined,
  sourcePath: string,
) {
```

and replace its page-control block

```ts
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
```

with

```ts
    if (pages.length > 1) {
      const pageControlEl = span.createDiv({ cls: 'drawio-page-control' });
      renderPageControl(pageControlEl, {
        pages,
        initialPage: currentPage,
        onPageChange: (page) => {
          renderPreview(preview, xml, { ...plugin.previewOpts(), page });
        },
        pin: {
          pinnedPage: currentPage,
          onPin: (page) => {
            const name = pages[page]?.name;
            if (name !== undefined) void pinEmbedPage(plugin.app, sourcePath, file, subpath, name);
          },
        },
      });
    }
```

(The fallback path re-renders the whole section after a note modify, so no
local subpath bookkeeping is needed — the rebuilt control starts from the
rewritten link.)

- [ ] **Step 5: Run the suites to verify they pass**

Run: `npx vitest run tests/embedPin.dom.test.ts tests/embedRendererMobile.test.ts`
Expected: PASS (all tests, both suites).

- [ ] **Step 6: Commit**

```bash
git add src/file/EmbedRenderer.ts tests/embedPin.dom.test.ts tests/setup.ts
git commit -m "feat: pin button on fallback-path embeds"
```

---

### Task 6: manual-test doc and full verification

**Files:**
- Modify: `docs/MANUAL_TESTS.md`

**Interfaces:** none — verification only.

- [ ] **Step 1: Document the manual checks**

Append to `docs/MANUAL_TESTS.md`:

```markdown
## Pin embed page (0.5.x)

Needs a note embedding a multi-page diagram twice: once bare
(`![[multi.drawio]]`), once with a subpath (`![[multi.drawio#Page-2]]`).

- [ ] Pin button appears on embed page controls only (code blocks and the
      read-only file view show none), enabled only after flipping away from
      the linked page. Works on mobile as well as desktop.
- [ ] Flipping the bare embed to page 2 and pinning rewrites that link to
      `![[multi.drawio#Page-2]]` (alias preserved if present), shows a
      confirming Notice, and the embed re-renders on the pinned page.
      Reopening the note lands on the pinned page.
- [ ] With TWO identical links to the same file in one note, pinning shows
      the "several identical links" Notice and leaves the note untouched.
- [ ] Pinning in Live Preview and in Reading view both work; the OTHER
      embed of the same file (different subpath) never changes.
- [ ] Clicking the pin never also triggers the embed click action
      (editor/default app).
```

- [ ] **Step 2: Full suite, typecheck, build**

Run: `npm test`
Expected: all suites PASS.

Run: `npm run build`
Expected: exits 0 (tsc + esbuild, guard plugins included).

- [ ] **Step 3: Commit**

```bash
git add docs/MANUAL_TESTS.md
git commit -m "docs: manual test checklist for embed page pinning"
```

- [ ] **Step 4: Hand off**

Implementation complete on `feat/pin-embed-page`. Use
superpowers:finishing-a-development-branch (merge to main, install to the
dev vault for the manual checks above, no release tag until manual
verification passes).
