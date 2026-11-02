import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DrawioEditor, DrawioEditorDeps } from '../src/editor/DrawioEditor';
import type { ExportingSource } from '../src/model/DrawioSource';
import type { DrawioSource } from '../src/model/DrawioSource';

const ORIGIN = 'http://127.0.0.1:1234';

function makeDeps(): DrawioEditorDeps {
  return {
    resolveBaseUrl: async () => `${ORIGIN}/index.html`,
    isDark: () => false,
    showLibraries: () => true,
    acquireServer: vi.fn(),
    releaseServer: vi.fn(),
  };
}

function makeExportingSource() {
  const writes: string[] = [];
  const xmlWrites: string[] = [];
  const source: ExportingSource = {
    title: () => 'dual',
    read: async () => '<mxfile/>',
    write: async (xml: string) => { xmlWrites.push(xml); },
    exportFormat: () => 'xmlsvg',
    writeExport: async (uri: string) => { writes.push(uri); },
  };
  return { source, writes, xmlWrites };
}

async function flush() {
  await new Promise((r) => window.setTimeout(r, 0));
}

describe('DrawioEditor export round-trip (dual-format sources)', () => {
  let container: HTMLElement;
  let editor: DrawioEditor | null = null;
  let posts: string[];
  let onExit: ReturnType<typeof vi.fn>;

  function dispatch(data: unknown) {
    const iframe = container.querySelector('iframe')!;
    window.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify(data),
      origin: ORIGIN,
      source: iframe.contentWindow,
    }));
  }

  async function mount(source: DrawioSource, exportTimeoutMs?: number, pngScale?: number) {
    editor = new DrawioEditor(container, source, {
      ...makeDeps(), pngExportScale: () => pngScale ?? 2,
    }, { onExit, exportTimeoutMs });
    await editor.mount();
    const cw = container.querySelector('iframe')!.contentWindow!;
    vi.spyOn(cw, 'postMessage').mockImplementation((msg: unknown) => {
      posts.push(msg as string);
    });
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    posts = [];
    onExit = vi.fn();
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    container.remove();
  });

  it('answers save with an export request instead of writing the XML', async () => {
    const { source, writes } = makeExportingSource();
    await mount(source);
    dispatch({ event: 'save', xml: '<mxfile/>' });
    await flush();
    expect(posts).toContainEqual(JSON.stringify({ action: 'export', format: 'xmlsvg' }));
    expect(writes).toEqual([]); // nothing persisted until the export reply
  });

  it('persists the export payload when the export event arrives', async () => {
    const { source, writes } = makeExportingSource();
    await mount(source);
    dispatch({ event: 'save', xml: '<mxfile/>' });
    await flush();
    dispatch({ event: 'export', format: 'xmlsvg', data: 'data:image/svg+xml;base64,YQ==' });
    await flush();
    expect(writes).toEqual(['data:image/svg+xml;base64,YQ==']);
    expect(posts.map((p) => JSON.parse(p))).toContainEqual({ action: 'status', message: '', modified: false });
    expect(onExit).not.toHaveBeenCalled();
  });

  it('defers exit-on-save until the export has been persisted', async () => {
    const { source, writes } = makeExportingSource();
    await mount(source);
    dispatch({ event: 'save', xml: '<mxfile/>', exit: true });
    await flush();
    expect(onExit).not.toHaveBeenCalled(); // still waiting for the export
    dispatch({ event: 'export', format: 'xmlsvg', data: 'data:image/svg+xml;base64,YQ==' });
    await flush();
    expect(writes).toHaveLength(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('requests native save-and-exit for modal Escape and waits for the image write', async () => {
    const { source, writes } = makeExportingSource();
    editor = new DrawioEditor(container, source, makeDeps(), { onExit, closeOnEscape: true });
    await editor.mount();
    const cw = container.querySelector('iframe')!.contentWindow!;
    expect(new URL(container.querySelector('iframe')!.src).searchParams.get('saveAndExit')).toBe('1');
    vi.spyOn(cw, 'postMessage').mockImplementation((msg: unknown) => { posts.push(msg as string); });
    dispatch({ event: 'configure' });
    expect(JSON.parse(posts[0]!).config.passThroughKeys).toEqual([
      { key: 'Escape', command: 'drawio-close' },
    ]);
    dispatch({ event: 'load' });
    dispatch({ event: 'shortcut', command: 'drawio-close' });
    expect(posts.map((p) => JSON.parse(p))).toContainEqual({ action: 'resetEditor' });
    expect(posts.map((p) => JSON.parse(p))).toContainEqual({ action: 'invokeAction', actionName: 'saveAndExit' });
    expect(onExit).not.toHaveBeenCalled();
    dispatch({ event: 'save', xml: '<mxfile>latest</mxfile>', exit: true });
    await flush();
    dispatch({ event: 'export', data: 'data:image/svg+xml;base64,YQ==' });
    await flush();
    expect(writes).toHaveLength(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('retains the editor after a failed Escape save and permits retry', async () => {
    const { source, writes } = makeExportingSource();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const persist = vi.spyOn(source, 'writeExport').mockRejectedValueOnce(new Error('disk full'));
    editor = new DrawioEditor(container, source, makeDeps(), { onExit, closeOnEscape: true });
    await editor.mount();
    const post = vi.spyOn(container.querySelector('iframe')!.contentWindow!, 'postMessage');
    dispatch({ event: 'load' });
    dispatch({ event: 'shortcut', command: 'drawio-close' });
    dispatch({ event: 'save', xml: '<latest/>', exit: true });
    dispatch({ event: 'export', data: 'data:image/svg+xml;base64,YQ==' });
    await flush();
    expect(onExit).not.toHaveBeenCalled();
    post.mockClear();
    dispatch({ event: 'shortcut', command: 'drawio-close' });
    expect(post).toHaveBeenCalledWith(JSON.stringify({ action: 'invokeAction', actionName: 'saveAndExit' }), ORIGIN);
    dispatch({ event: 'save', xml: '<latest/>', exit: true });
    dispatch({ event: 'export', data: 'data:image/svg+xml;base64,YQ==' });
    await flush();
    expect(writes).toHaveLength(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('leaves inline editors alone and rejects untrusted Escape shortcut messages', async () => {
    const { source } = makeExportingSource();
    await mount(source);
    dispatch({ event: 'configure' });
    expect(JSON.parse(posts[0]!).config.passThroughKeys).toBeUndefined();
    dispatch({ event: 'shortcut', command: 'drawio-close' });
    expect(posts).toHaveLength(1);
    editor!.destroy();
    editor = new DrawioEditor(container, source, makeDeps(), { onExit, closeOnEscape: true });
    await editor.mount();
    const iframe = container.querySelector('iframe')!;
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
    window.dispatchEvent(new MessageEvent('message', {
      source: iframe.contentWindow, origin: 'https://untrusted.example',
      data: JSON.stringify({ event: 'shortcut', command: 'drawio-close' }),
    }));
    window.dispatchEvent(new MessageEvent('message', {
      source: window, origin: ORIGIN,
      data: JSON.stringify({ event: 'shortcut', command: 'drawio-close' }),
    }));
    dispatch({ event: 'shortcut', command: 'another-command' });
    expect(post).not.toHaveBeenCalled();
  });

  it('coalesces overlapping autosaves into one trailing re-export', async () => {
    const { source, writes } = makeExportingSource();
    await mount(source);
    dispatch({ event: 'autosave', xml: '<a/>' });
    dispatch({ event: 'autosave', xml: '<b/>' });
    await flush();
    const exportPosts = () => posts.filter((p) => p.includes('"export"')).length;
    expect(exportPosts()).toBe(1); // second request queued, not sent
    dispatch({ event: 'export', format: 'xmlsvg', data: 'data:image/svg+xml;base64,YQ==' });
    await flush();
    expect(writes).toHaveLength(1);
    expect(exportPosts()).toBe(2); // queued request flushed after the reply
    expect(posts.some((p) => p.includes('"status"'))).toBe(false);
    dispatch({ event: 'export', format: 'xmlsvg', data: 'data:image/svg+xml;base64,Yg==' });
    await flush();
    expect(writes).toHaveLength(2);
    expect(posts.filter((p) => p.includes('"status"'))).toHaveLength(1);
  });

  it('saves PNGs at the configured scale', async () => {
    const { source } = makeExportingSource();
    source.exportFormat = () => 'xmlpng';
    await mount(source, undefined, 3);
    dispatch({ event: 'save', xml: '<mxfile/>' });
    await flush();
    expect(posts.map((p) => JSON.parse(p))).toContainEqual({ action: 'export', format: 'xmlpng', scale: 3 });
  });

  it('coalesces edits arriving during a slow vault write before acknowledging', async () => {
    const { source } = makeExportingSource();
    let finish!: () => void;
    const write = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }))
      .mockResolvedValue(undefined);
    source.writeExport = write;
    await mount(source);
    dispatch({ event: 'autosave', xml: '<first/>' });
    dispatch({ event: 'export', data: 'first' });
    await flush();
    dispatch({ event: 'autosave', xml: '<second/>' });
    expect(posts.filter((p) => p.includes('"export"'))).toHaveLength(1);
    expect(posts.some((p) => p.includes('"status"'))).toBe(false);
    finish();
    await flush();
    expect(posts.filter((p) => p.includes('"export"'))).toHaveLength(2);
    expect(posts.some((p) => p.includes('"status"'))).toBe(false);
    dispatch({ event: 'export', data: 'second' });
    await flush();
    expect(write.mock.calls).toEqual([['first'], ['second']]);
    expect(posts.filter((p) => p.includes('"status"'))).toHaveLength(1);
  });

  it('does not clear the modified flag or close the editor when image persistence fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { source } = makeExportingSource();
    source.writeExport = async () => { throw new Error('disk full'); };
    await mount(source);
    dispatch({ event: 'save', xml: '<unsaved/>', exit: true });
    dispatch({ event: 'export', data: 'image' });
    await flush();
    expect(posts.some((p) => p.includes('"status"'))).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('acknowledges successful XML saves only after the write resolves', async () => {
    let finish!: () => void;
    const source: DrawioSource = {
      title: () => 'plain', read: async () => '<mxfile/>',
      write: () => new Promise<void>((r) => { finish = r; }),
    };
    await mount(source);
    dispatch({ event: 'save', xml: '<mxfile/>', exit: true });
    await flush();
    expect(posts).toEqual([]);
    expect(onExit).not.toHaveBeenCalled();
    finish();
    await flush();
    expect(posts.map((p) => JSON.parse(p))).toEqual([{ action: 'status', message: '', modified: false }]);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('does not acknowledge or exit after a failed XML save', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source: DrawioSource = {
      title: () => 'plain', read: async () => '<mxfile/>',
      write: async () => { throw new Error('disk full'); },
    };
    await mount(source);
    dispatch({ event: 'save', xml: '<mxfile/>', exit: true });
    await flush();
    expect(posts).toEqual([]);
    expect(onExit).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('ignores late export replies after a successful XML fallback', async () => {
    const { source, writes } = makeExportingSource();
    await mount(source, 10);
    dispatch({ event: 'save', xml: '<mxfile/>' });
    await new Promise((r) => window.setTimeout(r, 40));
    dispatch({ event: 'export', data: 'late stale image' });
    await flush();
    expect(writes).toEqual([]);
    expect(posts.filter((p) => p.includes('"status"'))).toHaveLength(1);
  });

  it('destroy() during a pending export falls back to writing the last XML', async () => {
    const { source, writes, xmlWrites } = makeExportingSource();
    await mount(source);
    dispatch({ event: 'autosave', xml: '<mxfile>edited</mxfile>' });
    await flush();
    editor!.destroy();
    editor = null;
    await flush();
    expect(xmlWrites).toEqual(['<mxfile>edited</mxfile>']); // data survives the teardown
    expect(writes).toEqual([]);
  });

  it('keeps the latest XML when closed while an older image is being written', async () => {
    const { source } = makeExportingSource();
    let finish!: () => void;
    const disk: string[] = [];
    source.writeExport = async () => {
      await new Promise<void>((r) => { finish = r; });
      disk.push('old image');
    };
    source.write = async (xml) => { disk.push(xml); };
    await mount(source);
    dispatch({ event: 'autosave', xml: '<old/>' });
    dispatch({ event: 'export', data: 'old image' });
    await flush();
    dispatch({ event: 'autosave', xml: '<latest/>' });
    editor!.destroy();
    editor = null;
    await flush();
    expect(disk).toEqual([]);
    finish();
    await flush();
    expect(disk).toEqual(['old image', '<latest/>']);
    expect(posts.some((p) => p.includes('"status"'))).toBe(false);
  });

  it('an unanswered export times out into an XML fallback and completes a pending exit', async () => {
    const { source, xmlWrites } = makeExportingSource();
    await mount(source, 30);
    dispatch({ event: 'save', xml: '<mxfile>final</mxfile>', exit: true });
    await flush();
    expect(onExit).not.toHaveBeenCalled();
    await new Promise((r) => window.setTimeout(r, 80)); // past the 30 ms timeout
    expect(xmlWrites).toEqual(['<mxfile>final</mxfile>']);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
