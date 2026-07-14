import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { findFreePort } from '../src/server/portDetector';

// Ports are allocated dynamically (listen on 0) instead of hardcoded: fixed
// ports in the 41xxx range collide with Windows-side reservations under WSL2,
// where the conflict is invisible to `ss` inside the guest.
function listenAny(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port;
      resolve({ port, close: () => s.close() });
    });
  });
}

describe('findFreePort', () => {
  it('returns a port within the requested range', async () => {
    const { port: base, close } = await listenAny();
    close();
    const port = await findFreePort(base, base + 10);
    expect(port).toBeGreaterThanOrEqual(base);
    expect(port).toBeLessThanOrEqual(base + 10);
  });

  it('skips an occupied port', async () => {
    const { port: occupied, close } = await listenAny();
    try {
      const port = await findFreePort(occupied, occupied + 10);
      expect(port).not.toBe(occupied);
    } finally { close(); }
  });

  it('throws when no port is free in range', async () => {
    const { port: occupied, close } = await listenAny();
    try {
      await expect(findFreePort(occupied, occupied)).rejects.toThrow();
    } finally { close(); }
  });
});
