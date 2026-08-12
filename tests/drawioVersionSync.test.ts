import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DRAWIO_VERSION, DRAWIO_WAR_SHA256, DRAWIO_WAR_URL } from '../src/constants';

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

  // Both download paths must accept the exact same bytes; the script can't
  // import the TS constant, so the two literals are pinned to each other here.
  it('matches the draw.war SHA-256 pinned in scripts/fetch-drawio.mjs', () => {
    const script = readFileSync('scripts/fetch-drawio.mjs', 'utf8');
    const m = script.match(/WAR_SHA256 = '([^']+)'/);
    expect(m?.[1]).toBe(DRAWIO_WAR_SHA256);
  });

  it('verifies the archive in scripts/fetch-drawio.mjs before extracting it', () => {
    const script = readFileSync('scripts/fetch-drawio.mjs', 'utf8');
    const verifiedAt = script.indexOf('await verifyWarChecksum(');
    const extractedAt = script.indexOf("console.log('Extracting ...')");
    expect(verifiedAt).toBeGreaterThan(-1);
    expect(extractedAt).toBeGreaterThan(-1);
    expect(verifiedAt).toBeLessThan(extractedAt);
  });
});
