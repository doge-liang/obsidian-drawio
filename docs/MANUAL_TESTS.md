# Manual Test Checklist

Run in a desktop test vault after `npm run build` and copying the plugin (or symlinking `main.js`, `manifest.json`, `styles.css`, `webapp/`) into `<vault>/.obsidian/plugins/obsidian-drawio/`. Reload Obsidian (Ctrl/Cmd+R) after each rebuild.

## Code blocks
- [ ] A ` ```drawio ` block with valid mxfile XML renders an SVG preview in reading mode.
- [ ] Clicking the preview opens the editor modal (default **Preview click action**).
- [ ] Editing and saving in the modal updates the code block XML and the preview.
- [ ] Repeated autosaves while editing keep updating the SAME block (no "failed to save" spam, correct block among multiple).
- [ ] Invalid XML in the block shows the error placeholder + an Edit button.
- [ ] Two drawio blocks in one note edit independently (editing one doesn't corrupt the other).

## Files
- [ ] "Create new drawio diagram" command creates and opens a `.drawio` file in the custom view.
- [ ] Opening an existing `.drawio` file uses the custom view (preview + Edit), not plain text.
- [ ] Edit → Save persists to the file; the preview updates.

## Embeds
- [ ] `![[x.drawio]]` shows a preview in reading mode; clicking it opens the editor.
- [ ] Editing an embed saves to the underlying file; the embed updates after the note re-renders.

## Settings / theming
- [ ] Switching Obsidian dark/light updates the editor theme on the next editor open.
- [ ] Changing "Preview alignment" realigns already-rendered previews immediately (no re-render), including in a popped-out window.
- [ ] Disabling the plugin removes the left-alignment (previews in still-open notes fall back to centered).
- [ ] "Custom URL" mode loads the editor from the configured URL (e.g. https://embed.diagrams.net/).
- [ ] Server idle timeout persists across reloads; values below 5 are rejected.

## Server lifecycle
- [ ] First edit lazily starts the local server (check the dev console / network).
- [ ] The editor still opens if the first port in the range is occupied (auto-fallback).
- [ ] After the idle timeout with no editor open, the server stops.

## Cleanup
- [ ] Disabling the plugin with a `.drawio` file open does not leave a broken "No view of type" pane.
- [ ] No errors in the console on enable/disable cycles.

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
- [ ] A markdown-style embed (`![alt](multi.drawio)`) shows the "markdown-style link" Notice on pin and the note text is untouched.
- [ ] Clicking the pin never also triggers the embed click action
      (editor/default app).

## Dual-format embed click-to-edit (0.6.0)

Needs a `.drawio.svg` (and a `.drawio.png`) embedded in a note:
`![[diagram.drawio.svg]]`. Test in **Reading view** (the hotspot is
Reading-view only by design).

- [ ] Clicking anywhere on the embedded image opens the editor on the
      embedded diagram (not Obsidian's image lightbox).
- [ ] Editing and saving updates both the embedded XML and the rendered image.
- [ ] With **Preview click action → Open in default app**, clicking opens the
      file in the OS default app instead; with **Do nothing**, the image is not
      clickable.
- [ ] With **Preview click action → Interactive viewer**, clicking opens the
      editor (the interactive viewer only drives `.drawio` SVG previews; the
      native image has nothing to explore).
- [ ] A plain (non-drawio) `.svg`/`.png` embed is unaffected — normal
      image behavior.
- [ ] On mobile, the native image is untouched (no hijacked click).
- [ ] The standalone `.drawio.svg`/`.drawio.png` file tab still edits via the
      right-click **Edit drawio diagram** menu / command (file-tab hotspot is
      intentionally not added — Obsidian owns the native image view).

## Interactive viewer viewport

Set **Preview click action → Interactive viewer**. Needs a wide diagram (the
demo `demo.drawio`), a small one (two boxes), and a tall one, each as an
embed and as a code block.

- [ ] Before clicking, every preview already shows the diagram with a clear
      margin inside its box (no shape touching the edge); clicking activates
      without the picture moving or resizing.
- [ ] Active, the toolbar sits at the viewport's top-right and the resize
      handle on its bottom edge — also for a small code-block diagram, whose
      viewport is centred at its natural width rather than spanning the note.
- [ ] Drag the pane divider narrower and wider: the viewport height follows
      the new width (no blank bands above/below), and a zoomed view keeps its
      zoom level. Toggling the sidebar behaves the same.
- [ ] Drag the resize handle shorter than the diagram's aspect: the embed
      keeps its width (it used to shrink horizontally too) and the diagram is
      centred in the shorter box; after a reload the persisted height shows
      the same picture.
- [ ] A tall diagram gets a viewport no taller than ~90% of the pane, fully
      visible without scrolling; **Fit** and the initial view are identical.
- [ ] Flip pages on a multi-page embed: the box keeps its width and height,
      the new page is fitted inside it.
- [ ] **Full screen** fills the screen with the diagram re-fitted; exiting
      restores the previous box. Edit a diagram elsewhere while its embed is
      visible: the embed re-renders and re-fits to the new diagram.
