import { describe, it, expect } from 'vitest';
import {
  findBlockExtraction, uniqueDiagramPath,
  findEmbedConversion, buildBlockReplacementText,
} from '../src/model/blockFileConvert';
import { EMPTY_DIAGRAM } from '../src/constants';

const NL = '\n';

describe('findBlockExtraction', () => {
  const doc = ['# Note', '', '```drawio', '<mxfile>A</mxfile>', '```', '', 'after'].join(NL);

  it('finds the block when the cursor is on a body line', () => {
    const plan = findBlockExtraction(doc, 3);
    expect(plan).not.toBeNull();
    expect(plan!.range.from).toEqual({ line: 2, ch: 0 });
    expect(plan!.range.to).toEqual({ line: 4, ch: 3 }); // '```'.length
    expect(plan!.fileContent).toBe('<mxfile>A</mxfile>');
    expect(plan!.body).toBe('<mxfile>A</mxfile>');
  });

  it('finds the block when the cursor is on the opening fence line', () => {
    expect(findBlockExtraction(doc, 2)).not.toBeNull();
  });

  it('finds the block when the cursor is on the closing fence line', () => {
    expect(findBlockExtraction(doc, 4)).not.toBeNull();
  });

  it('returns null when the cursor is outside the block', () => {
    expect(findBlockExtraction(doc, 0)).toBeNull();
    expect(findBlockExtraction(doc, 1)).toBeNull();
    expect(findBlockExtraction(doc, 5)).toBeNull();
    expect(findBlockExtraction(doc, 6)).toBeNull();
  });

  it('returns null inside an unterminated block', () => {
    const open = ['```drawio', '<mxfile/>'].join(NL);
    expect(findBlockExtraction(open, 1)).toBeNull();
  });

  it('returns null for a non-drawio code block', () => {
    const js = ['```js', 'x()', '```'].join(NL);
    expect(findBlockExtraction(js, 1)).toBeNull();
  });

  it('uses EMPTY_DIAGRAM for an empty or whitespace-only body', () => {
    const empty = ['```drawio', '```'].join(NL);
    expect(findBlockExtraction(empty, 0)!.fileContent).toBe(EMPTY_DIAGRAM);
    const blank = ['```drawio', '   ', '', '```'].join(NL);
    expect(findBlockExtraction(blank, 1)!.fileContent).toBe(EMPTY_DIAGRAM);
  });

  it('keeps a multi-line body verbatim (no reformatting)', () => {
    const body = ['<mxfile>', '  <diagram/>', '</mxfile>'];
    const doc2 = ['```drawio', ...body, '```'].join(NL);
    expect(findBlockExtraction(doc2, 2)!.fileContent).toBe(body.join(NL));
  });

  it('picks the block the cursor is in when several exist', () => {
    const two = ['```drawio', 'A', '```', '', '```drawio', 'B', '```'].join(NL);
    expect(findBlockExtraction(two, 5)!.fileContent).toBe('B');
    expect(findBlockExtraction(two, 5)!.range.from.line).toBe(4);
  });
});

describe('uniqueDiagramPath', () => {
  it('uses "<basename> diagram.drawio" when free', () => {
    expect(uniqueDiagramPath('', 'Note', () => false)).toBe('Note diagram.drawio');
  });

  it('prefixes the folder', () => {
    expect(uniqueDiagramPath('sub/dir', 'Note', () => false))
      .toBe('sub/dir/Note diagram.drawio');
  });

  it('increments " 2", " 3", … while taken', () => {
    const taken = new Set(['Note diagram.drawio', 'Note diagram 2.drawio']);
    expect(uniqueDiagramPath('', 'Note', (p) => taken.has(p)))
      .toBe('Note diagram 3.drawio');
  });
});

describe('findEmbedConversion', () => {
  it('matches a plain .drawio embed and reports its exact span', () => {
    const doc = ['before', '![[a.drawio]]'].join(NL);
    const conv = findEmbedConversion(doc, 1);
    expect(conv).not.toBeNull();
    expect(conv!.linkpath).toBe('a.drawio');
    expect(conv!.range).toEqual({
      from: { line: 1, ch: 0 }, to: { line: 1, ch: '![[a.drawio]]'.length },
    });
    expect(conv!.hasTextBefore).toBe(false);
    expect(conv!.hasTextAfter).toBe(false);
  });

  it('matches with a #Page subpath and drops it from linkpath', () => {
    const conv = findEmbedConversion('![[a.drawio#Page-2]]', 0);
    expect(conv!.linkpath).toBe('a.drawio');
    expect(conv!.range.to.ch).toBe('![[a.drawio#Page-2]]'.length);
  });

  it('matches with an |alias, and with both subpath and alias', () => {
    expect(findEmbedConversion('![[a.drawio|nice name]]', 0)!.linkpath).toBe('a.drawio');
    expect(findEmbedConversion('![[sub/a.drawio#Page-3|x]]', 0)!.linkpath).toBe('sub/a.drawio');
  });

  it('does not match .drawio.svg or .drawio.png embeds', () => {
    expect(findEmbedConversion('![[a.drawio.svg]]', 0)).toBeNull();
    expect(findEmbedConversion('![[a.drawio.png]]', 0)).toBeNull();
  });

  it('does not match non-embeds or other lines', () => {
    expect(findEmbedConversion('[[a.drawio]]', 0)).toBeNull(); // link, not embed
    expect(findEmbedConversion('plain text', 0)).toBeNull();
    expect(findEmbedConversion('![[a.drawio]]', 1)).toBeNull(); // cursor on another line
  });

  it('takes the first match when a line has several embeds', () => {
    const line = '![[a.drawio]] and ![[b.drawio]]';
    expect(findEmbedConversion(line, 0)!.linkpath).toBe('a.drawio');
  });

  it('skips a leading .drawio.svg embed and takes the later .drawio one', () => {
    const line = '![[img.drawio.svg]] then ![[real.drawio]]';
    const conv = findEmbedConversion(line, 0);
    expect(conv!.linkpath).toBe('real.drawio');
    expect(conv!.hasTextBefore).toBe(true);
  });

  it('flags surrounding text on the line', () => {
    const conv = findEmbedConversion('see ![[a.drawio]] here', 0);
    expect(conv!.hasTextBefore).toBe(true);
    expect(conv!.hasTextAfter).toBe(true);
  });
});

describe('buildBlockReplacementText', () => {
  const bare = { hasTextBefore: false, hasTextAfter: false };
  const conv = (over: Partial<typeof bare>) => ({
    range: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 1 } },
    linkpath: 'a.drawio',
    ...bare,
    ...over,
  });

  it('wraps the XML in a drawio fence', () => {
    expect(buildBlockReplacementText('<mxfile/>', conv({})))
      .toBe('```drawio\n<mxfile/>\n```');
  });

  it('pads with newlines when the embed shares its line with text', () => {
    expect(buildBlockReplacementText('<x/>', conv({ hasTextBefore: true })))
      .toBe('\n```drawio\n<x/>\n```');
    expect(buildBlockReplacementText('<x/>', conv({ hasTextAfter: true })))
      .toBe('```drawio\n<x/>\n```\n');
  });

  it('normalizes CRLF and trims trailing whitespace so the closing fence is alone', () => {
    expect(buildBlockReplacementText('<a/>\r\n<b/>\r\n', conv({})))
      .toBe('```drawio\n<a/>\n<b/>\n```');
  });

  it('produces an empty block for an empty file', () => {
    expect(buildBlockReplacementText('', conv({}))).toBe('```drawio\n```');
  });
});
