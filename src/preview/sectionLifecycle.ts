import { MarkdownRenderChild } from 'obsidian';

/**
 * Tracks whether the markdown section that owns a rendered preview is alive.
 *
 * Register one with `ctx.addChild` synchronously — before any awaits — then
 * queue lifecycle-sensitive work through {@link whenReady}. Obsidian loads a
 * child of a live section immediately (or when the section itself loads
 * later), but a child added to an already-torn-down section is stored and
 * never loaded: queued work then simply never runs, so nothing that needs a
 * later teardown is ever created. This also covers the ordering race where
 * async rendering finishes before the section's load is dispatched — the
 * work is queued and runs from `onload` instead of being silently skipped.
 */
export class SectionLifecycle extends MarkdownRenderChild {
  private loadedOnce = false;
  private torndown = false;
  private readyCallbacks: Array<() => void> = [];

  onload(): void {
    this.loadedOnce = true;
    for (const cb of this.readyCallbacks.splice(0)) cb();
  }

  onunload(): void {
    this.torndown = true;
    this.readyCallbacks.length = 0;
  }

  /**
   * Runs `cb` once the section is loaded (immediately when it already is);
   * drops it when the section is — or later gets — torn down first.
   */
  whenReady(cb: () => void): void {
    if (this.torndown) return;
    if (this.loadedOnce) cb();
    else this.readyCallbacks.push(cb);
  }
}
