# CLAUDE.md

Guidance for working on this repo. The plugin is **shipped** (GitHub releases cut,
in/through Obsidian community review). Most future work is adding features or
fixing bugs on a stable base — so the priority is **not regressing the non-obvious
decisions below**, many of which were made to satisfy the plugin-review scanner or
to work around drawio/Obsidian quirks.

## What this is

An Obsidian plugin that embeds, previews, and edits
[draw.io](https://www.drawio.com/) (diagrams.net) diagrams. Plugin **id is
`drawio-editor`** (the bare `drawio` id is reserved — do not change it back).
**Editing is desktop-only** (it needs the iframe-based drawio embed app, the
local Node server, or a network connection); **mobile (phone/tablet) gets
preview only** — code blocks, embeds, and a read-only view for standalone
`.drawio` files. See `src/desktop/registerDesktopFeatures.ts` and the
"Mobile support" entry below.

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
  `resolveBaseUrl()` picks the editor URL (offline → local server; throws a typed
  `OfflineEditorNotInstalledError` when the webapp isn't installed — the automatic
  online fallback was removed after 0.4.x, **no automatic fallback** anymore).
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
  `editHint`, `pageControl` (multi-page prev/next control), and the vendored
  `viewer.min.txt`.
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
The plugin folder used during development is named `obsidian-drawio` (the old
name; the manifest id inside is `drawio-editor`).

## Non-obvious decisions — DO NOT casually revert

- **Mobile support (`isDesktopOnly: false`)**: `main.ts` and `ServerManager.ts`
  used to have top-level static imports of `node:http`/`node:fs`/`node:path`.
  esbuild marks Node built-ins as `external` (`esbuild.config.mjs`), so a
  static top-level import compiles to an unconditional, module-load-time
  `require(...)` call — which throws immediately on mobile (no Node runtime),
  crashing the *entire plugin load* before `onload()` even runs. Fixed by
  never letting a `node:*`/`electron` import be *static and top-level* outside
  `src/server/**` or `src/desktop/**` — both are only ever reached through
  `Platform.isDesktopApp`-gated dynamic imports: `main.ts`'s
  `maybeRegisterDesktopFeatures()`, and `settingsTab.ts`'s `startInstall()`
  (whose offline-editor row only renders inside the tab's desktop-gated
  block). A dynamic `await import(...)` at the point
  of use (e.g. `main.ts`'s `pluginDir()`/`resolveBaseUrl()`) is fine anywhere,
  since it's never eagerly evaluated — only a *static* top-level import gets
  hoisted and unconditionally `require()`d. **If you add a new Node/Electron
  API call anywhere outside those two directories, use a dynamic import at
  the call site — never a top-level static import** — or you will silently
  reintroduce the mobile load-time crash. `Platform` itself
  (`isDesktopApp`/`isMobile`/`isPhone`/`isTablet`) is `@since 0.12.2`, long
  publicly released — no `minAppVersion` concern.
  - **The dynamic-import pattern is only safe because esbuild lowers it (0.4.0
    regression).** esbuild *preserves* a dynamic `import()` of an external
    module as a native `import()` whenever the target supports the syntax
    (es2020+), even in cjs output — and Obsidian's CJS plugin loader in the
    Electron renderer resolves a native `import("node:path")` as a URL fetch,
    which rejects with `TypeError: Failed to fetch dynamically imported
    module`. In 0.4.0 that broke **every desktop editor mount in offline mode**
    (`resolveBaseUrl()` threw before its webapp check, so not even the online
    fallback ran — that fallback has since been removed, see "Default editor
    mode" below; at the time this bug was found it still existed). Fixed in
    0.4.1 by `supported: { 'dynamic-import': false }`
    in `esbuild.config.mjs`, which lowers every dynamic import to a lazy
    promise-wrapped `require()` (still evaluated at the call site, so the
    mobile rule above holds), plus `guardNativeNodeImportsPlugin`, which fails
    the build if a native `import()` of a Node built-in/electron ever
    reappears in `main.js`. **Don't remove either.**
- **Previews run the viewer via *indirect eval*, not a `<script>` element**
  (`src/preview/loadViewer.ts`). The plugin-review scanner flags
  `createElement("script")` as a blocking error; indirect eval (`win.eval(src)`) has
  identical global-scope semantics (top-level `var GraphViewer` → `window.GraphViewer`)
  without creating a script element. **Don't reintroduce `createElement('script')`.**
- **Two viewer global-state guards — don't remove either** (both regression-tested
  against the REAL vendored viewer; the suites skip when `viewer.min.txt` is absent):
  - `loadViewer.ts` defines a no-op `window.onDrawioViewerLoad` *before* evaling the
    viewer. Without it, viewer.min.js's tail bootstrap runs
    `GraphViewer.processElements()`: a document-wide scan that wipes and instantiates
    every `.mxgraph` element — including mounts it doesn't own.
    (`tests/loadViewerBootstrap.dom.test.ts`)
  - `ViewerRenderer.ts` restores the window-global `urlParams.page` after
    `createViewerForElement` returns. GraphViewer's init writes the instance's page
    into that global (its internal handshake for picking the `<diagram>` out of an
    mxfile — see the "Passes current page via urlParams" comment in GraphViewer.js)
    and never cleans it up, so without the restore the last-rendered page leaks to
    any later same-window mxfile parse that doesn't set a page first.
    (`tests/embedPageIsolation.dom.test.ts`, which also guards that flipping one
    multi-page preview never moves another — page state is strictly per-preview.)
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
- **`minAppVersion` is `1.4.0`** — chosen as the lowest version that needs zero
  `requireApiVersion` guards for any API this codebase currently uses (it exactly
  matches `Vault.createFolder`'s own floor, see below). **Don't bump it casually**,
  and see the settings-tab entry right below for a real mistake made bumping it
  too far.
- **`settingsTab.ts` uses the imperative `display()` API, NOT the declarative
  `getSettingDefinitions()` one — this was tried and reverted, on purpose.**
  0.3.0 (never released — see Review status below) briefly rewrote the settings
  tab to use `getSettingDefinitions()`/`setControlValue`/`refreshDomState` and
  bumped `minAppVersion` to `1.13.0` to match their `@since` tags. **The mistake:
  a `@since` tag only tells you an API exists in *some* Obsidian version — it does
  NOT tell you that version has actually shipped to the public.** At the time,
  `1.13.0` was a Catalyst (early-access) build; the latest *public* release was
  still `1.12.x`. Requiring `1.13.0` would have locked out every non-Catalyst user
  — i.e. almost everyone — until Obsidian promoted it to general availability, on
  a timeline we don't control. **Before requiring a version because an API's
  `@since` says so, check that version has actually shipped publicly**, not just
  that the tag exists in `obsidian.d.ts` — the same package ships tags for
  early-access builds too. `display()` is deprecated but not going anywhere; the
  cost of staying on it (one non-blocking review Warning) was far cheaper than
  the cost of the alternative (shipping a plugin the vast majority of users on
  public Obsidian couldn't even install). Reintroduce the declarative API only
  once its `@since` version is confirmed publicly released AND you're willing to
  raise `minAppVersion` to it.
  - Current `display()` implementation: a `save()` closure avoids repeating
    `void this.plugin.saveSettings()` per control; conditional rows (e.g. "Custom
    drawio URL" only in Custom mode) re-render via `this.display()` in the gating
    control's `onChange`; the idle-timeout field sets `inputEl.type = 'number'`
    and `inputEl.min = '5'` for native spinner UX, with manual range validation
    in `onChange` (invalid/too-small input is silently ignored, keeping the last
    good value) since `display()` has no built-in `validate` callback.
- **`onunload()` must NOT `detachLeavesOfType`.** Detaching resets the user's view to
  its default location on next load. Only stop the server.
- **Default editor mode is `offline`, with NO automatic online fallback** (the
  fallback existed through 0.4.x and was removed on purpose — don't reintroduce
  it). The ~145 MB `webapp/` can't ship via the store, so store installs start
  without it: `resolveBaseUrl()` throws `OfflineEditorNotInstalledError`
  (`src/model/errors.ts`), whose message both editor entry points surface, and
  the settings tab offers a one-click installer
  (`src/desktop/webappInstaller.ts`: `node:https` download of the pinned
  `draw.war` → `fflate` extract to a `webapp.installing/` staging dir →
  validate `index.html`/`js/viewer.min.js` exist → rename-aside swap into
  `webapp/` — the existing `webapp/` is renamed to `webapp.old/` first, the
  staging dir is renamed into `webapp/`, and on failure `webapp.old/` is
  renamed straight back so an install never leaves the vault with no webapp at
  all; a successful install best-effort-removes the `webapp.old/` leftover;
  the caller stops the local server first for Windows file locks; when the
  installed webapp's `DRAWIO_VERSION` file differs from the pinned constant,
  the row shows an **Update** button — same pipeline, always installs the
  pin, keeping the webapp in lockstep with the bundled viewer). `fflate` is
  a devDependency inlined by esbuild. The pinned version lives in
  `src/constants.ts` (`DRAWIO_VERSION`) and a test asserts it matches
  `scripts/fetch-drawio.mjs`. A load-time notice
  (`registerDesktopFeatures.ts`) points offline-mode users at settings when
  the webapp is missing.
- **Popout-window safety**: use `activeDocument`/`activeWindow` (baseline-supported),
  not `document`/`window`, in render paths.
- **A popped-out `.drawio` editor needs BOTH directions of the `postMessage` bridge
  fixed — receive AND send — and the two live in different places.** The editor iframe
  speaks the drawio embed protocol over `postMessage`, but the plugin always runs in
  the **main** window while a popped-out view's iframe lives in the **popout** window.
  Obsidian adopts the view's DOM into the popout *after* `mount()` runs (both "move to
  new window" and "open in new window" do this asynchronously), which reloads the
  iframe. Two independent fixes are required — **don't revert either, and note that the
  receive fix ALONE is not enough** (that intermediate state looked "fixed" but the
  pane still blanked):
  - **Receive** — `DrawioEditor.mount()` binds the `message` listener to
    `this.win = this.container.ownerDocument.defaultView`, and `rebindIfWindowChanged()`
    (wired to the iframe's `load` event) re-binds it whenever the container's window
    changes. Without this the listener is stuck on the main window and never sees the
    popped-out iframe's `configure`/`init` events.
  - **Send** — `DrawioEditor.post()` must dispatch replies from the iframe's **parent
    (popout) window realm** via indirect eval (`parentWin.eval(...)` posting to the
    iframe), NOT a bare `iframe.contentWindow.postMessage(...)` from the main realm.
    drawio only accepts protocol messages whose `source` is its own parent window; a
    post issued from the main realm carries `source === main window`, which drawio
    silently drops when popped out (its parent is the popout window), so the handshake
    stalls right after `configure` and the pane stays blank. In the main window
    `this.win === window`, the popout branch is skipped, and `post()` posts directly
    (unchanged) — which is also why the modal (code blocks / embeds, always main-window)
    and the in-main-window file view never showed the bug, making it look
    window-specific. Diagnose with the drawio handshake: `configure` received but no
    `init` follow-up ⇒ the reply isn't reaching drawio ⇒ it's the send side.
- **`Vault.createFolder()` requires Obsidian 1.4.0+** (it carries a `@since 1.4.0`
  JSDoc tag in `obsidian.d.ts`). `src/file/createDiagram.ts` originally called it
  unguarded, tripping `obsidianmd/no-unsupported-api` while `minAppVersion` was
  still `1.0.0`; fixed in 0.2.1 with a `requireApiVersion('1.4.0')` guard falling
  back to `vault.adapter.mkdir(...)`. **That guard is gone again as of 0.3.1**:
  `minAppVersion` is now exactly `1.4.0` (see above), so the guard's `else` branch
  is unreachable dead code — Obsidian's own version gating guarantees no installed
  instance runs below `minAppVersion`. *If you ever lower `minAppVersion` below
  `1.4.0`, re-add a guard for `createFolder` (and anything else whose `@since` then
  exceeds it)* — check `git log` for this file if you need the pattern back.
  **If you add any new Obsidian API call, don't assume "it's basic, it must
  be old"** — check for a `@since` tag in
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

**Since 0.2.2, releases are built and published automatically** by
`.github/workflows/release.yml`, triggered by pushing a version tag:

1. Add a `## <ver> - <YYYY-MM-DD>` section for the release at the **top** of
   `CHANGELOG.md`'s version list (Keep a Changelog subsections: Added / Changed /
   Fixed / Performance as applicable). The workflow publishes this section
   verbatim as the GitHub release notes — write it for end users, and call out
   behavior changes prominently.
2. Bump `manifest.json` `version` **and** add the matching entry to `versions.json`.
   Commit (changelog + bump together is fine) and push to `main`.
3. `env -u GITHUB_TOKEN git tag <ver> && env -u GITHUB_TOKEN git push origin <ver>`
   — the tag must exactly equal `manifest.version` (no `v` prefix) and must be
   pushed only after the version-bump commit is already on `main` (the workflow's
   own "verify tag matches manifest.json" step now hard-fails if they ever
   diverge — this used to be a manual, easy-to-miss check).
4. The workflow does the rest on a clean checkout: `npm ci` → verify tag ==
   manifest version → `npm run fetch-drawio` → `npm test` → `npm run build` →
   generate a signed build-provenance attestation for `main.js`/`manifest.json`/
   `styles.css` (`actions/attest-build-provenance`) → `gh release create` with
   those three assets, using the `CHANGELOG.md` section for the tag as the
   notes (falls back to `--generate-notes` with a warning when the section is
   missing — treat that warning as a bug in the release, not a feature).
5. **Don't also run `gh release create` by hand** after pushing the tag — it
   would race/conflict with the workflow's own release creation. To correct
   published notes afterward, fix `CHANGELOG.md` on `main` (the source of
   truth) and mirror the fix with `gh release edit <ver> --notes-file ...`.
6. Publishing a release (however it's created) is how the Obsidian review
   **re-runs** — cut one whenever you want a fresh review pass, even for a small fix.
7. **`env -u GITHUB_TOKEN`** is still required for any `gh`/`git` write op you run
   by hand (tagging, editing release notes, etc.) — the ambient PAT lacks scope;
   the `doge-liang` oauth login has it. (The workflow itself uses the auto-issued
   `GITHUB_TOKEN`, unrelated to this.)

GitHub Actions tag filters are **glob patterns, not regex** — `on.push.tags` only
supports `*`, `**`, `+`, `?`, `!`, no `[0-9]`-style character classes. The workflow's
trigger (`'*.*.*'`) is deliberately loose for this reason; the in-workflow
manifest-version check is the real gate.

## Review status (as of 0.3.1)

All blocking **Errors** found so far are fixed: dynamic `<script>` creation (0.1.3)
and `Vault.createFolder` outrunning `minAppVersion` (0.2.1). The `display`
deprecation Warning is back and **accepted, not resolved** — see the settings-tab
entry above for why the declarative-API alternative was tried in 0.3.0 and
reverted (0.3.0 was never released). Remaining findings are non-blocking and
inherent to the vendored drawio viewer:
- `fs` access (Warning) — ours: the local offline server + webapp existence check. Necessary, desktop-only.
- Clipboard / Local Storage / Dynamic Code Execution (Recommendations) — all from the
  vendored drawio `viewer.min.js`, not our code (our one indirect eval adds to the
  eval recommendation but stays non-blocking).
- `display` deprecation (Warning) — deliberate, see above.
- Missing artifact attestations — **resolved in 0.2.2** by the release workflow above.

## Checklist: before shipping any change

Distilled from every review round so far (0.1.0 → 0.3.1). Run through the relevant
parts before adding a new Obsidian API call, touching the DOM/rendering path, or
cutting a release — cheaper than a review round-trip.

**New Obsidian API call you haven't used in this repo before:**
- [ ] Check `node_modules/obsidian/obsidian.d.ts` for a `@since X.Y.Z` tag on it.
  *"Looks basic" is not evidence it's been there forever* — `Vault.createFolder`
  feels bog-standard but needs 1.4.0, our `minAppVersion`.
- [ ] **A `@since` tag proves the API exists in some Obsidian version — it does
  NOT prove that version has publicly shipped.** The `obsidian` npm package tags
  Catalyst (early-access) APIs the same way as stable ones. Before requiring a
  version because of a `@since` tag, confirm on Obsidian's own release notes/changelog
  that the version is out of Catalyst and generally available — this is exactly how
  0.3.0's `minAppVersion: 1.13.0` (declarative settings API) shipped-in-spirit but
  would have locked out everyone not in the Catalyst program. Reverted in 0.3.1.
- [ ] If it's newer than `minAppVersion`: guard with `requireApiVersion('X.Y.Z')`
  (the exact pattern `obsidianmd/no-unsupported-api`'s rule recognizes as
  satisfying the check — see `isGuardedByRequireApiVersion` in the rule source) and
  fall back to an older/untagged alternative. Don't bump `minAppVersion` for one
  call site.
- [ ] Conversely, if `minAppVersion` ever moves *past* an API's `@since`, any
  existing `requireApiVersion` guard for it becomes dead code (its fallback branch
  is now unreachable) — simplify it away rather than leaving it as inert cruft.
- [ ] To verify a finding — including one relayed secondhand, where line numbers
  can be transcribed incorrectly — reproduce the actual lint rule locally rather
  than reasoning from the rule's source alone (see the repro recipe above; a static
  read once wrongly pointed at `new Notice(...)` when the real culprit, found only
  by actually running the rule, was `Vault.createFolder` three lines later).

**Anything that imports a Node built-in (`node:*`) or `electron`:**
- [ ] Never a *static, top-level* `import ... from 'node:...'` (or `'electron'`)
  outside `src/server/**` or `src/desktop/**` — esbuild's `external` config
  (`esbuild.config.mjs`) leaves these as unconditional `require(...)` calls in
  the bundled `main.js`, which crashes the entire plugin load on mobile
  (no Node runtime) before `onload()` runs.
- [ ] If the call site is outside those two directories (e.g. a method on
  `DrawioPlugin` in `main.ts`), use a dynamic `await import('node:...')`
  *inside* the function body, at the point of use — never a top-level import.
- [ ] That dynamic-import pattern works ONLY because `esbuild.config.mjs` sets
  `supported: { 'dynamic-import': false }`, lowering `import()` to a lazy
  `require()`. Never remove that option: without it esbuild keeps a *native*
  `import("node:...")` in `main.js` (es2021 supports the syntax), which
  Obsidian's renderer can't resolve at runtime ("Failed to fetch dynamically
  imported module" — the 0.4.0 desktop regression, fixed in 0.4.1). The
  `guard-native-node-imports` build plugin enforces this at build time.
- [ ] If you're adding a genuinely new desktop-only feature, prefer adding it
  to `src/desktop/registerDesktopFeatures.ts` (or a sibling file there) over
  scattering a new `Platform.isDesktopApp` check somewhere else — keeping the
  boundary in one place is what makes it auditable.

**Any regex *literal* (`/pattern/flags`), anywhere in `src/`:**
- [ ] Never use a lookbehind assertion (`(?<=`/`(?<!`), a named capture group
  (`(?<name>`), or a Unicode property escape (`\p{...}`) in a regex *literal*.
  Lookbehind needs iOS 16.4+; named groups and Unicode property escapes only
  need iOS 11.1+ (avoided here too, out of the same caution, even though
  their floor is much lower) — but the danger isn't "this code path never
  runs on old iOS": a regex literal's
  syntax is validated when the *script is parsed*, not deferred to when that
  line executes (unlike an unreached function body, which most engines can
  skip during initial parsing). An unsupported regex literal anywhere in
  `main.js` — even inside a function nothing on mobile ever calls — throws a
  `SyntaxError` while the whole file is being parsed, crashing plugin load on
  mobile exactly like a static Node-built-in import does. (Found in
  `src/model/formatXml.ts` during mobile support's final verification sweep,
  in code whose only *caller* was already desktop-gated — gating the caller
  doesn't help, since the parse failure happens before any caller runs.)
- [ ] If you need this kind of behavior, use `new RegExp(pattern, flags)` with
  a runtime string (not a literal) inside a `try/catch`, or restructure the
  logic to avoid the feature entirely (e.g. `formatXml.ts`'s fix: split on a
  *captured* delimiter with only a lookahead, then re-merge the pairs).
- [ ] `eslint-plugin-obsidianmd`'s `regex-lookbehind` rule catches lookbehind
  specifically, but only lints `src/**/*.ts` — it does not scan the vendored
  `viewer.min.txt`. If you ever change what's vendored there (see
  `scripts/fetch-drawio.mjs`), grep the new blob for `(?<=`, `(?<!`, `(?<[a-zA-Z`,
  and `\p{` before shipping.

**Anything that dynamically creates DOM elements or runs code:**
- [ ] Never `doc.createElement('script')` — even for our own vendored, offline,
  no-network code, the review scanner flags it unconditionally (it can't tell
  "trusted vendored blob" from "arbitrary remote code"). Use indirect eval
  (`someWindow.eval(code)`) instead: identical global-scope semantics to a
  top-level `<script>`, no script element created.
- [ ] A genuine external-code loader (fetches `<script src="https://...">`) is a
  real risk, not just an optics problem for the scanner — strip it at build time if
  it's unused/inert (done for drawio's own MathJax-from-CDN loader in
  `esbuild.config.mjs`), don't just work around the scanner's pattern match.
- [ ] Don't reach for DOMPurify for drawio SVG/HTML content — it strips
  `foreignObject` in every profile, erasing drawio's `html=1` text labels. Extend
  `svgSanitizer.ts` instead.

**`onunload()`:** never call `detachLeavesOfType()` — it resets the user's view to
its default location on next load, discarding wherever they moved it. Only tear
down servers/timers/listeners.

**Anything that might render in a popped-out window:** use `activeDocument`/
`activeWindow`, never bare `document`/`window`.

**Settings tab:** stick with `display()`. The declarative `getSettingDefinitions()`
API is deprecation-free and nicer to write, but it's `@since 1.13.0`, and as of
this writing `1.13.0` is still Catalyst-only (not publicly released) — see the
"Non-obvious decisions" entry above. Don't switch until `1.13.0` (or whatever its
successor is by then) is confirmed publicly released, and you're willing to raise
`minAppVersion` to match. Adding a new setting to the current `display()`
implementation: add a `new Setting(containerEl)...` block, use the shared `save()`
closure after mutating `this.plugin.settings`, and if another row's visibility
depends on the new setting, call `this.display()` in its `onChange` to re-render.

**`package.json` dependencies:**
- [ ] `main.js` is a fully-bundled esbuild artifact — Obsidian never runs
  `npm install` for a plugin, so there's rarely a reason to have *any* runtime
  `dependencies` (everything should be inlined at build time). An unused
  dependency is pure liability: it still trips vulnerability-advisory scanners for
  code that isn't even imported. (Happened with `dompurify` — listed in
  `dependencies`, never once imported, removed in 0.2.2 alongside a matching
  GHSA finding.)
- [ ] Use `npm audit --omit=dev` before worrying about an audit finding —
  devDependency vulnerabilities (vitest/vite/esbuild toolchain, etc.) never ship in
  `main.js` and don't affect the plugin's actual security posture.
- [ ] If a dependency-name string (e.g. "dompurify") shows up inside `main.js`
  *after* confirming it's not one of our own imports, it's very likely inside the
  vendored `viewer.min.txt` itself — drawio bundles its own internal copy for the
  editor's paste-sanitization. Not independently patchable; only fixed by bumping
  `DRAWIO_VERSION` in `scripts/fetch-drawio.mjs`.

**TypeScript/lint hygiene the review's scanner also checks (beyond
`obsidianmd`-specific rules), easy to reintroduce after a refactor:**
- Unnecessary type assertions (`x as unknown as T` when `x` already satisfies `T`,
  usually after tightening/loosening a type elsewhere) — recheck casts you touch.
- No control-character regex (`/[\x00-\x1f]/`) — filter by char code in a loop
  instead (see `svgSanitizer.ts`'s `isUnsafeUrl`).
- `window.setTimeout`/`window.clearTimeout`, not the bare globals.
- No unnecessary `globalThis` casts.
- A promise-returning function passed where a sync callback is expected needs
  wrapping: `() => { void asyncFn(); }`, not a bare reference.

**Cutting a release:** see the Release process section above.
