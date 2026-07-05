import { describe, it, expect, vi, afterEach } from 'vitest';
import { DrawioEditor, DrawioEditorDeps } from '../src/editor/DrawioEditor';
import type { DrawioSource } from '../src/model/DrawioSource';

function fakeSource(): DrawioSource {
  return { title: () => 'test', read: async () => '<mxfile></mxfile>', write: async () => {} };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('DrawioEditor popout-window handling', () => {
  let popoutFrame: HTMLIFrameElement | null = null;

  afterEach(() => {
    popoutFrame?.remove();
    popoutFrame = null;
  });

  it("listens on the container's own window, not the global window (popped-out tab)", async () => {
    popoutFrame = document.createElement('iframe');
    document.body.appendChild(popoutFrame);
    const popoutWin = popoutFrame.contentWindow as Window;
    const container = popoutWin.document.createElement('div');
    // Minimal createEl/empty shim for this nested realm — mirrors tests/setup.ts,
    // which only patches the top-level window's HTMLElement prototype.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (container as any).createEl = function (this: HTMLElement, tag: string, attrs?: { cls?: string }) {
      const el = popoutWin.document.createElement(tag);
      if (attrs?.cls) el.className = attrs.cls;
      this.appendChild(el);
      return el;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (container as any).empty = function (this: HTMLElement) {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
    popoutWin.document.body.appendChild(container);

    const globalAdd = vi.spyOn(window, 'addEventListener');
    const popoutAdd = vi.spyOn(popoutWin, 'addEventListener');

    const deps: DrawioEditorDeps = {
      resolveBaseUrl: async () => 'http://127.0.0.1:1234/index.html',
      isDark: () => false,
      showLibraries: () => true,
      acquireServer: vi.fn(),
      releaseServer: vi.fn(),
    };
    const editor = new DrawioEditor(container, fakeSource(), deps);
    await editor.mount();

    expect(popoutAdd).toHaveBeenCalledWith('message', expect.any(Function));
    expect(globalAdd).not.toHaveBeenCalledWith('message', expect.any(Function));

    const popoutRemove = vi.spyOn(popoutWin, 'removeEventListener');
    editor.destroy();
    expect(popoutRemove).toHaveBeenCalledWith('message', expect.any(Function));

    globalAdd.mockRestore();
    popoutAdd.mockRestore();
  });

  it('rebinds to the new window when the container is adopted into a popout after mount() and the iframe reloads', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const globalRemove = vi.spyOn(window, 'removeEventListener');
    const deps: DrawioEditorDeps = {
      resolveBaseUrl: async () => 'http://127.0.0.1:1234/index.html',
      isDark: () => false,
      showLibraries: () => true,
      acquireServer: vi.fn(),
      releaseServer: vi.fn(),
    };
    const editor = new DrawioEditor(container, fakeSource(), deps);
    await editor.mount();

    // Simulate Obsidian adopting this view's DOM into a popout window some time
    // after mount() ran, then the iframe reloading as a result of the move.
    popoutFrame = document.createElement('iframe');
    document.body.appendChild(popoutFrame);
    const popoutWin = popoutFrame.contentWindow as Window;
    popoutWin.document.body.appendChild(container); // reparents container + its iframe child

    const popoutAdd = vi.spyOn(popoutWin, 'addEventListener');
    const innerIframe = container.querySelector('iframe');
    expect(innerIframe).not.toBeNull();
    innerIframe!.dispatchEvent(new Event('load'));

    expect(globalRemove).toHaveBeenCalledWith('message', expect.any(Function));
    expect(popoutAdd).toHaveBeenCalledWith('message', expect.any(Function));

    globalRemove.mockRestore();
    popoutAdd.mockRestore();
  });
});

describe('DrawioEditor destroy/mount race', () => {
  it('does not acquire the server or create an iframe if destroy() runs while mount() is still awaiting resolveBaseUrl', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { promise, resolve } = deferred<string>();
    const acquireServer = vi.fn();
    const releaseServer = vi.fn();
    const deps: DrawioEditorDeps = {
      resolveBaseUrl: () => promise,
      isDark: () => false,
      showLibraries: () => true,
      acquireServer,
      releaseServer,
    };
    const editor = new DrawioEditor(container, fakeSource(), deps);
    const mountPromise = editor.mount();
    editor.destroy(); // races ahead of resolveBaseUrl resolving
    resolve('http://127.0.0.1:1234/index.html');
    await mountPromise;

    expect(acquireServer).not.toHaveBeenCalled();
    expect(container.querySelector('iframe')).toBeNull();
  });
});
