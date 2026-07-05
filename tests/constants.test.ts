import { describe, it, expect } from 'vitest';
import {
  buildEmbedQuery,
  EMPTY_DIAGRAM,
  ONLINE_DRAWIO_URL,
  DRAWIO_VIEW_TYPE,
  DRAWIO_FILE_EXT,
  DRAWIO_CODE_BLOCK_LANG,
} from '../src/constants';
import { isValidDrawioXml, getDiagramPages } from '../src/model/xmlUtils';

const parse = (q: string) => new URLSearchParams(q);

describe('buildEmbedQuery', () => {
  it('always sets the offline/embed base params', () => {
    // These four gate the postMessage JSON protocol and readable (uncompressed)
    // XML; regressing any of them silently breaks editing round-trips.
    const p = parse(buildEmbedQuery({ dark: false, libraries: false }));
    expect(p.get('embed')).toBe('1');
    expect(p.get('proto')).toBe('json');
    expect(p.get('spin')).toBe('1');
    expect(p.get('configure')).toBe('1');
  });

  it('omits optional params when disabled', () => {
    const p = parse(buildEmbedQuery({ dark: false, libraries: false }));
    expect(p.has('dark')).toBe(false);
    expect(p.has('libraries')).toBe(false);
  });

  it('adds libraries=1 only when libraries enabled', () => {
    const p = parse(buildEmbedQuery({ dark: false, libraries: true }));
    expect(p.get('libraries')).toBe('1');
    expect(p.has('dark')).toBe(false);
  });

  it('adds dark=1 only when dark enabled', () => {
    const p = parse(buildEmbedQuery({ dark: true, libraries: false }));
    expect(p.get('dark')).toBe('1');
    expect(p.has('libraries')).toBe(false);
  });

  it('can enable both optional params together', () => {
    const p = parse(buildEmbedQuery({ dark: true, libraries: true }));
    expect(p.get('dark')).toBe('1');
    expect(p.get('libraries')).toBe('1');
  });
});

describe('constant invariants', () => {
  it('EMPTY_DIAGRAM is valid, single-page drawio XML named Page-1', () => {
    expect(isValidDrawioXml(EMPTY_DIAGRAM)).toBe(true);
    const pages = getDiagramPages(EMPTY_DIAGRAM);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.name).toBe('Page-1');
  });

  it('ONLINE_DRAWIO_URL points at the hosted embed app over https', () => {
    expect(ONLINE_DRAWIO_URL).toBe('https://embed.diagrams.net/');
  });

  it('exposes the stable view type / extension / block-language identifiers', () => {
    expect(DRAWIO_VIEW_TYPE).toBe('drawio-file-view');
    expect(DRAWIO_FILE_EXT).toBe('drawio');
    expect(DRAWIO_CODE_BLOCK_LANG).toBe('drawio');
  });
});
