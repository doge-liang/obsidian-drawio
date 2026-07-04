const MXFILE_RE = /<mxfile[\s>]/;
const MXMODEL_RE = /<mxGraphModel[\s>]/;

export function isValidDrawioXml(xml: string): boolean {
  if (!xml || !xml.trim()) return false;
  return MXFILE_RE.test(xml) || MXMODEL_RE.test(xml);
}

export function ensureMxfile(xml: string): string {
  const trimmed = xml.trim();
  if (MXFILE_RE.test(trimmed)) return trimmed;
  if (MXMODEL_RE.test(trimmed)) {
    return `<mxfile><diagram id="0" name="Page-1">${trimmed}</diagram></mxfile>`;
  }
  return trimmed;
}

export function extractDiagramTitle(xml: string): string | null {
  const m = xml.match(/<diagram[^>]*\bname="([^"]*)"/);
  return m?.[1] ?? null;
}

const DIAGRAM_TAG_RE = /<diagram\b([^>]*)>/g;
const ID_ATTR_RE = /\bid="([^"]*)"/;
const NAME_ATTR_RE = /\bname="([^"]*)"/;

export interface DiagramPage { id: string; name: string; }

/** Parse every `<diagram id="..." name="...">` opening tag from an mxfile, in
 *  document order. Missing id/name attributes get a generated fallback so every
 *  page always has a displayable label. */
export function getDiagramPages(xml: string): DiagramPage[] {
  const pages: DiagramPage[] = [];
  DIAGRAM_TAG_RE.lastIndex = 0; // the shared `g`-flagged regex is stateful across calls
  let match: RegExpExecArray | null;
  while ((match = DIAGRAM_TAG_RE.exec(xml))) {
    const attrs = match[1] ?? ''; // noUncheckedIndexedAccess: capture group 1 always matches here, but is still typed optional
    const id = ID_ATTR_RE.exec(attrs)?.[1] ?? String(pages.length);
    const name = NAME_ATTR_RE.exec(attrs)?.[1] ?? `Page-${pages.length + 1}`;
    pages.push({ id, name });
  }
  return pages;
}

/** Resolve a `![[file.drawio#Page-2]]`-style subpath (with or without the
 *  leading `#`) to a page index by matching `name`. Falls back to 0 (first
 *  page) when there's no subpath or no matching page name. */
export function resolvePageFromSubpath(
  pages: DiagramPage[],
  subpath: string | undefined | null,
): number {
  if (!subpath) return 0;
  const target = subpath.replace(/^#/, '');
  const index = pages.findIndex((p) => p.name === target);
  return index >= 0 ? index : 0;
}
