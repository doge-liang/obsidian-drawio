import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DRAWIO_VERSION, DRAWIO_WAR_URL } from '../src/constants';

// The runtime installer (src/desktop/webappInstaller.ts) and the build-time
// fetch script must install the exact same drawio version, or the bundled
// viewer.min.txt and the installed webapp drift apart.
describe('drawio version pinning', () => {
  it('matches the version pinned in scripts/fetch-drawio.mjs', () => {
    const script = readFileSync('scripts/fetch-drawio.mjs', 'utf8');
    const m = script.match(/DRAWIO_VERSION = '([^']+)'/);
    expect(m?.[1]).toBe(DRAWIO_VERSION);
  });

  it('builds the war URL from the pinned version', () => {
    expect(DRAWIO_WAR_URL).toBe(
      `https://github.com/jgraph/drawio/releases/download/${DRAWIO_VERSION}/draw.war`,
    );
  });
});
