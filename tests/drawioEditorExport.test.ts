import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DrawioEditor, DrawioEditorDeps } from '../src/editor/DrawioEditor';
import type { ExportingSource } from '../src/model/DrawioSource';

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
  const source: ExportingSource = {
    title: () => 'dual',
    read: async () => '<mxfile/>',
    write: async () => { throw new Error('unexpected XML write'); },
    exportFormat: () => 'xmlsvg',
    writeExport: async (uri: string) => { writes.push(uri); },
  };
  return { source, writes };
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

  async function mount(source: ExportingSource) {
    editor = new DrawioEditor(container, source, makeDeps(), { onExit });
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
    dispatch({ event: 'export', format: 'xmlsvg', data: 'data:image/svg+xml;base64,Yg==' });
    await flush();
    expect(writes).toHaveLength(2);
  });
});
