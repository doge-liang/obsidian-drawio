import { MarkdownView, parseLinktext, TFile } from 'obsidian';
import { dualFormatOf } from '../model/dualFormat';
import type DrawioPlugin from '../main';

function resourceIdentity(src: string): string | null {
  try {
    const url = new URL(src);
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** Native image embeds keep a decoded image at the old mtime URL after a save.
 * Update only matching mounted images; never rebuild the note/editor. */
export function registerDualFormatRefresh(plugin: DrawioPlugin): void {
  const { vault, workspace } = plugin.app;
  // Keep vault paths, not mtime URLs: files may be deleted or paths reused.
  const changedResources = new Map<string, string>();
  const observers = new Map<Document, MutationObserver>();
  const refreshMounted = (): void => {
    workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!view.containerEl.isConnected) return;
      const refresh = (scope: HTMLElement): void => {
        for (const img of Array.from(scope.querySelectorAll<HTMLImageElement>('img'))) {
          // Nested transclusions resolve links relative to their own note, not
          // the top-level MarkdownView. The mounted resource is authoritative.
          const identity = resourceIdentity(img.src);
          const path = identity && changedResources.get(identity);
          if (!path) continue;
          const file = vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile)) continue;
          const resourcePath = vault.getResourcePath(file);
          if (resourceIdentity(resourcePath) !== identity) continue;
          if (img.src === resourcePath) continue;
          img.src = resourcePath;
          // A subsequent save/detach can abort decoding; the native URL stays current.
          void img.decode?.().catch(() => {});
        }
      };
      if (view.getViewType() === 'image') {
        refresh(view.containerEl);
        return;
      }
      if (!(view instanceof MarkdownView) || !view.file) return;
      for (const embed of Array.from(view.containerEl.querySelectorAll<HTMLElement>('.internal-embed[src]'))) {
        const src = embed.getAttribute('src') ?? '';
        // A literal # may belong to the filename; only URLs are stripped above.
        if (!dualFormatOf(src) && !dualFormatOf(parseLinktext(src).path)) continue;
        refresh(embed);
      }
    });
  };
  const observeDocuments = (): void => {
    const documents = new Set<Document>([workspace.containerEl.ownerDocument]);
    workspace.iterateAllLeaves(leaf => documents.add(leaf.view.containerEl.ownerDocument));
    for (const [doc, observer] of observers) {
      if (!documents.has(doc)) { observer.disconnect(); observers.delete(doc); }
    }
    for (const doc of documents) {
      if (observers.has(doc) || !doc.defaultView) continue;
      const observer = new doc.defaultView.MutationObserver(records => {
        if (!changedResources.size) return;
        // Live Preview recycles offscreen widgets and may restore an old src.
        const imageChanged = records.some(record => record.type === 'attributes'
          ? (record.target as Element).tagName === 'IMG'
          : Array.from(record.addedNodes).some(node => node.nodeType === 1
            && ((node as Element).tagName === 'IMG' || !!(node as Element).querySelector('img'))));
        if (imageChanged) refreshMounted();
      });
      observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      observers.set(doc, observer);
    }
  };
  observeDocuments();
  const onLayout = (): void => { observeDocuments(); refreshMounted(); };
  plugin.registerEvent(workspace.on('layout-change', onLayout));
  plugin.registerEvent(workspace.on('window-open', onLayout));
  plugin.register(() => { observers.forEach(observer => observer.disconnect()); observers.clear(); changedResources.clear(); });
  plugin.registerEvent(vault.on('modify', (file) => {
    if (!(file instanceof TFile) || !dualFormatOf(file.path)) return;
    const resourcePath = vault.getResourcePath(file);
    const identity = resourceIdentity(resourcePath);
    if (!identity) return;
    changedResources.set(identity, file.path);
    refreshMounted();
  }));
}
