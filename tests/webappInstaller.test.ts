import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installFromWar, swapWebappIntoPlace, verifyWarChecksum,
} from '../src/desktop/webappInstaller';
import { DRAWIO_VERSION, DRAWIO_WAR_SHA256 } from '../src/constants';

function makeWar(entries: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    'index.html': strToU8('<html>drawio</html>'),
    'js/viewer.min.js': strToU8('// viewer'),
    'WEB-INF/web.xml': strToU8('<web-app/>'),
    'META-INF/MANIFEST.MF': strToU8('Manifest-Version: 1.0'),
    ...entries,
  });
}

/** These synthetic archives are not the pinned draw.war, so every install call
 * below must state the digest it expects — exactly the checksum gate under
 * test. `installFromWar(war, dir)` without it uses the real pin and fails. */
const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'drawio-install-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('installFromWar', () => {
  it('extracts the webapp, skipping WEB-INF/META-INF, and writes DRAWIO_VERSION', () => {
    const war = makeWar();
    installFromWar(war, dir, sha256(war));
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
    const war = makeWar();
    installFromWar(war, dir, sha256(war));
    expect(existsSync(join(dir, 'webapp', 'stale.txt'))).toBe(false);
    expect(existsSync(join(dir, 'webapp', 'index.html'))).toBe(true);
    expect(existsSync(join(dir, 'webapp.old'))).toBe(false);
  });

  it('cleans leftover webapp.installing from a previously interrupted run', () => {
    mkdirSync(join(dir, 'webapp.installing'), { recursive: true });
    writeFileSync(join(dir, 'webapp.installing', 'junk.txt'), 'junk');
    const war = makeWar();
    installFromWar(war, dir, sha256(war));
    expect(existsSync(join(dir, 'webapp', 'junk.txt'))).toBe(false);
    expect(existsSync(join(dir, 'webapp', 'index.html'))).toBe(true);
  });

  it('rejects an archive missing required files, keeping the old webapp intact', () => {
    mkdirSync(join(dir, 'webapp'), { recursive: true });
    writeFileSync(join(dir, 'webapp', 'index.html'), 'previous install');
    const bad = zipSync({ 'js/viewer.min.js': strToU8('// viewer only') });
    expect(() => installFromWar(bad, dir, sha256(bad))).toThrow(/index\.html/);
    // Old install untouched, staging cleaned up.
    expect(readFileSync(join(dir, 'webapp', 'index.html'), 'utf8')).toBe('previous install');
    expect(existsSync(join(dir, 'webapp.installing'))).toBe(false);
  });

  it('rejects zip entries that escape the target directory (zip-slip)', () => {
    // If fflate's zipSync ever refuses to create '../' entry names, keep the
    // guard in the implementation and adapt this test to call the exported
    // path check directly instead of deleting the test.
    const evil = makeWar({ '../evil.txt': strToU8('escape') });
    expect(() => installFromWar(evil, dir, sha256(evil))).toThrow(/[Uu]nsafe zip entry/);
    expect(existsSync(join(dir, 'evil.txt'))).toBe(false);
    expect(existsSync(join(dir, 'webapp.installing'))).toBe(false);
  });
});

describe('installFromWar checksum gate', () => {
  it('installs an archive whose digest matches the expected one', () => {
    const war = makeWar();
    expect(() => installFromWar(war, dir, sha256(war))).not.toThrow();
    expect(existsSync(join(dir, 'webapp', 'index.html'))).toBe(true);
  });

  it('aborts on a digest mismatch without touching the filesystem', () => {
    mkdirSync(join(dir, 'webapp'), { recursive: true });
    writeFileSync(join(dir, 'webapp', 'index.html'), 'previous install');
    expect(() => installFromWar(makeWar(), dir, 'f'.repeat(64)))
      .toThrow(/does not match the checksum/);
    // The gate runs before every write: the old install is byte-identical and
    // no staging dir was ever created.
    expect(readFileSync(join(dir, 'webapp', 'index.html'), 'utf8')).toBe('previous install');
    expect(existsSync(join(dir, 'webapp.installing'))).toBe(false);
    expect(existsSync(join(dir, 'webapp.old'))).toBe(false);
  });

  it('rejects a tampered archive that would otherwise install cleanly', () => {
    // Same structure, different bytes: only the digest can tell them apart.
    const tampered = makeWar({ 'js/app.min.js': strToU8('/* injected */') });
    expect(() => installFromWar(tampered, dir, sha256(makeWar())))
      .toThrow(/does not match the checksum/);
    expect(existsSync(join(dir, 'webapp'))).toBe(false);
  });

  it('defaults to the pinned DRAWIO_WAR_SHA256 when no digest is passed', () => {
    // Guards the shipped path: installWebapp() never passes a digest, so this
    // default is what a real install is checked against.
    expect(() => installFromWar(makeWar(), dir)).toThrow(DRAWIO_WAR_SHA256);
    expect(existsSync(join(dir, 'webapp'))).toBe(false);
  });
});

describe('verifyWarChecksum', () => {
  const bytes = strToU8('drawio archive bytes');
  const digest = sha256(bytes);

  it('accepts bytes hashing to the expected digest', () => {
    expect(() => verifyWarChecksum(bytes, digest)).not.toThrow();
  });

  it('rejects bytes hashing to anything else, naming both digests', () => {
    const other = sha256(strToU8('other bytes'));
    expect(() => verifyWarChecksum(bytes, other)).toThrow(other);
    expect(() => verifyWarChecksum(bytes, other)).toThrow(digest);
  });

  it('rejects a truncated archive (Content-Length alone would not)', () => {
    expect(() => verifyWarChecksum(bytes.slice(0, -1), digest))
      .toThrow(/does not match the checksum/);
  });
});

describe('swapWebappIntoPlace', () => {
  it('rolls the old webapp back when the staging rename fails', () => {
    mkdirSync(join(dir, 'webapp'), { recursive: true });
    writeFileSync(join(dir, 'webapp', 'marker.txt'), 'original install');
    // No webapp.installing/ created, so the staging rename throws ENOENT
    // after the old webapp has already been renamed aside.
    expect(() => swapWebappIntoPlace(dir)).toThrow();
    expect(readFileSync(join(dir, 'webapp', 'marker.txt'), 'utf8')).toBe('original install');
    expect(existsSync(join(dir, 'webapp.old'))).toBe(false);
  });

  it('clears a leftover webapp.old from a previous crash', () => {
    mkdirSync(join(dir, 'webapp.old'), { recursive: true });
    writeFileSync(join(dir, 'webapp.old', 'junk.txt'), 'junk');
    mkdirSync(join(dir, 'webapp.installing'), { recursive: true });
    writeFileSync(join(dir, 'webapp.installing', 'index.html'), 'new install');
    swapWebappIntoPlace(dir);
    expect(existsSync(join(dir, 'webapp.old'))).toBe(false);
    expect(readFileSync(join(dir, 'webapp', 'index.html'), 'utf8')).toBe('new install');
  });
});
