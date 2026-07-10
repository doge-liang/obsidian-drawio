import { setIcon } from 'obsidian';

/**
 * Add a centered, hover-revealed action hint over a clickable diagram preview
 * ("Edit" by default; e.g. "Open" when the click action is the default app).
 * The hint is non-interactive (pointer-events: none in CSS) so clicks fall through
 * to the preview's own click handler. Placed centrally rather than in a
 * corner so it never collides with other plugins' code-block buttons.
 */
export function addEditHint(parent: HTMLElement, label = 'Edit', icon = 'pencil'): void {
  const hint = parent.createDiv({ cls: 'drawio-edit-hint' });
  setIcon(hint.createSpan({ cls: 'drawio-edit-hint-icon' }), icon);
  hint.createSpan({ text: label });
}
