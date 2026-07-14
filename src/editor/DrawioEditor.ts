import { Notice } from 'obsidian';
import { DrawioSource, isExportingSource } from '../model/DrawioSource';
import {
  buildLoadMessage, buildConfigureMessage, buildExportMessage, parseDrawioEvent,
} from './embedMessages';
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
  /** Export round-trip state for dual-format sources: save/autosave answers
   * with an export request, and the export event does the actual persist.
   * Overlapping requests are coalesced into one trailing re-request. */
  private exportPending = false;
  private exportQueued = false;
  private exitAfterExport = false;

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
    // Obsidian can adopt this view's DOM into a popout window's document some
    // time after mount() runs (both "move to new window" and "open in new
    // window" do this asynchronously) — which reloads the iframe, so its next
    // postMessage handshake targets whatever window it ends up in. Re-sync the
    // listener whenever the iframe (re)loads; a no-op if the window is unchanged.
    this.iframe.addEventListener('load', () => this.rebindIfWindowChanged());
    this.iframe.setAttribute('src', url);

    this.win = this.container.ownerDocument.defaultView ?? window;
    this.onMessage = (e: MessageEvent) => { void this.handle(e); };
    this.win.addEventListener('message', this.onMessage);
  }

  private rebindIfWindowChanged(): void {
    if (this.destroyed) return;
    const current = this.container.ownerDocument.defaultView;
    if (!current || current === this.win) return;
    if (this.onMessage) this.win.removeEventListener('message', this.onMessage);
    this.win = current;
    if (this.onMessage) this.win.addEventListener('message', this.onMessage);
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
        if (isExportingSource(this.source)) {
          // The event's xml alone can't be persisted (the file body is an
          // image); ask the editor for a fresh export and save on its reply.
          if (ev.event === 'save' && (ev as { exit?: boolean }).exit) this.exitAfterExport = true;
          this.requestExport();
          break;
        }
        try {
          await this.source.write((ev as { xml: string }).xml);
        } catch (err) {
          new Notice('Drawio: failed to save diagram');
          console.error(err);
        }
        if (ev.event === 'save' && (ev as { exit?: boolean }).exit) this.options.onExit?.();
        break;
      }
      case 'export': {
        if (!isExportingSource(this.source)) break;
        this.exportPending = false;
        const again = this.exportQueued;
        this.exportQueued = false;
        try {
          await this.source.writeExport((ev as { data: string }).data);
        } catch (err) {
          new Notice('Drawio: failed to save diagram');
          console.error(err);
        }
        if (again) {
          this.requestExport();
        } else if (this.exitAfterExport) {
          this.exitAfterExport = false;
          this.options.onExit?.();
        }
        break;
      }
      case 'exit':
        this.options.onExit?.();
        break;
    }
  }

  private requestExport(): void {
    if (this.exportPending) { this.exportQueued = true; return; }
    if (!isExportingSource(this.source)) return;
    this.exportPending = true;
    this.post(buildExportMessage(this.source.exportFormat()));
  }

  private post(message: string): void {
    const cw = this.iframe?.contentWindow;
    if (!cw) return;
    const targetOrigin = this.origin === 'null' ? '*' : this.origin;
    // When the view is popped out, its iframe lives in a different top-level
    // window than the one this plugin code runs in (the main app window). drawio
    // only accepts protocol replies whose source is its own parent window, so a
    // direct cw.postMessage() issued from the main realm is ignored once popped
    // out. Post from the iframe's parent-window realm (indirect eval on that
    // window) so the message's source is that parent window. In the main window
    // this branch is skipped and we post directly.
    const parentWin = this.win as Window & {
      eval?: (s: string) => void;
      __drawioPostTarget?: Window;
    };
    if (parentWin && parentWin !== window && typeof parentWin.eval === 'function') {
      try {
        parentWin.__drawioPostTarget = cw;
        parentWin.eval(
          `window.__drawioPostTarget&&window.__drawioPostTarget.postMessage(${JSON.stringify(message)},${JSON.stringify(targetOrigin)})`,
        );
        return;
      } catch (err) {
        console.error('Drawio: cross-window post failed, falling back to direct', err);
      } finally {
        delete parentWin.__drawioPostTarget;
      }
    }
    cw.postMessage(message, targetOrigin);
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
