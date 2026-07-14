import { describe, it, expect } from 'vitest';
import {
  base64ToBytes, buildInitialPng, buildInitialSvg, decodeDataUri,
  dualFormatOf, extractXmlFromPng, extractXmlFromSvg,
} from '../src/model/dualFormat';

const XML = '<mxfile><diagram id="0" name="Page-1">A &amp; B "quoted" <x/></diagram></mxfile>';

describe('dualFormatOf', () => {
  it('detects both formats case-insensitively', () => {
    expect(dualFormatOf('a.drawio.svg')).toBe('svg');
    expect(dualFormatOf('dir/b.DRAWIO.PNG')).toBe('png');
  });

  it('rejects plain .drawio, bare images, and inner-only matches', () => {
    expect(dualFormatOf('a.drawio')).toBeNull();
    expect(dualFormatOf('a.svg')).toBeNull();
    expect(dualFormatOf('a.png')).toBeNull();
    expect(dualFormatOf('a.drawio.svg.md')).toBeNull();
    expect(dualFormatOf('drawio.svg')).toBeNull(); // no stem before ".drawio"? — suffix match is enough
  });
});

describe('SVG embedding', () => {
  it('round-trips XML through the content attribute, preserving entities', () => {
    const svg = buildInitialSvg(XML);
    expect(extractXmlFromSvg(svg)).toBe(XML);
  });

  it('returns null for an SVG without embedded content and for non-SVG text', () => {
    expect(extractXmlFromSvg('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBeNull();
    expect(extractXmlFromSvg('not xml at all')).toBeNull();
  });
});

describe('PNG embedding', () => {
  it('round-trips XML through a tEXt chunk', () => {
    const png = buildInitialPng(XML);
    expect(extractXmlFromPng(png)).toBe(XML);
    expect(extractXmlFromPng(png.buffer as ArrayBuffer)).toBe(XML);
  });

  it('keeps the PNG structurally valid: signature intact, tEXt before IEND', () => {
    const png = buildInitialPng(XML);
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const tail = png.subarray(png.length - 8, png.length - 4);
    expect(String.fromCharCode(...tail)).toBe('IEND');
  });

  it('returns null for a PNG without the mxfile chunk and for non-PNG bytes', () => {
    expect(extractXmlFromPng(base64ToBytes(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    ))).toBeNull();
    expect(extractXmlFromPng(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('decodeDataUri', () => {
  it('decodes base64 payloads to bytes', () => {
    const uri = `data:image/png;base64,${btoa('hello')}`;
    expect(new TextDecoder().decode(decodeDataUri(uri))).toBe('hello');
  });

  it('decodes percent-encoded payloads', () => {
    const uri = `data:image/svg+xml,${encodeURIComponent('<svg a="1"/>')}`;
    expect(new TextDecoder().decode(decodeDataUri(uri))).toBe('<svg a="1"/>');
  });

  it('throws on non-data URIs', () => {
    expect(() => decodeDataUri('https://example.com/x.png')).toThrow();
  });
});
