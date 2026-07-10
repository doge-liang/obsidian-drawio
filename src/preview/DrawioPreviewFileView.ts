import { Platform, TextFileView, WorkspaceLeaf } from 'obsidian';
import { DRAWIO_VIEW_TYPE } from '../constants';
import { renderPreview } from './ViewerRenderer';
import { renderPageControl } from './pageControl';
import { addEditHint } from './editHint';
import { resolveClickAction, openWithDefaultApp } from './clickAction';
import { getDiagramPages, ensureMxfile } from '../model/xmlUtils';
import { FileSource } from '../file/FileSource';
import type DrawioPlugin from '../main';

/**
 * Read-only view for `.drawio` files: a static preview rendered via the same
 * renderPreview used by code blocks and embeds. No iframe, no editor. Used
 * unconditionally on mobile (no editor there), and on desktop when the
 * "Open diagram files read-only" setting is enabled — there the click action
 * follows the "Preview click action" setting.
 */
export class DrawioPreviewFileView extends TextFileView {
  constructor(leaf: WorkspaceLeaf, private plugin: DrawioPlugin) {
    super(leaf);
    this.data = '';
    // One listener for the view's lifetime; render() only refreshes children.
    this.contentEl.addEventListener('click', () => { this.onPreviewClick(); });
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
    c.addClass('drawio-preview-file-view');

    const action = resolveClickAction(this.plugin.settings.previewClickAction, 'file');
    if (Platform.isDesktopApp) {
      c.setAttribute('title', action.title);
      c.toggleClass('drawio-clickable', action.kind !== 'none');
    } else {
      c.createDiv({
        cls: 'drawio-mobile-banner',
        text: 'Drawio: preview only on mobile — open this file on desktop to edit.',
      });
    }

    const preview = c.createDiv({ cls: 'drawio-preview' });
    const pages = getDiagramPages(ensureMxfile(this.data));
    renderPreview(preview, this.data, { ...this.plugin.previewOpts(), page: 0 });

    if (pages.length > 1) {
      const pageControlEl = c.createDiv({ cls: 'drawio-page-control' });
      renderPageControl(pageControlEl, {
        pages,
        initialPage: 0,
        onPageChange: (page) => {
          renderPreview(preview, this.data, { ...this.plugin.previewOpts(), page });
        },
      });
    }

    if (Platform.isDesktopApp && action.hint) {
      addEditHint(c, action.hint.label, action.hint.icon);
    }
  }

  private onPreviewClick(): void {
    if (!Platform.isDesktopApp || !this.file) return;
    // Resolve at click time so a settings change applies without reopening.
    const action = resolveClickAction(this.plugin.settings.previewClickAction, 'file');
    if (action.kind === 'editor') {
      this.plugin.openEditor(new FileSource(this.plugin.app, this.file));
    } else if (action.kind === 'defaultApp') {
      openWithDefaultApp(this.plugin.app, this.file.path);
    }
  }
}
