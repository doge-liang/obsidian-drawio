// @ts-expect-error - imported as raw text via esbuild text loader
import viewerSource from './viewer.min.txt';

const SENTINEL = 'drawioViewerLoaded';

/**
 * Load drawio's GraphViewer (viewer.min.js) into the given document exactly once
 * PER DOCUMENT (so pop-out windows each get their own copy). Sets offline globals
 * BEFORE loading so the viewer never reaches out to viewer.diagrams.net for
 * stylesheets/resources/proxy.
 *
 * The bundled viewer source is run via *indirect* eval rather than by injecting a
 * <script> element. Indirect eval executes in the target window's global scope —
 * exactly like a top-level <script>, so the viewer's `var GraphViewer = …` becomes
 * `window.GraphViewer` — but creates no script element. The source is our own
 * vendored, offline-pinned drawio viewer (no external code is fetched or run; the
 * vendored blob's only external-script loader is stripped at build time).
 */
export function ensureViewerLoaded(doc: Document = activeDocument): void {
  if (doc.head.dataset[SENTINEL] === '1') return;
  const win = (doc.defaultView ?? window) as unknown as Record<string, unknown>;
  if (win.GraphViewer) { doc.head.dataset[SENTINEL] = '1'; return; }
  // Keep everything local/offline.
  win.mxLoadResources = false;
  win.mxLoadStylesheets = false;
  win.mxForceIncludes = false;
  win.STYLE_PATH = win.STYLE_PATH ?? '.';
  win.RESOURCE_BASE = win.RESOURCE_BASE ?? '.';
  win.mxBasePath = win.mxBasePath ?? '.';
  win.PROXY_URL = win.PROXY_URL ?? '';
  // Indirect eval: calling the window's `eval` through a reference (not the bare
  // `eval(...)` form) runs the code in that window's global scope. This is the
  // <script>-free equivalent of appending an inline script tag.
  // eslint-disable-next-line no-eval -- run the bundled, vendored viewer in global scope without creating a <script> element
  const runInGlobalScope = win.eval as (code: string) => void;
  runInGlobalScope(viewerSource);
  doc.head.dataset[SENTINEL] = '1';
}

interface GraphViewerStatic {
  createViewerForElement(el: HTMLElement): void;
}

export function getGraphViewer(win: Window = window): GraphViewerStatic | null {
  const w = win as unknown as { GraphViewer?: GraphViewerStatic };
  return w.GraphViewer ?? null;
}

/** Test-only: clear the per-document injection sentinel. */
export function __resetViewerForTests(doc: Document = activeDocument): void {
  delete doc.head.dataset[SENTINEL];
}
