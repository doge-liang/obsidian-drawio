import { describe, it, expect, afterEach } from 'vitest';
import { createServer, IncomingMessage, ServerResponse, get as httpGet } from 'node:http';
import { createServer as createNetServer, Socket } from 'node:net';
import { download } from '../src/desktop/webappInstaller';
import type { InstallProgress } from '../src/model/installStatus';

// download() speaks node:https in production; these tests inject node:http's
// `get` so the exact same code path runs against local plain-HTTP fixtures.
// Every fixture listens on port 0 (OS-assigned) — no fixed ranges, so the
// cross-test socket-reuse hazards documented in serverManager.test.ts can't
// occur here at all.

type Closeable = { close(): void };
const servers: Closeable[] = [];
const sockets: Socket[] = [];
afterEach(() => {
  for (const s of sockets) s.destroy();
  for (const s of servers) s.close();
  sockets.length = 0;
  servers.length = 0;
});

function httpFixture(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
    });
  });
}

/** Raw TCP fixture for responses node's own http server refuses to produce
 * (truncated bodies, mid-transfer stalls). */
function rawFixture(response: string, opts: { endAfter?: boolean } = {}): Promise<string> {
  return new Promise((resolve) => {
    const server = createNetServer((socket) => {
      sockets.push(socket);
      socket.write(response);
      if (opts.endAfter) socket.end();
      // otherwise: leave the socket open and silent (stall)
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
    });
  });
}

const noProgress = (): void => {};

describe('webappInstaller download', () => {
  it('resolves with the body and reports byte totals from Content-Length', async () => {
    const base = await httpFixture((_req, res) => {
      res.writeHead(200, { 'Content-Length': '5' });
      res.end('hello');
    });
    const events: InstallProgress[] = [];
    const body = await download(`${base}/file`, (p) => events.push(p), 0, { getter: httpGet });
    expect(Buffer.from(body).toString()).toBe('hello');
    const last = events.at(-1);
    expect(last).toEqual({ phase: 'download', received: 5, total: 5 });
  });

  it('resolves without Content-Length (chunked), reporting a null total', async () => {
    const base = await httpFixture((_req, res) => {
      res.writeHead(200);
      res.write('chunk-a');
      res.end('chunk-b');
    });
    const events: InstallProgress[] = [];
    const body = await download(`${base}/file`, (p) => events.push(p), 0, { getter: httpGet });
    expect(Buffer.from(body).toString()).toBe('chunk-achunk-b');
    expect(events.every((p) => p.phase === 'download' && p.total === null)).toBe(true);
  });

  it('follows redirects (relative Location)', async () => {
    const base = await httpFixture((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { Location: '/real' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Length': '4' });
      res.end('real');
    });
    const body = await download(`${base}/start`, noProgress, 0, { getter: httpGet });
    expect(Buffer.from(body).toString()).toBe('real');
  });

  it('rejects after too many redirects', async () => {
    const base = await httpFixture((_req, res) => {
      res.writeHead(302, { Location: '/loop' });
      res.end();
    });
    await expect(download(`${base}/loop`, noProgress, 0, { getter: httpGet }))
      .rejects.toThrow(/[Tt]oo many redirects/);
  });

  it('rejects on a non-200 status', async () => {
    const base = await httpFixture((_req, res) => {
      res.writeHead(404);
      res.end('nope');
    });
    await expect(download(`${base}/missing`, noProgress, 0, { getter: httpGet }))
      .rejects.toThrow(/HTTP 404/);
  });

  it('rejects when the transfer stalls (inactivity timeout)', async () => {
    const base = await rawFixture(
      'HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial',
    );
    await expect(download(`${base}/stall`, noProgress, 0, { getter: httpGet, idleMs: 200 }))
      .rejects.toThrow(/stalled/);
  });

  it('rejects when the body is truncated below Content-Length', async () => {
    const base = await rawFixture(
      'HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nshort',
      { endAfter: true },
    );
    await expect(download(`${base}/truncated`, noProgress, 0, { getter: httpGet, idleMs: 1000 }))
      .rejects.toThrow();
  });
});
