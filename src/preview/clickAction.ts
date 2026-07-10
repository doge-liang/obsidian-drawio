import { App, Notice } from 'obsidian';
import type { PreviewClickAction } from '../settings';

export type PreviewSurface = 'codeblock' | 'file';

export interface ResolvedClickAction {
  kind: 'editor' | 'defaultApp' | 'none';
  /** Hover-hint label and icon; absent when kind is 'none' (no hint shown). */
  hint?: { label: string; icon: string };
  /** Tooltip for the preview container. */
  title: string;
}

/**
 * Map the click-action setting to concrete per-surface behavior. Code blocks
 * have no underlying file, so 'defaultApp' falls back to the built-in editor
 * there — the only surface-dependent row in the matrix.
 */
export function resolveClickAction(
  action: PreviewClickAction,
  surface: PreviewSurface,
): ResolvedClickAction {
  if (action === 'none') return { kind: 'none', title: 'Drawio diagram' };
  if (action === 'defaultApp' && surface === 'file') {
    return {
      kind: 'defaultApp',
      hint: { label: 'Open', icon: 'external-link' },
      title: 'Click to open in default app',
    };
  }
  return { kind: 'editor', hint: { label: 'Edit', icon: 'pencil' }, title: 'Click to edit diagram' };
}

/**
 * Open a vault file in the OS default application. `App.openWithDefaultApp`
 * is an Obsidian internal that isn't in the public typings, so it's
 * feature-detected (same pattern as EmbedRenderer's embedRegistry) with a
 * Notice fallback instead of a throw.
 */
export function openWithDefaultApp(app: App, path: string): void {
  const internal = app as unknown as { openWithDefaultApp?: (path: string) => unknown };
  if (typeof internal.openWithDefaultApp === 'function') {
    internal.openWithDefaultApp(path);
  } else {
    new Notice('Drawio: this Obsidian version cannot open files in the default app.');
  }
}
