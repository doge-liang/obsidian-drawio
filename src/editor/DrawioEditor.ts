import { Notice } from 'obsidian';
import { DrawioSource } from '../model/DrawioSource';
import { buildLoadMessage, buildConfigureMessage, parseDrawioEvent } from './embedMessages';
import { buildEmbedQuery } from '../constants';

export interface DrawioEditorDeps {
  /** Resolve the editor base URL (local server origin or custom URL). */
  resolveBaseUrl(): Promise<string>;
  isDark(): boolean;
  showLibraries(): boolean;
  /** Pin/unpin the local server so it isn't idle-stopped while editing. */
  acquireServer(): void;
  releaseServer(): void;
}

export interface DrawioEditorOptions {
  /** Called when drawio emits an `exit` event (e.g. user clicks the editor's close). */
  onExit?: () => void;
}

/**
 * Reusable drawio editor surface: an <iframe> loading the drawio webapp in embed
 * mode, speaking the postMessage JSON protocol. Used both by the modal (code blocks
 * / embeds) and inline in the .drawio file view. The container is filled with the
 * iframe; the editor pins the local server for its lifetime.
 */
export class DrawioEditor {
  private iframe: HTMLIFrameElement | null = null;
  private onMessage: ((e: MessageEvent) => void) | null = null;
  private origin = '';
  private acquired = false;
  private destroyed = false;
  /** The window mount() actually listens on — the container's own window, so a
   * popped-out .drawio tab (a separate Window) still receives the iframe's
   * postMessage replies, which are dispatched on ITS parent window, not the
   * main app window. */
  private win: Window = window;

  constructor(
    private container: HTMLElement,
    private source: DrawioSource,
    private deps: DrawioEditorDeps,
    private options: DrawioEditorOptions = {},
  ) {}

  async mount(): Promise<void> {
    const base = await this.deps.resolveBaseUrl();
    // destroy() may have run while the await above was pending (e.g. rapid
    // remount/close). Bail out before touching the server or the DOM.
    if (this.destroyed) return;

    this.origin = new URL(base).origin;
    const q = buildEmbedQuery({ dark: this.deps.isDark(), libraries: this.deps.showLibraries() });
    const url = `${base}${base.includes('?') ? '&' : '?'}${q}`;

    this.deps.acquireServer();
    this.acquired = true;

    this.iframe = this.container.createEl('iframe', { cls: 'drawio-iframe' });
    this.iframe.addEventListener('error', (ev) => console.error('Drawio: editor iframe failed to load', ev));
    this.iframe.setAttribute('src', url);

    this.win = this.container.ownerDocument.defaultView ?? window;
    this.onMessage = (e: MessageEvent) => { void this.handle(e); };
    this.win.addEventListener('message', this.onMessage);
  }

  /** Push fresh XML into the running editor (e.g. the file changed on disk). */
  async reload(): Promise<void> {
    if (!this.iframe) return;
    const xml = await this.source.read();
    this.post(buildLoadMessage(xml, { dark: this.deps.isDark() }));
  }

  private async handle(e: MessageEvent): Promise<void> {
    if (e.source !== this.iframe?.contentWindow) return;
    if (this.origin !== 'null' && e.origin !== this.origin) return;
    const ev = parseDrawioEvent(e.data);
    if (!ev) return;
    switch (ev.event) {
      case 'configure':
        // Sent before init when configure=1. Disable compression → readable XML.
        this.post(buildConfigureMessage());
        break;
      case 'init': {
        let xml: string;
        try {
          xml = await this.source.read();
        } catch (err) {
          new Notice('Drawio: failed to read diagram');
          console.error(err);
          break;
        }
        this.post(buildLoadMessage(xml, { dark: this.deps.isDark() }));
        break;
      }
      case 'save':
      case 'autosave': {
        try {
          await this.source.write((ev as { xml: string }).xml);
        } catch (err) {
          new Notice('Drawio: failed to save diagram');
          console.error(err);
        }
        if (ev.event === 'save' && (ev as { exit?: boolean }).exit) this.options.onExit?.();
        break;
      }
      case 'exit':
        this.options.onExit?.();
        break;
    }
  }

  private post(message: string): void {
    this.iframe?.contentWindow?.postMessage(message, this.origin === 'null' ? '*' : this.origin);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.onMessage) this.win.removeEventListener('message', this.onMessage);
    this.onMessage = null;
    this.iframe = null;
    if (this.acquired) { this.deps.releaseServer(); this.acquired = false; }
    this.container.empty();
  }
}
