import { describe, it, expect, vi, afterEach } from 'vitest';

// Stub the raw-text import so the module loads fast under vitest and avoids
// jsdom-eval incompatibilities in the real vendored viewer (see
// tests/drawioMobileFileView.test.ts for the same pattern).
vi.mock('../src/preview/viewer.min.txt', () => ({ default: 'window.GraphViewer = window.GraphViewer || undefined;' }));

import { Platform } from 'obsidian';
import { registerDrawioCodeBlock } from '../src/codeblock/DrawioCodeBlock';
import type { PreviewClickAction } from '../src/settings';
import type DrawioPlugin from '../src/main';

type Processor = (source: string, el: HTMLElement, ctx: unknown) => void;

function fakePlugin(openEditor: DrawioPlugin['openEditor'], previewClickAction: PreviewClickAction = 'editor') {
  let processor: Processor | undefined;
  const raw = {
    app: {},
    settings: { previewClickAction },
    previewOpts: () => ({ dark: false }),
    openEditor,
    registerMarkdownCodeBlockProcessor: (_lang: string, cb: Processor) => { processor = cb; },
  };
  return {
    plugin: raw as unknown as DrawioPlugin,
    run: (source: string, el: HTMLElement, ctx: unknown) => processor!(source, el, ctx),
  };
}

const XML = '<mxfile><diagram id="0" name="Page-1"><mxGraphModel/></diagram></mxfile>';

describe('drawio code block — mobile click behavior', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => { Platform.isDesktopApp = originalIsDesktopApp; });

  it('opens the editor on click and shows the edit hint on desktop', () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor);
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.drawio-edit-hint')).not.toBeNull();
  });

  it('still opens the built-in editor under "defaultApp" (code blocks have no file)', () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor, 'defaultApp');
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('does nothing on click under "none", with no edit hint', () => {
    Platform.isDesktopApp = true;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor, 'none');
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(el.querySelector('.drawio-edit-hint')).toBeNull();
  });

  it('shows a Notice instead of opening the editor on mobile, with no edit hint', () => {
    Platform.isDesktopApp = false;
    const openEditor = vi.fn();
    const { plugin, run } = fakePlugin(openEditor);
    registerDrawioCodeBlock(plugin);
    const el = document.createElement('div');
    run(XML, el, { sourcePath: 'note.md' });
    el.querySelector('.drawio-codeblock')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openEditor).not.toHaveBeenCalled();
    expect(el.querySelector('.drawio-edit-hint')).toBeNull();
  });
});
