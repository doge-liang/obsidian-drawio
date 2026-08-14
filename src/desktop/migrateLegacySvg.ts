import { App, Modal, Notice, Setting, TFile, parseLinktext } from 'obsidian';
import { uniquePath } from '../model/uniquePath';
import {
  isLegacyDrawioSvgContent, isLegacyDrawioSvgPath,
  legacyRenameStem, preferredLegacyRenamePath,
} from '../model/legacySvg';
import type DrawioPlugin from '../main';

export interface LegacyMigrateItem {
  file: TFile;
  from: string;
  to: string;
  linkCount: number;
}

export interface LegacyMigrateResult {
  renamed: string[];
  failed: { path: string; message: string }[];
}

/** Count wikilink / markdown embeds and links in the metadata cache that
 *  resolve to `file`. Used only for the preview list — rename itself goes
 *  through `fileManager.renameFile`, which updates those links. */
export function countReferencesToFile(app: App, file: TFile): number {
  let n = 0;
  for (const md of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getCache(md.path);
    if (!cache) continue;
    const refs = [...(cache.embeds ?? []), ...(cache.links ?? [])];
    for (const ref of refs) {
      const dest = app.metadataCache.getFirstLinkpathDest(
        parseLinktext(ref.link).path, md.path);
      if (dest?.path === file.path) n += 1;
    }
  }
  return n;
}

export async function scanLegacyDrawioSvgs(app: App): Promise<LegacyMigrateItem[]> {
  const files = app.vault.getFiles().filter((f) => isLegacyDrawioSvgPath(f.path));
  const taken = new Set(app.vault.getFiles().map((f) => f.path));
  const items: LegacyMigrateItem[] = [];
  for (const file of files) {
    const text = await app.vault.cachedRead(file);
    if (!isLegacyDrawioSvgContent(text)) continue;
    const preferred = preferredLegacyRenamePath(file.path);
    const dest = uniquePath(legacyRenameStem(preferred), '.drawio.svg', (p) => taken.has(p));
    taken.add(dest);
    items.push({
      file,
      from: file.path,
      to: dest,
      linkCount: countReferencesToFile(app, file),
    });
  }
  return items;
}

export async function migrateLegacyDrawioSvgs(
  app: App,
  items: LegacyMigrateItem[],
): Promise<LegacyMigrateResult> {
  const renamed: string[] = [];
  const failed: { path: string; message: string }[] = [];
  const taken = new Set(app.vault.getFiles().map((f) => f.path));
  for (const item of items) {
    try {
      const current = app.vault.getAbstractFileByPath(item.from);
      if (!(current instanceof TFile)) {
        failed.push({ path: item.from, message: 'file no longer exists' });
        continue;
      }
      let dest = item.to;
      if (taken.has(dest) && dest !== current.path) {
        dest = uniquePath(legacyRenameStem(preferredLegacyRenamePath(current.path)),
          '.drawio.svg', (p) => taken.has(p));
      }
      await app.fileManager.renameFile(current, dest);
      taken.delete(item.from);
      taken.add(dest);
      renamed.push(dest);
    } catch (e) {
      failed.push({
        path: item.from,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { renamed, failed };
}

export async function openMigrateLegacy(plugin: DrawioPlugin): Promise<void> {
  const items = await scanLegacyDrawioSvgs(plugin.app);
  if (items.length === 0) {
    new Notice('Drawio: no old Diagrams-plugin SVG files found.');
    return;
  }
  new MigrateLegacyModal(plugin.app, items).open();
}

class MigrateLegacyModal extends Modal {
  private busy = false;

  constructor(app: App, private items: LegacyMigrateItem[]) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('Migrate diagrams from the old Diagrams plugin');
    const links = this.items.reduce((n, item) => n + item.linkCount, 0);
    this.contentEl.createEl('p', {
      text: `Found ${this.items.length} SVG file${this.items.length === 1 ? '' : 's'} ` +
        `with embedded drawio data` +
        (links > 0 ? ` (${links} link${links === 1 ? '' : 's'} will be updated)` : '') +
        '. Rename them to .drawio.svg so they stay editable here?',
    });
    const list = this.contentEl.createEl('ul', { cls: 'drawio-migrate-list' });
    for (const item of this.items) {
      const li = list.createEl('li');
      li.createEl('code', { text: item.from });
      li.createSpan({ text: ' → ' });
      li.createEl('code', { text: item.to });
      if (item.linkCount > 0) {
        li.createSpan({
          cls: 'drawio-migrate-links',
          text: `  ${item.linkCount} link${item.linkCount === 1 ? '' : 's'}`,
        });
      }
    }
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) => b.setButtonText('Rename files').setCta().onClick(() => {
        void this.confirm();
      }));
  }

  private async confirm(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const result = await migrateLegacyDrawioSvgs(this.app, this.items);
    const parts = [`Drawio: renamed ${result.renamed.length} file${result.renamed.length === 1 ? '' : 's'}`];
    if (result.failed.length > 0) {
      parts.push(`${result.failed.length} failed`);
      console.error('[drawio] migrate failures', result.failed);
    }
    new Notice(parts.join(', ') + '.', 8000);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
