import { TextFileView, WorkspaceLeaf } from 'obsidian';
import { DRAWIO_VIEW_TYPE } from '../constants';
import { renderPreview } from './ViewerRenderer';
import type DrawioPlugin from '../main';

/**
 * Read-only view for `.drawio` files on mobile: a fixed banner plus the
 * diagram rendered via the same renderPreview used by code blocks and
 * embeds. No iframe, no editor — mobile has no local server, and the
 * online/custom iframe editor path isn't supported in this phase.
 */
export class DrawioMobileFileView extends TextFileView {
  constructor(leaf: WorkspaceLeaf, private plugin: DrawioPlugin) {
    super(leaf);
    this.data = '';
  }

  getViewType(): string { return DRAWIO_VIEW_TYPE; }
  getIcon(): string { return 'pencil-ruler'; }
  getViewData(): string { return this.data; }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;
    this.render();
  }

  clear(): void {
    this.data = '';
    this.contentEl.empty();
  }

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass('drawio-mobile-file-view');
    c.createDiv({
      cls: 'drawio-mobile-banner',
      text: 'Drawio: preview only on mobile — open this file on desktop to edit.',
    });
    const preview = c.createDiv({ cls: 'drawio-preview' });
    renderPreview(preview, this.data, this.plugin.previewOpts());
  }
}
