import { describe, it, expect } from 'vitest';
import { rewriteEmbedSubpath, type EmbedSpan } from '../src/model/embedLink';

/** Build the EmbedSpan for the first occurrence of `original` in `doc`. */
function spanOf(doc: string, original: string): EmbedSpan {
  const start = doc.indexOf(original);
  if (start === -1) throw new Error(`"${original}" not in doc`);
  const inner = original.slice(3, -2);
  const target = inner.split('|')[0]!;
  const hash = target.indexOf('#');
  return {
    original,
    start,
    end: start + original.length,
    path: hash === -1 ? target : target.slice(0, hash),
    subpath: hash === -1 ? undefined : target.slice(hash + 1),
  };
}

describe('rewriteEmbedSubpath', () => {
  it('appends a subpath to a link that has none', () => {
    const doc = 'before ![[a.drawio]] after';
    const r = rewriteEmbedSubpath(doc, [spanOf(doc, '![[a.drawio]]')], undefined, 'Page-3');
    expect(r).toEqual({ outcome: 'ok', text: 'before ![[a.drawio#Page-3]] after' });
  });

  it('replaces an existing subpath', () => {
    const doc = '![[a.drawio#Page-2]]';
    const r = rewriteEmbedSubpath(doc, [spanOf(doc, '![[a.drawio#Page-2]]')], 'Page-2', 'Page-3');
    expect(r).toEqual({ outcome: 'ok', text: '![[a.drawio#Page-3]]' });
  });

  it('preserves an |alias', () => {
    const doc = '![[a.drawio#Page-2|My diagram]]';
    const r = rewriteEmbedSubpath(doc, [spanOf(doc, '![[a.drawio#Page-2|My diagram]]')], 'Page-2', 'Page-3');
    expect(r).toEqual({ outcome: 'ok', text: '![[a.drawio#Page-3|My diagram]]' });
  });

  it('normalizes a leading # on the original subpath', () => {
    const doc = '![[a.drawio#Page-2]]';
    const r = rewriteEmbedSubpath(doc, [spanOf(doc, '![[a.drawio#Page-2]]')], '#Page-2', 'Page-3');
    expect(r.outcome).toBe('ok');
  });

  it('returns no-match when no candidate carries the original subpath', () => {
    const doc = '![[a.drawio#Page-2]]';
    const r = rewriteEmbedSubpath(doc, [spanOf(doc, '![[a.drawio#Page-2]]')], 'Page-9', 'Page-3');
    expect(r).toEqual({ outcome: 'no-match' });
  });

  it('returns ambiguous when several identical candidates match', () => {
    const doc = '![[a.drawio]] and ![[a.drawio]]';
    const first = spanOf(doc, '![[a.drawio]]');
    const second: EmbedSpan = { ...first, start: 18, end: 18 + first.original.length };
    const r = rewriteEmbedSubpath(doc, [first, second], undefined, 'Page-3');
    expect(r).toEqual({ outcome: 'ambiguous' });
  });

  it('distinguishes two embeds of the same file by their original subpath', () => {
    const doc = '![[a.drawio]] then ![[a.drawio#Page-2]]';
    const plain = spanOf(doc, '![[a.drawio]]');
    const paged = spanOf(doc, '![[a.drawio#Page-2]]');
    const r = rewriteEmbedSubpath(doc, [plain, paged], 'Page-2', 'Page-3');
    expect(r).toEqual({ outcome: 'ok', text: '![[a.drawio]] then ![[a.drawio#Page-3]]' });
  });

  it('rejects stale offsets instead of corrupting the note', () => {
    const doc = 'EDITED ![[a.drawio]]';
    // Span computed against the pre-edit text: offsets no longer line up.
    const stale: EmbedSpan = {
      original: '![[a.drawio]]', start: 0, end: 13, path: 'a.drawio', subpath: undefined,
    };
    const r = rewriteEmbedSubpath(doc, [stale], undefined, 'Page-3');
    expect(r).toEqual({ outcome: 'no-match' });
  });

  /** Build the EmbedSpan for a markdown-style embed occurrence in `doc`. */
  function markdownSpanOf(doc: string, original: string, path: string, subpath: string | undefined): EmbedSpan {
    const start = doc.indexOf(original);
    if (start === -1) throw new Error(`"${original}" not in doc`);
    return { original, start, end: start + original.length, path, subpath };
  }

  it('reports unsupported-link for a markdown-style embed and leaves the note untouched', () => {
    const doc = 'before ![diagram](multi.drawio) after';
    const span = markdownSpanOf(doc, '![diagram](multi.drawio)', 'multi.drawio', undefined);
    const r = rewriteEmbedSubpath(doc, [span], undefined, 'Page-3');
    expect(r).toEqual({ outcome: 'unsupported-link' });
  });

  it('reports unsupported-link for a markdown-style embed with a size suffix', () => {
    const doc = 'before ![alt|100](multi.drawio) after';
    const span = markdownSpanOf(doc, '![alt|100](multi.drawio)', 'multi.drawio', undefined);
    const r = rewriteEmbedSubpath(doc, [span], undefined, 'Page-3');
    expect(r).toEqual({ outcome: 'unsupported-link' });
  });

  it('never guesses: a wikilink and a markdown link to the same file/subpath are ambiguous', () => {
    const doc = '![[multi.drawio]] and ![diagram](multi.drawio)';
    const wikilink = spanOf(doc, '![[multi.drawio]]');
    const markdown = markdownSpanOf(doc, '![diagram](multi.drawio)', 'multi.drawio', undefined);
    const r = rewriteEmbedSubpath(doc, [wikilink, markdown], undefined, 'Page-3');
    expect(r).toEqual({ outcome: 'ambiguous' });
  });
});
