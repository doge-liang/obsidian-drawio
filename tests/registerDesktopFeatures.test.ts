import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('obsidian', async (importOriginal) => {
  const orig = await importOriginal<typeof import('obsidian')>();
  return { ...orig, Notice: vi.fn() };
});

import { FileSystemAdapter, Notice, TFile } from 'obsidian';
import { registerDesktopFeatures } from '../src/desktop/registerDesktopFeatures';
import { DRAWIO_VERSION } from '../src/constants';
import type DrawioPlugin from '../src/main';

class FakeAdapter extends FileSystemAdapter {
  getBasePath(): string { return '/vault'; }
}

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  f.extension = dot < 0 ? '' : name.slice(dot + 1);
  f.basename = dot < 0 ? name : name.slice(0, dot);
  return f;
}

function fakePlugin() {
  const workspaceOn = vi.fn(
    (_name: string, _cb: (menu: unknown, file: unknown) => unknown) => ({}));
  const getActiveFile = vi.fn<() => TFile | null>(() => null);
  const raw = {
    app: {
      vault: { adapter: new FakeAdapter() },
      workspace: {
        on: workspaceOn, getActiveFile,
        iterateAllLeaves: vi.fn(),
        getActiveViewOfType: vi.fn(),
        // Real Obsidian runs this once layout is up; running it inline keeps the
        // tests synchronous while still exercising the deferred path.
        onLayoutReady: vi.fn((cb: () => unknown) => { cb(); }),
      },
    },
    manifest: { dir: 'drawio-editor' },
    settings: {
      serverPortMin: 3000, serverPortMax: 3999, serverIdleTimeout: 300,
      drawioMode: 'offline',
      webappVersionNoticeShownFor: '',
    },
    server: null as unknown,
    register: vi.fn(),
    addCommand: vi.fn(),
    addRibbonIcon: vi.fn(),
    registerEvent: vi.fn(),
    registerDomEvent: vi.fn(),
    isWebappInstalled: vi.fn(async () => true),
    installedWebappVersion: vi.fn(async (): Promise<string | null> => DRAWIO_VERSION),
    saveSettings: vi.fn(async () => {}),
  };
  return { plugin: raw as unknown as DrawioPlugin, raw, workspaceOn, getActiveFile };
}

/** The notices are raised inside onLayoutReady's callback, which the stub runs
 * inline but cannot await — one macrotask hop lets its await chain settle. */
async function flushNotices(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface RegisteredCommand {
  id: string;
  name: string;
  checkCallback?: (checking: boolean) => boolean;
}

function registeredCommand(raw: { addCommand: ReturnType<typeof vi.fn> }, id: string) {
  const cmd = raw.addCommand.mock.calls
    .map((c) => c[0] as RegisteredCommand)
    .find((c) => c.id === id);
  expect(cmd).toBeDefined();
  return cmd!;
}

/** Menu double: records item titles, ignores icons/clicks. */
function fakeMenu() {
  const titles: string[] = [];
  const item = {
    setTitle(t: string) { titles.push(t); return item; },
    setIcon() { return item; },
    onClick() { return item; },
  };
  const menu = { addItem: (cb: (i: typeof item) => unknown) => { cb(item); return menu; } };
  return { menu, titles };
}

describe('registerDesktopFeatures', () => {
  beforeEach(() => { vi.mocked(Notice).mockClear(); });

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
    expect(workspaceOn).toHaveBeenCalledWith('file-menu', expect.any(Function));
  });

  it('registers the migrate-legacy-diagrams command', async () => {
    const { plugin, raw } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(raw.addCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'migrate-legacy-diagrams',
        name: 'Migrate diagrams from the old Diagrams plugin',
      }),
    );
  });

  it('registers the two export commands', async () => {
    const { plugin, raw } = fakePlugin();
    await registerDesktopFeatures(plugin);
    expect(raw.addCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'export-diagram-svg', name: 'Export diagram as SVG' }),
    );
    expect(raw.addCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'export-diagram-png', name: 'Export diagram as PNG' }),
    );
  });

  it('export commands are available only when the active file is a diagram', async () => {
    const { plugin, raw, getActiveFile } = fakePlugin();
    await registerDesktopFeatures(plugin);
    const check = registeredCommand(raw, 'export-diagram-svg').checkCallback!;

    expect(check(true)).toBe(false); // no active file
    getActiveFile.mockReturnValue(tfile('note.md'));
    expect(check(true)).toBe(false);
    getActiveFile.mockReturnValue(tfile('d/a.drawio'));
    expect(check(true)).toBe(true);
    getActiveFile.mockReturnValue(tfile('d/a.drawio.png'));
    expect(check(true)).toBe(true);
  });

  it('file-menu offers both export items on diagram files, none on others', async () => {
    const { plugin, workspaceOn } = fakePlugin();
    await registerDesktopFeatures(plugin);
    const handler = workspaceOn.mock.calls
      .find((c) => c[0] === 'file-menu')![1] as (menu: unknown, file: unknown) => void;

    const drawio = fakeMenu();
    handler(drawio.menu, tfile('a.drawio'));
    expect(drawio.titles).toEqual(['Export diagram as SVG', 'Export diagram as PNG']);

    const dual = fakeMenu();
    handler(dual.menu, tfile('a.drawio.svg'));
    expect(dual.titles).toEqual(
      ['Edit drawio diagram', 'Export diagram as SVG', 'Export diagram as PNG']);

    const other = fakeMenu();
    handler(other.menu, tfile('note.md'));
    expect(other.titles).toEqual([]);
  });

  it('throws if the vault adapter is not a FileSystemAdapter', async () => {
    const { plugin, raw } = fakePlugin();
    (raw.app as { vault: { adapter: unknown } }).vault.adapter = {};
    await expect(registerDesktopFeatures(plugin)).rejects.toThrow(/desktop \(FileSystem\) vault/);
  });

  it('shows a notice when offline mode is set but the webapp is missing', async () => {
    const { plugin, raw } = fakePlugin();
    raw.isWebappInstalled = vi.fn(async () => false);
    await registerDesktopFeatures(plugin);
    await flushNotices();
    expect(Notice).toHaveBeenCalledWith(
      expect.stringContaining('offline editor'), expect.any(Number),
    );
  });

  it('stays silent when the webapp is installed and matches the pin', async () => {
    const { plugin } = fakePlugin();
    await registerDesktopFeatures(plugin);
    await flushNotices();
    expect(Notice).not.toHaveBeenCalled();
  });

  // Version drift informs but never blocks: resolveBaseUrl() requires only that
  // a webapp exist, so the editor keeps running the installed one either way.
  it('notices an installed webapp older than the pinned version', async () => {
    const { plugin, raw } = fakePlugin();
    raw.installedWebappVersion = vi.fn(async () => 'v1.0.0');
    await registerDesktopFeatures(plugin);
    await flushNotices();
    expect(Notice).toHaveBeenCalledWith(
      expect.stringContaining('v1.0.0'), expect.any(Number),
    );
    expect(Notice).toHaveBeenCalledWith(
      expect.stringContaining(DRAWIO_VERSION), expect.any(Number),
    );
  });

  it('records the pinned version so the drift notice fires only once', async () => {
    const { plugin, raw } = fakePlugin();
    raw.installedWebappVersion = vi.fn(async () => 'v1.0.0');
    await registerDesktopFeatures(plugin);
    await flushNotices();
    expect(raw.settings.webappVersionNoticeShownFor).toBe(DRAWIO_VERSION);
    expect(raw.saveSettings).toHaveBeenCalled();

    vi.mocked(Notice).mockClear();
    await registerDesktopFeatures(plugin);
    await flushNotices();
    expect(Notice).not.toHaveBeenCalled();
  });

  // A later bump moves the pin, which must re-arm the notice.
  it('notices again once the pin moves past the recorded version', async () => {
    const { plugin, raw } = fakePlugin();
    raw.installedWebappVersion = vi.fn(async () => 'v1.0.0');
    raw.settings.webappVersionNoticeShownFor = 'v0.0.1';
    await registerDesktopFeatures(plugin);
    await flushNotices();
    expect(Notice).toHaveBeenCalledWith(
      expect.stringContaining('v1.0.0'), expect.any(Number),
    );
  });

  // Hand-installed webapps carry no DRAWIO_VERSION file; with nothing to
  // compare, staying quiet beats guessing.
  it('stays silent when the installed webapp reports no version', async () => {
    const { plugin, raw } = fakePlugin();
    raw.installedWebappVersion = vi.fn(async () => null);
    await registerDesktopFeatures(plugin);
    await flushNotices();
    expect(Notice).not.toHaveBeenCalled();
  });

  it('stays silent in online mode even without the webapp', async () => {
    const { plugin, raw } = fakePlugin();
    raw.settings.drawioMode = 'online';
    raw.isWebappInstalled = vi.fn(async () => false);
    await registerDesktopFeatures(plugin);
    await flushNotices();
    expect(Notice).not.toHaveBeenCalled();
  });
});
