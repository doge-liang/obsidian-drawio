import { ensureViewerLoaded, getGraphViewer } from './loadViewer';
import { isValidDrawioXml, ensureMxfile } from '../model/xmlUtils';
import { sanitizeSvgToNode } from './svgSanitizer';

export interface RenderOptions {
  dark: boolean;
  /** Which diagram page to render (0-indexed); defaults to 0 (first page). */
  page?: number;
}

const RENDER_TIMEOUT_MS = 5000;

/**
 * Render drawio XML into `el` as a static, sanitized, non-interactive SVG preview.
 *
 * Two GraphViewer behaviours shape this code:
 *
 *  1. By default GraphViewer DEFERS rendering whenever the mount has
 *     `offsetWidth == 0` (detached or hidden), waiting on a MutationObserver for
 *     an *attribute* change on an ancestor. In Obsidian's reading view the
 *     post-processor runs on a DETACHED fragment, and the later attach is a
 *     childList change, not an attribute change — so that observer never fires and
 *     the diagram never renders. We pass `check-visible-state: false` to force an
 *     immediate, synchronous render regardless of attachment, which is what makes
 *     reading-mode (and lazy embeds) work.
 *
 *  2. GraphViewer's <svg> has NO `viewBox`/`width`/`height` attributes — only
 *     inline `width:100%;height:100%` plus `min-width`/`min-height` equal to the
 *     diagram bounds. That only renders correctly inside GraphViewer's own
 *     precisely-sized container. Since we lift the bare <svg> out (to drop
 *     GraphViewer's click/lightbox handlers), we must re-attach explicit
 *     dimensions, otherwise the standalone SVG stretches to the note width and
 *     shows blank padding. {@link extractSizedSvg} restores a self-contained,
 *     content-sized SVG that scales down responsively via CSS.
 *
 * Returns false synchronously only for the early-exit cases (invalid XML / viewer
 * unavailable). The render itself is normally synchronous; a MutationObserver is
 * kept purely as a safety net for any environment that still defers.
 */
export function renderPreview(el: HTMLElement, xml: string, opts: RenderOptions): boolean {
  el.empty();
  if (!isValidDrawioXml(xml)) {
    el.createDiv({ cls: 'drawio-error', text: 'Invalid drawio diagram' });
    return false;
  }
  ensureViewerLoaded(el.ownerDocument);
  const viewer = getGraphViewer(el.ownerDocument.defaultView ?? window);
  if (!viewer) {
    el.createDiv({ cls: 'drawio-error', text: 'drawio viewer failed to load' });
    return false;
  }

  const mount = el.createDiv({ cls: 'mxgraph' });
  const data = {
    highlight: '#0000ff', nav: false, lightbox: false, toolbar: '', edit: null,
    // Render even when the mount is detached/hidden (reading view, lazy embeds).
    'check-visible-state': false,
    'dark-mode': opts.dark ? 'auto' : 'off',
    page: opts.page ?? 0,
    xml: ensureMxfile(xml),
  };
  mount.setAttribute('data-mxgraph', JSON.stringify(data));
  viewer.createViewerForElement(mount);

  let done = false;
  const finalize = (svg: SVGSVGElement): void => {
    if (done) return;
    done = true;
    let clean: Node | null = null;
    try {
      clean = extractSizedSvg(svg, el.ownerDocument);
    } catch {
      clean = null;
    }
    el.empty(); // drop GraphViewer's container + its handlers/overlays
    if (clean) {
      el.appendChild(clean);
    } else {
      el.createDiv({ cls: 'drawio-error', text: 'drawio render failed' });
    }
  };

  // With `check-visible-state: false` the SVG is produced synchronously.
  const immediate = mount.querySelector('svg');
  if (immediate) {
    finalize(immediate);
    return true;
  }

  // Safety net: if some environment still defers, wait for the SVG to appear.
  const win = el.ownerDocument.defaultView ?? window;
  const observer = new win.MutationObserver(() => {
    const svg = mount.querySelector('svg');
    if (svg) {
      observer.disconnect();
      finalize(svg);
    }
  });
  observer.observe(mount, { childList: true, subtree: true });
  win.setTimeout(() => {
    observer.disconnect();
    if (!done) {
      el.empty();
      el.createDiv({ cls: 'drawio-error', text: 'drawio render timed out' });
    }
  }, RENDER_TIMEOUT_MS);
  return true;
}

/**
 * Sanitize GraphViewer's <svg> and make it self-contained: give it an explicit
 * `viewBox`/`width`/`height` from the diagram bounds (GraphViewer encodes those as
 * the SVG's `min-width`/`min-height`) and strip the inline `width:100%`/`height:100%`
 * sizing that only works inside GraphViewer's own container. The result renders at
 * its natural size and scales down to the note width via CSS (`max-width:100%`).
 *
 * Returns the imported, sanitized <svg> node, or null if no <svg> survived.
 */
function extractSizedSvg(svg: SVGSVGElement, targetDoc: Document): Node | null {
  // Capture bounds before sanitizing. `min-width`/`min-height` carry the diagram
  // size even when the mount is detached (offsetWidth would be 0); a live bounding
  // rect is the fallback when, rarely, the style isn't present.
  const rect = svg.getBoundingClientRect();
  const w = parseFloat(svg.style.minWidth) || rect.width || 0;
  const h = parseFloat(svg.style.minHeight) || rect.height || 0;

  const frag = sanitizeSvgToNode(svg.outerHTML, targetDoc);
  let out: SVGSVGElement | null = null;
  for (const node of Array.from(frag.childNodes)) {
    if (node.nodeType === 1 && (node as Element).localName.toLowerCase() === 'svg') {
      out = node as SVGSVGElement;
      break;
    }
  }
  if (!out) return null;

  if (w > 0 && h > 0) {
    out.setAttribute('viewBox', `0 0 ${w} ${h}`);
    out.setAttribute('width', String(w));
    out.setAttribute('height', String(h));
    // Inline width/height:100% (and absolute positioning) would override the
    // attributes and the responsive CSS — remove them so the SVG sizes naturally.
    for (const prop of ['width', 'height', 'min-width', 'min-height', 'position', 'left', 'top']) {
      out.style.removeProperty(prop);
    }
  }
  return frag;
}
