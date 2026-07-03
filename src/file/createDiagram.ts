import { Notice, TFolder } from 'obsidian';
import type DrawioPlugin from '../main';
import type { DrawioSettings } from '../settings';
import { EMPTY_DIAGRAM } from '../constants';

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

/** Create missing folders segment by segment (recursive createFolder isn't
 *  guaranteed across all Obsidian versions we support). */
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

/**
 * Create a new empty diagram and open it in a new tab. `folderOverride` (the
 * folder the user right-clicked) wins over the location setting.
 */
export async function createNewDiagram(plugin: DrawioPlugin, folderOverride?: TFolder): Promise<void> {
  try {
    let folder: string;
    if (folderOverride) {
      folder = normalizeFolderPath(folderOverride.path);
    } else {
      const parent = plugin.app.workspace.getActiveFile()?.parent?.path ?? null;
      folder = resolveNewDiagramFolder(plugin.settings, parent);
      if (!(await ensureFolderExists(plugin, folder))) return;
    }
    const name = `Untitled Diagram ${Date.now()}.drawio`;
    const file = await plugin.app.vault.create(folder ? `${folder}/${name}` : name, EMPTY_DIAGRAM);
    const leaf = plugin.app.workspace.getLeaf(true);
    await leaf.openFile(file);
  } catch (err) {
    new Notice(`Drawio: could not create diagram — ${String(err)}`);
  }
}
