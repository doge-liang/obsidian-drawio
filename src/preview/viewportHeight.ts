import { App, MarkdownPostProcessorContext, TFile } from 'obsidian';
import { locateAllDrawioBlocks } from '../codeblock/locateBlock';

export const MIN_VIEWPORT_HEIGHT = 80;
export const MAX_VIEWPORT_HEIGHT = 4000;

// A `[\s>]*` prefix accepts the comment inside callouts/blockquotes (`> `,
// nested `> > `), where the writer below reproduces the quote markers.
const COMMENT_RE = /^[\s>]*<!--\s*drawio-viewer:\s*height=(\d+)\s*-->\s*$/;
const ANY_COMMENT_RE = /^[\s>]*<!--\s*drawio-viewer\s*:/;
/** Leading indentation and blockquote markers of a Markdown line. */
const LINE_PREFIX_RE = /^[ \t]*(?:>[ \t]*)*/;
/** Bullet / ordered-list markers — inserting a bare comment line above these restructures the list. */
const LIST_MARKER_RE = /^(?:[-*+]|\d{1,9}[.)])\s/;

export function parseViewportHeightComment(line: string | undefined): number | null {
  const raw = COMMENT_RE.exec(line ?? '')?.[1];
  if (!raw) return null;
  const height = Number(raw);
  return Number.isInteger(height)
    ? clampHeight(height)
    : null;
}

/**
 * Insert (or update in place) the `<!-- drawio-viewer: height=N -->` line
 * right above the block/embed starting at `blockStart`.
 *
 * The inserted line reproduces the anchor line's blockquote/indentation
 * prefix so a diagram inside a callout keeps its callout intact. When the
 * anchor sits where a bare inserted line would corrupt the surrounding
 * structure — a table row or directly on a list-item marker — the write is
 * refused (`null`): not persisting the height is always preferable to
 * damaging the note.
 */
export function upsertViewportHeightComment(
  doc: string,
  blockStart: number,
  height: number,
): string | null {
  const lines = doc.split('\n');
  const anchor = stripCr(lines[blockStart] ?? '');
  const prefix = LINE_PREFIX_RE.exec(anchor)?.[0] ?? '';
  const comment = `${prefix}<!-- drawio-viewer: height=${clampHeight(height)} -->`;
  const previous = lines[blockStart - 1];
  if (blockStart > 0 && ANY_COMMENT_RE.test(stripCr(previous ?? ''))) {
    // Updating the existing comment line never changes the note's structure.
    lines[blockStart - 1] = comment + trailingCr(previous ?? '');
    return lines.join('\n');
  }
  const rest = anchor.slice(prefix.length);
  if (rest.startsWith('|') || LIST_MARKER_RE.test(rest)) return null;
  lines.splice(blockStart, 0, comment + trailingCr(lines[blockStart] ?? ''));
  return lines.join('\n');
}

export async function readCodeBlockViewportHeight(
  app: App,
  ctx: MarkdownPostProcessorContext,
  el: HTMLElement,
  source: string,
): Promise<number | null> {
  const file = app.vault?.getAbstractFileByPath?.(ctx.sourcePath);
  if (!(file instanceof TFile)) return null;
  const doc = await app.vault.cachedRead(file);
  const start = resolveBlockStart(doc, ctx, el, source);
  return start === null ? null : parseViewportHeightComment(doc.split('\n')[start - 1]);
}

export async function writeCodeBlockViewportHeight(
  app: App,
  ctx: MarkdownPostProcessorContext,
  el: HTMLElement,
  source: string,
  height: number,
): Promise<boolean> {
  const file = app.vault?.getAbstractFileByPath?.(ctx.sourcePath);
  if (!(file instanceof TFile)) return false;
  let changed = false;
  await app.vault.process(file, (doc) => {
    const start = resolveBlockStart(doc, ctx, el, source);
    if (start === null) return doc;
    const updated = upsertViewportHeightComment(doc, start, height);
    if (updated === null) return doc;
    changed = true;
    return updated;
  });
  return changed;
}

function resolveBlockStart(
  doc: string,
  ctx: MarkdownPostProcessorContext,
  el: HTMLElement,
  source: string,
): number | null {
  const lines = doc.split('\n');
  const matches = locateAllDrawioBlocks(lines, source);
  const info = ctx.getSectionInfo(el);
  if (info && matches.some((match) => match.start === info.lineStart)) return info.lineStart;
  return matches.length === 1 ? matches[0]!.start : null;
}

function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** The CR to give an inserted line so CRLF notes stay uniformly CRLF. */
function trailingCr(neighborLine: string): string {
  return neighborLine.endsWith('\r') ? '\r' : '';
}

function clampHeight(height: number): number {
  return Math.round(Math.min(MAX_VIEWPORT_HEIGHT, Math.max(MIN_VIEWPORT_HEIGHT, height)));
}
