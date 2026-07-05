import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { FileSource } from '../src/file/FileSource';
import { CodeBlockSource } from '../src/codeblock/CodeBlockSource';

// --- FileSource ---------------------------------------------------------------

function makeFileApp(initial: string) {
  const box = { xml: initial };
  const app = {
    vault: {
      read: async (_f: unknown) => box.xml,
      modify: async (_f: unknown, data: string) => {
        box.xml = data;
      },
    },
  } as unknown as import('obsidian').App;
  return { app, box };
}

describe('FileSource', () => {
  const file = Object.assign(new TFile(), { basename: 'diagram', path: 'diagram.drawio' });

  it('titles the modal with the file basename', () => {
    const { app } = makeFileApp('<init/>');
    expect(new FileSource(app, file).title()).toBe('diagram');
  });

  it('reads the current file contents verbatim', async () => {
    const { app } = makeFileApp('<mxfile>A</mxfile>');
    expect(await new FileSource(app, file).read()).toBe('<mxfile>A</mxfile>');
  });

  it('writes XML straight through to the vault (files store raw XML)', async () => {
    const { app, box } = makeFileApp('<init/>');
    const src = new FileSource(app, file);
    await src.write('<mxfile>B</mxfile>');
    expect(box.xml).toBe('<mxfile>B</mxfile>');
    expect(await src.read()).toBe('<mxfile>B</mxfile>');
  });
});

// --- CodeBlockSource ----------------------------------------------------------

const NOTE = ['# t', '```drawio', '<mxfile>A</mxfile>', '```', 'end'].join('\n');

function makeBlockApp(noteText: string, file: unknown) {
  const box = { modified: '' as string };
  const app = {
    vault: {
      getAbstractFileByPath: (_p: string) => file,
      read: async (_f: unknown) => noteText,
      modify: async (_f: unknown, data: string) => {
        box.modified = data;
      },
    },
  } as unknown as import('obsidian').App;
  return { app, box };
}

const ctx = (over: Partial<Record<string, unknown>> = {}) =>
  ({ sourcePath: 'note.md', getSectionInfo: () => null, ...over }) as unknown as import(
    'obsidian'
  ).MarkdownPostProcessorContext;

describe('CodeBlockSource', () => {
  it('reads back the trimmed initial block body', async () => {
    const file = Object.assign(new TFile(), { path: 'note.md' });
    const { app } = makeBlockApp(NOTE, file);
    const src = new CodeBlockSource(app, ctx(), document.createElement('div'), '  <mxfile>A</mxfile>  ');
    expect(await src.read()).toBe('<mxfile>A</mxfile>');
  });

  it('rewrites the matching block in the note and updates its cached body', async () => {
    const file = Object.assign(new TFile(), { path: 'note.md' });
    const { app, box } = makeBlockApp(NOTE, file);
    const src = new CodeBlockSource(app, ctx(), document.createElement('div'), '<mxfile>A</mxfile>');
    await src.write('<mxfile>B</mxfile>');
    expect(box.modified).toContain('```drawio');
    expect(box.modified).toContain('B');
    expect(box.modified).not.toContain('<mxfile>A</mxfile>');
    expect(await src.read()).toContain('B');
  });

  it('throws when the source note no longer exists', async () => {
    const { app } = makeBlockApp(NOTE, null); // getAbstractFileByPath -> null
    const src = new CodeBlockSource(app, ctx(), document.createElement('div'), '<mxfile>A</mxfile>');
    await expect(src.write('<x/>')).rejects.toThrow(/source note not found/);
  });

  it('throws when the block cannot be located and there is no section info', async () => {
    const file = Object.assign(new TFile(), { path: 'note.md' });
    const { app } = makeBlockApp('# a note with no drawio block\n', file);
    const src = new CodeBlockSource(app, ctx(), document.createElement('div'), '<mxfile>MISSING</mxfile>');
    await expect(src.write('<x/>')).rejects.toThrow(/cannot locate code block/);
  });
});
