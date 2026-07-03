import { MarkdownPostProcessorContext } from 'obsidian';
import { renderPreview } from '../preview/ViewerRenderer';
import { addEditHint } from '../preview/editHint';
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
  wrapper.setAttribute('title', 'Click to edit diagram');
  const preview = wrapper.createDiv({ cls: 'drawio-preview' });
  renderPreview(preview, source, plugin.previewOpts());
  addEditHint(wrapper);

  // Click anywhere on the diagram to edit (the centered hint shows on hover).
  wrapper.addEventListener('click', () => {
    plugin.openEditor(new CodeBlockSource(plugin.app, ctx, el, source));
  });
}
