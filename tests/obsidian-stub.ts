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

// Renders an icon into `parent`. A no-op is enough for tests that only assert
// element structure — the icon glyph itself is not under test.
export function setIcon(_parent: HTMLElement, _iconId: string): void {}
