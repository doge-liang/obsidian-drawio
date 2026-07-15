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
  /** How long to wait for drawio's export reply before falling back to an
   * XML-only write (tests shrink this; defaults to 15 s). */
  exportTimeoutMs?: number;
}

const DEFAULT_EXPORT_TIMEOUT_MS = 15_000;

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
   * Overlapping requests are coalesced into one trailing re-request. The XML
   * from the latest save/autosave event is kept so that a torn-down or
   * unanswered export can still fall back to an XML-only write — the diagram
   * data must never be lost, even if the image part goes stale. */
  private exportPending = false;
  private exportQueued = false;
  private exitAfterExport = false;
  private lastXml: string | null = null;
  private exportTimer: number | null = null;

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
          // The event's xml alone can't be persisted as-is (the file body is
          // an image); ask the editor for a fresh export and save on its
          // reply. Keep the xml for the fallback paths.
          this.lastXml = (ev as { xml: string }).xml;
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
        this.clearExportTimer();
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
    this.clearExportTimer();
    this.exportTimer = window.setTimeout(() => { void this.onExportTimeout(); },
      this.options.exportTimeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS);
    this.post(buildExportMessage(this.source.exportFormat()));
  }

  private clearExportTimer(): void {
    if (this.exportTimer !== null) { window.clearTimeout(this.exportTimer); this.exportTimer = null; }
  }

  /** drawio never answered the export request: fall back to writing the XML
   * alone (the image part stays stale until the next successful save), so the
   * user's data survives and a pending save-and-exit doesn't hang forever. */
  private async onExportTimeout(): Promise<void> {
    if (this.destroyed || !this.exportPending) return;
    this.exportTimer = null;
    this.exportPending = false;
    this.exportQueued = false;
    const exit = this.exitAfterExport;
    this.exitAfterExport = false;
    try {
      if (this.lastXml !== null) await this.source.write(this.lastXml);
      new Notice('Drawio: the editor did not return an export — the diagram data was saved, ' +
        'but the image may be outdated until the next save.');
    } catch (err) {
      new Notice('Drawio: failed to save diagram');
      console.error(err);
    }
    if (exit) this.options.onExit?.();
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
    this.clearExportTimer();
    // Torn down while an export round-trip is in flight (e.g. the modal
    // closed right after an autosave): the reply will never arrive, so
    // persist the last known XML now. The vault write survives the teardown;
    // only the image part stays stale until the next editor save.
    if ((this.exportPending || this.exportQueued) && this.lastXml !== null) {
      this.source.write(this.lastXml).catch((err) => {
        new Notice('Drawio: failed to save diagram');
        console.error(err);
      });
      this.exportPending = false;
      this.exportQueued = false;
    }
    if (this.onMessage) this.win.removeEventListener('message', this.onMessage);
    this.onMessage = null;
    this.iframe = null;
    if (this.acquired) { this.deps.releaseServer(); this.acquired = false; }
    this.container.empty();
  }
}
