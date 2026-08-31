export const DRAWIO_VIEW_TYPE = 'drawio-file-view';
export const DRAWIO_CODE_BLOCK_LANG = 'drawio';
export const DRAWIO_FILE_EXT = 'drawio';

/** Hosted drawio embed, used when the editor source is "Online". */
export const ONLINE_DRAWIO_URL = 'https://embed.diagrams.net/';

/** Pinned drawio version — MUST match scripts/fetch-drawio.mjs (guarded by
 * tests/drawioVersionSync.test.ts) so the runtime-installed webapp matches the
 * bundled viewer.min.txt. */
export const DRAWIO_VERSION = 'v31.4.1';

/** The pinned drawio webapp archive (a ZIP), downloaded by the settings-tab
 * one-click installer. */
export const DRAWIO_WAR_URL =
  `https://github.com/jgraph/drawio/releases/download/${DRAWIO_VERSION}/draw.war`;

/** SHA-256 of the pinned draw.war. Checked against the downloaded bytes before
 * anything is extracted or installed — by the runtime installer
 * (src/desktop/webappInstaller.ts) and by scripts/fetch-drawio.mjs, which pins
 * the same literal (guarded by tests/drawioVersionSync.test.ts).
 *
 * Upstream publishes no checksum file: this digest was computed from the
 * archive at DRAWIO_WAR_URL and cross-checked against the digest GitHub reports
 * for that release asset. Bump it in both places whenever DRAWIO_VERSION moves,
 * and only after verifying the new archive — a mismatch is meant to fail the
 * build and the install loudly. */
export const DRAWIO_WAR_SHA256 =
  '910530e608c7bf98f56ed4cc74f90c86695f561f10acb5b0f78c5a4840dc3a53';

/** Default empty mxfile diagram. */
export const EMPTY_DIAGRAM =
  '<mxfile><diagram id="0" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" ' +
  'gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" ' +
  'pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">' +
  '<root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

/** drawio embed iframe URL query params. `configure=1` lets us disable XML
 *  compression so saved diagrams are readable (and code blocks are formattable). */
export function buildEmbedQuery(opts: { dark: boolean; libraries: boolean }): string {
  const p = new URLSearchParams({ embed: '1', proto: 'json', spin: '1', configure: '1' });
  if (opts.libraries) p.set('libraries', '1');
  if (opts.dark) p.set('dark', '1');
  return p.toString();
}
