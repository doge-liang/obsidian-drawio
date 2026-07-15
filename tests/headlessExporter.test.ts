import { describe, it, expect, vi, afterEach } from 'vitest';
import { exportDiagramXml, PlainExportFormat } from '../src/editor/HeadlessExporter';
import type { DrawioEditorDeps } from '../src/editor/DrawioEditor';

const ORIGIN = 'http://127.0.0.1:1234';
const XML = '<mxfile><diagram/></mxfile>';
const SVG_URI = 'data:image/svg+xml;base64,PHN2Zy8+';

function makeDeps(): DrawioEditorDeps {
  return {
    resolveBaseUrl: async () => `${ORIGIN}/index.html`,
    isDark: () => false,
    showLibraries: () => true,
    acquireServer: vi.fn(),
    releaseServer: vi.fn(),
  };
}

async function flush() {
  await new Promise((r) => window.setTimeout(r, 0));
}

/** Kick off an export, wait for the iframe mount, and wire the same
 * dispatch/postMessage-spy plumbing as tests/drawioEditorExport.test.ts. */
async function start(format: PlainExportFormat, deps: DrawioEditorDeps, timeoutMs = 5000) {
  const promise = exportDiagramXml(XML, format, deps, { timeoutMs });
  await flush(); // let resolveBaseUrl settle and the DOM mount
  const iframe = document.querySelector<HTMLIFrameElement>('.drawio-headless-exporter iframe')!;
  expect(iframe).not.toBeNull();
  const posts: string[] = [];
  vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation((msg: unknown) => {
    posts.push(msg as string);
  });
  const dispatch = (data: unknown, origin = ORIGIN, source: Window | null = iframe.contentWindow) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify(data), origin, source,
    }));
  };
  return { promise, posts, dispatch };
}

function containers() {
  return document.querySelectorAll('.drawio-headless-exporter');
}

describe('exportDiagramXml (headless drawio export)', () => {
  afterEach(() => {
    // Any leftover mount is a cleanup bug in the test at hand; don't let it
    // leak into the next one.
    containers().forEach((el) => el.remove());
  });

  it('drives configure → init → load → export and resolves with the data URI', async () => {
    const deps = makeDeps();
    const { promise, posts, dispatch } = await start('svg', deps);

    dispatch({ event: 'configure' });
    expect(posts).toContainEqual(JSON.stringify({ action: 'configure', config: { compressXml: false } }));

    dispatch({ event: 'init' });
    const load = posts.find((p) => p.includes('"action":"load"'));
    expect(load).toBeDefined();
    expect(JSON.parse(load!)).toMatchObject({ action: 'load', xml: XML });

    dispatch({ event: 'load' });
    expect(posts).toContainEqual(JSON.stringify({ action: 'export', format: 'svg' }));

    dispatch({ event: 'export', format: 'svg', data: SVG_URI });
    await expect(promise).resolves.toBe(SVG_URI);
  });

  it('requests the png format for png exports', async () => {
    const deps = makeDeps();
    const { promise, posts, dispatch } = await start('png', deps);
    dispatch({ event: 'load' });
    expect(posts).toContainEqual(JSON.stringify({ action: 'export', format: 'png' }));
    dispatch({ event: 'export', format: 'png', data: 'data:image/png;base64,AA==' });
    await expect(promise).resolves.toBe('data:image/png;base64,AA==');
  });

  it('cleans up the DOM, the listener, and the server pin after success', async () => {
    const deps = makeDeps();
    const { promise, posts, dispatch } = await start('svg', deps);
    dispatch({ event: 'export', format: 'svg', data: SVG_URI });
    await promise;

    expect(containers()).toHaveLength(0);
    expect(deps.acquireServer).toHaveBeenCalledTimes(1);
    expect(deps.releaseServer).toHaveBeenCalledTimes(1);

    // The message listener is gone: further protocol traffic posts nothing.
    const before = posts.length;
    dispatch({ event: 'configure' });
    expect(posts).toHaveLength(before);
  });

  it('rejects after the timeout and still cleans up', async () => {
    const deps = makeDeps();
    const { promise } = await start('svg', deps, 30);
    await expect(promise).rejects.toThrow(/timed out/);
    expect(containers()).toHaveLength(0);
    expect(deps.releaseServer).toHaveBeenCalledTimes(1);
  });

  it('ignores messages from the wrong origin or a foreign source', async () => {
    const deps = makeDeps();
    const { promise, posts, dispatch } = await start('svg', deps);

    dispatch({ event: 'export', format: 'svg', data: SVG_URI }, 'http://evil.example');
    dispatch({ event: 'export', format: 'svg', data: SVG_URI }, ORIGIN, window);
    await flush();
    expect(containers()).toHaveLength(1); // still pending — nothing accepted
    expect(posts).toHaveLength(0);

    dispatch({ event: 'export', format: 'svg', data: SVG_URI });
    await expect(promise).resolves.toBe(SVG_URI);
  });

  it('propagates a resolveBaseUrl failure without touching the server or the DOM', async () => {
    const deps = makeDeps();
    deps.resolveBaseUrl = async () => { throw new Error('offline editor not installed'); };
    await expect(exportDiagramXml(XML, 'svg', deps)).rejects.toThrow('offline editor not installed');
    expect(containers()).toHaveLength(0);
    expect(deps.acquireServer).not.toHaveBeenCalled();
    expect(deps.releaseServer).not.toHaveBeenCalled();
  });
});
