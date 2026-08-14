import { describe, it, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import {
  resolveClickAction, resolveEditButtonAction, openWithDefaultApp,
} from '../src/preview/clickAction';

describe('resolveClickAction', () => {
  it('maps "editor" to the built-in editor on every surface', () => {
    for (const surface of ['codeblock', 'file'] as const) {
      const r = resolveClickAction('editor', surface);
      expect(r.kind).toBe('editor');
      expect(r.title).toBe('Click to edit diagram');
    }
  });

  it('maps "defaultApp" to the system default app for file-backed surfaces', () => {
    const r = resolveClickAction('defaultApp', 'file');
    expect(r.kind).toBe('defaultApp');
    expect(r.title).toBe('Click to open in default app');
  });

  it('falls back to the built-in editor for "defaultApp" on code blocks (no file)', () => {
    const r = resolveClickAction('defaultApp', 'codeblock');
    expect(r.kind).toBe('editor');
  });

  it('maps "none" to no action, no hint, and a plain tooltip on every surface', () => {
    for (const surface of ['codeblock', 'file'] as const) {
      const r = resolveClickAction('none', surface);
      expect(r.kind).toBe('none');
      expect(r.title).toBe('Drawio diagram');
    }
  });

  it('maps "interactive" to activation without opening an editor', () => {
    for (const surface of ['codeblock', 'file'] as const) {
      const r = resolveClickAction('interactive', surface);
      expect(r.kind).toBe('interactive');
      expect(r.title).toBe('Click to explore diagram');
    }
  });
});

describe('resolveEditButtonAction', () => {
  it('opens the selected editor action for file-backed previews', () => {
    expect(resolveEditButtonAction('editor', 'file').kind).toBe('editor');
    expect(resolveEditButtonAction('defaultApp', 'file').kind).toBe('defaultApp');
  });

  it('falls back to the built-in editor for code blocks', () => {
    expect(resolveEditButtonAction('defaultApp', 'codeblock').kind).toBe('editor');
  });
});

describe('openWithDefaultApp', () => {
  it('calls the app internal with the path when available', () => {
    const open = vi.fn();
    openWithDefaultApp({ openWithDefaultApp: open } as unknown as App, 'diagram.drawio');
    expect(open).toHaveBeenCalledWith('diagram.drawio');
  });

  it('does not throw when the internal is missing', () => {
    expect(() => openWithDefaultApp({} as App, 'diagram.drawio')).not.toThrow();
  });
});
