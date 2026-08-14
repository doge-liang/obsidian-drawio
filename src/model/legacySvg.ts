import { dualFormatOf, extractXmlFromSvg } from './dualFormat';
import { isValidDrawioXml } from './xmlUtils';

/** True for a path that looks like the old Diagrams plugin's default `.svg`
 *  product — not already our dual-format `.drawio.svg`. */
export function isLegacyDrawioSvgPath(path: string): boolean {
  return path.toLowerCase().endsWith('.svg') && dualFormatOf(path) === null;
}

/** True when the file body is an SVG whose root `content` attribute holds
 *  drawio XML (mxfile or a bare mxGraphModel). Matches the old plugin's
 *  empty template and its saved xmlsvg exports. */
export function isLegacyDrawioSvgContent(svg: string): boolean {
  const xml = extractXmlFromSvg(svg);
  return xml !== null && isValidDrawioXml(xml);
}

/** Preferred rename target: `foo.svg` → `foo.drawio.svg`. Does not check
 *  collisions — callers run the result through {@link uniquePath}. */
export function preferredLegacyRenamePath(path: string): string {
  return path.replace(/\.svg$/i, '.drawio.svg');
}

/** Stem used with `uniquePath(..., '.drawio.svg', …)`. */
export function legacyRenameStem(destPath: string): string {
  return destPath.replace(/\.drawio\.svg$/i, '');
}
