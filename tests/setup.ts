// Obsidian exposes `activeDocument`/`activeWindow` globals (popout-window aware).
// jsdom doesn't, so map them to the test document/window for code that defaults
// to them.
const g = globalThis as unknown as { activeDocument?: Document; activeWindow?: Window };
g.activeDocument = document;
g.activeWindow = window;

// Obsidian's runtime extends HTMLElement with these DOM-building helpers.
// jsdom doesn't have them; shim the common ones globally so source code that
// uses them (createDiv/createSpan/createEl/empty) works in tests without each
// test file re-inventing the same patch.
interface ElAttrs { cls?: string | string[]; text?: string; }

function applyElAttrs(el: HTMLElement, attrs?: ElAttrs): void {
  if (!attrs) return;
  if (attrs.cls) el.className = Array.isArray(attrs.cls) ? attrs.cls.join(' ') : attrs.cls;
  if (attrs.text !== undefined) el.textContent = attrs.text;
}

const proto = HTMLElement.prototype as any;
proto.empty = function (this: HTMLElement) {
  while (this.firstChild) this.removeChild(this.firstChild);
};
proto.createDiv = function (this: HTMLElement, attrs?: ElAttrs) {
  const child = document.createElement('div');
  applyElAttrs(child, attrs);
  this.appendChild(child);
  return child;
};
proto.createSpan = function (this: HTMLElement, attrs?: ElAttrs) {
  const child = document.createElement('span');
  applyElAttrs(child, attrs);
  this.appendChild(child);
  return child;
};
proto.createEl = function (this: HTMLElement, tag: string, attrs?: ElAttrs) {
  const child = document.createElement(tag);
  applyElAttrs(child, attrs);
  this.appendChild(child);
  return child;
};
proto.addClass = function (this: HTMLElement, ...cls: string[]) {
  this.classList.add(...cls);
};
proto.toggleClass = function (this: HTMLElement, cls: string | string[], value: boolean) {
  for (const c of Array.isArray(cls) ? cls : [cls]) this.classList.toggle(c, value);
};
proto.removeClasses = function (this: HTMLElement, cls: string[]) {
  this.classList.remove(...cls);
};
