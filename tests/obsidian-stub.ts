// Minimal runtime stub for the 'obsidian' package (which ships types only, so
// Vite cannot resolve it in tests). Aliased in vitest.config.ts. Add exports
// here as tested modules need them.
export class Notice {
  constructor(_message?: string, _timeout?: number) {}
}

export class TFolder {
  path = '';
  name = '';
}

export class TFile {
  path = '';
  basename = '';
  extension = '';
}

export class TextFileView {
  contentEl: HTMLElement = document.createElement('div');
  file: TFile | null = null;
  data = '';
  constructor(_leaf: unknown) {}
  getViewType(): string { return ''; }
  getIcon(): string { return ''; }
  getViewData(): string { return this.data; }
  setViewData(_data: string, _clear: boolean): void {}
  clear(): void {}
  async onClose(): Promise<void> {}
  requestSave(): void {}
}

export class MarkdownView extends TextFileView {
  editor: unknown;
}

export class FileSystemAdapter {
  getBasePath(): string { return ''; }
}

export class Plugin {
  constructor(_app: unknown, _manifest: unknown) {}
}

export class Modal {
  constructor(_app: unknown) {}
}

export const Platform = {
  isDesktopApp: true,
  isMobileApp: false,
  isMobile: false,
  isPhone: false,
  isTablet: false,
};

// Renders an icon into `parent`. A no-op is enough for tests that only assert
// element structure — the icon glyph itself is not under test.
export function setIcon(_parent: HTMLElement, _iconId: string): void {}

export class PluginSettingTab {
  containerEl: HTMLElement;
  constructor(_app: unknown, _plugin: unknown) {
    this.containerEl = document.createElement('div');
  }
}

export class DropdownComponent {
  selectEl = document.createElement('select');
  constructor(containerEl?: HTMLElement) { containerEl?.appendChild(this.selectEl); }
  addOption(value: string, label: string): this {
    this.selectEl.appendChild(new Option(label, value));
    return this;
  }
  setValue(value: string): this { this.selectEl.value = value; return this; }
  setDisabled(disabled: boolean): this { this.selectEl.disabled = disabled; return this; }
  onChange(_cb: (value: string) => void): this { return this; }
}

class ToggleComponent {
  setValue(_value: boolean): this { return this; }
  onChange(_cb: (value: boolean) => void): this { return this; }
}

class TextComponent {
  inputEl: HTMLInputElement = document.createElement('input');
  setPlaceholder(_p: string): this { return this; }
  setValue(_v: string): this { return this; }
  onChange(_cb: (value: string) => void): this { return this; }
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement = document.createElement('button');
  setButtonText(t: string): this { this.buttonEl.textContent = t; return this; }
  setCta(): this { this.buttonEl.classList.add('mod-cta'); return this; }
  removeCta(): this { this.buttonEl.classList.remove('mod-cta'); return this; }
  setDisabled(d: boolean): this { this.buttonEl.disabled = d; return this; }
  onClick(cb: (evt: MouseEvent) => unknown): this {
    this.buttonEl.addEventListener('click', () => { void cb(new MouseEvent('click')); });
    return this;
  }
}

export class Setting {
  settingEl: HTMLElement;
  descEl: HTMLElement;
  private nameEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement('div');
    this.settingEl.className = 'setting-item';
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'setting-item-name';
    this.settingEl.appendChild(this.nameEl);
    this.descEl = document.createElement('div');
    this.descEl.className = 'setting-item-description';
    this.settingEl.appendChild(this.descEl);
    containerEl.appendChild(this.settingEl);
  }
  setName(name: string): this { this.nameEl.textContent = name; return this; }
  setDesc(desc: string): this { this.descEl.textContent = desc; return this; }
  addDropdown(cb: (d: DropdownComponent) => unknown): this {
    const dropdown = new DropdownComponent(this.settingEl);
    cb(dropdown);
    return this;
  }
  addToggle(cb: (t: ToggleComponent) => unknown): this { cb(new ToggleComponent()); return this; }
  addText(cb: (t: TextComponent) => unknown): this { cb(new TextComponent()); return this; }
  addButton(cb: (b: ButtonComponent) => unknown): this {
    const b = new ButtonComponent();
    this.settingEl.appendChild(b.buttonEl);
    cb(b);
    return this;
  }
}

// Mirrors obsidian's Component lifecycle contract: `load()` fires `onload`
// once and cascades to children; `addChild` loads the child immediately when
// the parent is already loaded; `unload()` runs children, `register`ed
// callbacks, then `onunload`.
export class Component {
  private loaded = false;
  private children: Component[] = [];
  private unloadCallbacks: Array<() => void> = [];
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.onload();
    for (const child of this.children) child.load();
  }
  unload(): void {
    if (!this.loaded) return;
    this.loaded = false;
    for (const child of this.children.splice(0)) child.unload();
    for (const cb of this.unloadCallbacks.splice(0)) cb();
    this.onunload();
  }
  addChild<T extends Component>(component: T): T {
    this.children.push(component);
    if (this.loaded) component.load();
    return component;
  }
  register(cb: () => void): void { this.unloadCallbacks.push(cb); }
  registerEvent(_ref: unknown): void {}
  onload(): void {}
  onunload(): void {}
}

export class MarkdownRenderChild extends Component {
  containerEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    super();
    this.containerEl = containerEl;
  }
}

/** Split "path#subpath" — subpath keeps its leading '#', '' when absent. */
export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const i = linktext.indexOf('#');
  return i === -1
    ? { path: linktext, subpath: '' }
    : { path: linktext.slice(0, i), subpath: linktext.slice(i) };
}
