import { locateDrawioBlockAtLine } from '../codeblock/locateBlock';
import { EMPTY_DIAGRAM } from '../constants';

/** 0-based editor position, structurally compatible with Obsidian's EditorPosition. */
export interface Pos { line: number; ch: number }

/** A half-open-in-spirit editor range: replace everything from `from` to `to`. */
export interface Range { from: Pos; to: Pos }

// --------------------------------------------------------------------------
// Direction 1: ```drawio code block → standalone .drawio file
// --------------------------------------------------------------------------

export interface BlockExtraction {
  /** The whole fenced block: start of the opening-fence line through the end
   * of the closing-fence line. */
  range: Range;
  /** The block body exactly as written (used to re-locate the block by
   * content if the note changed while the file was being created). */
  body: string;
  /** Payload for the new .drawio file: the body verbatim (no reformatting),
   * or EMPTY_DIAGRAM when the body is empty/whitespace-only. */
  fileContent: string;
}

/**
 * Find the ```drawio block containing `cursorLine` — the opening and closing
 * fence lines count as inside. Pure: full note text in, replacement range and
 * new-file payload out; null when the cursor is not inside a drawio block.
 * Fence parsing is `locateDrawioBlockAtLine`'s (see codeblock/locateBlock.ts).
 */
export function findBlockExtraction(doc: string, cursorLine: number): BlockExtraction | null {
  const lines = doc.split('\n');
  const block = locateDrawioBlockAtLine(lines, cursorLine);
  if (!block) return null;
  const body = lines.slice(block.start + 1, block.end).join('\n');
  return {
    range: {
      from: { line: block.start, ch: 0 },
      to: { line: block.end, ch: (lines[block.end] ?? '').length },
    },
    body,
    fileContent: body.trim() === '' ? EMPTY_DIAGRAM : body,
  };
}

/**
 * First free `<noteBasename> diagram.drawio` path in `folder` ('' = vault
 * root); when taken, `<noteBasename> diagram 2.drawio`, ` 3`, … `exists`
 * abstracts the vault lookup so this stays pure.
 */
export function uniqueDiagramPath(
  folder: string,
  noteBasename: string,
  exists: (path: string) => boolean,
): string {
  const prefix = (folder ? `${folder}/` : '') + `${noteBasename} diagram`;
  for (let n = 1; ; n++) {
    const path = `${prefix}${n === 1 ? '' : ` ${n}`}.drawio`;
    if (!exists(path)) return path;
  }
}

// --------------------------------------------------------------------------
// Direction 2: ![[x.drawio]] embed → ```drawio code block
// --------------------------------------------------------------------------

/** First `![[….drawio…]]` wikilink embed on a line: optional `#subpath`
 * (e.g. `#Page-2`) and `|alias`, both discarded by the conversion. Only the
 * bare `.drawio` extension qualifies — `.drawio.svg`/`.drawio.png` embeds are
 * images, not diagram sources. No lookbehind / named groups / `\p{…}`: an
 * unsupported regex literal crashes plugin load on mobile at parse time (see
 * CLAUDE.md's regex checklist). */
const EMBED_RE = /!\[\[\s*([^\][#|]+\.drawio)\s*(#[^\]|]*)?(\|[^\]]*)?\]\]/;

export interface EmbedConversion {
  /** Exactly the embed markup's span on its line. */
  range: Range;
  /** Link path with subpath/alias dropped, e.g. `sub/x.drawio`. */
  linkpath: string;
  /** Whether other non-whitespace text precedes/follows the embed on its line
   * (a fenced block needs its own lines — see buildBlockReplacementText). */
  hasTextBefore: boolean;
  hasTextAfter: boolean;
}

/**
 * Find the first .drawio wikilink embed on `cursorLine`. Pure: full note text
 * in, the embed's range + link path out; null when the line has none. When a
 * line holds several embeds only the first is converted.
 */
export function findEmbedConversion(doc: string, cursorLine: number): EmbedConversion | null {
  const line = doc.split('\n')[cursorLine];
  if (line === undefined) return null;
  const m = EMBED_RE.exec(line);
  if (!m) return null;
  const start = m.index;
  const end = start + m[0].length;
  return {
    range: { from: { line: cursorLine, ch: start }, to: { line: cursorLine, ch: end } },
    linkpath: (m[1] ?? '').trim(),
    hasTextBefore: line.slice(0, start).trim() !== '',
    hasTextAfter: line.slice(end).trim() !== '',
  };
}

/**
 * The fenced-block text that replaces the embed markup. Newline-padded on
 * whichever side the embed shared its line with other text, so both fences
 * always start at a line beginning. Line endings are normalized to `\n` and
 * trailing whitespace trimmed so the closing fence sits on its own line; the
 * XML itself is otherwise written verbatim.
 */
export function buildBlockReplacementText(xml: string, conv: EmbedConversion): string {
  const body = xml.split('\r\n').join('\n').split('\r').join('\n').trimEnd();
  const block = body === '' ? '```drawio\n```' : '```drawio\n' + body + '\n```';
  return (conv.hasTextBefore ? '\n' : '') + block + (conv.hasTextAfter ? '\n' : '');
}
