import { buildEmbedQuery } from '../constants';
import {
  buildConfigureMessage, buildExportMessage, buildLoadMessage, parseDrawioEvent,
} from './embedMessages';
import type { DrawioEditorDeps } from './DrawioEditor';

/** Plain image export formats — unlike the dual-format `xmlsvg`/`xmlpng`
 * bodies, the output carries no embedded diagram XML. */
export type PlainExportFormat = 'svg' | 'png';

export interface HeadlessExportOptions {
  /** How long to wait for drawio's export reply before rejecting
   * (tests shrink this; defaults to 30 s). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * One-shot, invisible drawio export: mounts an off-screen embed-mode iframe on
 * `activeDocument.body`, drives the postMessage handshake (configure → init →
 * load → export), and resolves with the exported image as a `data:` URI.
 * The container, the message listener, the timer, and the server pin are all
 * torn down whether the export succeeds, fails, or times out.
 *
 * Always a main-window flow (the export commands and menu items run there), so
 * unlike DrawioEditor it needs none of the popout rebind/eval-post machinery.
 */
export async function exportDiagramXml(
  xml: string,
  format: PlainExportFormat,
  deps: DrawioEditorDeps,
  options: HeadlessExportOptions = {},
): Promise<string> {
  const base = await deps.resolveBaseUrl();
  const origin = new URL(base).origin;
  const q = buildEmbedQuery({ dark: false, libraries: false });
  const url = `${base}${base.includes('?') ? '&' : '?'}${q}`;

  deps.acquireServer();
  const container = activeDocument.body.createDiv({ cls: 'drawio-headless-exporter' });
  const win = container.ownerDocument.defaultView ?? window;
  const iframe = container.createEl('iframe', { cls: 'drawio-iframe' });

  let timer: number | null = null;
  let onMessage: ((e: MessageEvent) => void) | null = null;
  try {
    return await new Promise<string>((resolve, reject) => {
      const post = (message: string) => {
        iframe.contentWindow?.postMessage(message, origin === 'null' ? '*' : origin);
      };
      onMessage = (e: MessageEvent) => {
        if (e.source !== iframe.contentWindow) return;
        if (origin !== 'null' && e.origin !== origin) return;
        const ev = parseDrawioEvent(e.data);
        if (!ev) return;
        switch (ev.event) {
          case 'configure':
            post(buildConfigureMessage());
            break;
          case 'init':
            post(buildLoadMessage(xml, { dark: false }));
            break;
          case 'load':
            // The diagram is in; ask for the plain image.
            post(buildExportMessage(format));
            break;
          case 'export':
            resolve((ev as { data: string }).data);
            break;
        }
      };
      win.addEventListener('message', onMessage);
      timer = window.setTimeout(
        () => reject(new Error('timed out waiting for the drawio export')),
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      iframe.setAttribute('src', url);
    });
  } finally {
    if (timer !== null) window.clearTimeout(timer);
    if (onMessage) win.removeEventListener('message', onMessage);
    container.remove();
    deps.releaseServer();
  }
}
