/** One embed link occurrence in a note, as reported by the metadata cache. */
export interface EmbedSpan {
  /** Full embed text, e.g. `![[a.drawio#Page-2|alias]]`. */
  original: string;
  /** Offset range of `original` within the note text. */
  start: number;
  end: number;
  /** Link path without the subpath, e.g. `a.drawio`. */
  path: string;
  /** Subpath, with or without its leading `#`; undefined when none. */
  subpath: string | undefined;
}

export type PinRewrite =
  | { outcome: 'ok'; text: string }
  | { outcome: 'no-match' }
  | { outcome: 'ambiguous' };

/**
 * Rewrite exactly one embed link's subpath to `newPageName`.
 *
 * The candidate to rewrite is the one whose subpath equals `originalSubpath`
 * (the page the embed instance was created with — NOT the currently flipped
 * page, which exists only in memory). Zero matches → no-match; more than one
 * (identical duplicate links) → ambiguous; in both cases the text is left
 * untouched — never guess which link the user meant.
 *
 * Stale-cache safety: a candidate only matches if the document really
 * contains its `original` text at its recorded offsets. Metadata-cache
 * offsets can lag behind fast edits; splicing at stale offsets would corrupt
 * the note.
 */
export function rewriteEmbedSubpath(
  doc: string,
  candidates: EmbedSpan[],
  originalSubpath: string | undefined,
  newPageName: string,
): PinRewrite {
  const norm = (s: string | undefined): string => (s ?? '').replace(/^#/, '');
  const wanted = norm(originalSubpath);
  const matches = candidates.filter((c) =>
    norm(c.subpath) === wanted && doc.slice(c.start, c.end) === c.original);
  if (matches.length === 0) return { outcome: 'no-match' };
  if (matches.length > 1) return { outcome: 'ambiguous' };
  const m = matches[0]!;

  // `original` is `![[` + target(#subpath)? (|alias)? + `]]` — keep the alias
  // part verbatim, replace the target with path#newPageName.
  const inner = m.original.slice(3, -2);
  const pipe = inner.indexOf('|');
  const alias = pipe === -1 ? '' : inner.slice(pipe);
  const replaced = `![[${m.path}#${newPageName}${alias}]]`;
  return { outcome: 'ok', text: doc.slice(0, m.start) + replaced + doc.slice(m.end) };
}
