import { App, MarkdownPostProcessorContext, parseLinktext, TFile } from 'obsidian';
import { parseViewportHeightComment, upsertViewportHeightComment } from './viewportHeight';

export type EmbedHeightWriteOutcome = 'written' | 'no-match' | 'ambiguous';

interface EmbedCacheItem {
  link: string;
  original: string;
  position: { start: { offset: number }; end: { offset: number } };
}

interface LocatedEmbed {
  item: EmbedCacheItem;
  allItems: EmbedCacheItem[];
}

export async function readEmbedViewportHeight(
  app: App,
  sourcePath: string,
  targetFile: TFile,
  subpath?: string,
  ctx?: MarkdownPostProcessorContext,
  el?: HTMLElement,
  occurrence?: number,
  sourceOffset?: number,
): Promise<number | null> {
  const note = app.vault.getAbstractFileByPath(sourcePath);
  if (!(note instanceof TFile)) return null;
  const doc = await app.vault.cachedRead(note);
  const located = locateEmbed(
    app, sourcePath, targetFile, subpath, doc, ctx, el, occurrence, sourceOffset,
  );
  if (located.outcome !== 'found') return null;
  const offset = resolveCurrentOffset(doc, located.value);
  if (offset === null) return null;
  const line = lineAtOffset(doc, offset);
  return parseViewportHeightComment(doc.split('\n')[line - 1]);
}

export async function writeEmbedViewportHeight(
  app: App,
  sourcePath: string,
  targetFile: TFile,
  subpath: string | undefined,
  height: number,
  ctx?: MarkdownPostProcessorContext,
  el?: HTMLElement,
  occurrence?: number,
  sourceOffset?: number,
): Promise<EmbedHeightWriteOutcome> {
  const note = app.vault.getAbstractFileByPath(sourcePath);
  if (!(note instanceof TFile)) return 'no-match';
  const snapshot = await app.vault.cachedRead(note);
  const located = locateEmbed(
    app, sourcePath, targetFile, subpath, snapshot, ctx, el, occurrence, sourceOffset,
  );
  if (located.outcome !== 'found') return located.outcome;
  let written = false;
  await app.vault.process(note, (doc) => {
    const offset = resolveCurrentOffset(doc, located.value);
    if (offset === null) return doc;
    written = true;
    return upsertViewportHeightComment(doc, lineAtOffset(doc, offset), height);
  });
  return written ? 'written' : 'no-match';
}

function locateEmbed(
  app: App,
  sourcePath: string,
  targetFile: TFile,
  subpath: string | undefined,
  doc: string,
  ctx?: MarkdownPostProcessorContext,
  el?: HTMLElement,
  occurrence?: number,
  sourceOffset?: number,
): { outcome: 'found'; value: LocatedEmbed } | { outcome: 'no-match' | 'ambiguous' } {
  const embeds = (app.metadataCache.getCache(sourcePath)?.embeds ?? []) as EmbedCacheItem[];
  const expectedSubpath = normalizeSubpath(subpath);
  const candidates = embeds.filter((item) => {
    const parsed = parseLinktext(sourceLinktext(item));
    const dest = app.metadataCache.getFirstLinkpathDest(parsed.path, sourcePath);
    return dest?.path === targetFile.path && normalizeSubpath(parsed.subpath) === expectedSubpath;
  });
  if (candidates.length === 0) return { outcome: 'no-match' };

  if (sourceOffset !== undefined) {
    const atPosition = candidates.filter((item) =>
      sourceOffset >= item.position.start.offset && sourceOffset <= item.position.end.offset);
    if (atPosition.length === 1) {
      return { outcome: 'found', value: { item: atPosition[0]!, allItems: embeds } };
    }
  }

  const info = ctx && el ? ctx.getSectionInfo(el) : null;
  if (info) {
    const inSection = candidates.filter((item) => {
      const offset = resolveCurrentOffset(doc, { item, allItems: embeds });
      if (offset === null) return false;
      const line = lineAtOffset(doc, offset);
      return line >= info.lineStart && line <= info.lineEnd;
    });
    if (inSection.length === 1) {
      return { outcome: 'found', value: { item: inSection[0]!, allItems: embeds } };
    }
  }

  if (occurrence !== undefined && candidates[occurrence]) {
    return { outcome: 'found', value: { item: candidates[occurrence]!, allItems: embeds } };
  }

  return candidates.length === 1
    ? { outcome: 'found', value: { item: candidates[0]!, allItems: embeds } }
    : { outcome: 'ambiguous' };
}

function sourceLinktext(item: EmbedCacheItem): string {
  const match = /^!\[\[([\s\S]*?)\]\]$/.exec(item.original.trim());
  if (!match) return item.link;
  return match[1]!.split('|', 1)[0]!.trim();
}

function resolveCurrentOffset(doc: string, located: LocatedEmbed): number | null {
  const { item, allItems } = located;
  const start = item.position.start.offset;
  if (doc.slice(start, start + item.original.length) === item.original) return start;

  const peers = allItems.filter((candidate) => candidate.original === item.original);
  const ordinal = peers.indexOf(item);
  const occurrences: number[] = [];
  let from = 0;
  while (from <= doc.length) {
    const found = doc.indexOf(item.original, from);
    if (found === -1) break;
    occurrences.push(found);
    from = found + item.original.length;
  }
  return ordinal >= 0 && occurrences.length === peers.length
    ? occurrences[ordinal] ?? null
    : occurrences.length === 1 ? occurrences[0]! : null;
}

function normalizeSubpath(subpath: string | undefined | null): string {
  if (!subpath) return '';
  return subpath.startsWith('#') ? subpath : `#${subpath}`;
}

function lineAtOffset(doc: string, offset: number): number {
  let line = 0;
  for (let index = 0; index < offset; index += 1) {
    if (doc.charCodeAt(index) === 10) line += 1;
  }
  return line;
}
