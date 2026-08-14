import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings';

describe('DEFAULT_SETTINGS', () => {
  it('defaults the editor to offline (no automatic online fallback)', () => {
    // CLAUDE.md invariant: the default mode is 'offline'. Flipping this would
    // change first-run behavior for every install.
    expect(DEFAULT_SETTINGS.drawioMode).toBe('offline');
    expect(DEFAULT_SETTINGS.customDrawioUrl).toBe('');
  });

  it('defines a valid, non-empty local server port range', () => {
    const { serverPortMin, serverPortMax } = DEFAULT_SETTINGS;
    expect(serverPortMin).toBeGreaterThanOrEqual(1);
    expect(serverPortMax).toBeLessThanOrEqual(65535);
    expect(serverPortMin).toBeLessThan(serverPortMax);
  });

  it('keeps the idle timeout within the settings-tab minimum (>= 5s)', () => {
    expect(DEFAULT_SETTINGS.serverIdleTimeout).toBeGreaterThanOrEqual(5);
  });

  it('follows the Obsidian theme and shows the shape libraries by default', () => {
    expect(DEFAULT_SETTINGS.followObsidianTheme).toBe(true);
    expect(DEFAULT_SETTINGS.showLibraries).toBe(true);
  });

  it('creates new diagrams at the vault root with centered previews', () => {
    expect(DEFAULT_SETTINGS.newDiagramLocation).toBe('root');
    expect(DEFAULT_SETTINGS.newDiagramFolder).toBe('');
    expect(DEFAULT_SETTINGS.previewAlignment).toBe('center');
  });

  it('defaults to the editable file view with the built-in editor click action', () => {
    expect(DEFAULT_SETTINGS.readonlyFileView).toBe(false);
    expect(DEFAULT_SETTINGS.previewClickAction).toBe('editor');
    expect(DEFAULT_SETTINGS.editButtonAction).toBe('editor');
  });

  it('exposes exactly the documented settings keys (guards accidental shape drift)', () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(
      [
        'customDrawioUrl',
        'drawioMode',
        'editButtonAction',
        'followObsidianTheme',
        'newDiagramFolder',
        'newDiagramFormat',
        'newDiagramLocation',
        'previewAlignment',
        'previewClickAction',
        'readonlyFileView',
        'serverIdleTimeout',
        'serverPortMax',
        'serverPortMin',
        'showLibraries',
      ].sort(),
    );
  });
});
