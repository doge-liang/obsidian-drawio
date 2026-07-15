import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { DualFormatFileSource } from '../src/file/DualFormatFileSource';
import { buildInitialPng, buildInitialSvg } from '../src/model/dualFormat';
import { EMPTY_DIAGRAM } from '../src/constants';
import { isExportingSource } from '../src/model/DrawioSource';

const XML = '<mxfile><diagram id="0" name="P">x</diagram></mxfile>';

function makeApp(initial: { text?: string; bytes?: Uint8Array }) {
  const box = { text: initial.text ?? '', bytes: initial.bytes ?? new Uint8Array() };
  const app = {
    vault: {
      read: async () => box.text,
      readBinary: async () => {
        const buf = new ArrayBuffer(box.bytes.byteLength);
        new Uint8Array(buf).set(box.bytes);
        return buf;
      },
      modify: async (_f: unknown, data: string) => { box.text = data; },
      modifyBinary: async (_f: unknown, data: ArrayBuffer) => { box.bytes = new Uint8Array(data); },
    },
  } as unknown as import('obsidian').App;
  return { app, box };
}

const svgFile = Object.assign(new TFile(), {
  basename: 'flow.drawio', name: 'flow.drawio.svg', path: 'flow.drawio.svg',
});
const pngFile = Object.assign(new TFile(), {
  basename: 'flow.drawio', name: 'flow.drawio.png', path: 'flow.drawio.png',
});

describe('DualFormatFileSource (svg)', () => {
  it('is an ExportingSource requesting xmlsvg', () => {
    const { app } = makeApp({ text: '' });
    const src = new DualFormatFileSource(app, svgFile, 'svg');
    expect(isExportingSource(src)).toBe(true);
    expect(src.exportFormat()).toBe('xmlsvg');
  });

  it('titles without the inner .drawio suffix', () => {
    const { app } = makeApp({ text: '' });
    expect(new DualFormatFileSource(app, svgFile, 'svg').title()).toBe('flow');
  });

  it('reads the embedded XML back out of the SVG body', async () => {
    const { app } = makeApp({ text: buildInitialSvg(XML) });
    expect(await new DualFormatFileSource(app, svgFile, 'svg').read()).toBe(XML);
  });

  it('treats an empty file as a new empty diagram', async () => {
    const { app } = makeApp({ text: '  ' });
    expect(await new DualFormatFileSource(app, svgFile, 'svg').read()).toBe(EMPTY_DIAGRAM);
  });

  it('rejects an SVG without an embedded diagram instead of clobbering it', async () => {
    const { app } = makeApp({ text: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    await expect(new DualFormatFileSource(app, svgFile, 'svg').read())
      .rejects.toThrow(/no embedded drawio diagram/);
  });

  it('persists an exported data URI as the new text body', async () => {
    const { app, box } = makeApp({ text: buildInitialSvg(XML) });
    const exported = buildInitialSvg('<mxfile>v2</mxfile>');
    const uri = `data:image/svg+xml;base64,${btoa(exported)}`;
    await new DualFormatFileSource(app, svgFile, 'svg').writeExport(uri);
    expect(box.text).toBe(exported);
  });

  it('write() falls back to swapping only the embedded XML, keeping the image body', async () => {
    const { app, box } = makeApp({ text: buildInitialSvg(XML) });
    const src = new DualFormatFileSource(app, svgFile, 'svg');
    await src.write('<mxfile>fallback</mxfile>');
    expect(await src.read()).toBe('<mxfile>fallback</mxfile>');
    expect(box.text).toContain('<svg'); // still an SVG, not a bare XML body
  });

  it('write() refuses to clobber a non-SVG body', async () => {
    const { app } = makeApp({ text: 'not an svg' });
    await expect(new DualFormatFileSource(app, svgFile, 'svg').write('<x/>'))
      .rejects.toThrow(/not a valid SVG/);
  });
});

describe('DualFormatFileSource (png)', () => {
  it('requests xmlpng and reads embedded XML from the binary body', async () => {
    const { app } = makeApp({ bytes: buildInitialPng(XML) });
    const src = new DualFormatFileSource(app, pngFile, 'png');
    expect(src.exportFormat()).toBe('xmlpng');
    expect(await src.read()).toBe(XML);
  });

  it('treats an empty file as a new empty diagram', async () => {
    const { app } = makeApp({});
    expect(await new DualFormatFileSource(app, pngFile, 'png').read()).toBe(EMPTY_DIAGRAM);
  });

  it('rejects a PNG without an embedded diagram', async () => {
    const { app } = makeApp({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1]) });
    await expect(new DualFormatFileSource(app, pngFile, 'png').read())
      .rejects.toThrow(/no embedded drawio diagram/);
  });

  it('persists an exported data URI as the new binary body', async () => {
    const { app, box } = makeApp({ bytes: buildInitialPng(XML) });
    const next = buildInitialPng('<mxfile>v2</mxfile>');
    let bin = '';
    for (const b of next) bin += String.fromCharCode(b);
    await new DualFormatFileSource(app, pngFile, 'png')
      .writeExport(`data:image/png;base64,${btoa(bin)}`);
    expect(Array.from(box.bytes)).toEqual(Array.from(next));
  });

  it('write() falls back to swapping the embedded XML inside the existing PNG', async () => {
    const { app } = makeApp({ bytes: buildInitialPng(XML) });
    const src = new DualFormatFileSource(app, pngFile, 'png');
    await src.write('<mxfile>fallback</mxfile>');
    expect(await src.read()).toBe('<mxfile>fallback</mxfile>');
  });

  it('write() refuses to clobber non-PNG bytes', async () => {
    const { app } = makeApp({ bytes: new Uint8Array([1, 2, 3, 4]) });
    await expect(new DualFormatFileSource(app, pngFile, 'png').write('<x/>'))
      .rejects.toThrow(/not a valid PNG/);
  });
});
