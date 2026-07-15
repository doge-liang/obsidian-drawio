import { describe, it, expect } from 'vitest';
import { registerConvertCommands } from '../src/main';
import type DrawioPlugin from '../src/main';
import { EMPTY_DIAGRAM } from '../src/constants';

const NL = '\n';

interface Pos { line: number; ch: number }
interface Command {
  id: string;
  name: string;
  checkCallback: (checking: boolean) => boolean | void;
}

/** Lets the awaited vault promises inside the command workers settle. */
const flush = () => new Promise((resolve) => { window.setTimeout(resolve, 0); });

function makeEditor(doc: string, cursorLine: number) {
  const replacements: Array<{ text: string; from: Pos; to: Pos }> = [];
  return {
    replacements,
    getValue: () => doc,
    getCursor: () => ({ line: cursorLine, ch: 0 }),
    replaceRange: (text: string, from: Pos, to: Pos) => {
      replacements.push({ text, from, to });
    },
  };
}

function makeView(editor: unknown, notePath = 'dir/Note.md', parentPath = 'dir') {
  const basename = notePath.split('/').pop()!.replace(/\.md$/, '');
  return { editor, file: { path: notePath, basename, parent: { path: parentPath } } };
}

/** Fake plugin exposing the registered commands and the vault writes. */
function makePlugin(view: unknown, vaultFiles: Map<string, string> = new Map()) {
  const commands: Command[] = [];
  const created: Array<{ path: string; data: string }> = [];
  const plugin = {
    addCommand: (c: Command) => { commands.push(c); },
    app: {
      workspace: { getActiveViewOfType: () => view },
      vault: {
        getAbstractFileByPath: (p: string) => (vaultFiles.has(p) ? {} : null),
        create: (path: string, data: string) => {
          created.push({ path, data });
          return Promise.resolve({ path });
        },
        read: (file: { path: string }) => Promise.resolve(vaultFiles.get(file.path) ?? ''),
      },
      // Returns a plain wikilink (no `!`) — the command must prepend it.
      fileManager: {
        generateMarkdownLink: (file: { path: string }) => `[[${file.path}]]`,
      },
      metadataCache: {
        getFirstLinkpathDest: (linkpath: string) =>
          vaultFiles.has(linkpath) ? { path: linkpath } : null,
      },
    },
  } as unknown as DrawioPlugin;
  registerConvertCommands(plugin);
  const byId = (id: string) => commands.find((c) => c.id === id)!;
  return { commands, created, byId };
}

describe('extract-code-block-to-file command', () => {
  const doc = ['```drawio', '<mxfile>A</mxfile>', '```', 'after'].join(NL);

  it('registers both commands with the expected ids', () => {
    const { commands } = makePlugin(null);
    expect(commands.map((c) => c.id).sort()).toEqual(
      ['extract-code-block-to-file', 'inline-embed-to-code-block']);
  });

  it('is unavailable without a markdown view or outside a drawio block', () => {
    expect(makePlugin(null).byId('extract-code-block-to-file')
      .checkCallback(true)).toBe(false);
    const editor = makeEditor(doc, 3); // cursor on 'after'
    expect(makePlugin(makeView(editor)).byId('extract-code-block-to-file')
      .checkCallback(true)).toBe(false);
  });

  it('creates the file next to the note and swaps the block for an embed', async () => {
    const editor = makeEditor(doc, 1);
    const { byId, created } = makePlugin(makeView(editor));
    expect(byId('extract-code-block-to-file').checkCallback(true)).toBe(true);
    byId('extract-code-block-to-file').checkCallback(false);
    await flush();
    expect(created).toEqual([{ path: 'dir/Note diagram.drawio', data: '<mxfile>A</mxfile>' }]);
    expect(editor.replacements).toEqual([{
      text: '![[dir/Note diagram.drawio]]',
      from: { line: 0, ch: 0 },
      to: { line: 2, ch: 3 },
    }]);
  });

  it('increments the file name when the default is taken', async () => {
    const editor = makeEditor(doc, 0);
    const { byId, created } = makePlugin(makeView(editor),
      new Map([['dir/Note diagram.drawio', '']]));
    byId('extract-code-block-to-file').checkCallback(false);
    await flush();
    expect(created[0]!.path).toBe('dir/Note diagram 2.drawio');
  });

  it('writes EMPTY_DIAGRAM for an empty block and handles root-folder notes', async () => {
    const emptyDoc = ['```drawio', '```'].join(NL);
    const editor = makeEditor(emptyDoc, 0);
    // Obsidian reports '/' as the parent path of root-level notes.
    const { byId, created } = makePlugin(makeView(editor, 'Note.md', '/'));
    byId('extract-code-block-to-file').checkCallback(false);
    await flush();
    expect(created).toEqual([{ path: 'Note diagram.drawio', data: EMPTY_DIAGRAM }]);
  });
});

describe('inline-embed-to-code-block command', () => {
  it('is unavailable on lines without a bare-.drawio embed', () => {
    const editor = makeEditor('![[a.drawio.svg]]', 0);
    expect(makePlugin(makeView(editor)).byId('inline-embed-to-code-block')
      .checkCallback(true)).toBe(false);
  });

  it('replaces the embed with a fenced block, dropping page and alias', async () => {
    const editor = makeEditor('![[d.drawio#Page-2|alias]]', 0);
    const { byId } = makePlugin(makeView(editor),
      new Map([['d.drawio', '<mxfile>X</mxfile>']]));
    expect(byId('inline-embed-to-code-block').checkCallback(true)).toBe(true);
    byId('inline-embed-to-code-block').checkCallback(false);
    await flush();
    expect(editor.replacements).toEqual([{
      text: '```drawio\n<mxfile>X</mxfile>\n```',
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: '![[d.drawio#Page-2|alias]]'.length },
    }]);
  });

  it('does not edit the note when the link resolves to no file', async () => {
    const editor = makeEditor('![[missing.drawio]]', 0);
    const { byId } = makePlugin(makeView(editor));
    byId('inline-embed-to-code-block').checkCallback(false);
    await flush();
    expect(editor.replacements).toEqual([]);
  });
});
