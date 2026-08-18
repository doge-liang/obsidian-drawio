import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sanitizeViewerSource } from '../scripts/sanitize-viewer.mjs';

// Real vendored viewer, sanitized with the exact transform the build applies
// (shared via scripts/sanitize-viewer.mjs) — before this suite, the sanitized
// blob shipped without ever being executed by a test. Needs
// `npm run fetch-drawio` first (same prerequisite as a build); without it the
// suite skips instead of failing.
const viewerPath = join(process.cwd(), 'src/preview/viewer.min.txt');
const hasViewer = existsSync(viewerPath);

describe.skipIf(!hasViewer)('build-time viewer sanitization', () => {
  // Throws on snippet drift, so a changed minified shape fails this file at
  // collection — the same loud failure the build produces.
  const sanitized = hasViewer ? sanitizeViewerSource(readFileSync(viewerPath, 'utf8')) : '';

  it('removes every createElement("script") literal', () => {
    expect(sanitized).not.toContain('createElement("script")');
    expect(sanitized).not.toContain("createElement('script')");
  });

  it('collapses the SVG icon-script ternary to the namespaced branch', () => {
    expect(sanitized).toContain('k=f.createElementNS(mxConstants.NS_SVG,"script")');
  });

  it('still parses as JavaScript', () => {
    expect(() => new Function(sanitized)).not.toThrow();
  });

  it('still boots GraphViewer when evaluated', () => {
    const win = window as unknown as Record<string, unknown>;
    // Same offline pre-flight as loadViewer.ts, so the viewer neither fetches
    // resources nor auto-scans the document on load.
    win.mxLoadResources = false;
    win.mxLoadStylesheets = false;
    win.mxForceIncludes = false;
    win.STYLE_PATH = '.';
    win.RESOURCE_BASE = '.';
    win.mxBasePath = '.';
    win.PROXY_URL = '';
    win.onDrawioViewerLoad = (): void => { /* no-op */ };
    (win.eval as (code: string) => void)(sanitized);
    expect(win.GraphViewer).toBeTruthy();
  });
});
