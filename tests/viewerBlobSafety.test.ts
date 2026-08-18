import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// A regex literal's syntax is validated when the whole script is PARSED, not
// when the line runs, so one unsupported construct anywhere in the vendored
// blob crashes plugin load on older iOS before onload() even runs — see the
// regex checklist in CLAUDE.md. This automates the pre-ship grep that used to
// be a manual step in every drawio bump PR. Substring counting can in theory
// over-match (the sequences could appear inside an ordinary string); that
// noise is acceptable — a hit means a human inspects the new blob, which is
// exactly the intended behavior.
const viewerPath = join(process.cwd(), 'src/preview/viewer.min.txt');
const hasViewer = existsSync(viewerPath);

describe.skipIf(!hasViewer)('vendored viewer regex safety', () => {
  const blob = hasViewer ? readFileSync(viewerPath, 'utf8') : '';

  const count = (needle: string): number => blob.split(needle).length - 1;

  it('contains no lookbehind assertions (iOS < 16.4 parse failure)', () => {
    expect(count('(?<=')).toBe(0);
    expect(count('(?<!')).toBe(0);
  });

  it('contains no named capture groups', () => {
    expect(blob.match(/\(\?<[A-Za-z_$]/g) ?? []).toEqual([]);
  });

  it('contains no Unicode property escapes', () => {
    expect(count('\\p{')).toBe(0);
    expect(count('\\P{')).toBe(0);
  });
});
