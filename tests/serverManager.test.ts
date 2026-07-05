import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { ServerManager } from '../src/server/ServerManager';

let mgr: ServerManager | null = null;
afterEach(() => { mgr?.stop(); mgr = null; });

function fakeWebapp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wa-'));
  writeFileSync(join(dir, 'index.html'), '<html>drawio</html>');
  mkdirSync(join(dir, 'js'));
  writeFileSync(join(dir, 'js', 'viewer.min.js'), 'console.log(1)');
  return dir;
}

function rawGetStatus(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('ServerManager', () => {
  it('serves index.html after ensureStarted', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41100, max: 41200, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    const res = await fetch(`http://127.0.0.1:${port}/index.html`);
    expect(await res.text()).toContain('drawio');
  });

  it('does not serve files outside the webapp dir (path traversal)', async () => {
    // NOTE: fetch() (via the WHATWG URL standard) normalises both plain `..`
    // AND percent-encoded dots (`%2e%2e`) before sending — so the server
    // receives `/etc/passwd` directly, NOT the traversal path.  That path
    // does not exist → 404, which does NOT exercise the guard.
    //
    // What fetch does NOT normalise: percent-encoded *slashes* (`%2f`).
    // The path `/..%2f..%2fetc%2fpasswd` reaches the server verbatim.
    // Our handle() then calls decodeURIComponent() which turns `%2f` → `/`,
    // giving `../../etc/passwd`; normalize(join(root, that)) escapes root,
    // startsWith(root+sep) is false → guard fires → 403.
    //
    // Verified manually: `fetch('http://host/..%2f..%2fetc%2fpasswd')` sends
    // exactly that string; server logs `req.url = '/..%2f..%2fetc%2fpasswd'`.
    mgr = new ServerManager(fakeWebapp(), { min: 41100, max: 41200, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    const res = await fetch(`http://127.0.0.1:${port}/..%2f..%2fetc%2fpasswd`);
    expect(res.status).toBe(403);
  });

  it('ensureStarted is idempotent (same port)', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41100, max: 41200, idleMs: 60000 });
    const p1 = await mgr.ensureStarted();
    const p2 = await mgr.ensureStarted();
    expect(p1).toBe(p2);
  });

  it('concurrent ensureStarted calls share one in-flight startup (no double bind)', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41100, max: 41200, idleMs: 60000 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const startSpy = vi.spyOn(mgr as any, 'start');
    const [p1, p2] = await Promise.all([mgr.ensureStarted(), mgr.ensureStarted()]);
    expect(p1).toBe(p2);
    expect(startSpy).toHaveBeenCalledTimes(1);
    const res = await fetch(`http://127.0.0.1:${p1}/index.html`);
    expect(await res.text()).toContain('drawio');
  });

  it('setIdleMs updates the timeout without stopping the running server', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41100, max: 41200, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    mgr.setIdleMs(120000);
    const res = await fetch(`http://127.0.0.1:${port}/index.html`);
    expect(await res.text()).toContain('drawio');
  });

  it('returns 400 for malformed percent-encoding (does not crash)', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41100, max: 41200, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    // fetch() would normalize a lone %, so send a raw request with an invalid %ZZ sequence.
    const status = await rawGetStatus(port, '/%ZZ');
    expect(status).toBe(400);
  });

  it('does not follow a symlink that escapes the webapp dir', async () => {
    const root = fakeWebapp();
    const outside = mkdtempSync(join(tmpdir(), 'secret-'));
    writeFileSync(join(outside, 'secret.txt'), 'TOPSECRET');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
    mgr = new ServerManager(root, { min: 41100, max: 41200, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    const res = await fetch(`http://127.0.0.1:${port}/link.txt`);
    expect(res.status).toBe(403);
  });
});
