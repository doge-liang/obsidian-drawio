import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import DrawioPlugin from '../src/main';
import { OfflineEditorNotInstalledError } from '../src/model/errors';
import { ONLINE_DRAWIO_URL } from '../src/constants';

// resolveBaseUrl/isWebappInstalled are instance methods with no constructor
// dependencies beyond the fields they read, so they are tested via
// prototype.call on a minimal fake (same pattern as other suites' fakePlugin).
// The cast keeps strictBindCallApply satisfied.
const proto = DrawioPlugin.prototype;
const asPlugin = (o: object) => o as unknown as DrawioPlugin;

describe('resolveBaseUrl', () => {
  it('throws OfflineEditorNotInstalledError in offline mode without the webapp', async () => {
    const fake = asPlugin({
      settings: { drawioMode: 'offline', customDrawioUrl: '' },
      isWebappInstalled: async () => false,
    });
    await expect(proto.resolveBaseUrl.call(fake)).rejects.toBeInstanceOf(
      OfflineEditorNotInstalledError,
    );
  });

  it('serves from the local server in offline mode when installed', async () => {
    const touch = vi.fn();
    const fake = asPlugin({
      settings: { drawioMode: 'offline', customDrawioUrl: '' },
      isWebappInstalled: async () => true,
      server: { ensureStarted: async () => 3456, touch },
    });
    await expect(proto.resolveBaseUrl.call(fake)).resolves.toBe(
      'http://127.0.0.1:3456/index.html',
    );
    expect(touch).toHaveBeenCalled();
  });

  it('returns the online URL in online mode', async () => {
    const fake = asPlugin({ settings: { drawioMode: 'online', customDrawioUrl: '' } });
    await expect(proto.resolveBaseUrl.call(fake)).resolves.toBe(ONLINE_DRAWIO_URL);
  });
});

describe('isWebappInstalled / installedWebappVersion', () => {
  it('reflects webapp/index.html presence and reads DRAWIO_VERSION', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawio-detect-'));
    try {
      const fake = asPlugin({ pluginDir: async () => dir });
      expect(await proto.isWebappInstalled.call(fake)).toBe(false);
      expect(await proto.installedWebappVersion.call(fake)).toBeNull();

      mkdirSync(join(dir, 'webapp'), { recursive: true });
      writeFileSync(join(dir, 'webapp', 'index.html'), '<html></html>');
      expect(await proto.isWebappInstalled.call(fake)).toBe(true);
      // Manually-installed webapps may lack the version file — that is not an error.
      expect(await proto.installedWebappVersion.call(fake)).toBeNull();

      writeFileSync(join(dir, 'webapp', 'DRAWIO_VERSION'), 'v30.0.4\n');
      expect(await proto.installedWebappVersion.call(fake)).toBe('v30.0.4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
