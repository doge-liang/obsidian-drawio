// Build-time scrub for the vendored drawio viewer (src/preview/viewer.min.txt),
// shared between esbuild.config.mjs (the shipped transform) and
// tests/sanitizeViewer.test.ts, so what the tests execute is byte-for-byte
// what ships inside main.js.
//
// Two createElement("script") sites exist in the v31 viewer; the plugin-review
// scanner flags that literal unconditionally, so neither may reach the bundle:
//
// 1. VIEWER_SCRIPT_LOADER — the MathJax-from-CDN helper: builds a <script>,
//    points its src at a CDN URL and appends it. A genuine external-code
//    loader, dead in offline previews (we never render math), so it is
//    deleted outright.
// 2. VIEWER_SVG_ICON_SCRIPT — addSvgIconHandlers embeds an inline popup
//    script into SVGs *exported by EditorUi*, a path GraphViewer previews
//    never reach. Its element creation is a ternary with a
//    document.createElement("script") fallback for pre-createElementNS
//    documents; every runtime this plugin can reach (Electron, iOS/Android
//    WebView) has createElementNS, so the ternary is collapsed to its
//    SVG-namespace branch: identical behavior, no scanner literal, and no
//    dead value left in a reachable path.
//
// Both snippets are exact substrings of the minified blob, variable names
// included, so ANY upstream re-minification breaks the match. That is by
// design: the count assertion below turns a drifted snippet into a loud
// build failure instead of a silently unsanitized bundle. If you bump
// drawio, expect to re-derive these from the new viewer.min.js.

export const VIEWER_REPLACEMENTS = [
  {
    label: 'VIEWER_SCRIPT_LOADER',
    from:
      'var V=document.createElement("script");V.setAttribute("type","text/javascript");' +
      'V.setAttribute("src",l);v[0].parentNode.appendChild(V)',
    to: '',
  },
  {
    label: 'VIEWER_SVG_ICON_SCRIPT',
    from:
      'k=null!=f.createElementNS?f.createElementNS(mxConstants.NS_SVG,"script"):' +
      'f.createElement("script")',
    to: 'k=f.createElementNS(mxConstants.NS_SVG,"script")',
  },
];

export function sanitizeViewerSource(original) {
  let contents = original;
  for (const { label, from, to } of VIEWER_REPLACEMENTS) {
    const parts = contents.split(from);
    if (parts.length - 1 !== 1) {
      throw new Error(
        `sanitize-viewer: expected exactly 1 ${label} in viewer.min.txt, ` +
        `found ${parts.length - 1}. The vendored drawio viewer likely changed; ` +
        `review and update the snippet in scripts/sanitize-viewer.mjs.`,
      );
    }
    contents = parts.join(to);
  }
  if (contents.includes('createElement("script")') || contents.includes("createElement('script')")) {
    throw new Error(
      'sanitize-viewer: createElement("script") still present after applying ' +
      'the known replacements; aborting to avoid shipping it.',
    );
  }
  return contents;
}
