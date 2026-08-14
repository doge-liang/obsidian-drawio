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

// Every test gets its own port range: fetch() (undici) pools keep-alive
// connections per origin, and a pooled socket can outlive a stopped server.
// Reusing one against a *restarted* server on the same port flakes with
// "other side closed" — or worse, the request is answered by the previous
// test's still-draining server (observed as 404 instead of 403 in the
// symlink test, whose fixture only exists in its own root). Distinct ranges
// make cross-test socket reuse structurally impossible.
describe('ServerManager', () => {
  it('serves index.html after ensureStarted', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41100, max: 41109, idleMs: 60000 });
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
    mgr = new ServerManager(fakeWebapp(), { min: 41110, max: 41119, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    const res = await fetch(`http://127.0.0.1:${port}/..%2f..%2fetc%2fpasswd`);
    expect(res.status).toBe(403);
  });

  it('ensureStarted is idempotent (same port)', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41120, max: 41129, idleMs: 60000 });
    const p1 = await mgr.ensureStarted();
    const p2 = await mgr.ensureStarted();
    expect(p1).toBe(p2);
  });

  it('concurrent ensureStarted calls share one in-flight startup (no double bind)', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41130, max: 41139, idleMs: 60000 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const startSpy = vi.spyOn(mgr as any, 'start');
    const [p1, p2] = await Promise.all([mgr.ensureStarted(), mgr.ensureStarted()]);
    expect(p1).toBe(p2);
    expect(startSpy).toHaveBeenCalledTimes(1);
    const res = await fetch(`http://127.0.0.1:${p1}/index.html`);
    expect(await res.text()).toContain('drawio');
  });

  it('setIdleMs updates the timeout without stopping the running server', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41140, max: 41149, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    mgr.setIdleMs(120000);
    const res = await fetch(`http://127.0.0.1:${port}/index.html`);
    expect(await res.text()).toContain('drawio');
  });

  it('returns 400 for malformed percent-encoding (does not crash)', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41150, max: 41159, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    // fetch() would normalize a lone %, so send a raw request with an invalid %ZZ sequence.
    const status = await rawGetStatus(port, '/%ZZ');
    expect(status).toBe(400);
  });

  it('does not follow a symlink that escapes the webapp dir', async (ctx) => {
    const root = fakeWebapp();
    const outside = mkdtempSync(join(tmpdir(), 'secret-'));
    writeFileSync(join(outside, 'secret.txt'), 'TOPSECRET');
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
    } catch (err) {
      // Windows without Developer Mode / elevation cannot create symlinks.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EACCES') {
        ctx.skip();
        return;
      }
      throw err;
    }
    mgr = new ServerManager(root, { min: 41160, max: 41169, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    const res = await fetch(`http://127.0.0.1:${port}/link.txt`);
    expect(res.status).toBe(403);
  });

  it('serves cacheable responses with validators', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41210, max: 41219, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    const res = await fetch(`http://127.0.0.1:${port}/index.html`);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('etag')).toMatch(/^".+"$/);
    expect(res.headers.get('last-modified')).toBeTruthy();
    expect(res.headers.get('content-length')).toBe(String((await res.arrayBuffer()).byteLength));
  });

  it('answers a matching If-None-Match with 304 and no body', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41220, max: 41229, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    const first = await fetch(`http://127.0.0.1:${port}/index.html`);
    const etag = first.headers.get('etag')!;
    const second = await fetch(`http://127.0.0.1:${port}/index.html`, {
      headers: { 'If-None-Match': etag },
      cache: 'no-store',
    });
    expect(second.status).toBe(304);
    expect(second.headers.get('etag')).toBe(etag);
    expect(await second.text()).toBe('');
  });

  it('answers a fresh If-Modified-Since with 304 and a stale one with 200', async () => {
    mgr = new ServerManager(fakeWebapp(), { min: 41230, max: 41239, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    const first = await fetch(`http://127.0.0.1:${port}/index.html`);
    const lastModified = first.headers.get('last-modified')!;
    const fresh = await fetch(`http://127.0.0.1:${port}/index.html`, {
      headers: { 'If-Modified-Since': lastModified },
      cache: 'no-store',
    });
    expect(fresh.status).toBe(304);
    const stale = await fetch(`http://127.0.0.1:${port}/index.html`, {
      headers: { 'If-Modified-Since': new Date(Date.parse(lastModified) - 60_000).toUTCString() },
      cache: 'no-store',
    });
    expect(stale.status).toBe(200);
  });

  it('serves 200 with fresh validators when the file changes (version bump)', async () => {
    const root = fakeWebapp();
    mgr = new ServerManager(root, { min: 41240, max: 41249, idleMs: 60000 });
    const port = await mgr.ensureStarted();
    const first = await fetch(`http://127.0.0.1:${port}/index.html`);
    const etag = first.headers.get('etag')!;
    writeFileSync(join(root, 'index.html'), '<html>drawio v2 — longer body</html>');
    const second = await fetch(`http://127.0.0.1:${port}/index.html`, {
      headers: { 'If-None-Match': etag },
      cache: 'no-store',
    });
    expect(second.status).toBe(200);
    expect(second.headers.get('etag')).not.toBe(etag);
    expect(await second.text()).toContain('v2');
  });
});
