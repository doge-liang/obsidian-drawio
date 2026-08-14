import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform, TFile } from 'obsidian';
import { DualFormatFileSource } from '../src/file/DualFormatFileSource';
import {
  handleDualFormatEmbedClick, syncDualFormatEditAction,
} from '../src/desktop/dualFormatOpen';
import type DrawioPlugin from '../src/main';
import type { PreviewClickAction } from '../src/settings';

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  return f;
}

function pluginWith(opts: {
  previewClickAction?: PreviewClickAction;
  dest?: TFile | null;
  notePath?: string;
} = {}) {
  const openEditor = vi.fn();
  const openWithDefaultApp = vi.fn();
  const dest = opts.dest === undefined ? tfile('diagram.drawio.svg') : opts.dest;
  const plugin = {
    app: {
      metadataCache: {
        getFirstLinkpathDest: () => dest,
      },
      workspace: {
        getActiveViewOfType: () => (
          opts.notePath ? { file: tfile(opts.notePath) } : { file: tfile('note.md') }
        ),
      },
      openWithDefaultApp,
    },
    settings: { previewClickAction: opts.previewClickAction ?? 'editor' },
    openEditor,
  } as unknown as DrawioPlugin;
  return { plugin, openEditor, openWithDefaultApp };
}

function clickOnEmbed(src: string, alreadyDecorated = false): { event: MouseEvent; span: HTMLElement } {
  const span = document.createElement('span');
  span.className = 'internal-embed';
  span.setAttribute('src', src);
  if (alreadyDecorated) span.dataset.drawioDualformat = '1';
  const img = document.createElement('img');
  span.appendChild(img);
  document.body.appendChild(span);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: img });
  return { event, span };
}

describe('handleDualFormatEmbedClick', () => {
  afterEach(() => { document.body.empty(); });

  it('opens the editor for an undecorated Live Preview dual-format embed', () => {
    const { plugin, openEditor } = pluginWith();
    const { event } = clickOnEmbed('diagram.drawio.svg');
    expect(handleDualFormatEmbedClick(plugin, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(openEditor.mock.calls[0]?.[0]).toBeInstanceOf(DualFormatFileSource);
  });

  it('leaves Reading-view decorated embeds to the post-processor', () => {
    const { plugin, openEditor } = pluginWith();
    const { event } = clickOnEmbed('diagram.drawio.svg', true);
    expect(handleDualFormatEmbedClick(plugin, event)).toBe(false);
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('ignores ordinary image embeds', () => {
    const { plugin, openEditor } = pluginWith();
    const { event } = clickOnEmbed('photo.png');
    expect(handleDualFormatEmbedClick(plugin, event)).toBe(false);
    expect(openEditor).not.toHaveBeenCalled();
  });

  it('respects Preview click action Do nothing', () => {
    const { plugin, openEditor } = pluginWith({ previewClickAction: 'none' });
    const { event } = clickOnEmbed('diagram.drawio.svg');
    expect(handleDualFormatEmbedClick(plugin, event)).toBe(false);
    expect(openEditor).not.toHaveBeenCalled();
  });
});

describe('syncDualFormatEditAction', () => {
  function leaf(file: TFile | undefined, viewType = 'image') {
    const actions: HTMLElement[] = [];
    const containerEl = document.createElement('div');
    const view = {
      file,
      containerEl,
      getViewType: () => viewType,
      addAction(_icon: string, title: string, cb: (e: MouseEvent) => unknown) {
        const el = document.createElement('button');
        el.setAttribute('aria-label', title);
        el.addEventListener('click', (e) => cb(e as MouseEvent));
        containerEl.appendChild(el);
        actions.push(el);
        return el;
      },
    };
    return { leaf: { view } as never, view, actions };
  }

  it('adds an Edit action on a native image tab showing a dual-format file', () => {
    const { plugin, openEditor } = pluginWith();
    const file = tfile('a.drawio.svg');
    const { leaf: l, view } = leaf(file);
    syncDualFormatEditAction(plugin, l);
    const btn = view.containerEl.querySelector('[data-drawio-edit-action]');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-label')).toBe('Edit drawio diagram');
    btn?.dispatchEvent(new MouseEvent('click'));
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('does not claim a plain svg image tab', () => {
    const { plugin } = pluginWith();
    const { leaf: l, view } = leaf(tfile('logo.svg'));
    syncDualFormatEditAction(plugin, l);
    expect(view.containerEl.querySelector('[data-drawio-edit-action]')).toBeNull();
  });

  it('removes the action when the leaf navigates to a non-diagram file', () => {
    const { plugin } = pluginWith();
    const file = tfile('a.drawio.svg');
    const { leaf: l, view } = leaf(file);
    syncDualFormatEditAction(plugin, l);
    expect(view.containerEl.querySelector('[data-drawio-edit-action]')).not.toBeNull();
    view.file = tfile('note.md');
    syncDualFormatEditAction(plugin, l);
    expect(view.containerEl.querySelector('[data-drawio-edit-action]')).toBeNull();
  });
});
