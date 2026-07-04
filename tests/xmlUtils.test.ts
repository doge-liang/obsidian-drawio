import { describe, it, expect } from 'vitest';
import { isValidDrawioXml, ensureMxfile, extractDiagramTitle, getDiagramPages, resolvePageFromSubpath } from '../src/model/xmlUtils';

describe('xmlUtils', () => {
  it('accepts a valid mxfile', () => {
    expect(isValidDrawioXml('<mxfile><diagram>x</diagram></mxfile>')).toBe(true);
  });
  it('accepts a bare mxGraphModel', () => {
    expect(isValidDrawioXml('<mxGraphModel><root/></mxGraphModel>')).toBe(true);
  });
  it('rejects empty or non-xml', () => {
    expect(isValidDrawioXml('')).toBe(false);
    expect(isValidDrawioXml('not xml')).toBe(false);
  });
  it('wraps a bare mxGraphModel into an mxfile', () => {
    const out = ensureMxfile('<mxGraphModel><root/></mxGraphModel>');
    expect(out.startsWith('<mxfile')).toBe(true);
    expect(out).toContain('<mxGraphModel>');
  });
  it('leaves an existing mxfile unchanged', () => {
    const src = '<mxfile><diagram>x</diagram></mxfile>';
    expect(ensureMxfile(src)).toBe(src);
  });
  it('extracts a diagram name attribute', () => {
    const src = '<mxfile><diagram name="Flow">x</diagram></mxfile>';
    expect(extractDiagramTitle(src)).toBe('Flow');
  });
  it('returns null title when absent', () => {
    expect(extractDiagramTitle('<mxfile><diagram>x</diagram></mxfile>')).toBeNull();
  });
});

describe('getDiagramPages', () => {
  it('returns one page for a single-diagram mxfile', () => {
    const xml = '<mxfile><diagram id="0" name="Page-1">x</diagram></mxfile>';
    expect(getDiagramPages(xml)).toEqual([{ id: '0', name: 'Page-1' }]);
  });

  it('returns all pages in document order for a multi-page mxfile', () => {
    const xml = '<mxfile>' +
      '<diagram id="a" name="Overview">x</diagram>' +
      '<diagram id="b" name="Details">y</diagram>' +
      '</mxfile>';
    expect(getDiagramPages(xml)).toEqual([
      { id: 'a', name: 'Overview' },
      { id: 'b', name: 'Details' },
    ]);
  });

  it('falls back to a generated id/name when attributes are missing', () => {
    const xml = '<mxfile><diagram>x</diagram></mxfile>';
    expect(getDiagramPages(xml)).toEqual([{ id: '0', name: 'Page-1' }]);
  });

  it('returns an empty array for a bare mxGraphModel with no diagram tags', () => {
    expect(getDiagramPages('<mxGraphModel><root/></mxGraphModel>')).toEqual([]);
  });

  it('does not leak regex lastIndex state across calls', () => {
    const longXml = '<mxfile>' +
      '<diagram id="a" name="A">x</diagram>' +
      '<diagram id="b" name="B">y</diagram>' +
      '<diagram id="c" name="C">z</diagram>' +
      '</mxfile>';
    const shortXml = '<mxfile><diagram id="a" name="A">x</diagram></mxfile>';
    getDiagramPages(longXml);
    expect(getDiagramPages(shortXml)).toEqual([{ id: 'a', name: 'A' }]);
  });
});

describe('resolvePageFromSubpath', () => {
  const pages = [{ id: '0', name: 'Page-1' }, { id: '1', name: 'Page-2' }];

  it('returns 0 when there is no subpath', () => {
    expect(resolvePageFromSubpath(pages, undefined)).toBe(0);
    expect(resolvePageFromSubpath(pages, null)).toBe(0);
    expect(resolvePageFromSubpath(pages, '')).toBe(0);
  });

  it('matches a page by name, with or without a leading #', () => {
    expect(resolvePageFromSubpath(pages, 'Page-2')).toBe(1);
    expect(resolvePageFromSubpath(pages, '#Page-2')).toBe(1);
  });

  it('falls back to 0 when no page name matches', () => {
    expect(resolvePageFromSubpath(pages, 'Nope')).toBe(0);
  });
});
