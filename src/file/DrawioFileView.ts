import { TextFileView, WorkspaceLeaf } from 'obsidian';
import { DRAWIO_VIEW_TYPE } from '../constants';
import { DrawioEditor } from '../editor/DrawioEditor';
import { DrawioSource } from '../model/DrawioSource';
import type DrawioPlugin from '../main';

/**
 * Custom view for `.drawio` files: embeds the drawio editor directly in the tab
 * (Excalidraw-style), instead of a preview + modal. Saves flow through the native
 * TextFileView save (requestSave + getViewData), and external file changes reload
 * the running editor. A self-write guard prevents our own saves from triggering a
 * disruptive reload.
 */
export class DrawioFileView extends TextFileView {
  private editor: DrawioEditor | null = null;
  /** The last XML we wrote ourselves — used to ignore our own change events. */
  private lastSaved = '';

  constructor(leaf: WorkspaceLeaf, private plugin: DrawioPlugin) {
    super(leaf);
    this.data = '';
  }

  getViewType(): string { return DRAWIO_VIEW_TYPE; }
  getIcon(): string { return 'pencil-ruler'; }

  getViewData(): string { return this.data; }

  setViewData(data: string, clear: boolean): void {
    this.data = data;
    if (clear) {
      // Fresh file opened in this leaf — (re)mount the editor.
      this.lastSaved = data;
      this.mountEditor();
    } else if (data !== this.lastSaved) {
      // The file changed on disk from outside the editor — reload it.
      this.lastSaved = data;
      void this.editor?.reload();
    }
  }

  clear(): void {
    this.data = '';
    this.lastSaved = '';
    this.editor?.destroy();
    this.editor = null;
  }

  private mountEditor(): void {
    this.editor?.destroy();
    const c = this.contentEl;
    c.empty();
    c.addClass('drawio-file-view');

    const source: DrawioSource = {
      title: () => this.file?.basename ?? 'Drawio',
      read: async () => this.data,
      write: async (xml: string) => {
        this.data = xml;
        this.lastSaved = xml;
        this.requestSave();
      },
    };

    this.editor = new DrawioEditor(c, source, this.plugin.editorDeps());
    this.editor.mount().catch((err) => {
      console.error('[drawio] file-view editor failed to mount', err);
      c.createDiv({
        cls: 'drawio-error',
        text: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async onClose(): Promise<void> {
    this.editor?.destroy();
    this.editor = null;
  }
}
