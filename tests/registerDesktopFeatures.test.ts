import { describe, it, expect, vi } from 'vitest';
import { FileSystemAdapter } from 'obsidian';
import { registerDesktopFeatures } from '../src/desktop/registerDesktopFeatures';
import type DrawioPlugin from '../src/main';

class FakeAdapter extends FileSystemAdapter {
  getBasePath(): string { return '/vault'; }
}

function fakePlugin() {
  const workspaceOn = vi.fn(() => ({}));
  const raw = {
    app: {
      vault: { adapter: new FakeAdapter() },
      workspace: { on: workspaceOn },
    },
    manifest: { dir: 'drawio-editor' },
    settings: { serverPortMin: 3000, serverPortMax: 3999, serverIdleTimeout: 300 },
    server: null as unknown,
    register: vi.fn(),
    addCommand: vi.fn(),
    addRibbonIcon: vi.fn(),
    registerEvent: vi.fn(),
  };
  return { plugin: raw as unknown as DrawioPlugin, raw, workspaceOn };
}

describe('registerDesktopFeatures', () => {
  it('builds and assigns a ServerManager to plugin.server, and registers its teardown', async () => {
    const { plugin, raw } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(raw.server).not.toBeNull();
    expect(raw.register).toHaveBeenCalledTimes(1);
  });

  it('registers the create-drawio-file command', async () => {
    const { plugin, raw } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(raw.addCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'create-drawio-file', name: 'Create new diagram' }),
    );
  });

  it('adds the ribbon icon', async () => {
    const { plugin, raw } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(raw.addRibbonIcon).toHaveBeenCalledWith(
      'workflow', 'Create new drawio diagram', expect.any(Function),
    );
  });

  it('registers a file-menu handler for the folder context menu', async () => {
    const { plugin, raw, workspaceOn } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(raw.registerEvent).toHaveBeenCalledTimes(1);
    expect(workspaceOn).toHaveBeenCalledWith('file-menu', expect.any(Function));
  });

  it('throws if the vault adapter is not a FileSystemAdapter', async () => {
    const { plugin, raw } = fakePlugin();
    (raw.app as { vault: { adapter: unknown } }).vault.adapter = {};
    await expect(registerDesktopFeatures(plugin)).rejects.toThrow(/desktop \(FileSystem\) vault/);
  });
});
