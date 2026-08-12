import { MarkdownPostProcessorContext, MarkdownRenderChild, Notice, Platform, TFile } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { renderPreview } from '../preview/ViewerRenderer';
import { renderPageControl } from '../preview/pageControl';
import { addEditHint } from '../preview/editHint';
import {
  resolveClickAction, resolveEditButtonAction, openWithDefaultApp,
} from '../preview/clickAction';
import { InteractiveViewerController } from '../preview/interactiveViewer';
import {
  readEmbedViewportHeight, writeEmbedViewportHeight,
} from '../preview/embedViewportHeight';
import { getDiagramPages, resolvePageFromSubpath, ensureMxfile, type DiagramPage } from '../model/xmlUtils';
import { FileSource } from './FileSource';
import { DualFormatFileSource } from './DualFormatFileSource';
import { dualFormatOf } from '../model/dualFormat';
import { DRAWIO_FILE_EXT } from '../constants';
import { pinEmbedPage } from './pinEmbedPage';
import type DrawioPlugin from '../main';

/**
 * Make `![[diagram.drawio]]` embeds render the diagram (and open the editor on
 * click) in BOTH Live Preview and Reading view.
 *
 * The reliable way to do this is Obsidian's embed registry: it owns embeds in both
 * editing modes, where a markdown post-processor only reaches Reading view. The
 * registry isn't in the public typings, so we feature-detect it and fall back to a
 * post-processor (Reading-view only) on the off chance it's unavailable.
 */
export function registerDrawioEmbeds(plugin: DrawioPlugin) {
  const registry = (plugin.app as unknown as { embedRegistry?: EmbedRegistry }).embedRegistry;
  if (registry && typeof registry.registerExtension === 'function') {
    try {
      registry.registerExtension(DRAWIO_FILE_EXT, (ctx, file, subpath) =>
        new DrawioFileEmbed(plugin, file, ctx.containerEl, subpath, ctx.sourcePath));
      plugin.register(() => {
        try { registry.unregisterExtension?.(DRAWIO_FILE_EXT); } catch { /* ignore */ }
      });
      return;
    } catch {
      // Extension already taken or API shape changed — use the fallback.
    }
  }
  registerEmbedPostProcessor(plugin);
}

interface EmbedRegistry {
  registerExtension(ext: string, creator: (ctx: { containerEl: HTMLElement; sourcePath?: string }, file: TFile, subpath?: string) => unknown): void;
  unregisterExtension?(ext: string): void;
}

/** An embed component Obsidian drives in either editing mode. */
class DrawioFileEmbed extends MarkdownRenderChild {
  private currentPage = 0;
  private pageResolvedFromSubpath = false;
  private interactive: InteractiveViewerController | null = null;

  constructor(
    private plugin: DrawioPlugin,
    private file: TFile,
    containerEl: HTMLElement,
    private subpath?: string,
    // Note that owns this embed. An internal-but-stable ctx field — when a
    // future Obsidian stops supplying it, the pin button silently disappears
    // (feature-detect, same stance as embedRegistry itself).
    private sourcePath?: string,
  ) {
    super(containerEl);
  }

  /** Called by the embed system to (re)render the file's diagram. */
  async loadFile(file?: TFile): Promise<void> {
    if (file && file.path !== this.file.path) {
      // Target file actually changed: any subpath was resolved for the old
      // file and no longer applies. Start over at page 0 for the new one.
      this.file = file;
      this.currentPage = 0;
      this.pageResolvedFromSubpath = false;
      this.subpath = undefined;
    }
    await this.render();
  }

  onload(): void {
    // Reflect edits made elsewhere (e.g. the modal or the file view).
    this.registerEvent(this.plugin.app.vault.on('modify', (f) => {
      if (f instanceof TFile && f.path === this.file.path) void this.render();
    }));
    if (this.sourcePath) {
      this.registerEvent(this.plugin.app.vault.on('modify', (f) => {
        if (!(f instanceof TFile) || f.path !== this.sourcePath || !this.interactive) return;
        applyStoredEmbedHeight(
          this.plugin, this.interactive, this.sourcePath!, this.file, this.subpath,
          undefined, this.containerEl,
        );
      }));
    }
  }

  onunload(): void {
    this.interactive?.dispose();
    this.interactive = null;
  }

  private async render(): Promise<void> {
    const el = this.containerEl;
    this.interactive?.dispose();
    this.interactive = null;
    el.empty();
    el.addClass('drawio-embed');
    if (this.sourcePath) markEmbedInsertion(el, this.sourcePath, this.file, this.subpath);
    const action = resolveClickAction(this.plugin.settings.previewClickAction, 'file');
    let initialHeight: number | null = null;
    if (Platform.isDesktopApp && action.kind === 'interactive' && this.sourcePath) {
      try {
        initialHeight = await readEmbedViewportHeight(
          this.plugin.app, this.sourcePath, this.file, this.subpath,
          undefined, undefined, getEmbedOccurrence(el), getLivePreviewSourceOffset(el),
        );
      } catch {
        initialHeight = null;
      }
    }
    el.setAttribute('title', Platform.isDesktopApp ? action.title : 'Drawio diagram');
    el.toggleClass('drawio-no-action', Platform.isDesktopApp && action.kind === 'none');
    try {
      const xml = await this.plugin.app.vault.read(this.file);
      const wrapped = ensureMxfile(xml);
      const pages = getDiagramPages(wrapped);

      if (!this.pageResolvedFromSubpath) {
        this.pageResolvedFromSubpath = true;
        this.currentPage = resolvePageFromSubpath(pages, this.subpath);
      } else {
        // A modify-triggered refresh: keep whatever page the user was looking
        // at, clamped in case the page count shrank.
        this.currentPage = Math.min(this.currentPage, Math.max(pages.length - 1, 0));
      }

      const preview = el.createDiv({ cls: 'drawio-preview' });
      renderPreview(preview, xml, { ...this.plugin.previewOpts(), page: this.currentPage });

      if (pages.length > 1) {
        const pageControlEl = el.createDiv({ cls: 'drawio-page-control' });
        renderPageControl(pageControlEl, {
          pages,
          initialPage: this.currentPage,
          onPageChange: (page) => {
            this.currentPage = page;
            renderPreview(preview, xml, { ...this.plugin.previewOpts(), page });
            this.interactive?.bindSvg(preview.querySelector('svg'), { preserveViewportHeight: true });
          },
          pin: !this.sourcePath ? undefined : {
            pinnedPage: resolvePageFromSubpath(pages, this.subpath),
            onPin: (page) => { void this.pin(pages, page); },
          },
        });
      }

      if (Platform.isDesktopApp && action.hint) {
        addEditHint(el, action.hint.label, action.hint.icon);
      }
      if (Platform.isDesktopApp) {
        this.interactive = new InteractiveViewerController(el, preview, {
          isEnabled: () =>
            resolveClickAction(this.plugin.settings.previewClickAction, 'file').kind === 'interactive',
          initialHeight: initialHeight ?? undefined,
          onHeightCommit: this.sourcePath ? (height) => {
            commitEmbedHeight(
              this.plugin, this.sourcePath!, this.file, this.subpath, height,
              undefined, undefined, getEmbedOccurrence(el), getLivePreviewSourceOffset(el),
            );
          } : undefined,
          onEdit: () => {
            const editAction = resolveEditButtonAction(this.plugin.settings.editButtonAction, 'file');
            if (editAction.kind === 'editor') {
              this.plugin.openEditor(new FileSource(this.plugin.app, this.file));
            } else if (editAction.kind === 'defaultApp') {
              openWithDefaultApp(this.plugin.app, this.file.path);
            }
          },
        });
        this.interactive.bindSvg(preview.querySelector('svg'));
        scheduleStoredEmbedHeight(
          this.plugin, this.interactive, this.sourcePath, this.file, this.subpath,
          undefined, el,
        );
      }
    } catch (err) {
      el.createDiv({ cls: 'drawio-error', text: `Failed to render diagram: ${String(err)}` });
    }
    // Wire the click handler once (survives re-renders; el.empty() keeps the
    // listener). The action is re-resolved at click time so settings changes
    // apply to already-rendered embeds.
    if (!el.dataset.drawioClick) {
      el.dataset.drawioClick = '1';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!Platform.isDesktopApp) {
          new Notice('Drawio: editing is only available on desktop');
          return;
        }
        const current = resolveClickAction(this.plugin.settings.previewClickAction, 'file');
        if (current.kind === 'editor') {
          this.plugin.openEditor(new FileSource(this.plugin.app, this.file));
        } else if (current.kind === 'defaultApp') {
          openWithDefaultApp(this.plugin.app, this.file.path);
        }
      });
    }
  }

  /** Persist the shown page into the note's link; on success adopt the new
   *  subpath locally so a modify-triggered re-render agrees with the note. */
  private async pin(pages: DiagramPage[], page: number): Promise<void> {
    const name = pages[page]?.name;
    if (name === undefined || this.sourcePath === undefined) return;
    const outcome = await pinEmbedPage(this.plugin.app, this.sourcePath, this.file, this.subpath, name);
    if (outcome === 'pinned') {
      this.subpath = name;
      await this.render();
    }
  }
}

/**
 * Give dual-format image embeds (`![[diagram.drawio.svg]]` / `.drawio.png`) the
 * same click-to-edit hotspot the other previews have.
 *
 * These render through Obsidian's own image embed — a plain `<img>` — so, unlike
 * `.drawio` embeds, they can't go through the embed registry: that registers by
 * final extension, and `svg`/`png` belong to every image, not just ours. A
 * Reading-view markdown post-processor is the right seam: it decorates the
 * already-rendered image span with the shared click action + hover hint, without
 * changing how the image itself renders.
 *
 * Scope, by design:
 *  - Reading view only. Post-processors don't run over Live Preview's embed
 *    widgets; the diagram still shows there (native image), it just isn't
 *    clickable-to-edit. `.drawio` embeds get both modes only because the embed
 *    registry does.
 *  - Desktop only. Editing needs the desktop editor; on mobile the native image
 *    (with its own tap-to-zoom) is left completely untouched.
 *  - The **Interactive viewer** click action falls back to the editor here:
 *    the viewer drives the sanitized SVG previews, and a native `<img>` has
 *    none to explore.
 *  - The standalone `.drawio.svg`/`.drawio.png` file tab opens in Obsidian's
 *    native image view, which we deliberately don't intercept (it would mean
 *    claiming every `.svg`/`.png`); the "Edit drawio diagram" file-menu item and
 *    command cover editing there.
 */
export function registerDualFormatEmbeds(plugin: DrawioPlugin) {
  const resolveAction = () => {
    const action = resolveClickAction(plugin.settings.previewClickAction, 'file');
    return action.kind === 'interactive' ? resolveClickAction('editor', 'file') : action;
  };
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    if (!Platform.isDesktopApp) return;
    for (const span of Array.from(el.querySelectorAll<HTMLElement>('.internal-embed'))) {
      if (span.dataset.drawioDualformat === '1') continue;
      const rawSrc = span.getAttribute('src');
      if (!rawSrc) continue;
      // Split off any `#subpath` before the suffix check (dual-format files
      // have no page anchors today, but be robust to a stray '#').
      const hashIndex = rawSrc.indexOf('#');
      const path = hashIndex === -1 ? rawSrc : rawSrc.slice(0, hashIndex);
      const format = dualFormatOf(path);
      if (!format) continue;
      const file = plugin.app.metadataCache.getFirstLinkpathDest(path, ctx.sourcePath);
      if (!(file instanceof TFile)) continue;
      span.dataset.drawioDualformat = '1';

      span.addClass('drawio-dualformat-embed');
      const action = resolveAction();
      span.setAttribute('title', action.title);
      span.toggleClass('drawio-no-action', action.kind === 'none');
      if (action.hint) addEditHint(span, action.hint.label, action.hint.icon);

      // Capture phase so we pre-empt any native click behavior on the <img>
      // (e.g. lightbox); the action is re-resolved at click time so a settings
      // change applies to already-decorated embeds.
      span.addEventListener('click', (e) => {
        const current = resolveAction();
        if (current.kind === 'none') return; // leave native image behavior alone
        e.preventDefault();
        e.stopPropagation();
        if (current.kind === 'editor') {
          plugin.openEditor(new DualFormatFileSource(plugin.app, file, format));
        } else if (current.kind === 'defaultApp') {
          openWithDefaultApp(plugin.app, file.path);
        }
      }, true);
    }
  });
}

/** Reading-view-only fallback when the embed registry is unavailable. */
function registerEmbedPostProcessor(plugin: DrawioPlugin) {
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    for (const span of Array.from(el.querySelectorAll<HTMLElement>('.internal-embed'))) {
      if (span.dataset.drawioEmbed === '1') continue;
      const rawSrc = span.getAttribute('src');
      if (!rawSrc) continue;
      // Obsidian's exact behavior for whether a `#subpath` ends up in `src` for
      // an unrecognized (non-.md) embed extension isn't guaranteed — split it
      // off before the extension check so this works either way (see Task 6
      // in the implementation plan for why).
      const hashIndex = rawSrc.indexOf('#');
      const path = hashIndex === -1 ? rawSrc : rawSrc.slice(0, hashIndex);
      const subpath = hashIndex === -1 ? undefined : rawSrc.slice(hashIndex + 1);
      if (!path.toLowerCase().endsWith('.' + DRAWIO_FILE_EXT)) continue;
      const file = plugin.app.metadataCache.getFirstLinkpathDest(path, ctx.sourcePath);
      if (!(file instanceof TFile)) continue;
      span.dataset.drawioEmbed = '1';
      const action = resolveClickAction(plugin.settings.previewClickAction, 'file');
      span.setAttribute('title', Platform.isDesktopApp ? action.title : 'Drawio diagram');
      span.addEventListener('click', () => {
        if (!Platform.isDesktopApp) {
          new Notice('Drawio: editing is only available on desktop');
          return;
        }
        const current = resolveClickAction(plugin.settings.previewClickAction, 'file');
        if (current.kind === 'editor') {
          plugin.openEditor(new FileSource(plugin.app, file));
        } else if (current.kind === 'defaultApp') {
          openWithDefaultApp(plugin.app, file.path);
        }
      });
      void renderEmbedInto(plugin, span, file, subpath, ctx);
    }
  });
}

async function renderEmbedInto(
  plugin: DrawioPlugin,
  span: HTMLElement,
  file: TFile,
  subpath: string | undefined,
  ctx: MarkdownPostProcessorContext,
) {
  span.empty();
  span.addClass('drawio-embed');
  markEmbedInsertion(span, ctx.sourcePath, file, subpath);
  span.removeClasses(['file-embed', 'mod-generic', 'is-loaded']);
  try {
    const xml = await plugin.app.vault.read(file);
    const wrapped = ensureMxfile(xml);
    const pages = getDiagramPages(wrapped);
    const currentPage = resolvePageFromSubpath(pages, subpath);
    let interactive: InteractiveViewerController | null = null;
    let initialHeight: number | null = null;
    if (Platform.isDesktopApp &&
        resolveClickAction(plugin.settings.previewClickAction, 'file').kind === 'interactive') {
      try {
        initialHeight = await readEmbedViewportHeight(
          plugin.app, ctx.sourcePath, file, subpath, ctx, span,
          getEmbedOccurrence(span), getLivePreviewSourceOffset(span),
        );
      } catch {
        initialHeight = null;
      }
    }

    const preview = span.createDiv({ cls: 'drawio-preview' });
    renderPreview(preview, xml, { ...plugin.previewOpts(), page: currentPage });

    if (pages.length > 1) {
      const pageControlEl = span.createDiv({ cls: 'drawio-page-control' });
      renderPageControl(pageControlEl, {
        pages,
        initialPage: currentPage,
        onPageChange: (page) => {
          renderPreview(preview, xml, { ...plugin.previewOpts(), page });
          interactive?.bindSvg(preview.querySelector('svg'), { preserveViewportHeight: true });
        },
        pin: !ctx.sourcePath ? undefined : {
          pinnedPage: currentPage,
          onPin: (page) => {
            const name = pages[page]?.name;
            if (name !== undefined) void pinEmbedPage(plugin.app, ctx.sourcePath, file, subpath, name);
          },
        },
      });
    }

    const action = resolveClickAction(plugin.settings.previewClickAction, 'file');
    span.toggleClass('drawio-no-action', Platform.isDesktopApp && action.kind === 'none');
    if (Platform.isDesktopApp && action.hint) {
      addEditHint(span, action.hint.label, action.hint.icon);
    }
    if (Platform.isDesktopApp) {
      interactive = new InteractiveViewerController(span, preview, {
        isEnabled: () =>
          resolveClickAction(plugin.settings.previewClickAction, 'file').kind === 'interactive',
        initialHeight: initialHeight ?? undefined,
        onHeightCommit: (height) => {
          commitEmbedHeight(
            plugin, ctx.sourcePath, file, subpath, height, ctx, span, getEmbedOccurrence(span),
            getLivePreviewSourceOffset(span),
          );
        },
        onEdit: () => {
          const editAction = resolveEditButtonAction(plugin.settings.editButtonAction, 'file');
          if (editAction.kind === 'editor') {
            plugin.openEditor(new FileSource(plugin.app, file));
          } else if (editAction.kind === 'defaultApp') {
            openWithDefaultApp(plugin.app, file.path);
          }
        },
      });
      interactive.bindSvg(preview.querySelector('svg'));
      scheduleStoredEmbedHeight(
        plugin, interactive, ctx.sourcePath, file, subpath, ctx, span,
      );
      interactive.registerEvent(plugin.app.vault.on('modify', (changed) => {
        if (changed instanceof TFile && changed.path === ctx.sourcePath) {
          applyStoredEmbedHeight(
            plugin, interactive!, ctx.sourcePath, file, subpath, ctx, span,
          );
        }
      }));
      ctx.addChild(interactive);
    }
  } catch (err) {
    span.empty();
    span.createDiv({ cls: 'drawio-error', text: `Failed to render diagram: ${String(err)}` });
  }
}

function commitEmbedHeight(
  plugin: DrawioPlugin,
  sourcePath: string,
  file: TFile,
  subpath: string | undefined,
  height: number,
  ctx?: MarkdownPostProcessorContext,
  el?: HTMLElement,
  occurrence?: number,
  sourceOffset?: number,
): void {
  void writeEmbedViewportHeight(
    plugin.app, sourcePath, file, subpath, height, ctx, el, occurrence, sourceOffset,
  ).then((outcome) => {
    if (outcome === 'ambiguous') {
      new Notice(
        'Drawio: several identical embeds match this insertion. ' +
        'Resize it in Reading view or give the links distinct page subpaths.',
      );
    } else if (outcome === 'no-match') {
      new Notice('Drawio: could not locate this embed in the note; viewer height was not saved.');
    }
  }).catch((err) => {
    new Notice(`Drawio: could not save viewer height — ${String(err)}`);
  });
}

function scheduleStoredEmbedHeight(
  plugin: DrawioPlugin,
  interactive: InteractiveViewerController,
  sourcePath: string | undefined,
  file: TFile,
  subpath: string | undefined,
  ctx: MarkdownPostProcessorContext | undefined,
  el: HTMLElement,
): void {
  if (!sourcePath) return;
  const run = () => applyStoredEmbedHeight(
    plugin, interactive, sourcePath, file, subpath, ctx, el,
  );
  const win = el.ownerDocument.defaultView;
  if (win) win.requestAnimationFrame(run);
  else run();
}

function applyStoredEmbedHeight(
  plugin: DrawioPlugin,
  interactive: InteractiveViewerController,
  sourcePath: string,
  file: TFile,
  subpath: string | undefined,
  ctx: MarkdownPostProcessorContext | undefined,
  el: HTMLElement,
): void {
  if (resolveClickAction(plugin.settings.previewClickAction, 'file').kind !== 'interactive') return;
  void readEmbedViewportHeight(
    plugin.app, sourcePath, file, subpath, ctx, el,
    getEmbedOccurrence(el), getLivePreviewSourceOffset(el),
  ).then((height) => {
    if (height !== null) interactive.applyPersistedHeight(height);
  }).catch(() => { /* Keep the already rendered automatic height. */ });
}

function markEmbedInsertion(
  el: HTMLElement,
  sourcePath: string,
  file: TFile,
  subpath: string | undefined,
): void {
  el.dataset.drawioInsertionKey = JSON.stringify([
    sourcePath,
    file.path,
    subpath?.replace(/^#/, '') ?? '',
  ]);
}

function getEmbedOccurrence(el: HTMLElement): number {
  const key = el.dataset.drawioInsertionKey;
  if (!key) return 0;
  const scope = el.closest<HTMLElement>(
    '.markdown-preview-view, .markdown-source-view, .workspace-leaf-content',
  ) ?? el.parentElement;
  if (!scope) return 0;
  const peers = Array.from(scope.querySelectorAll<HTMLElement>('.drawio-embed'))
    .filter((candidate) => candidate.dataset.drawioInsertionKey === key);
  const index = peers.indexOf(el);
  return index === -1 ? 0 : index;
}

function getLivePreviewSourceOffset(el: HTMLElement): number | undefined {
  try {
    const view = EditorView.findFromDOM(el);
    return view?.posAtDOM(el, 0);
  } catch {
    return undefined;
  }
}
