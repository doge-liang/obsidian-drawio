/** Progress events emitted by the offline-webapp installer. Download progress
 * is per-chunk; extraction is a single coarse phase (fflate's unzipSync is
 * synchronous — deliberately no finer granularity, per the design spec). */
export type InstallProgress =
  | { phase: 'download'; received: number; total: number | null }
  | { phase: 'extract' };

/** UI-facing install state, held on the plugin instance so it outlives
 * settings-tab re-renders (display() rebuilds the whole pane at any time). */
export type WebappInstallState =
  | { status: 'idle' }
  | { status: 'installing'; progressText: string }
  | { status: 'error'; message: string };

/** Single-listener state holder: the settings row re-subscribes on every
 * render, and only one settings pane exists, so last-subscriber-wins is
 * exactly the right semantics. */
export class InstallStatus {
  state: WebappInstallState = { status: 'idle' };
  private listener: ((s: WebappInstallState) => void) | null = null;

  set(state: WebappInstallState): void {
    this.state = state;
    this.listener?.(state);
  }

  subscribe(cb: (s: WebappInstallState) => void): void {
    this.listener = cb;
  }
}

export function formatInstallProgress(p: InstallProgress): string {
  if (p.phase === 'extract') return 'Extracting…';
  if (p.total) return `Downloading… ${Math.floor((p.received / p.total) * 100)}%`;
  return `Downloading… ${(p.received / (1024 * 1024)).toFixed(1)} MB`;
}
