import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installFromWar } from '../src/desktop/webappInstaller';
import { DRAWIO_VERSION } from '../src/constants';

function makeWar(entries: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    'index.html': strToU8('<html>drawio</html>'),
    'js/viewer.min.js': strToU8('// viewer'),
    'WEB-INF/web.xml': strToU8('<web-app/>'),
    'META-INF/MANIFEST.MF': strToU8('Manifest-Version: 1.0'),
    ...entries,
  });
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'drawio-install-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('installFromWar', () => {
  it('extracts the webapp, skipping WEB-INF/META-INF, and writes DRAWIO_VERSION', () => {
    installFromWar(makeWar(), dir);
    expect(readFileSync(join(dir, 'webapp', 'index.html'), 'utf8')).toBe('<html>drawio</html>');
    expect(existsSync(join(dir, 'webapp', 'js', 'viewer.min.js'))).toBe(true);
    expect(existsSync(join(dir, 'webapp', 'WEB-INF'))).toBe(false);
    expect(existsSync(join(dir, 'webapp', 'META-INF'))).toBe(false);
    expect(readFileSync(join(dir, 'webapp', 'DRAWIO_VERSION'), 'utf8').trim()).toBe(DRAWIO_VERSION);
    expect(existsSync(join(dir, 'webapp.installing'))).toBe(false);
  });

  it('replaces an existing webapp atomically', () => {
    mkdirSync(join(dir, 'webapp'), { recursive: true });
    writeFileSync(join(dir, 'webapp', 'stale.txt'), 'old');
    installFromWar(makeWar(), dir);
    expect(existsSync(join(dir, 'webapp', 'stale.txt'))).toBe(false);
    expect(existsSync(join(dir, 'webapp', 'index.html'))).toBe(true);
  });

  it('cleans leftover webapp.installing from a previously interrupted run', () => {
    mkdirSync(join(dir, 'webapp.installing'), { recursive: true });
    writeFileSync(join(dir, 'webapp.installing', 'junk.txt'), 'junk');
    installFromWar(makeWar(), dir);
    expect(existsSync(join(dir, 'webapp', 'junk.txt'))).toBe(false);
    expect(existsSync(join(dir, 'webapp', 'index.html'))).toBe(true);
  });

  it('rejects an archive missing required files, keeping the old webapp intact', () => {
    mkdirSync(join(dir, 'webapp'), { recursive: true });
    writeFileSync(join(dir, 'webapp', 'index.html'), 'previous install');
    const bad = zipSync({ 'js/viewer.min.js': strToU8('// viewer only') });
    expect(() => installFromWar(bad, dir)).toThrow(/index\.html/);
    // Old install untouched, staging cleaned up.
    expect(readFileSync(join(dir, 'webapp', 'index.html'), 'utf8')).toBe('previous install');
    expect(existsSync(join(dir, 'webapp.installing'))).toBe(false);
  });

  it('rejects zip entries that escape the target directory (zip-slip)', () => {
    // If fflate's zipSync ever refuses to create '../' entry names, keep the
    // guard in the implementation and adapt this test to call the exported
    // path check directly instead of deleting the test.
    const evil = makeWar({ '../evil.txt': strToU8('escape') });
    expect(() => installFromWar(evil, dir)).toThrow(/[Uu]nsafe zip entry/);
    expect(existsSync(join(dir, 'evil.txt'))).toBe(false);
    expect(existsSync(join(dir, 'webapp.installing'))).toBe(false);
  });
});
