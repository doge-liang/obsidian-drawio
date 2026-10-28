import { finishRenderMath, loadMathJax, renderMath } from 'obsidian';
import { sanitizeSvgToNode } from './svgSanitizer';

// draw.io's TeX delimiters. A single dollar is ordinary text (e.g. a price).
const MATH = /\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;

/** Typeset only this preview's sanitized HTML labels with Obsidian's bundled
 * engine. Never initialize draw.io's CDN loader or alter the host MathJax config. */
export async function typesetPreviewMath(svg: SVGSVGElement): Promise<void> {
  const doc = svg.ownerDocument;
  const nodes: Text[] = [];
  for (const label of Array.from(svg.querySelectorAll('foreignObject'))) {
    const walker = doc.createTreeWalker(label, 4 /* SHOW_TEXT */);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('mjx-container, math, style, code, pre')) continue;
      MATH.lastIndex = 0;
      if (MATH.test(node.textContent ?? '')) nodes.push(node as Text);
    }
  }
  if (!nodes.length) return;
  await loadMathJax();
  const mathDocs = new Set<Document>();
  for (const node of nodes) {
    const text = node.data;
    const fragment = doc.createDocumentFragment();
    let offset = 0;
    MATH.lastIndex = 0;
    for (const match of text.matchAll(MATH)) {
      fragment.appendChild(doc.createTextNode(text.slice(offset, match.index)));
      try {
        const rendered = renderMath(match[1] ?? match[2] ?? match[3] ?? '', match[2] === undefined);
        mathDocs.add(rendered.ownerDocument);
        // Obsidian may use a document-wide SVG glyph cache. Inline referenced
        // glyphs so adopted output also works in a separate popout document.
        const copy = rendered.cloneNode(true) as HTMLElement;
        const mathSvg = copy.querySelector('svg');
        if (mathSvg) {
          const defs = doc.createElementNS('http://www.w3.org/2000/svg', 'defs');
          const copied = new Set<string>();
          for (const use of Array.from(mathSvg.querySelectorAll('use'))) {
            const href = use.getAttribute('href') ?? use.getAttribute('xlink:href');
            if (!href?.startsWith('#') || copied.has(href)) continue;
            const glyph = rendered.ownerDocument.getElementById(href.slice(1));
            if (glyph && !rendered.contains(glyph)) {
              defs.appendChild(doc.importNode(glyph, true));
              copied.add(href);
            }
          }
          if (defs.childNodes.length) mathSvg.prepend(defs);
        }
        fragment.appendChild(sanitizeSvgToNode(copy.outerHTML, doc));
      } catch (err) {
        // A malformed expression must not erase the rest of the diagram.
        console.error('Drawio: failed to typeset formula', err);
        fragment.appendChild(doc.createTextNode(match[0]));
      }
      offset = (match.index ?? 0) + match[0].length;
    }
    fragment.appendChild(doc.createTextNode(text.slice(offset)));
    node.replaceWith(fragment);
  }
  await finishRenderMath();
  // Keep MathJax's SVG rules with the preview, including in popout windows.
  for (const sourceDoc of mathDocs) {
    const style = sourceDoc.getElementById('MJX-SVG-styles');
    if (style) {
      const copy = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
      copy.textContent = style.textContent;
      svg.prepend(copy);
    }
  }
}
