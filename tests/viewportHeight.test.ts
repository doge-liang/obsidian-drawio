import { describe, expect, it } from 'vitest';
import {
  parseViewportHeightComment,
  upsertViewportHeightComment,
} from '../src/preview/viewportHeight';

describe('viewport height Markdown metadata', () => {
  it('parses only the dedicated integer-pixel comment', () => {
    expect(parseViewportHeightComment('<!-- drawio-viewer: height=480 -->')).toBe(480);
    expect(parseViewportHeightComment('  <!-- drawio-viewer: height=80 -->')).toBe(80);
    expect(parseViewportHeightComment('<!-- drawio-viewer: height=50% -->')).toBeNull();
    expect(parseViewportHeightComment('<!-- other: height=480 -->')).toBeNull();
  });

  it('inserts a comment immediately before the selected code block', () => {
    const doc = ['before', '```drawio', '<mxfile/>', '```', 'after'].join('\n');
    expect(upsertViewportHeightComment(doc, 1, 480)).toBe(
      ['before', '<!-- drawio-viewer: height=480 -->', '```drawio', '<mxfile/>', '```', 'after'].join('\n'),
    );
  });

  it('updates the existing dedicated comment without touching neighboring text', () => {
    const doc = [
      '<!-- drawio-viewer: height=320 -->',
      '```drawio',
      '<mxfile/>',
      '```',
      '<!-- drawio-viewer: height=900 -->',
      '```drawio',
      '<mxfile/>',
      '```',
    ].join('\n');
    expect(upsertViewportHeightComment(doc, 5, 640)).toBe([
      '<!-- drawio-viewer: height=320 -->',
      '```drawio',
      '<mxfile/>',
      '```',
      '<!-- drawio-viewer: height=640 -->',
      '```drawio',
      '<mxfile/>',
      '```',
    ].join('\n'));
  });
});
