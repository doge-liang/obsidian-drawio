import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform, TFile } from 'obsidian';
import { DualFormatFileSource } from '../src/file/DualFormatFileSource';
import {
  handleDualFormatEmbedClick, syncDualFormatEditAction, registerDualFormatOpen,
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
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  Object.defineProperty(event, 'target', { value: img });
  return { event, span };
}

function registerOpenHandlers(plugin: DrawioPlugin): () => void {
  const cleanups: Array<() => void> = [];
  Object.assign(plugin, {
    registerDomEvent: (
      target: EventTarget, type: string, cb: EventListener, opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, cb, opts);
      cleanups.push(() => target.removeEventListener(type, cb, opts));
    },
    registerEvent: vi.fn(),
  });
  Object.assign(plugin.app.workspace, { on: vi.fn(), iterateAllLeaves: vi.fn() });
  registerDualFormatOpen(plugin);
  return () => cleanups.forEach(cleanup => cleanup());
}

const disposers: Array<() => void> = [];
function startResize(decorated = false) {
  const { plugin, openEditor } = pluginWith();
  disposers.push(registerOpenHandlers(plugin));
  const { span } = clickOnEmbed('diagram.drawio.svg', decorated);
  if (decorated) span.addEventListener('click', () => openEditor());
  const handle = document.createElement('div');
  handle.className = 'image-resize-corner';
  span.appendChild(handle);
  handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  return { span, img: span.querySelector('img')!, openEditor };
}

describe('handleDualFormatEmbedClick', () => {
  afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.empty(); });

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

  it('leaves native resize and embed-action controls alone', () => {
    const { plugin, openEditor } = pluginWith();
    for (const cls of ['image-resize-corner', 'embed-action']) {
      const { span } = clickOnEmbed('diagram.drawio.svg');
      const control = document.createElement('div');
      control.className = cls;
      span.appendChild(control);
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'target', { value: control });
      expect(handleDualFormatEmbedClick(plugin, event)).toBe(false);
    }
    expect(openEditor).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not open on a click retargeted after native image resize (Reading view: %s)', (decorated) => {
    const { span, img, openEditor } = startResize(decorated);
    span.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(openEditor).not.toHaveBeenCalled();
    img.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('does not suppress a keyboard click after resizing ends without a click', () => {
    const { span, openEditor } = startResize();
    const button = document.createElement('button');
    span.appendChild(button);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
    expect(openEditor).toHaveBeenCalledTimes(1);
  });

  it('keeps resize click suppression when a note input loses focus', () => {
    const { span, openEditor } = startResize();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new FocusEvent('blur'));
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(openEditor).not.toHaveBeenCalled();
  });

  it.each(['blur', 'pointercancel'])('clears resize suppression on %s', (type) => {
    const { img, openEditor } = startResize();
    (type === 'blur' ? window : document).dispatchEvent(new Event(type));
    img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(openEditor).toHaveBeenCalledTimes(1);
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
