import { describe, it, expect, vi, afterEach } from 'vitest';
import { Notice, TFile, TFolder } from 'obsidian';
import type { Editor, MarkdownFileInfo } from 'obsidian';
import type DrawioPlugin from '../src/main';
import { DEFAULT_SETTINGS } from '../src/settings';
import { createAndInsertDiagram, createNewDiagram, resolveNewDiagramFolder } from '../src/file/createDiagram';
import { EMPTY_DIAGRAM } from '../src/constants';
import { extractXmlFromPng, extractXmlFromSvg } from '../src/model/dualFormat';

vi.mock('obsidian', async (importOriginal) => {
  const orig = await importOriginal<typeof import('obsidian')>();
  return { ...orig, Notice: vi.fn() };
});

afterEach(() => { vi.clearAllMocks(); });

const settings = (location: 'root' | 'current' | 'folder', folder = '') =>
  ({ newDiagramLocation: location, newDiagramFolder: folder });

describe('resolveNewDiagramFolder', () => {
  it('root mode always resolves to the vault root', () => {
    expect(resolveNewDiagramFolder(settings('root'), 'Notes/Daily')).toBe('');
    expect(resolveNewDiagramFolder(settings('root', 'Diagrams'), null)).toBe('');
  });

  it('current mode uses the active file parent', () => {
    expect(resolveNewDiagramFolder(settings('current'), 'Notes/Daily')).toBe('Notes/Daily');
  });

  it('current mode falls back to root when there is no active file', () => {
    expect(resolveNewDiagramFolder(settings('current'), null)).toBe('');
  });

  it('current mode treats the root folder path "/" as root', () => {
    expect(resolveNewDiagramFolder(settings('current'), '/')).toBe('');
  });

  it('folder mode uses the configured folder', () => {
    expect(resolveNewDiagramFolder(settings('folder', 'Diagrams'), 'Notes')).toBe('Diagrams');
  });

  it('folder mode with an empty setting resolves to root', () => {
    expect(resolveNewDiagramFolder(settings('folder', ''), 'Notes')).toBe('');
    expect(resolveNewDiagramFolder(settings('folder', '   '), 'Notes')).toBe('');
  });

  it('normalizes slashes and whitespace in the configured folder', () => {
    expect(resolveNewDiagramFolder(settings('folder', ' /Diagrams/sub/ '), null)).toBe('Diagrams/sub');
    expect(resolveNewDiagramFolder(settings('folder', 'Diagrams\\sub'), null)).toBe('Diagrams/sub');
    expect(resolveNewDiagramFolder(settings('folder', '//Diagrams//sub//'), null)).toBe('Diagrams/sub');
  });
});

function diagramFile(path: string): TFile {
  const name = path.split('/').pop()!;
  return Object.assign(new TFile(), {
    path, extension: name.split('.').pop(), basename: name.slice(0, name.lastIndexOf('.')),
  });
}

function creationFixture() {
  const files = new Map<string, TFile | TFolder>();
  const created: Array<{ file: TFile; data: string | ArrayBuffer }> = [];
  const events: string[] = [];
  const store = async (path: string, data: string | ArrayBuffer) => {
    const file = diagramFile(path);
    files.set(path, file);
    created.push({ file, data });
    events.push('create');
    return file;
  };
  const create = vi.fn((path: string, data: string) => store(path, data));
  const createBinary = vi.fn((path: string, data: ArrayBuffer) => store(path, data));
  const createFolder = vi.fn(async (path: string) => {
    files.set(path, Object.assign(new TFolder(), { path }));
    events.push(`folder:${path}`);
  });
  const openFile = vi.fn(async () => { events.push('open'); });
  const openEditor = vi.fn(() => { events.push('open'); });
  const getActiveFile = vi.fn(() => ({ parent: { path: 'Other' } }));
  const generateMarkdownLink = vi.fn((file: TFile) => `[[${file.path}]]`);
  const raw = {
    settings: { ...DEFAULT_SETTINGS },
    app: {
      workspace: { getActiveFile, getLeaf: vi.fn(() => ({ openFile })) },
      vault: {
        create, createBinary, createFolder,
        getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
      },
      fileManager: { generateMarkdownLink },
    },
    openEditor,
  };
  let doc = 'before selected after';
  const position = { line: 0, ch: 15 };
  const replaceRange = vi.fn((text: string, from: { line: number; ch: number }, to?: { line: number; ch: number }) => {
    const offset = (pos: { line: number; ch: number }) =>
      doc.split('\n').slice(0, pos.line).reduce((n, line) => n + line.length + 1, 0) + pos.ch;
    doc = doc.slice(0, offset(from)) + text + doc.slice(offset(to ?? from));
    events.push('insert');
  });
  const editor = {
    getCursor: vi.fn(() => position), replaceRange, getValue: () => doc,
  };
  const file = Object.assign(diagramFile('Notes/Source.md'), { parent: { path: 'Notes' } });
  const context = { file, editor } as unknown as MarkdownFileInfo;
  return { plugin: raw as unknown as DrawioPlugin, raw, editor, context, position, files, created, events };
}

describe('createNewDiagram compatibility', () => {
  it.each(['drawio', 'svg', 'png'] as const)('creates standalone %s without adding a note embed', async (format) => {
    const f = creationFixture();
    f.raw.settings.newDiagramFormat = format;
    await createNewDiagram(f.plugin);
    expect(f.created).toHaveLength(1);
    expect(f.editor.replaceRange).not.toHaveBeenCalled();
    expect(f.raw.app.fileManager.generateMarkdownLink).not.toHaveBeenCalled();
    expect(f.events).toEqual(['create', 'open']);
  });

  it('keeps the folder-context override ahead of the location setting', async () => {
    const f = creationFixture();
    f.raw.settings.newDiagramLocation = 'folder';
    f.raw.settings.newDiagramFolder = 'Configured';
    await createNewDiagram(f.plugin, Object.assign(new TFolder(), { path: 'Clicked' }));
    expect(f.created[0]!.file.path).toMatch(/^Clicked\/Untitled Diagram \d+\.drawio$/);
    expect(f.raw.app.vault.createFolder).not.toHaveBeenCalled();
    expect(f.raw.app.workspace.getActiveFile).not.toHaveBeenCalled();
  });
});

describe('createAndInsertDiagram', () => {
  it('uses the supplied editor when MarkdownFileInfo has no editor property', async () => {
    const f = creationFixture();
    const context = { file: f.context.file } as MarkdownFileInfo;
    await createAndInsertDiagram(f.plugin, f.editor as unknown as Editor, context);
    expect(f.editor.replaceRange).toHaveBeenCalledTimes(1);
  });

  it.each(['drawio', 'svg', 'png'] as const)('creates an editable %s file and embeds it before opening', async (format) => {
    const f = creationFixture();
    f.raw.settings.newDiagramFormat = format;
    f.raw.settings.newDiagramLocation = 'folder';
    f.raw.settings.newDiagramFolder = 'Diagrams/Nested';
    await createAndInsertDiagram(f.plugin, f.editor as unknown as Editor, f.context);
    const { file, data } = f.created[0]!;
    const ext = format === 'drawio' ? 'drawio' : `drawio.${format}`;
    expect(file.path).toMatch(new RegExp(`^Diagrams/Nested/Untitled Diagram \\d+\\.${ext.replace('.', '\\.')}$`));
    expect(f.raw.app.vault.createFolder.mock.calls).toEqual([['Diagrams'], ['Diagrams/Nested']]);
    if (format === 'drawio') {
      expect(data).toBe(EMPTY_DIAGRAM);
      expect(f.raw.app.workspace.getLeaf).toHaveBeenCalledWith(true);
    } else {
      const xml = format === 'svg'
        ? extractXmlFromSvg(data as string)
        : extractXmlFromPng(new Uint8Array(data as ArrayBuffer));
      expect(xml).toBe(EMPTY_DIAGRAM);
      expect(f.raw.openEditor).toHaveBeenCalledTimes(1);
      expect(f.raw.app.workspace.getLeaf).not.toHaveBeenCalled();
    }
    expect(f.editor.getCursor).toHaveBeenCalledWith('to');
    expect(f.editor.replaceRange).toHaveBeenCalledWith(`\n![[${file.path}]]\n`, { line: 0, ch: 15 });
    expect(f.editor.getValue()).toBe(`before selected\n![[${file.path}]]\n after`);
    expect(f.events).toEqual(['folder:Diagrams', 'folder:Diagrams/Nested', 'create', 'insert', 'open']);
  });

  it.each([
    '[Diagram](../Diagrams/Diagram%20name.drawio.svg)',
    '![Diagram](../Diagrams/Diagram%20name.drawio.svg)',
  ])('preserves the link generated by Obsidian: %s', async (link) => {
    const f = creationFixture();
    f.raw.app.fileManager.generateMarkdownLink.mockReturnValue(link);
    await createAndInsertDiagram(f.plugin, f.editor as unknown as Editor, f.context);
    expect(f.raw.app.fileManager.generateMarkdownLink).toHaveBeenCalledWith(f.created[0]!.file, 'Notes/Source.md');
    const embed = link.startsWith('!') ? link : `!${link}`;
    expect(f.editor.replaceRange).toHaveBeenCalledWith(`\n${embed}\n`, { line: 0, ch: 15 });
  });

  it.each(['drawio', 'svg', 'png'] as const)('keeps the %s embed if opening the editor fails', async (format) => {
    const f = creationFixture();
    f.raw.settings.newDiagramFormat = format;
    f.raw.app.workspace.getLeaf().openFile.mockRejectedValue(new Error('editor unavailable'));
    f.raw.openEditor.mockImplementation(() => { throw new Error('editor unavailable'); });
    f.raw.app.workspace.getLeaf.mockClear();
    await createAndInsertDiagram(f.plugin, f.editor as unknown as Editor, f.context);
    expect(f.editor.getValue()).toContain(`![[${f.created[0]!.file.path}]]`);
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('editor unavailable'));
  });

  it('does not insert or open an editor if file creation fails', async () => {
    const f = creationFixture();
    f.raw.app.vault.create.mockRejectedValue(new Error('disk full'));
    await createAndInsertDiagram(f.plugin, f.editor as unknown as Editor, f.context);
    expect(f.editor.replaceRange).not.toHaveBeenCalled();
    expect(f.raw.openEditor).not.toHaveBeenCalled();
    expect(f.raw.app.workspace.getLeaf).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });

  it('leaves the note unchanged when the target folder is a file', async () => {
    const f = creationFixture();
    f.raw.settings.newDiagramLocation = 'folder';
    f.raw.settings.newDiagramFolder = 'Diagrams';
    f.files.set('Diagrams', diagramFile('Diagrams'));
    await createAndInsertDiagram(f.plugin, f.editor as unknown as Editor, f.context);
    expect(f.created).toEqual([]);
    expect(f.editor.replaceRange).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('not a folder'));
  });

  it('captures the editor even when a different note becomes active during create', async () => {
    const f = creationFixture();
    let finish!: (file: TFile) => void;
    f.raw.app.vault.create.mockReturnValue(new Promise<TFile>((resolve) => { finish = resolve; }));
    const pending = createAndInsertDiagram(f.plugin, f.editor as unknown as Editor, f.context);
    f.raw.app.workspace.getActiveFile.mockReturnValue({ parent: { path: 'NowActive' } });
    finish(diagramFile('Untitled Diagram 123.drawio'));
    await pending;
    expect(f.editor.replaceRange).toHaveBeenCalledTimes(1);
    expect(f.raw.app.workspace.getActiveFile).not.toHaveBeenCalled();
    expect(f.raw.app.fileManager.generateMarkdownLink).toHaveBeenCalledWith(expect.any(TFile), 'Notes/Source.md');
  });

  it('does nothing without a Markdown source file', async () => {
    const f = creationFixture();
    Object.assign(f.context, { file: null });
    await createAndInsertDiagram(f.plugin, f.editor as unknown as Editor, f.context);
    Object.assign(f.context, { file: diagramFile('not-a-note.drawio') });
    await createAndInsertDiagram(f.plugin, f.editor as unknown as Editor, f.context);
    expect(f.created).toEqual([]);
    expect(f.editor.getCursor).not.toHaveBeenCalled();
  });

  it.each(['file', 'editor'])('never inserts when the source %s is replaced during creation', async (changed) => {
    const f = creationFixture();
    let finish!: (file: TFile) => void;
    const created = new Promise<TFile>((resolve) => { finish = resolve; });
    f.raw.app.vault.create.mockReturnValue(created);
    const pending = createAndInsertDiagram(f.plugin, f.editor as unknown as Editor, f.context);
    Object.assign(f.context, changed === 'file'
      ? { file: diagramFile('Other/Replacement.md') }
      : { editor: {} });
    const file = diagramFile('Untitled Diagram 123.drawio');
    finish(file);
    await pending;
    expect(f.editor.replaceRange).not.toHaveBeenCalled();
    expect(f.raw.app.fileManager.generateMarkdownLink).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining(file.path));
  });

  it('captures the source folder and cursor before creation despite a different active note', async () => {
    const f = creationFixture();
    f.raw.settings.newDiagramLocation = 'current';
    let finish!: () => void;
    const folderReady = new Promise<void>((resolve) => { finish = resolve; });
    f.raw.app.vault.createFolder.mockImplementation(async (path) => {
      await folderReady;
      f.files.set(path, Object.assign(new TFolder(), { path }));
    });
    const pending = createAndInsertDiagram(f.plugin, f.editor as unknown as Editor, f.context);
    // Moving the cursor during the pending folder create must not redirect insertion.
    f.position.ch = 0;
    finish();
    await pending;
    expect(f.created[0]!.file.path).toMatch(/^Notes\/Untitled Diagram \d+\.drawio$/);
    expect(f.editor.replaceRange).toHaveBeenCalledWith(expect.any(String), { line: 0, ch: 15 });
    expect(f.raw.app.workspace.getActiveFile).not.toHaveBeenCalled();
    expect(f.events).toEqual(['create', 'insert', 'open']);
  });
});
