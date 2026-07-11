/** Progress events emitted by the offline-webapp installer. Download progress
 * is per-chunk; extraction is a single coarse phase (fflate's unzipSync is
 * synchronous — deliberately no finer granularity, per the design spec). */
export type InstallProgress =
  | { phase: 'download'; received: number; total: number | null }
  | { phase: 'extract' };
