import { MarkdownPostProcessorContext, Notice, Platform } from 'obsidian';
import { renderPreview } from '../preview/ViewerRenderer';
import { renderPageControl } from '../preview/pageControl';
import { addEditHint } from '../preview/editHint';
import { resolveClickAction, resolveEditButtonAction } from '../preview/clickAction';
import { mountInteractiveViewer, type InteractiveMountHandle } from '../preview/interactiveMount';
import {
  readCodeBlockViewportHeight, writeCodeBlockViewportHeight,
} from '../preview/viewportHeight';
import { getDiagramPages, ensureMxfile } from '../model/xmlUtils';
import { CodeBlockSource } from './CodeBlockSource';
import type DrawioPlugin from '../main';

export function registerDrawioCodeBlock(plugin: DrawioPlugin) {
  plugin.registerMarkdownCodeBlockProcessor('drawio', (source, el, ctx) =>
    renderCodeBlock(plugin, source, el, ctx));
}

async function renderCodeBlock(
  plugin: DrawioPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): Promise<void> {
  const action = resolveClickAction(plugin.settings.previewClickAction, 'codeblock');
  let initialHeight: number | null = null;
  if (Platform.isDesktopApp && action.kind === 'interactive') {
    try {
      initialHeight = await readCodeBlockViewportHeight(plugin.app, ctx, el, source);
    } catch {
      // A failed metadata read must never abort rendering the diagram itself.
      initialHeight = null;
    }
  }
  const wrapper = el.createDiv({ cls: 'drawio-codeblock' });
  wrapper.setAttribute('title', Platform.isDesktopApp ? action.title : 'Drawio diagram');
  wrapper.toggleClass('drawio-no-action', Platform.isDesktopApp && action.kind === 'none');
  const preview = wrapper.createDiv({ cls: 'drawio-preview' });

  const wrapped = ensureMxfile(source);
  const pages = getDiagramPages(wrapped);
  let currentPage = 0;
  let interactive: InteractiveMountHandle | null = null;
  renderPreview(preview, source, { ...plugin.previewOpts(), page: currentPage });

  if (pages.length > 1) {
    const pageControlEl = wrapper.createDiv({ cls: 'drawio-page-control' });
    renderPageControl(pageControlEl, {
      pages,
      initialPage: currentPage,
      onPageChange: (page) => {
        currentPage = page;
        renderPreview(preview, source, { ...plugin.previewOpts(), page });
        interactive?.bindSvg(preview.querySelector('svg'), { preserveViewportHeight: true });
      },
    });
  }

  if (Platform.isDesktopApp && action.hint) {
    addEditHint(wrapper, action.hint.label, action.hint.icon);
  }

  if (Platform.isDesktopApp) {
    interactive = mountInteractiveViewer(wrapper, preview, {
      isEnabled: () =>
        resolveClickAction(plugin.settings.previewClickAction, 'codeblock').kind === 'interactive',
      initialHeight: initialHeight ?? undefined,
      loadPersistedHeight: () => readCodeBlockViewportHeight(plugin.app, ctx, el, source),
      onHeightCommit: (height) => {
        void writeCodeBlockViewportHeight(plugin.app, ctx, el, source, height).then((written) => {
          if (!written) new Notice('Drawio: could not save the viewer height for this code block.');
        }).catch((err) => {
          new Notice(`Drawio: could not save viewer height — ${String(err)}`);
        });
      },
      onEdit: () => {
        const editAction = resolveEditButtonAction(plugin.settings.editButtonAction, 'codeblock');
        if (editAction.kind === 'editor') {
          plugin.openEditor(new CodeBlockSource(plugin.app, ctx, el, source));
        }
      },
      onController: (controller) => { ctx.addChild(controller); },
    });
  }

  // Click anywhere on the diagram (the centered hint shows on hover). The
  // action is re-resolved at click time so settings changes apply to
  // already-rendered blocks. Mobile has no editor — show a Notice instead.
  wrapper.addEventListener('click', () => {
    if (!Platform.isDesktopApp) {
      new Notice('Drawio: editing is only available on desktop');
      return;
    }
    const current = resolveClickAction(plugin.settings.previewClickAction, 'codeblock');
    if (current.kind === 'editor') {
      plugin.openEditor(new CodeBlockSource(plugin.app, ctx, el, source));
    }
  });
}
