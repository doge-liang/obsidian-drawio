# Design: multi-page preview navigation

Date: 2026-07-04. Approved by owner in-session (section by section).

## Motivation

Previews (code blocks and `![[file.drawio]]` embeds) currently render only the
first `<diagram>` page of a multi-page mxfile; README documents this as a known
limitation, and `![[file.drawio#Page-2]]`'s page-selector subpath is silently
ignored. This adds a compact prev/next control to browse all pages directly in
the rendered preview, without opening the full editor, and wires up the
existing (currently ignored) `#Page-N` subpath as the embed's initial page.

## Feasibility (already verified)

drawio's vendored `GraphViewer` (`src/preview/viewer.min.txt`) already supports
rendering a specific page via its `data-mxgraph` config: `this.currentPage =
parseInt(this.graphConfig.page) || 0`. No changes to the vendored viewer are
needed — we just need to pass `page: N` through the config we already build.

## 1. Data model (`src/model/xmlUtils.ts`)

```ts
export interface DiagramPage { id: string; name: string; }
export function getDiagramPages(xml: string): DiagramPage[]
```

Parses all `<diagram id="..." name="...">` elements from an `<mxfile>` in
document order. `extractDiagramTitle` (currently defined but unused anywhere in
`src/`) is rewritten as a thin wrapper: `getDiagramPages(xml)[0]?.name ?? null`
— avoids two independent regex parsers for overlapping data in the same file.

## 2. `ViewerRenderer.ts`

`RenderOptions` gains an optional field:

```ts
interface RenderOptions {
  dark: boolean;
  align?: PreviewAlignment;
  page?: number; // default 0
}
```

`renderPreview` threads `page: opts.page ?? 0` into the existing `data-mxgraph`
config object. No other change to `renderPreview`'s behavior or signature;
existing call sites that don't pass `page` are unaffected (default first page).

A page switch is implemented as **calling `renderPreview` again** with the same
in-memory XML string and a new `page` index, producing a fresh sanitized SVG
that replaces the old one. `renderPreview` already `el.empty()`s and rebuilds
its target element on every call (this is how theme changes and embed
`modify`-triggered refreshes already work today), so this requires no new
re-render machinery — it's the same call, called again with a different option.

## 3. Page control component (`src/preview/pageControl.ts`, new)

```ts
export function renderPageControl(container: HTMLElement, opts: {
  pages: DiagramPage[];
  initialPage: number;
  onPageChange: (page: number) => void;
}): void
```

Only invoked when `pages.length > 1` — single-page files show no control,
matching current appearance exactly. Renders a compact `‹ 2 / 5 ›` bar: plain
page numbers (not names) in the indicator, per the compact-arrows interaction
style. Owns its own "currently displayed page" UI state internally; on each
arrow click, updates its own indicator text and disables the arrow at
whichever boundary is now reached (clamped, no wraparound — no next-after-last
or prev-before-first), then calls `onPageChange(newIndex)` so the caller
re-renders the SVG for that page. The component itself never touches XML or
`renderPreview` — its only job is page-index UI and boundary clamping.

Arrow click handlers call `stopPropagation()` — the wrapper element they sit
inside already has its own click-to-open-editor listener, so this is required
to keep clicking an arrow from also opening the editor.

## 4. Wiring into the two render call sites

**New DOM structure** (both call sites): the page control renders as a
**sibling** of `.drawio-preview`, both children of the same wrapper
(`.drawio-codeblock` / `.drawio-embed`):

```
wrapper
 ├─ .drawio-preview        (renderPreview owns this; empties/rebuilds it alone)
 └─ .drawio-page-control   (only created when pages.length > 1)
```

Placed below the diagram. Clicking blank space on the page-control bar (not an
arrow) still opens the editor, same as clicking anywhere else on the preview —
only the arrow buttons themselves stop propagation. The existing centered
hover "Edit" hint overlay (`inset: 0` relative to the wrapper) will span both
the diagram and the control bar once both exist; this is a minor cosmetic
detail to eyeball during manual testing, not a functional concern.

**Code blocks** (`DrawioCodeBlock.ts`): current-page state is a local variable
closed over by the arrow click handlers — the whole `renderCodeBlock` function
already reruns fresh on every note re-render (editing the block, switching
views), so there's no cross-render state to preserve. Always starts at page 0
(first page) — no subpath mechanism for code blocks (out of scope, per
decision below).

**Embeds, embedRegistry path** (`DrawioFileEmbed` class in `EmbedRenderer.ts`):
current-page tracked as an instance field (`private currentPage: number`), not
a local variable — this class already persists across `vault.on('modify')`-
triggered re-renders of the same file, and the field lets a modify-triggered
refresh **preserve** whatever page the user was looking at (e.g. mid-edit via
the full editor) instead of resetting to page 0/the subpath every time. The
field is only re-initialized from the subpath when the embed's target file
identity actually changes (comparing `file.path`), not on a same-file content
refresh.

**`#Page-N` initial page**: `EmbedRegistry.registerExtension`'s creator
callback already receives a third `subpath` argument (currently unused):
`registry.registerExtension(DRAWIO_FILE_EXT, (ctx, file, subpath) => new
DrawioFileEmbed(plugin, file, ctx.containerEl, subpath))` — the constructor
gains a `subpath?: string` parameter and stores the resolved initial page
(computed once, in the constructor, before the first `render()` call). To
strip a leading `#` and match against `pages[].name`, `render()`'s first
successful parse of the file's pages is what resolves the subpath string to an
actual page index (the constructor can't know page names before the file is
read); on match, that's `this.currentPage`'s starting value, on no match (or
no subpath), it defaults to page 0 — identical to today's "ignored" behavior,
so this is strictly a fix, never a regression.

**Embeds, post-processor fallback path** (`registerEmbedPostProcessor`, used
only when `embedRegistry` is unavailable): whether this path can reliably
recover the `#Page-N` subpath from the `.internal-embed` span's `src`
attribute (or elsewhere) is **unverified** — Obsidian's exact attribute
behavior here needs empirical checking during implementation, not assumed
from documentation. Design stance: best-effort — if the subpath can be
recovered, use it; if not, default to page 0. Never worse than current
behavior, and not a blocker for shipping the rest of the feature, since this
path is itself only a defensive fallback for an already-rare case
(`embedRegistry` missing).

## 5. Error handling

Deliberately minimal new code — most cases fall out of already-robust existing
mechanics:

- **SVG render failure on a page switch**: `renderPreview` is already an
  idempotent, repeatedly-callable function that shows a `.drawio-error`
  placeholder on failure (this is exactly how theme toggles and embed
  `modify` refreshes already behave). A page switch is just another call to
  it; no new failure-handling code needed here.
- **Code-block content/page-count changes**: the whole `renderCodeBlock`
  function already reruns from scratch on every note re-render; page count is
  recomputed and the view resets to page 0 naturally, matching the
  already-decided "code blocks always start at page 1" behavior.
- **Embed page count shrinks on a `modify`-triggered refresh**: the one place
  that needs new, explicit code. Clamp `this.currentPage` to
  `Math.min(this.currentPage, pages.length - 1)` right after recomputing
  `pages`, before using it to render. If the file now has only 1 page, the
  control disappears naturally — `DrawioFileEmbed.render()` already
  `el.empty()`s and rebuilds everything from scratch on every refresh.
- **`#Page-N` matches no page name**: silent fallback to page 0. No error
  shown — matches the current "ignored" baseline exactly.

## 6. Testing

- `getDiagramPages`: pure-function unit tests — single page, multiple pages,
  missing `name` attributes, non-mxfile input.
- Extend `tests/viewerRenderer.sizing.test.ts`'s existing mock-`GraphViewer`
  pattern with one assertion: passing `page: N` in `RenderOptions` results in
  the `data-mxgraph` config object carrying that field. (GraphViewer's own
  internal use of the field is not re-verified here — already confirmed by
  reading the vendored source in this design's Feasibility section.)
- Interactive behavior — arrow click handling, boundary clamping, the
  `#Page-N` wiring, and the post-processor fallback's subpath recovery — all
  depend on real Obsidian runtime behavior that cannot be driven from this
  environment (same limitation as the 0.3.0 settings-tab rewrite). These
  require manual verification in the dev vault before release.

## Out of scope

- A page-selector syntax for code blocks (e.g. an info-string `page=` param) —
  code blocks always start at page 0; only the arrows navigate.
- Persisting the "last viewed page" across note reopens/app restarts —
  ephemeral, in-memory only, resets to the initial page (0, or the subpath's
  page for embeds) on a fresh render.
- Reusing drawio's own native `"pages"` toolbar UI inside GraphViewer's live
  container — rejected because it would require keeping GraphViewer's
  unsanitized, interactive container mounted, contradicting the existing
  static-sanitized-SVG-only architecture documented in `CLAUDE.md`.
- Pre-rendering all pages up front for instant flipping — rejected as
  unnecessary complexity/cost for typical (few-page) diagrams; page switches
  reuse the already-fast synchronous render path.
