import { MarkdownPostProcessorContext, MarkdownRenderChild, TFile } from 'obsidian';
import { renderPreview } from '../preview/ViewerRenderer';
import { addEditHint } from '../preview/editHint';
import { FileSource } from './FileSource';
import { DRAWIO_FILE_EXT } from '../constants';
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
      registry.registerExtension(DRAWIO_FILE_EXT, (ctx, file) =>
        new DrawioFileEmbed(plugin, file, ctx.containerEl));
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
  registerExtension(ext: string, creator: (ctx: { containerEl: HTMLElement }, file: TFile, subpath?: string) => unknown): void;
  unregisterExtension?(ext: string): void;
}

/** An embed component Obsidian drives in either editing mode. */
class DrawioFileEmbed extends MarkdownRenderChild {
  constructor(private plugin: DrawioPlugin, private file: TFile, containerEl: HTMLElement) {
    super(containerEl);
  }

  /** Called by the embed system to (re)render the file's diagram. */
  async loadFile(file?: TFile): Promise<void> {
    if (file) this.file = file;
    await this.render();
  }

  onload(): void {
    // Reflect edits made elsewhere (e.g. the modal or the file view).
    this.registerEvent(this.plugin.app.vault.on('modify', (f) => {
      if (f instanceof TFile && f.path === this.file.path) void this.render();
    }));
  }

  private async render(): Promise<void> {
    const el = this.containerEl;
    el.empty();
    el.addClass('drawio-embed');
    el.setAttribute('title', 'Click to edit diagram');
    try {
      const xml = await this.plugin.app.vault.read(this.file);
      const preview = el.createDiv({ cls: 'drawio-preview' });
      renderPreview(preview, xml, this.plugin.previewOpts());
      addEditHint(el);
    } catch (err) {
      el.createDiv({ cls: 'drawio-error', text: `Failed to render diagram: ${String(err)}` });
    }
    // Wire click-to-edit once (survives re-renders; el.empty() keeps the listener).
    if (!el.dataset.drawioClick) {
      el.dataset.drawioClick = '1';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.plugin.openEditor(new FileSource(this.plugin.app, this.file));
      });
    }
  }
}

/** Reading-view-only fallback when the embed registry is unavailable. */
function registerEmbedPostProcessor(plugin: DrawioPlugin) {
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    for (const span of Array.from(el.querySelectorAll<HTMLElement>('.internal-embed'))) {
      if (span.dataset.drawioEmbed === '1') continue;
      const src = span.getAttribute('src');
      if (!src || !src.toLowerCase().endsWith('.' + DRAWIO_FILE_EXT)) continue;
      const file = plugin.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
      if (!(file instanceof TFile)) continue;
      span.dataset.drawioEmbed = '1';
      span.setAttribute('title', 'Click to edit diagram');
      span.addEventListener('click', () => plugin.openEditor(new FileSource(plugin.app, file)));
      void renderEmbedInto(plugin, span, file);
    }
  });
}

async function renderEmbedInto(plugin: DrawioPlugin, span: HTMLElement, file: TFile) {
  span.empty();
  span.addClass('drawio-embed');
  span.removeClasses(['file-embed', 'mod-generic', 'is-loaded']);
  try {
    const xml = await plugin.app.vault.read(file);
    const preview = span.createDiv({ cls: 'drawio-preview' });
    renderPreview(preview, xml, plugin.previewOpts());
    addEditHint(span);
  } catch (err) {
    span.empty();
    span.createDiv({ cls: 'drawio-error', text: `Failed to render diagram: ${String(err)}` });
  }
}
