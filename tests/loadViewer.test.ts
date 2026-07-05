import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replace the 2.3 MB vendored viewer blob with a tiny stand-in that records how
// many times it is evaluated and installs a fake GraphViewer. This lets us prove
// the load path's semantics (indirect eval, run-once, offline globals, no
// <script> element) without transforming the real file.
vi.mock('../src/preview/viewer.min.txt', () => ({
  default:
    'window.__viewerEvalCount = (window.__viewerEvalCount || 0) + 1;' +
    'window.GraphViewer = { createViewerForElement: function () {} };',
}));

import {
  ensureViewerLoaded,
  getGraphViewer,
  __resetViewerForTests,
} from '../src/preview/loadViewer';

const w = () => window as unknown as Record<string, unknown>;

beforeEach(() => {
  __resetViewerForTests(document);
  const g = w();
  delete g.GraphViewer;
  delete g.__viewerEvalCount;
  delete g.STYLE_PATH;
  delete g.PROXY_URL;
});

describe('ensureViewerLoaded', () => {
  it('evaluates the vendored viewer and exposes GraphViewer', () => {
    expect(getGraphViewer(window)).toBeNull();
    ensureViewerLoaded(document);
    expect(w().__viewerEvalCount).toBe(1);
    expect(getGraphViewer(window)).not.toBeNull();
  });

  it('sets the offline mx globals before evaluating', () => {
    ensureViewerLoaded(document);
    const g = w();
    expect(g.mxLoadResources).toBe(false);
    expect(g.mxLoadStylesheets).toBe(false);
    expect(g.mxForceIncludes).toBe(false);
    expect(g.STYLE_PATH).toBe('.');
    expect(g.PROXY_URL).toBe('');
  });

  it('evaluates at most once per document (idempotent)', () => {
    ensureViewerLoaded(document);
    ensureViewerLoaded(document);
    ensureViewerLoaded(document);
    expect(w().__viewerEvalCount).toBe(1);
  });

  it('creates no <script> element (the review-scanner constraint)', () => {
    const before = document.getElementsByTagName('script').length;
    ensureViewerLoaded(document);
    expect(document.getElementsByTagName('script').length).toBe(before);
  });

  it('marks the document head with the load sentinel, cleared by the test reset', () => {
    ensureViewerLoaded(document);
    expect(document.head.dataset.drawioViewerLoaded).toBe('1');
    __resetViewerForTests(document);
    expect(document.head.dataset.drawioViewerLoaded).toBeUndefined();
  });
});

describe('getGraphViewer', () => {
  it('returns null when no GraphViewer is present on the window', () => {
    expect(getGraphViewer(window)).toBeNull();
  });
});
