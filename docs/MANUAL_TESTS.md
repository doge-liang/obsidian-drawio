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
- [ ] **Create new diagram**, the ribbon button and folder menu create/open a standalone diagram without editing the active note.
- [ ] Opening an existing `.drawio` file uses the custom view (preview + Edit), not plain text.
- [ ] Edit → Save persists to the file; the preview updates.

## Create and insert diagram (desktop)
- [ ] **Create and insert diagram** is available in a Markdown editor, not Reading view, an image/diagram tab or an empty workspace.
- [ ] For each **New diagram format** (`.drawio`, `.drawio.svg`, `.drawio.png`), the file is created and its embed appears in the source note before its editor opens. Close the editor without editing: the embed remains and resolves to the created file.
- [ ] **New diagram location** respects vault root, the source note's folder and a fixed nested folder (created if missing).
- [ ] At a cursor in text, and with a forward/backward selection, surrounding and selected text remain intact. The embed is inserted at the cursor/selection end on its own line. Undo in the note removes the insertion but keeps the file; redo restores the embed.
- [ ] With Wikilinks on/off and different **New link format** settings, the generated embed resolves correctly, including paths with spaces.
- [ ] If another Markdown pane becomes active while file creation is pending, only the initiating editor is changed, at its captured cursor. If the initiating pane is reused for a different note, neither that note nor the new active note is edited; a notice gives the created file's path.
- [ ] A failed file/folder creation leaves the note untouched; an editor-open failure after successful insertion does not remove the embed.

## Modal save and return to note (desktop)
- [ ] After creating/inserting a dual-format diagram, edit a shape label without clicking elsewhere and press **Esc**. The latest label is saved in both native XML and the exported image before the modal closes; focus returns to the still-active source note without changing its text or selection.
- [ ] Repeat from an existing embed and a code-block editor; a standalone `.drawio` editor tab does not acquire the modal Escape shortcut.
- [ ] With persistence deliberately failing in a test vault, **Esc** leaves the modal open with the unsaved diagram; restore writes and press **Esc** again to save and close.
- [ ] Closing a modal does not steal focus if a different note became active. An editor that failed to load can still be dismissed with **Esc**.

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
