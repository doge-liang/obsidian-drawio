import { MarkdownPostProcessorContext, Notice, Platform } from 'obsidian';
import { renderPreview } from '../preview/ViewerRenderer';
import { renderPageControl } from '../preview/pageControl';
import { addEditHint } from '../preview/editHint';
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
  wrapper.setAttribute('title', Platform.isDesktopApp ? 'Click to edit diagram' : 'Drawio diagram');
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

  if (Platform.isDesktopApp) {
    addEditHint(wrapper);
  }

  // Click anywhere on the diagram to edit (the centered hint shows on hover).
  // Mobile has no editor in this phase — show a Notice instead.
  wrapper.addEventListener('click', () => {
    if (Platform.isDesktopApp) {
      plugin.openEditor(new CodeBlockSource(plugin.app, ctx, el, source));
    } else {
      new Notice('Drawio: editing is only available on desktop');
    }
  });
}
