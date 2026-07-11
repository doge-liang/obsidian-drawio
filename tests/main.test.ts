import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform } from 'obsidian';

vi.mock('../src/desktop/registerDesktopFeatures', () => ({
  registerDesktopFeatures: vi.fn(async () => {}),
}));

import { maybeRegisterDesktopFeatures, setPreviewAlignmentClass } from '../src/main';
import { registerDesktopFeatures } from '../src/desktop/registerDesktopFeatures';
import type DrawioPlugin from '../src/main';

describe('maybeRegisterDesktopFeatures', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => {
    Platform.isDesktopApp = originalIsDesktopApp;
    vi.clearAllMocks();
  });

  it('registers desktop features when Platform.isDesktopApp is true', async () => {
    Platform.isDesktopApp = true;
    const fakePlugin = {} as unknown as DrawioPlugin;
    await maybeRegisterDesktopFeatures(fakePlugin);
    expect(registerDesktopFeatures).toHaveBeenCalledWith(fakePlugin);
  });

  it('does nothing when Platform.isDesktopApp is false', async () => {
    Platform.isDesktopApp = false;
    const fakePlugin = {} as unknown as DrawioPlugin;
    await maybeRegisterDesktopFeatures(fakePlugin);
    expect(registerDesktopFeatures).not.toHaveBeenCalled();
  });
});

describe('setPreviewAlignmentClass', () => {
  function fakePlugin(leaves: Array<{ view: { containerEl: HTMLElement } }>): DrawioPlugin {
    return {
      app: {
        workspace: {
          iterateAllLeaves: (cb: (leaf: unknown) => void) => { leaves.forEach(cb); },
        },
      },
    } as unknown as DrawioPlugin;
  }

  afterEach(() => {
    document.body.classList.remove('drawio-align-left');
  });

  it('adds the class to the main body and every popout body', () => {
    const popoutDoc = document.implementation.createHTMLDocument();
    const plugin = fakePlugin([
      { view: { containerEl: document.createElement('div') } },
      { view: { containerEl: popoutDoc.createElement('div') } },
    ]);
    setPreviewAlignmentClass(plugin, true);
    expect(document.body.classList.contains('drawio-align-left')).toBe(true);
    expect(popoutDoc.body.classList.contains('drawio-align-left')).toBe(true);
  });

  it('removes the class from every body when centered', () => {
    const popoutDoc = document.implementation.createHTMLDocument();
    document.body.classList.add('drawio-align-left');
    popoutDoc.body.classList.add('drawio-align-left');
    const plugin = fakePlugin([
      { view: { containerEl: popoutDoc.createElement('div') } },
    ]);
    setPreviewAlignmentClass(plugin, false);
    expect(document.body.classList.contains('drawio-align-left')).toBe(false);
    expect(popoutDoc.body.classList.contains('drawio-align-left')).toBe(false);
  });
});
