import { MarkdownView, Platform, TFile, WorkspaceLeaf } from 'obsidian';
import { DualFormatFileSource } from '../file/DualFormatFileSource';
import { dualFormatOf } from '../model/dualFormat';
import { DRAWIO_VIEW_TYPE } from '../constants';
import {
  openWithDefaultApp, resolveClickAction,
} from '../preview/clickAction';
import type DrawioPlugin from '../main';

const ACTION_ATTR = 'data-drawio-edit-action';

interface ImageLikeView {
  file?: TFile;
  containerEl: HTMLElement;
  getViewType(): string;
  addAction?(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement;
}

/** Attach (or refresh) an Edit action on a native image tab that is showing
 *  a dual-format file. Does not register the `svg`/`png` extensions. */
export function syncDualFormatEditAction(plugin: DrawioPlugin, leaf: WorkspaceLeaf): void {
  const view = leaf.view as ImageLikeView;
  const existing = view.containerEl?.querySelector?.(`[${ACTION_ATTR}]`);
  const file = view.file;
  const format = file instanceof TFile ? dualFormatOf(file.path) : null;
  if (!(file instanceof TFile) || !format || view.getViewType() === DRAWIO_VIEW_TYPE) {
    existing?.remove();
    return;
  }
  if (existing instanceof HTMLElement && existing.dataset.drawioEditPath === file.path) return;
  existing?.remove();
  if (typeof view.addAction !== 'function') return;
  const el = view.addAction('pencil', 'Edit drawio diagram', () => {
    plugin.openEditor(new DualFormatFileSource(plugin.app, file, format));
  });
  el.setAttribute(ACTION_ATTR, '1');
  el.dataset.drawioEditPath = file.path;
}

/** Handle a click on a Live Preview dual-format embed (Reading view is owned
 *  by the post-processor, marked `data-drawio-dualformat=1`). Returns true
 *  when the event was consumed. */
export function handleDualFormatEmbedClick(plugin: DrawioPlugin, event: Event): boolean {
  if (!Platform.isDesktopApp) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const span = target.closest('.internal-embed');
  if (!(span instanceof HTMLElement)) return false;
  if (span.dataset.drawioDualformat === '1') return false;
  const rawSrc = span.getAttribute('src');
  if (!rawSrc) return false;
  const hashIndex = rawSrc.indexOf('#');
  const path = hashIndex === -1 ? rawSrc : rawSrc.slice(0, hashIndex);
  const format = dualFormatOf(path);
  if (!format) return false;
  const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
  const sourcePath = view?.file?.path ?? '';
  const file = plugin.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
  if (!(file instanceof TFile)) return false;
  const action = resolveClickAction(plugin.settings.previewClickAction, 'file');
  const kind = action.kind === 'interactive' ? 'editor' : action.kind;
  if (kind === 'none') return false;
  event.preventDefault();
  event.stopPropagation();
  if (kind === 'editor') {
    plugin.openEditor(new DualFormatFileSource(plugin.app, file, format));
  } else if (kind === 'defaultApp') {
    openWithDefaultApp(plugin.app, file.path);
  }
  return true;
}

function syncAll(plugin: DrawioPlugin): void {
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    syncDualFormatEditAction(plugin, leaf);
  });
}

export function registerDualFormatOpen(plugin: DrawioPlugin): void {
  const onClick = (event: MouseEvent) => {
    handleDualFormatEmbedClick(plugin, event);
  };
  plugin.registerDomEvent(document, 'click', onClick, { capture: true });
  plugin.registerEvent(plugin.app.workspace.on('window-open', (_win, popout) => {
    plugin.registerDomEvent(popout.document, 'click', onClick, { capture: true });
  }));
  plugin.registerEvent(plugin.app.workspace.on('file-open', () => { syncAll(plugin); }));
  plugin.registerEvent(plugin.app.workspace.on('layout-change', () => { syncAll(plugin); }));
  syncAll(plugin);
}
