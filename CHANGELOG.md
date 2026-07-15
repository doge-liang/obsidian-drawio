# Changelog

All notable changes to the Drawio plugin are documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); version
numbers are plain `X.Y.Z` (no `v` prefix), matching the plugin's release tags.

The release workflow publishes the tagged version's section below as the GitHub
release notes, so a version's section must be complete before its tag is pushed
(see the Release process section of CLAUDE.md).

## 0.5.3 - 2026-07-15

### Added

- **Export diagrams as plain images**: the **Export diagram as SVG** and
  **Export diagram as PNG** commands (also in the file context menu) render
  the current diagram to a standalone image file next to the source — for
  publishing anywhere drawio isn't available. Desktop only; works for
  `.drawio` files and for `.drawio.svg` / `.drawio.png` files.

## 0.5.2 - 2026-07-15

### Changed — action may be required

- **The bundled drawio is updated from 30.0.4 to 30.3.11** (see the
  [drawio changelog](https://github.com/jgraph/drawio/releases) for what's new).
  Previews use the new version immediately. If you installed the offline
  editor, open **Settings → Drawio** and click **Update** to bring the editor
  to the same version; until then it keeps working on the previous one.

### Added

- **Dual-format diagram files (`.drawio.svg` / `.drawio.png`)**: the file is a
  standard SVG or PNG image with the diagram embedded — it displays as a plain
  image everywhere (GitHub, other tools, Obsidian's own image view and embeds)
  while staying fully editable here. Choose **New diagram format** in the
  settings to create them; edit via the file's context menu (**Edit drawio
  diagram**) or the **Edit diagram in the current image file** command. Same
  format as the VS Code drawio extension, so the files are interchangeable.
- **Convert between code blocks and files**: the **Extract diagram code block
  to file** command turns the code block under the cursor into a `.drawio`
  file and replaces the block with an embed; **Convert diagram embed to code
  block** does the reverse.

## 0.5.1 - 2026-07-12

### Added

- **Offline install bundle**: every release now ships
  `drawio-editor-<version>-offline.zip` — the complete plugin folder with the
  offline editor already inside, for vaults on machines without network
  access. Download it on a connected machine and, with Obsidian closed,
  extract it into `<vault>/.obsidian/plugins/` (see the README's
  [Offline editor](README.md#offline-editor-optional) section).

### Fixed

- After an offline-editor **Update** or **Reinstall**, reopening the editor
  could keep loading the previous drawio version from the browser cache for
  up to an hour. The editor now revalidates against the local server on every
  load — unchanged files still answer instantly from cache.
- An install whose download finished while the Obsidian window was minimized
  stalled at "Extracting…" until the window became visible again.
- A download whose connection went dead mid-transfer left the settings row
  stuck at "Installing…" until the plugin was reloaded; it now fails after
  30 seconds without data and offers **Retry**.

## 0.5.0 - 2026-07-12

### Changed — action may be required

- **The offline editor no longer falls back to the online editor silently.**
  With Editor source set to Offline (the default) and no offline webapp
  installed — the state of every store install whose settings were never
  touched — the editor now shows an install prompt instead of quietly loading
  diagrams.net. Install the offline editor with one click in the plugin
  settings (see below), or set **Editor source → Online** to keep the previous
  behavior explicitly. A one-time notice on plugin load points at the setting.

### Added

- **One-click offline editor install** in settings: downloads the pinned drawio
  release (~53 MB) from GitHub with live progress, validates it, and swaps it
  into place atomically — a failed or interrupted install never damages an
  existing one. When a plugin update bumps the bundled drawio version, the same
  settings row offers **Update** so the editor stays in lockstep with the
  bundled preview viewer.
- **Pin button on multi-page embed previews**: writes the currently shown page
  into the wikilink (`![[diagram.drawio#Page-2]]`), so the embed keeps opening
  on that page.
- **Read-only mode for `.drawio` files on desktop** (opt-in): open diagram
  files as a static preview instead of the embedded editor — for workflows
  centred on an external drawio app.
- **Preview click action** setting: clicking a preview edits the diagram
  (default), opens the file in the system default app, or does nothing.

### Fixed

- Flipping pages on one multi-page preview no longer changes the page shown by
  other multi-page previews in the same window.
- The read-only file view's hover "Edit" hint now floats over the diagram
  itself instead of the middle of the tab.
- Preview alignment changes apply immediately to already-rendered previews.

### Performance

- The local offline-editor server now sends HTTP cache headers (`ETag` /
  `Last-Modified`, conditional 304s), so reopening the editor skips
  re-transferring the webapp and reuses Chromium's compiled-code cache —
  noticeably faster editor startup after the first open.

## 0.4.1 - 2026-07-07

### Fixed

- Desktop editor mounts failed in offline mode ("Failed to fetch dynamically
  imported module"): dynamic `node:` imports are now lowered to lazy
  `require()` calls in the bundle, with a build-time guard that fails the build
  if a native `import()` of a Node built-in ever reappears.

## 0.4.0 - 2026-07-06

### Added

- **Mobile (phone/tablet) support**: previews for code blocks and embeds, and a
  read-only view for standalone `.drawio` files. Editing stays desktop-only.

### Fixed

- Plugin load crashed on iOS below 16.4 (lookbehind regex parsed at load time);
  desktop-only registration is now gated behind `Platform.isDesktopApp`.

## 0.3.2 - 2026-07-05

### Fixed

- The editor in a popped-out window stalled after loading: postMessage replies
  are now dispatched from the popout window's own realm.

## 0.3.1 - 2026-07-05

### Added

- **Multi-page diagrams**: a compact page switcher on previews, and
  `![[file.drawio#Page-N]]` opens an embed on a specific page.

### Fixed

- Popout-window message routing, an editor mount/destroy race, and a local
  server startup race.

### Changed

- `minAppVersion` raised to 1.4.0. The settings tab stays on the stable
  `display()` API — the declarative replacement is still early-access only.

## 0.2.2 - 2026-07-03

### Changed

- Releases are now built and published by CI from a clean checkout, with signed
  build-provenance attestations for the release assets.
- Removed an unused `dompurify` dependency (never imported; flagged by advisory
  scanners).

## 0.2.1 - 2026-07-03

### Fixed

- Guarded `Vault.createFolder()` for Obsidian versions below 1.4.0
  (plugin-review finding).

## 0.2.0 - 2026-07-03

### Added

- **New diagram location** setting: vault root, the current note's folder, or a
  fixed folder (created if missing).
- New entry points: a ribbon button and a "New drawio diagram" item in the file
  explorer's folder context menu.
- **Preview alignment** setting: centered (default) or left-aligned previews.

## 0.1.3 - 2026-06-06

### Fixed

- Previews no longer create `<script>` elements: the bundled viewer runs via
  indirect eval, and drawio's unused external MathJax loader is stripped at
  build time (plugin-review findings).

## 0.1.2 - 2026-06-06

### Changed

- The editor defaults to the bundled offline webapp, falling back to the online
  editor when the webapp isn't installed.

### Fixed

- Review-round fixes: keep the user's view location on unload, popout-safe
  globals, settings tab on the supported API.

## 0.1.1 - 2026-06-05

### Changed

- Maintenance release for community review; the plugin id `drawio-editor` is
  used consistently across manifest, tag, and release assets.

## 0.1.0 - 2026-06-05

### Added

- First release: embed, preview, and edit draw.io (diagrams.net) diagrams via
  ` ```drawio ` code blocks, standalone `.drawio` files (editor in the file's
  tab), and `![[file.drawio]]` embeds — with previews in both editing and
  reading views, and diagrams stored as readable uncompressed XML.
