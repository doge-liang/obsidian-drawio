import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownView, TFile } from 'obsidian';
import { registerDualFormatRefresh } from '../src/file/dualFormatRefresh';
import type DrawioPlugin from '../src/main';

function file(path: string, mtime = 2): TFile {
  return Object.assign(new TFile(), { path, stat: { mtime } });
}

function resourcePath(path: string, mtime = 1): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `app://vault-hash/Users/test/Test%20Vault/${encodedPath}?${mtime}`;
}

function markdownLeaf(path: string, doc = document) {
  const containerEl = doc.createElement('div');
  doc.body.appendChild(containerEl);
  const view = Object.assign(new MarkdownView({} as never), {
    file: file(path), containerEl,
  });
  return { view };
}

function embed(container: HTMLElement, path: string, targetPath = path) {
  const span = container.ownerDocument.createElement('span');
  span.className = 'internal-embed image-embed';
  span.setAttribute('src', path);
  const img = container.ownerDocument.createElement('img');
  img.src = resourcePath(targetPath);
  img.decode = vi.fn(async () => {});
  span.appendChild(img);
  container.appendChild(span);
  return img;
}

function setup(leaves: Array<{ view: unknown }>) {
  let modify: (changed: TFile) => void = () => {};
  const ref = {};
  const files = new Map<string, TFile>();
  const getAbstractFileByPath = vi.fn((path: string) => files.get(path) ?? null);
  const getResourcePath = vi.fn((f: TFile) => resourcePath(f.path, f.stat.mtime));
  const getFirstLinkpathDest = vi.fn();
  const registerEvent = vi.fn();
  const cleanups: Array<() => void> = [];
  const plugin = {
    app: {
      vault: {
        on: vi.fn((event: string, callback: typeof modify) => {
          expect(event).toBe('modify');
          modify = callback;
          return ref;
        }),
        getAbstractFileByPath,
        getResourcePath,
      },
      workspace: {
        iterateAllLeaves: (cb: (leaf: unknown) => void) => leaves.forEach(cb),
        on: vi.fn(() => ({})),
        containerEl: document.body,
      },
      metadataCache: { getFirstLinkpathDest },
    },
    registerEvent,
    register: (cleanup: () => void) => cleanups.push(cleanup),
  } as unknown as DrawioPlugin;
  registerDualFormatRefresh(plugin);
  const dispose = () => cleanups.forEach(cleanup => cleanup());
  disposers.push(dispose);
  return {
    emit: (changed: TFile) => { files.set(changed.path, changed); modify(changed); },
    files, getAbstractFileByPath, getResourcePath, getFirstLinkpathDest, registerEvent, ref, dispose,
  };
}

const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });

describe('dual-format native image refresh', () => {
  it('skips a deleted resource and uses the current file when its path is recreated', async () => {
    const target = file('attachments/diagram.drawio.svg');
    const leaf = markdownLeaf('notes/source.md');
    const image = embed(leaf.view.containerEl, target.path);
    const { emit, files } = setup([leaf]);
    emit(target);
    await new Promise(resolve => window.setTimeout(resolve, 0));

    files.delete(target.path);
    image.src = resourcePath(target.path);
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(image.src).toBe(resourcePath(target.path));
    expect(image.decode).toHaveBeenCalledOnce();

    const replacement = file(target.path, 3);
    files.set(replacement.path, replacement);
    image.src = resourcePath(replacement.path);
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(image.src).toBe(resourcePath(replacement.path, 3));
    expect(image.decode).toHaveBeenCalledTimes(2);
  });

  it('does not restore an old mtime when a renamed resource path is reused', async () => {
    const target = file('attachments/diagram.drawio.svg');
    const originalPath = target.path;
    const leaf = markdownLeaf('notes/source.md');
    const image = embed(leaf.view.containerEl, originalPath);
    const { emit, files } = setup([leaf]);
    emit(target);
    await new Promise(resolve => window.setTimeout(resolve, 0));

    files.delete(originalPath);
    target.path = 'attachments/renamed.drawio.svg';
    files.set(target.path, target);
    const replacement = file(originalPath, 3);
    files.set(originalPath, replacement);
    image.src = resourcePath(originalPath, 3);
    await new Promise(resolve => window.setTimeout(resolve, 0));

    expect(image.src).toBe(resourcePath(originalPath, 3));
    expect(image.decode).toHaveBeenCalledOnce();
  });

  it('refreshes an image reattached after a save without a second modify event', async () => {
    const target = file('attachments/diagram.drawio.svg');
    const leaf = markdownLeaf('notes/source.md');
    const image = embed(leaf.view.containerEl, target.path);
    const wrapper = image.parentElement!;
    wrapper.remove();
    const { emit } = setup([leaf]);

    emit(target);
    expect(image.src).toBe(resourcePath(target.path));
    leaf.view.containerEl.appendChild(wrapper);
    await new Promise(resolve => window.setTimeout(resolve, 0));

    expect(image.src).toBe(resourcePath(target.path, 2));
    expect(image.decode).toHaveBeenCalledOnce();
  });

  it('corrects a recycled image src and stops observing on unload', async () => {
    const target = file('attachments/diagram.drawio.svg');
    const leaf = markdownLeaf('notes/source.md');
    const image = embed(leaf.view.containerEl, target.path);
    const { emit, dispose } = setup([leaf]);
    emit(target);
    await new Promise(resolve => window.setTimeout(resolve, 0));
    image.src = resourcePath(target.path);
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(image.src).toBe(resourcePath(target.path, 2));
    expect(image.decode).toHaveBeenCalledTimes(2);

    dispose();
    image.src = resourcePath(target.path);
    await new Promise(resolve => window.setTimeout(resolve, 0));
    expect(image.src).toBe(resourcePath(target.path));
    expect(image.decode).toHaveBeenCalledTimes(2);
  });

  it('refreshes only matching mounted resources, including popout documents', () => {
    const target = file('a/diagram.drawio.png');
    const main = markdownLeaf('b/note.md');
    const mainImage = embed(main.view.containerEl, 'diagram.drawio.png', 'b/diagram.drawio.png');
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const popout = markdownLeaf('a/note.md', iframe.contentDocument!);
    const popoutImage = embed(popout.view.containerEl, 'diagram.drawio.png', target.path);
    const detached = markdownLeaf('a/closed.md');
    const detachedImage = embed(detached.view.containerEl, 'diagram.drawio.png', target.path);
    detached.view.containerEl.remove();
    const { emit, getResourcePath } = setup([main, popout, detached]);

    emit(target);
    target.stat.mtime = 3;
    emit(target);

    expect(popoutImage.src).toBe(resourcePath(target.path, 3));
    expect(popoutImage.ownerDocument).toBe(iframe.contentDocument);
    expect(popoutImage.decode).toHaveBeenCalledTimes(2);
    expect(mainImage.src).toBe(resourcePath('b/diagram.drawio.png'));
    expect(detachedImage.src).toBe(resourcePath(target.path));
    expect(getResourcePath).toHaveBeenCalledTimes(4);
  });

  it.each(['host', 'child'])('refreshes only the %s image across a nested transclusion with the same filename', (changed) => {
    const host = file('host/Diagram.drawio.svg');
    const child = file('child/Diagram.drawio.svg');
    const leaf = markdownLeaf('host/Host.md');
    const hostImage = embed(leaf.view.containerEl, 'Diagram.drawio.svg', host.path);
    const transclusion = document.createElement('div');
    transclusion.className = 'internal-embed markdown-embed';
    transclusion.setAttribute('src', 'child/Child.md');
    leaf.view.containerEl.appendChild(transclusion);
    const childImage = embed(transclusion, 'Diagram.drawio.svg', child.path);
    const { emit } = setup([leaf]);

    emit(changed === 'host' ? host : child);

    expect(hostImage.src).toBe(resourcePath(host.path, changed === 'host' ? 2 : 1));
    expect(childImage.src).toBe(resourcePath(child.path, changed === 'child' ? 2 : 1));
    expect(hostImage.decode).toHaveBeenCalledTimes(changed === 'host' ? 1 : 0);
    expect(childImage.decode).toHaveBeenCalledTimes(changed === 'child' ? 1 : 0);
  });

  it('preserves encoded filename characters when matching URLs across query and fragment changes', () => {
    const target = file('attachments/Design #1? 100% 图.drawio.svg');
    const leaf = markdownLeaf('notes/source.md');
    const image = embed(leaf.view.containerEl, target.path);
    image.src = `${resourcePath(target.path)}#page-2`;
    const other = embed(leaf.view.containerEl, 'Design.drawio.svg', 'attachments/Design.drawio.svg');
    const { emit, getFirstLinkpathDest } = setup([leaf]);

    emit(target);

    expect(image.src).toBe(resourcePath(target.path, 2));
    expect(image.src).toContain('Design%20%231%3F%20100%25%20%E5%9B%BE.drawio.svg');
    expect(image.decode).toHaveBeenCalledOnce();
    expect(other.src).toBe(resourcePath('attachments/Design.drawio.svg'));
    expect(other.decode).not.toHaveBeenCalled();
    expect(getFirstLinkpathDest).not.toHaveBeenCalled();
  });

  it('ignores unrelated modifications and images outside dual-format embeds', () => {
    const target = file('attachments/diagram.drawio.svg');
    const leaf = markdownLeaf('notes/source.md');
    const image = embed(leaf.view.containerEl, target.path);
    const plainImage = document.createElement('img');
    plainImage.src = resourcePath(target.path);
    plainImage.decode = vi.fn(async () => {});
    leaf.view.containerEl.appendChild(plainImage);
    const ordinaryEmbed = embed(leaf.view.containerEl, 'photo.svg', target.path);
    const { emit, getResourcePath, getFirstLinkpathDest } = setup([leaf]);

    for (const path of ['note.md', 'photo.svg', 'photo.png', 'diagram.drawio']) emit(file(path));
    expect(image.src).toBe(resourcePath(target.path));
    expect(getResourcePath).not.toHaveBeenCalled();

    emit(target);

    expect(image.src).toBe(resourcePath(target.path, 2));
    expect(plainImage.src).toBe(resourcePath(target.path));
    expect(ordinaryEmbed.src).toBe(resourcePath(target.path));
    expect(plainImage.decode).not.toHaveBeenCalled();
    expect(ordinaryEmbed.decode).not.toHaveBeenCalled();
    expect(getFirstLinkpathDest).not.toHaveBeenCalled();
  });

  it('refreshes matching standalone native image views, leaving other image views alone', () => {
    const target = file('attachments/diagram.drawio.png');
    function imageLeaf(path: string) {
      const containerEl = document.createElement('div');
      document.body.appendChild(containerEl);
      const img = document.createElement('img');
      img.src = resourcePath(path);
      img.decode = vi.fn(async () => {});
      containerEl.appendChild(img);
      return { view: { containerEl, getViewType: () => 'image', getState: () => ({ file: path }) }, img };
    }
    const matching = imageLeaf(target.path);
    const other = imageLeaf('attachments/other.drawio.png');
    const { emit } = setup([matching, other]);

    emit(target);

    expect(matching.img.src).toBe(resourcePath(target.path, 2));
    expect(matching.img.decode).toHaveBeenCalledOnce();
    expect(other.img.src).toBe(resourcePath('attachments/other.drawio.png'));
    expect(other.img.decode).not.toHaveBeenCalled();
  });

  it('refreshes only the modified attachment without replacing DOM or disturbing selection', () => {
    const target = file('attachments/diagram.drawio.svg');
    const leaf = markdownLeaf('notes/source.md');
    const image = embed(leaf.view.containerEl, '../attachments/diagram.drawio.svg#page', target.path);
    const other = embed(leaf.view.containerEl, 'other.drawio.svg');
    const photo = embed(leaf.view.containerEl, 'photo.svg');
    const text = document.createTextNode('keep this selection');
    leaf.view.containerEl.appendChild(text);
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 7);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    leaf.view.containerEl.scrollTop = 41;
    const children = Array.from(leaf.view.containerEl.childNodes);
    const sourceBefore = leaf.view.containerEl.textContent;
    const { emit, registerEvent, ref } = setup([leaf]);

    emit(target);

    expect(image.src).toBe(resourcePath(target.path, 2));
    expect(image.decode).toHaveBeenCalledOnce();
    expect(other.src).toBe(resourcePath('other.drawio.svg'));
    expect(photo.src).toBe(resourcePath('photo.svg'));
    expect(other.decode).not.toHaveBeenCalled();
    expect(photo.decode).not.toHaveBeenCalled();
    expect(Array.from(leaf.view.containerEl.childNodes)).toEqual(children);
    expect(leaf.view.containerEl.textContent).toBe(sourceBefore);
    expect(selection.anchorNode).toBe(text);
    expect(selection.anchorOffset).toBe(2);
    expect(selection.focusOffset).toBe(7);
    expect(leaf.view.containerEl.scrollTop).toBe(41);
    expect(registerEvent).toHaveBeenCalledWith(ref);
  });
});
