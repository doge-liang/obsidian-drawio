import { App, MarkdownPostProcessorContext, TFile } from 'obsidian';

export const MIN_VIEWPORT_HEIGHT = 80;
export const MAX_VIEWPORT_HEIGHT = 4000;

const COMMENT_RE = /^\s*<!--\s*drawio-viewer:\s*height=(\d+)\s*-->\s*$/;
const ANY_COMMENT_RE = /^\s*<!--\s*drawio-viewer\s*:/;
const OPEN_RE = /^\s*(```+|~~~+)\s*drawio\s*$/;
const CLOSE_RE = /^\s*(```+|~~~+)\s*$/;

export function parseViewportHeightComment(line: string | undefined): number | null {
  const raw = COMMENT_RE.exec(line ?? '')?.[1];
  if (!raw) return null;
  const height = Number(raw);
  return Number.isInteger(height)
    ? clampHeight(height)
    : null;
}

export function upsertViewportHeightComment(doc: string, blockStart: number, height: number): string {
  const lines = doc.split('\n');
  const opening = lines[blockStart] ?? '';
  const indent = /^\s*/.exec(opening)?.[0] ?? '';
  const comment = `${indent}<!-- drawio-viewer: height=${clampHeight(height)} -->`;
  if (blockStart > 0 && ANY_COMMENT_RE.test(lines[blockStart - 1] ?? '')) {
    lines[blockStart - 1] = comment;
  } else {
    lines.splice(blockStart, 0, comment);
  }
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
    changed = true;
    return upsertViewportHeightComment(doc, start, height);
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
  const getInfo = (ctx as unknown as {
    getSectionInfo?: (target: HTMLElement) => { lineStart: number; lineEnd: number } | null;
  }).getSectionInfo;
  const info = getInfo?.call(ctx, el);
  if (info && blockMatches(lines, info.lineStart, info.lineEnd, source)) return info.lineStart;

  const matches: number[] = [];
  for (let start = 0; start < lines.length; start += 1) {
    if (!OPEN_RE.test(lines[start] ?? '')) continue;
    for (let end = start + 1; end < lines.length; end += 1) {
      if (!CLOSE_RE.test(lines[end] ?? '')) continue;
      if (blockMatches(lines, start, end, source)) matches.push(start);
      start = end;
      break;
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}

function blockMatches(lines: string[], start: number, end: number, source: string): boolean {
  return OPEN_RE.test(lines[start] ?? '')
    && CLOSE_RE.test(lines[end] ?? '')
    && lines.slice(start + 1, end).join('\n').trim() === source.trim();
}

function clampHeight(height: number): number {
  return Math.round(Math.min(MAX_VIEWPORT_HEIGHT, Math.max(MIN_VIEWPORT_HEIGHT, height)));
}
