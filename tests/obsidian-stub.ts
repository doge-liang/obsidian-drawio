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

class DropdownComponent {
  addOption(_value: string, _label: string): this { return this; }
  setValue(_value: string): this { return this; }
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

export class Setting {
  settingEl: HTMLElement;
  private nameEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement('div');
    this.settingEl.className = 'setting-item';
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'setting-item-name';
    this.settingEl.appendChild(this.nameEl);
    containerEl.appendChild(this.settingEl);
  }
  setName(name: string): this { this.nameEl.textContent = name; return this; }
  setDesc(_desc: string): this { return this; }
  addDropdown(cb: (d: DropdownComponent) => unknown): this { cb(new DropdownComponent()); return this; }
  addToggle(cb: (t: ToggleComponent) => unknown): this { cb(new ToggleComponent()); return this; }
  addText(cb: (t: TextComponent) => unknown): this { cb(new TextComponent()); return this; }
}
