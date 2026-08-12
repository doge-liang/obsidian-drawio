import { Platform, TextFileView, WorkspaceLeaf } from 'obsidian';
import { DRAWIO_VIEW_TYPE } from '../constants';
import { renderPreview } from './ViewerRenderer';
import { renderPageControl } from './pageControl';
import { addEditHint } from './editHint';
import { resolveClickAction, resolveEditButtonAction, openWithDefaultApp } from './clickAction';
import { InteractiveViewerController } from './interactiveViewer';
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
  private interactive: InteractiveViewerController | null = null;

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
    this.interactive?.dispose();
    this.interactive = null;
    this.data = '';
    this.contentEl.empty();
  }

  private render(): void {
    const c = this.contentEl;
    this.interactive?.dispose();
    this.interactive = null;
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

    // The hint's absolute centring must resolve against the diagram, not the
    // tab-filling contentEl (there it floats mid-tab in empty space) — and it
    // can't live inside .drawio-preview, which renderPreview() empties on
    // every (re-)render, so a page flip would silently drop it.
    const previewWrap = c.createDiv({ cls: 'drawio-preview-wrap' });
    const preview = previewWrap.createDiv({ cls: 'drawio-preview' });
    const pages = getDiagramPages(ensureMxfile(this.data));
    renderPreview(preview, this.data, { ...this.plugin.previewOpts(), page: 0 });

    if (pages.length > 1) {
      const pageControlEl = c.createDiv({ cls: 'drawio-page-control' });
      renderPageControl(pageControlEl, {
        pages,
        initialPage: 0,
        onPageChange: (page) => {
          renderPreview(preview, this.data, { ...this.plugin.previewOpts(), page });
          this.interactive?.bindSvg(preview.querySelector('svg'), { preserveViewportHeight: true });
        },
      });
    }

    if (Platform.isDesktopApp && action.hint) {
      addEditHint(previewWrap, action.hint.label, action.hint.icon);
    }
    if (Platform.isDesktopApp) {
      this.interactive = new InteractiveViewerController(c, preview, {
        isEnabled: () =>
          resolveClickAction(this.plugin.settings.previewClickAction, 'file').kind === 'interactive',
        onEdit: () => {
          if (!this.file) return;
          const editAction = resolveEditButtonAction(this.plugin.settings.editButtonAction, 'file');
          if (editAction.kind === 'editor') {
            this.plugin.openEditor(new FileSource(this.plugin.app, this.file));
          } else if (editAction.kind === 'defaultApp') {
            openWithDefaultApp(this.plugin.app, this.file.path);
          }
        },
      });
      this.interactive.bindSvg(preview.querySelector('svg'));
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
