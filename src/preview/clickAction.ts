import { App, Notice } from 'obsidian';
import type { EditButtonAction, PreviewClickAction } from '../settings';

export type PreviewSurface = 'codeblock' | 'file';

export interface ResolvedClickAction {
  kind: 'editor' | 'defaultApp' | 'interactive' | 'none';
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
  if (action === 'interactive') {
    return { kind: 'interactive', title: 'Click to explore diagram' };
  }
  if (action === 'defaultApp' && surface === 'file') {
    return { kind: 'defaultApp', title: 'Click to open in default app' };
  }
  return { kind: 'editor', title: 'Click to edit diagram' };
}

/** Resolve the explicit Edit button separately from preview activation. */
export function resolveEditButtonAction(
  action: EditButtonAction,
  surface: PreviewSurface,
): ResolvedClickAction {
  return resolveClickAction(action, surface);
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
