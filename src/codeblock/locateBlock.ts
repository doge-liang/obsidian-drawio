export interface BlockRange { start: number; end: number; } // 0-based fence line indices

const OPEN_RE = /^\s*(```+|~~~+)\s*drawio\s*$/;
const CLOSE_RE = /^\s*(```+|~~~+)\s*$/;

/** Drop a trailing CR so CRLF notes compare equal to the LF text Obsidian hands processors. */
function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Find every fenced ```drawio block whose body (joined and trimmed) equals
 * `expectedBody` (trimmed). Returns the opening/closing fence line indices of
 * each match, in document order. This is the single source of truth for the
 * drawio fence grammar — extend here, not in per-feature copies.
 */
export function locateAllDrawioBlocks(lines: string[], expectedBody: string): BlockRange[] {
  const want = expectedBody.trim();
  const matches: BlockRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!OPEN_RE.test(stripCr(lines[i] ?? ''))) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (CLOSE_RE.test(stripCr(lines[j] ?? ''))) {
        const body = lines.slice(i + 1, j).map(stripCr).join('\n').trim();
        if (body === want) matches.push({ start: i, end: j });
        i = j; // resume scanning after this block
        break;
      }
    }
  }
  return matches;
}

/**
 * Find the first fenced ```drawio block whose body (joined and trimmed) equals
 * `expectedBody` (trimmed). Returns the opening/closing fence line indices,
 * or null if no such block exists. Content-matching is robust against line
 * shifts and disambiguates multiple drawio blocks.
 */
export function locateDrawioBlock(lines: string[], expectedBody: string): BlockRange | null {
  return locateAllDrawioBlocks(lines, expectedBody)[0] ?? null;
}

/**
 * Find the fenced ```drawio block that contains `line`, counting the opening
 * and closing fence lines as inside. Same fence grammar and scan order as
 * `locateAllDrawioBlocks` above (single source of truth for fence parsing).
 * Returns null when the line is outside every block, or when the block the
 * line sits in is unterminated.
 */
export function locateDrawioBlockAtLine(lines: string[], line: number): BlockRange | null {
  for (let i = 0; i < lines.length; i++) {
    if (!OPEN_RE.test(stripCr(lines[i] ?? ''))) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (CLOSE_RE.test(stripCr(lines[j] ?? ''))) {
        if (line >= i && line <= j) return { start: i, end: j };
        i = j; // resume scanning after this block
        break;
      }
    }
  }
  return null;
}
