import { MarkdownPostProcessorContext, Notice, Platform } from 'obsidian';
import { renderPreview } from '../preview/ViewerRenderer';
import { renderPageControl } from '../preview/pageControl';
import { addEditHint } from '../preview/editHint';
import { resolveClickAction } from '../preview/clickAction';
import { getDiagramPages, ensureMxfile } from '../model/xmlUtils';
import { CodeBlockSource } from './CodeBlockSource';
import type DrawioPlugin from '../main';

export function registerDrawioCodeBlock(plugin: DrawioPlugin) {
  plugin.registerMarkdownCodeBlockProcessor('drawio', (source, el, ctx) => {
    renderCodeBlock(plugin, source, el, ctx);
  });
}

function renderCodeBlock(
  plugin: DrawioPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
) {
  const wrapper = el.createDiv({ cls: 'drawio-codeblock' });
  const action = resolveClickAction(plugin.settings.previewClickAction, 'codeblock');
  wrapper.setAttribute('title', Platform.isDesktopApp ? action.title : 'Drawio diagram');
  wrapper.toggleClass('drawio-no-action', Platform.isDesktopApp && action.kind === 'none');
  const preview = wrapper.createDiv({ cls: 'drawio-preview' });

  const wrapped = ensureMxfile(source);
  const pages = getDiagramPages(wrapped);
  let currentPage = 0;
  renderPreview(preview, source, { ...plugin.previewOpts(), page: currentPage });

  if (pages.length > 1) {
    const pageControlEl = wrapper.createDiv({ cls: 'drawio-page-control' });
    renderPageControl(pageControlEl, {
      pages,
      initialPage: currentPage,
      onPageChange: (page) => {
        currentPage = page;
        renderPreview(preview, source, { ...plugin.previewOpts(), page });
      },
    });
  }

  if (Platform.isDesktopApp && action.hint) {
    addEditHint(wrapper, action.hint.label, action.hint.icon);
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
