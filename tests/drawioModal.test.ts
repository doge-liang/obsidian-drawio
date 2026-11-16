import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { DrawioModal } from '../src/editor/DrawioModal';
import { DrawioEditor } from '../src/editor/DrawioEditor';

describe('DrawioModal Escape', () => {
  it('replaces inherited immediate-close binding with save-and-close', async () => {
    const focus = vi.fn();
    const view = { editor: { focus } };
    const modal = new DrawioModal({ workspace: { getActiveViewOfType: () => view } } as unknown as App, {
      title: () => 'test', read: async () => '<mxfile/>', write: async () => {},
    }, {
      resolveBaseUrl: async () => 'http://127.0.0.1:1234/index.html',
      isDark: () => false, showLibraries: () => false,
      acquireServer: () => {}, releaseServer: () => {},
    });
    modal.titleEl.setText = (text) => { modal.titleEl.textContent = String(text); };
    await modal.onOpen();
    const request = vi.spyOn(DrawioEditor.prototype, 'requestClose').mockReturnValue(true);
    const close = vi.spyOn(modal, 'close');
    const bindings = (modal.scope as unknown as { keys: Array<{ key: string; func: () => unknown }> }).keys;
    expect(bindings.filter((b) => b.key === 'Escape')).toHaveLength(1);
    bindings.find((b) => b.key === 'Escape')!.func();
    expect(request).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    request.mockReturnValue(false);
    bindings.find((b) => b.key === 'Escape')!.func();
    expect(close).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    request.mockRestore();
    close.mockRestore();
    modal.onClose();
  });
});

describe('DrawioModal return focus', () => {
  it('returns focus to the originating note without stealing focus from another note', () => {
    const focus = vi.fn();
    const view = { editor: { focus } };
    let activeView: unknown = view;
    const modal = new DrawioModal({ workspace: { getActiveViewOfType: () => activeView } } as unknown as App,
      { title: () => 'test', read: async () => '<mxfile/>', write: async () => {} },
      { resolveBaseUrl: async () => 'http://127.0.0.1:1234/', isDark: () => false,
        showLibraries: () => false, acquireServer: () => {}, releaseServer: () => {} });
    modal.onClose();
    expect(focus).toHaveBeenCalledTimes(1);
    activeView = { editor: { focus: vi.fn() } };
    modal.onClose();
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
