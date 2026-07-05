import { createServer, Server } from 'node:http';
import { createReadStream, statSync, realpathSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { findFreePort } from './portDetector';

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.map': 'application/json', '.txt': 'text/plain',
  '.wasm': 'application/wasm',
};

export interface ServerOptions { min: number; max: number; idleMs: number; }

export class ServerManager {
  private server: Server | null = null;
  private port = 0;
  private idleTimer: number | null = null;
  private realRoot = '';
  private pins = 0;
  /** In-flight startup, so concurrent ensureStarted() callers await the same
   * bind instead of each starting their own server on a different port. */
  private starting: Promise<number> | null = null;

  constructor(private readonly root: string, private readonly opts: ServerOptions) {}

  /** Pin the server open (e.g. while an editor is mounted). Reference-counted. */
  acquire(): void {
    this.pins++;
    if (this.idleTimer) { window.clearTimeout(this.idleTimer); this.idleTimer = null; }
  }

  /** Release a pin; once none remain, restart the idle countdown. */
  release(): void {
    if (this.pins > 0) this.pins--;
    if (this.pins === 0) this.touch();
  }

  async ensureStarted(): Promise<number> {
    this.touch();
    if (!this.realRoot) this.realRoot = realpathSync(this.root);
    if (this.server) return this.port;
    if (!this.starting) {
      this.starting = this.start().finally(() => { this.starting = null; });
    }
    return this.starting;
  }

  private async start(): Promise<number> {
    this.port = await findFreePort(this.opts.min, this.opts.max);
    this.server = createServer((req, res) => this.handle(req.url ?? '/', res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, '127.0.0.1', resolve);
    });
    return this.port;
  }

  /** Reset the idle countdown; call on each editor open/activity. No-op while pinned. */
  touch(): void {
    if (this.pins > 0) return;
    if (this.idleTimer) window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.stop(), this.opts.idleMs);
  }

  /** Update the idle-timeout duration in place. Never stops/recreates the
   * running server (a currently-open editor may hold a live connection to
   * it) — just re-arms the countdown with the new duration if unpinned. */
  setIdleMs(idleMs: number): void {
    this.opts.idleMs = idleMs;
    this.touch();
  }

  stop(): void {
    if (this.idleTimer) { window.clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.server) { this.server.close(); this.server = null; this.port = 0; }
  }

  private handle(url: string, res: import('node:http').ServerResponse): void {
    const path0 = url.split('?')[0] ?? '/';
    let path: string;
    try {
      path = decodeURIComponent(path0);
    } catch {
      res.writeHead(400); res.end('Bad Request'); return;
    }
    if (path === '/' || path === '') path = '/index.html';

    const candidate = normalize(join(this.realRoot, path));
    // First boundary check on the normalized (pre-symlink) path — catches plain traversal.
    if (!candidate.startsWith(this.realRoot + sep) && candidate !== this.realRoot) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    let full: string;
    try {
      full = realpathSync(candidate); // resolves symlinks + verifies existence
    } catch {
      res.writeHead(404); res.end('Not found'); return;
    }
    // Second boundary check AFTER symlink resolution: the real path must stay inside root.
    if (!full.startsWith(this.realRoot + sep) && full !== this.realRoot) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (!statSync(full).isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const stream = createReadStream(full);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end('Internal Server Error');
    });
    res.writeHead(200, { 'Content-Type': MIME[extname(full)] ?? 'application/octet-stream' });
    stream.pipe(res);
  }
}
