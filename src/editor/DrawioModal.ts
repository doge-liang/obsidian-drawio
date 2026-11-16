import { App, MarkdownView, Modal, Notice, Scope } from 'obsidian';
import { DrawioSource } from '../model/DrawioSource';
import { DrawioEditor, DrawioEditorDeps } from './DrawioEditor';
import { OfflineEditorNotInstalledError } from '../model/errors';

/**
 * Full-screen modal wrapping a {@link DrawioEditor}. Used for editing code-block
 * and `![[file.drawio]]` embed diagrams without leaving the note.
 */
export class DrawioModal extends Modal {
  private editor: DrawioEditor | null = null;
  private returnView: MarkdownView | null;

  constructor(app: App, private source: DrawioSource, private deps: DrawioEditorDeps) {
    super(app);
    this.returnView = app.workspace.getActiveViewOfType(MarkdownView);
    this.scope = new Scope(this.scope);
    this.scope.register([], 'Escape', () => {
      if (!this.editor?.requestClose()) this.close();
      return false;
    });
  }

  async onOpen() {
    this.modalEl.addClass('drawio-modal');
    this.titleEl.setText(this.source.title());
    try {
      this.editor = new DrawioEditor(this.contentEl, this.source, this.deps, {
        onExit: () => this.close(),
        closeOnEscape: true,
      });
      await this.editor.mount();
    } catch (err) {
      console.error('[drawio] failed to open editor:', err);
      const msg = err instanceof OfflineEditorNotInstalledError
        ? err.message
        : 'Drawio: failed to open editor — see console (Ctrl+Shift+I)';
      new Notice(msg, 8000);
      this.contentEl.createDiv({
        cls: 'drawio-error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  }

  onClose() {
    this.editor?.destroy();
    this.editor = null;
    this.contentEl.empty();
    if (this.returnView && this.app.workspace.getActiveViewOfType(MarkdownView) === this.returnView) {
      this.returnView.editor.focus();
    }
  }
}
