export type DrawioEvent =
  | { event: 'init' }
  | { event: 'load'; [k: string]: unknown }
  | { event: 'save'; xml: string; exit?: boolean }
  | { event: 'autosave'; xml: string }
  | { event: 'exit'; modified?: boolean }
  | { event: 'export'; data: string; xml?: string; format?: string }
  | { event: 'configure' };

export function buildLoadMessage(xml: string, opts: { dark: boolean }): string {
  return JSON.stringify({ action: 'load', xml, autosave: 1, modified: 0, dark: opts.dark });
}

export function buildExportMessage(format: 'svg' | 'png' | 'xmlsvg' | 'xmlpng'): string {
  return JSON.stringify({ action: 'export', format });
}

/**
 * Response to the editor's `configure` event. We disable XML compression so saved
 * diagrams are human-readable mxGraphModel XML (not a base64 blob).
 */
export function buildConfigureMessage(): string {
  return JSON.stringify({ action: 'configure', config: { compressXml: false } });
}

export function parseDrawioEvent(raw: unknown): DrawioEvent | null {
  if (typeof raw !== 'string') return null;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const ev = (obj as Record<string, unknown>).event;
  if (typeof ev !== 'string') return null;
  return obj as DrawioEvent;
}
