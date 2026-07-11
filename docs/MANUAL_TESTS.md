# Manual Test Checklist

Run in a desktop test vault after `npm run build` and copying the plugin (or symlinking `main.js`, `manifest.json`, `styles.css`, `webapp/`) into `<vault>/.obsidian/plugins/obsidian-drawio/`. Reload Obsidian (Ctrl/Cmd+R) after each rebuild.

## Code blocks
- [ ] A ` ```drawio ` block with valid mxfile XML renders an SVG preview in reading mode.
- [ ] The Edit (pencil) button appears (on hover) and opens the editor modal.
- [ ] Editing and saving in the modal updates the code block XML and the preview.
- [ ] Repeated autosaves while editing keep updating the SAME block (no "failed to save" spam, correct block among multiple).
- [ ] Invalid XML in the block shows the error placeholder + an Edit button.
- [ ] Two drawio blocks in one note edit independently (editing one doesn't corrupt the other).

## Files
- [ ] "Create new drawio diagram" command creates and opens a `.drawio` file in the custom view.
- [ ] Opening an existing `.drawio` file uses the custom view (preview + Edit), not plain text.
- [ ] Edit → Save persists to the file; the preview updates.

## Embeds
- [ ] `![[x.drawio]]` shows a preview + Edit button in reading mode.
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
