# Design: pin an embed's current page back into the note

Date: 2026-07-12. Approved by owner in-session (interaction model and scope
chosen via explicit options; design presented and approved as one piece).

## Motivation

The multi-page preview control (see `2026-07-04-multipage-preview-design.md`)
deliberately kept page flips ephemeral — "persisting the last viewed page" was
listed out of scope there. In practice that means an embed always reopens on
the page hard-coded in the note text (`![[file.drawio#Page-2]]`'s subpath, or
the first page when there is none), and a page the user navigated to is lost
on the next render. This adds an explicit, user-initiated way to persist the
currently shown page into the note itself.

Owner decisions taken during brainstorming:

- **Explicit pin button**, not save-on-every-flip: flipping stays a read-only
  browsing gesture; only a deliberate click mutates the note. Avoids edit
  history, sync and git churn from casual browsing. (An auto-save setting can
  be layered on later; out of scope now.)
- **Embeds only**: the note text is the natural home for an embed's page (the
  `#Page-N` subpath already exists and is name-resolved). Code blocks and the
  read-only file view are out of scope.

## Interaction

The embed page control grows a pin button to the right of the existing
`‹ N / M ›` bar (rendered only when the caller provides pin support — code
blocks and the file view pass nothing and look unchanged):

- Enabled whenever the currently shown page differs from the page the link
  currently points to (the resolved initial page). Disabled when they match.
- Click: rewrite this embed's link in the note so its subpath names the
  current page — `![[flow.drawio]]` → `![[flow.drawio#Page-3]]`, or
  `![[flow.drawio#Page-2]]` → `![[flow.drawio#Page-3]]`. An existing
  `|alias` part is preserved. A `Notice` confirms success.
- Pinning is a pure text operation on the note — available on mobile too (no
  desktop gate, unlike the editor).
- Like the arrows, the pin button `stopPropagation()`s so a click never also
  triggers the embed's click action.

## Locating the link to rewrite

The embed creator's `ctx` carries `sourcePath` (the embedding note's path) in
addition to the `containerEl` we already use (verified against Obsidian
1.12.7 internals: the embed loader passes `{app, containerEl, linktext,
sourcePath, …}`; only `sourcePath` is needed — the links themselves come from
the metadata cache below). It is an internal-but-stable field, handled in the
same feature-detect style as `embedRegistry` itself: **if it is missing, the
pin button simply isn't rendered** — the feature degrades to today's behavior
instead of breaking.

The link is located by *position*, never by string search:
`metadataCache.getCache(sourcePath).embeds` lists every embed in the note with
exact offsets. Candidates are the entries that (a) resolve to this embed's
target file (`getFirstLinkpathDest(entry link path, sourcePath)`), and (b)
carry the same subpath this instance was created with (its *original*
subpath, not the currently flipped page):

- **Exactly one candidate** → rewrite it atomically via
  `vault.process(noteFile, …)`, replacing only that link's text span.
- **Zero or several candidates** (e.g. the note embeds the identical link
  twice, or the cache is stale/unavailable) → `Notice` explaining the pin
  couldn't be applied unambiguously; the note is not touched.

The rewrite itself is a pure function (note text + candidate spans + new page
name → new text | ambiguity outcome), unit-testable without Obsidian.

## Subpath semantics

The written subpath uses the page *name* (e.g. `#Page-3`), symmetric with the
existing name-based `resolvePageFromSubpath`. Known limitation, documented
here: if a file contains duplicate page names, resolution hits the first
match, so pinning a later same-named page won't round-trip. Pages later
renamed or deleted fall back to page 0 on resolve — the pre-existing subpath
behavior, unchanged.

## Convergence after the rewrite

Modifying the note makes Obsidian rebuild that embed (new creator call with
the new subpath), so the displayed page, the control's state, and the note
text converge without any manual syncing. Flipping continues to write nothing.

## Error handling

- Missing `linktext`/`sourcePath` on `ctx` → no pin button (silent degrade).
- No/ambiguous candidates in the metadata cache → `Notice`, no write.
- `vault.process` failure → `Notice` with the error, no partial state to
  clean up (the rewrite is a single atomic operation).
- Single-page files: no page control at all today; nothing changes.

## Testing

- Pure rewrite function: append a subpath where none exists; replace an
  existing subpath; preserve `|alias`; reject zero-candidate and
  multiple-identical-candidate inputs; distinguish two embeds of the same
  file by their differing original subpaths.
- Page control (existing DOM test suite): pin button rendered only when pin
  support is provided; disabled exactly when shown page == pinned page;
  click stops propagation and fires the callback with the current page.
- Live behavior (Obsidian runtime — creator `ctx` fields, cache timing,
  reading view vs Live Preview rebuild) needs manual verification in the dev
  vault; add the steps to `docs/MANUAL_TESTS.md`.

## Out of scope

- Code-block page persistence (e.g. a fence info-string `page=` param).
- Remembering the last viewed page of the read-only `.drawio` file view.
- An "auto-save page on flip" setting (possible later layer on top of the
  same rewrite machinery).
- Any change to flip behavior itself — flips remain ephemeral.
