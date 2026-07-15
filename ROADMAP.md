# Roadmap

Planning notes for upcoming releases. This reflects current intent, not a
commitment — priorities shift with user feedback and review findings.
Shipped work moves to [CHANGELOG.md](CHANGELOG.md).

## 0.6.0 — make what shipped discoverable and consistent

As of 0.5.3 the plugin leads its category on feature breadth (offline-first
editing, three surfaces, dual-format files, mobile previews). The gaps are
discovery (no forum presence, no demo media, "not manually reviewed" store
label) and one consistency hole in the flagship dual-format feature. 0.6.0
closes those before adding new surface area.

### P0 — adoption funnel (mostly non-code, before the release)

- [ ] Demo GIF at the top of the README (create → edit → preview flow);
      storyboard prepared, recording needs a desktop vault.
- [ ] Publish the community-forum announcement post (draft ready; move the
      "Coming next" items into the shipped list).
- [ ] GitHub issue templates + a troubleshooting section in the README
      (offline-editor install is the predictable top support driver).

### P0 — click-to-edit for dual-format files

`.drawio` files and code blocks edit on click; `.drawio.svg` / `.drawio.png`
embeds don't — the entry point hides in the context menu, which reads as
broken rather than missing. Add a click-to-edit hot zone on dual-format
embeds and file tabs (reuse the Reading-view post-processor suffix-filter
pattern; respect the **Preview click action** setting).

Acceptance: editing feels identical across all three surfaces.

### P1 — preview zoom & pan

Wheel/gesture zoom and drag pan on all previews (code blocks, embeds,
read-only file view), pinch-to-zoom on mobile. Table stakes for large
diagrams, and on phones/tablets the preview is the whole experience.

### P1 — automated upstream drawio bumps

Weekly scheduled workflow that checks the latest jgraph/drawio release and
opens a bump PR when behind (reusing the pinned-version pipeline and its
build-time assertions). Upstream ships several patch releases per month;
manual tracking is a hidden maintenance tax.

### P2 — new-diagram templates (stretch)

A templates-folder setting; the create command offers a template picker.
Serves repeat workflows; not release-gating.

## Deliberately deferred

- **Tablet editing** — high technical risk (embed iframe + postMessage on
  mobile WebView is unproven); worth a timeboxed spike only.
- **UI-string localization** — wait for a real demand signal.
- **Indexing diagram text for vault search** — heavy, uncertain API surface.

Reserve bandwidth for Obsidian's manual plugin review, which may arrive with
findings at any time.

## Success signals (no telemetry — proxies only)

- Store downloads reach top-2 among drawio-category plugins.
- Forum post gets real user replies.
- First external issues arrive and get a response within 48 hours.
