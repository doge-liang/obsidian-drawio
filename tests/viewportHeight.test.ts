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

  it('parses the comment behind blockquote markers and a trailing CR', () => {
    expect(parseViewportHeightComment('> <!-- drawio-viewer: height=480 -->')).toBe(480);
    expect(parseViewportHeightComment('> > <!-- drawio-viewer: height=200 -->')).toBe(200);
    expect(parseViewportHeightComment('<!-- drawio-viewer: height=480 -->\r')).toBe(480);
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

  it('reproduces the callout prefix when inserting inside a blockquote', () => {
    const doc = [
      '> [!note] Diagram',
      '> ![[diagram.drawio]]',
      'after',
    ].join('\n');
    expect(upsertViewportHeightComment(doc, 1, 420)).toBe([
      '> [!note] Diagram',
      '> <!-- drawio-viewer: height=420 -->',
      '> ![[diagram.drawio]]',
      'after',
    ].join('\n'));
  });

  it('reproduces nested blockquote markers and updates in place inside a callout', () => {
    const inserted = upsertViewportHeightComment('> > ![[diagram.drawio]]', 0, 300);
    expect(inserted).toBe('> > <!-- drawio-viewer: height=300 -->\n> > ![[diagram.drawio]]');
    // Second write updates the existing prefixed comment instead of stacking.
    expect(upsertViewportHeightComment(inserted!, 1, 350)).toBe(
      '> > <!-- drawio-viewer: height=350 -->\n> > ![[diagram.drawio]]',
    );
  });

  it('refuses to insert above a table row rather than corrupt the table', () => {
    const doc = [
      '| left | right |',
      '| --- | --- |',
      '| ![[diagram.drawio]] | text |',
    ].join('\n');
    expect(upsertViewportHeightComment(doc, 2, 480)).toBeNull();
  });

  it('refuses to insert above a table row inside a callout', () => {
    const doc = [
      '> | a | b |',
      '> | - | - |',
      '> | ![[diagram.drawio]] | x |',
    ].join('\n');
    expect(upsertViewportHeightComment(doc, 2, 480)).toBeNull();
  });

  it('refuses borderless GFM table rows (any unescaped pipe outside a wikilink)', () => {
    expect(upsertViewportHeightComment('a | ![[diagram.drawio]] | b', 0, 480)).toBeNull();
    expect(upsertViewportHeightComment('cell | ![[diagram.drawio]]', 0, 480)).toBeNull();
  });

  it('still writes for wikilink aliases and escaped pipes (not table delimiters)', () => {
    expect(upsertViewportHeightComment('![[diagram.drawio|Architecture]]', 0, 480)).toBe(
      '<!-- drawio-viewer: height=480 -->\n![[diagram.drawio|Architecture]]',
    );
    expect(upsertViewportHeightComment('price \\| note ![[diagram.drawio]]', 0, 480)).toBe(
      '<!-- drawio-viewer: height=480 -->\nprice \\| note ![[diagram.drawio]]',
    );
  });

  it('refuses the callout title line — the [!type] marker must stay on the first quote line', () => {
    expect(upsertViewportHeightComment('> [!note] ![[diagram.drawio]]', 0, 480)).toBeNull();
    expect(upsertViewportHeightComment('> > [!tip] ![[diagram.drawio]]', 0, 480)).toBeNull();
    // Outside a blockquote `[!` is plain text, not a callout marker.
    expect(upsertViewportHeightComment('[!not-a-callout] ![[diagram.drawio]]', 0, 480)).toBe(
      '<!-- drawio-viewer: height=480 -->\n[!not-a-callout] ![[diagram.drawio]]',
    );
  });

  it('keeps the existing comment line prefix when updating after the embed was de-quoted', () => {
    const doc = [
      '> <!-- drawio-viewer: height=300 -->',
      '![[diagram.drawio]]',
    ].join('\n');
    expect(upsertViewportHeightComment(doc, 1, 350)).toBe([
      '> <!-- drawio-viewer: height=350 -->',
      '![[diagram.drawio]]',
    ].join('\n'));
  });

  it('refuses to insert directly above a list-item marker line', () => {
    expect(upsertViewportHeightComment('- ![[diagram.drawio]]', 0, 480)).toBeNull();
    expect(upsertViewportHeightComment('1. ![[diagram.drawio]]', 0, 480)).toBeNull();
    expect(upsertViewportHeightComment('* ![[diagram.drawio]]', 0, 480)).toBeNull();
  });

  it('still updates an existing comment above a list item without restructuring', () => {
    const doc = [
      '<!-- drawio-viewer: height=200 -->',
      '- ![[diagram.drawio]]',
    ].join('\n');
    expect(upsertViewportHeightComment(doc, 1, 260)).toBe([
      '<!-- drawio-viewer: height=260 -->',
      '- ![[diagram.drawio]]',
    ].join('\n'));
  });

  it('keeps indentation for fences nested in list items', () => {
    const doc = [
      '- item',
      '  ```drawio',
      '  <mxfile/>',
      '  ```',
    ].join('\n');
    expect(upsertViewportHeightComment(doc, 1, 480)).toBe([
      '- item',
      '  <!-- drawio-viewer: height=480 -->',
      '  ```drawio',
      '  <mxfile/>',
      '  ```',
    ].join('\n'));
  });

  it('inserts a CRLF comment above the final line of a CRLF note without a trailing newline', () => {
    // The anchor itself carries no CR (it is the last line), but the inserted
    // line is never file-final, so it must still match the file's CRLF style.
    expect(upsertViewportHeightComment('a\r\n![[diagram.drawio]]', 1, 480)).toBe(
      'a\r\n<!-- drawio-viewer: height=480 -->\r\n![[diagram.drawio]]',
    );
  });

  it('preserves CRLF line endings when inserting and updating', () => {
    const doc = 'before\r\n```drawio\r\n<mxfile/>\r\n```\r\nafter';
    const inserted = upsertViewportHeightComment(doc, 1, 480);
    expect(inserted).toBe(
      'before\r\n<!-- drawio-viewer: height=480 -->\r\n```drawio\r\n<mxfile/>\r\n```\r\nafter',
    );
    expect(upsertViewportHeightComment(inserted!, 2, 520)).toBe(
      'before\r\n<!-- drawio-viewer: height=520 -->\r\n```drawio\r\n<mxfile/>\r\n```\r\nafter',
    );
  });
});
