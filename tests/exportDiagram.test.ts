import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { Vault } from 'obsidian';
import {
  exportTargetPath, isExportableDiagram, writeExportedFile,
} from '../src/desktop/exportDiagram';

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  f.extension = dot < 0 ? '' : name.slice(dot + 1);
  f.basename = dot < 0 ? name : name.slice(0, dot);
  return f;
}

const none = () => false;

describe('isExportableDiagram', () => {
  it('accepts .drawio and both dual-format extensions', () => {
    expect(isExportableDiagram(tfile('a.drawio'))).toBe(true);
    expect(isExportableDiagram(tfile('sub/b.drawio.svg'))).toBe(true);
    expect(isExportableDiagram(tfile('sub/c.drawio.png'))).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isExportableDiagram(tfile('a.svg'))).toBe(false);
    expect(isExportableDiagram(tfile('a.png'))).toBe(false);
    expect(isExportableDiagram(tfile('note.md'))).toBe(false);
  });
});

describe('exportTargetPath', () => {
  it('drops the .drawio suffix and appends the export extension', () => {
    expect(exportTargetPath('notes/a.drawio', 'svg', none)).toBe('notes/a.svg');
    expect(exportTargetPath('notes/a.drawio', 'png', none)).toBe('notes/a.png');
  });

  it('drops the full dual-format suffix', () => {
    expect(exportTargetPath('x/b.drawio.svg', 'svg', none)).toBe('x/b.svg');
    expect(exportTargetPath('x/b.drawio.png', 'png', none)).toBe('x/b.png');
    expect(exportTargetPath('x/b.drawio.png', 'svg', none)).toBe('x/b.svg');
  });

  it('works at the vault root and matches suffixes case-insensitively', () => {
    expect(exportTargetPath('a.drawio', 'svg', none)).toBe('a.svg');
    expect(exportTargetPath('A.DRAWIO', 'png', none)).toBe('A.png');
  });

  it('numbers the name 2, 3, … when taken (same scheme as uniqueDiagramPath)', () => {
    const taken = new Set(['d/a.svg', 'd/a 2.svg']);
    expect(exportTargetPath('d/a.drawio', 'svg', (p) => taken.has(p))).toBe('d/a 3.svg');
  });
});

describe('writeExportedFile', () => {
  function fakeVault() {
    return {
      create: vi.fn(async (path: string, _data: string) => tfile(path)),
      createBinary: vi.fn(async (path: string, _data: ArrayBuffer) => tfile(path)),
    };
  }

  it('writes SVG exports as decoded text via vault.create', async () => {
    const vault = fakeVault();
    const uri = `data:image/svg+xml;base64,${btoa('<svg>x</svg>')}`;
    const created = await writeExportedFile(vault as unknown as Vault, 'a.svg', 'svg', uri);
    expect(vault.create).toHaveBeenCalledWith('a.svg', '<svg>x</svg>');
    expect(vault.createBinary).not.toHaveBeenCalled();
    expect(created.path).toBe('a.svg');
  });

  it('writes PNG exports as an independent ArrayBuffer via vault.createBinary', async () => {
    const vault = fakeVault();
    const uri = `data:image/png;base64,${btoa(String.fromCharCode(1, 2, 3))}`;
    await writeExportedFile(vault as unknown as Vault, 'a.png', 'png', uri);
    expect(vault.create).not.toHaveBeenCalled();
    const buf = vault.createBinary.mock.calls[0]![1] as ArrayBuffer;
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3]);
  });

  it('rejects on a malformed data URI without writing anything', async () => {
    const vault = fakeVault();
    await expect(writeExportedFile(vault as unknown as Vault, 'a.svg', 'svg', 'nonsense'))
      .rejects.toThrow(/data: URI/);
    expect(vault.create).not.toHaveBeenCalled();
    expect(vault.createBinary).not.toHaveBeenCalled();
  });
});
