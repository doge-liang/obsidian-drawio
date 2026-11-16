import { Notice, TFile, TFolder } from 'obsidian';
import type { Editor, EditorPosition, MarkdownFileInfo } from 'obsidian';
import type DrawioPlugin from '../main';
import type { DrawioSettings } from '../settings';
import { EMPTY_DIAGRAM } from '../constants';
import { buildInitialPng, buildInitialSvg } from '../model/dualFormat';
import { DualFormatFileSource } from './DualFormatFileSource';

/** Normalize a vault folder path: forward slashes, no empty/leading/trailing segments. */
function normalizeFolderPath(path: string): string {
  return path.trim().replace(/\\/g, '/').split('/').filter(Boolean).join('/');
}

/**
 * Resolve the target folder ('' = vault root) for a new diagram from the
 * location setting and the active file's parent path (null when no file is open).
 */
export function resolveNewDiagramFolder(
  settings: Pick<DrawioSettings, 'newDiagramLocation' | 'newDiagramFolder'>,
  activeFileParentPath: string | null,
): string {
  switch (settings.newDiagramLocation) {
    case 'current': return normalizeFolderPath(activeFileParentPath ?? '');
    case 'folder': return normalizeFolderPath(settings.newDiagramFolder);
    default: return '';
  }
}

/** Create missing folders segment by segment. */
async function ensureFolderExists(plugin: DrawioPlugin, path: string): Promise<boolean> {
  if (!path) return true;
  let current = '';
  for (const segment of path.split('/')) {
    current = current ? `${current}/${segment}` : segment;
    const existing = plugin.app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) continue;
    if (existing) {
      new Notice(`Drawio: "${current}" already exists but is not a folder.`);
      return false;
    }
    await plugin.app.vault.createFolder(current);
  }
  return true;
}

/** Create a standalone diagram without changing the current note. */
export async function createNewDiagram(plugin: DrawioPlugin, folderOverride?: TFolder): Promise<void> {
  await createDiagram(plugin, folderOverride);
}

/** Capture the initiating editor and selection end before any asynchronous work. */
export async function createAndInsertDiagram(
  plugin: DrawioPlugin, editor: Editor, context: MarkdownFileInfo,
): Promise<void> {
  const file = context.file;
  if (!file || file.extension !== 'md') return;
  const position = { ...editor.getCursor('to') };
  await createDiagram(plugin, undefined, { editor, file, position, context });
}

/** Shared creation/open path; folder-menu overrides retain their original behavior. */
async function createDiagram(
  plugin: DrawioPlugin,
  folderOverride?: TFolder,
  insertion?: { editor: Editor; file: TFile; position: EditorPosition; context: MarkdownFileInfo },
): Promise<void> {
  try {
    let folder: string;
    if (folderOverride) {
      folder = normalizeFolderPath(folderOverride.path);
    } else {
      const parent = insertion
        ? insertion.file.parent?.path ?? null
        : plugin.app.workspace.getActiveFile()?.parent?.path ?? null;
      folder = resolveNewDiagramFolder(plugin.settings, parent);
      if (!(await ensureFolderExists(plugin, folder))) return;
    }
    const format = plugin.settings.newDiagramFormat;
    const ext = format === 'drawio' ? '.drawio' : `.drawio.${format}`;
    const path = `${folder ? `${folder}/` : ''}Untitled Diagram ${Date.now()}${ext}`;
    let file: TFile;
    if (format === 'png') {
      const bytes = buildInitialPng(EMPTY_DIAGRAM);
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      file = await plugin.app.vault.createBinary(path, buf);
    } else {
      const body = format === 'svg' ? buildInitialSvg(EMPTY_DIAGRAM) : EMPTY_DIAGRAM;
      file = await plugin.app.vault.create(path, body);
    }
    if (insertion) {
      // A Markdown pane can be reused for another note while creation awaits.
      if (insertion.context.file !== insertion.file
        || (insertion.context.editor && insertion.context.editor !== insertion.editor)) {
        new Notice(`Drawio: "${file.path}" was created, but the source note is no longer open — the embed was not inserted.`);
        return;
      }
      const link = plugin.app.fileManager.generateMarkdownLink(file, insertion.file.path);
      const embed = link.startsWith('!') ? link : `!${link}`;
      insertion.editor.replaceRange(`\n${embed}\n`, insertion.position);
    }
    if (format === 'drawio') {
      // Our registered file view carries the editor inline.
      const leaf = plugin.app.workspace.getLeaf(true);
      await leaf.openFile(file);
    } else {
      // Dual-format files open in Obsidian's own image view, so go straight
      // to the modal editor instead; the image body fills in on first save.
      plugin.openEditor(new DualFormatFileSource(plugin.app, file, format));
    }
  } catch (err) {
    new Notice(`Drawio: could not create diagram — ${String(err)}`);
  }
}
