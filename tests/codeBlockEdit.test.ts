import { describe, it, expect } from 'vitest';
import { replaceCodeBlockBody } from '../src/model/codeBlockEdit';

const NL = '\n';

describe('replaceCodeBlockBody', () => {
  it('replaces body between fences (lineStart=fence, lineEnd=closing fence)', () => {
    const doc = ['# Note', '', '```drawio', 'OLD', '```', '', 'after'].join(NL);
    // section: lineStart=2 (```drawio), lineEnd=4 (```)
    const out = replaceCodeBlockBody(doc, 2, 4, 'NEW1\nNEW2');
    expect(out).toBe(['# Note', '', '```drawio', 'NEW1', 'NEW2', '```', '', 'after'].join(NL));
  });

  it('handles an empty original body', () => {
    const doc = ['```drawio', '```'].join(NL);
    const out = replaceCodeBlockBody(doc, 0, 1, 'X');
    expect(out).toBe(['```drawio', 'X', '```'].join(NL));
  });

  it('replaces the correct block when multiple blocks exist', () => {
    const doc = ['```drawio', 'A', '```', '', '```drawio', 'B', '```'].join(NL);
    const out = replaceCodeBlockBody(doc, 4, 6, 'B2'); // second block
    expect(out).toBe(['```drawio', 'A', '```', '', '```drawio', 'B2', '```'].join(NL));
  });

  it('preserves a trailing newline at end of document', () => {
    const doc = ['```drawio', 'A', '```', ''].join(NL);
    const out = replaceCodeBlockBody(doc, 0, 2, 'A2');
    expect(out).toBe(['```drawio', 'A2', '```', ''].join(NL));
  });

  it('writes CRLF body lines into a CRLF note instead of mixing line endings', () => {
    const doc = 'pre\r\n```drawio\r\nOLD1\r\nOLD2\r\n```\r\npost';
    const out = replaceCodeBlockBody(doc, 1, 4, 'NEW1\nNEW2');
    expect(out).toBe('pre\r\n```drawio\r\nNEW1\r\nNEW2\r\n```\r\npost');
  });
});
