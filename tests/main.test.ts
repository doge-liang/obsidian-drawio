import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform } from 'obsidian';

vi.mock('../src/desktop/registerDesktopFeatures', () => ({
  registerDesktopFeatures: vi.fn(async () => {}),
}));

import { maybeRegisterDesktopFeatures } from '../src/main';
import { registerDesktopFeatures } from '../src/desktop/registerDesktopFeatures';
import type DrawioPlugin from '../src/main';

describe('maybeRegisterDesktopFeatures', () => {
  const originalIsDesktopApp = Platform.isDesktopApp;
  afterEach(() => {
    Platform.isDesktopApp = originalIsDesktopApp;
    vi.clearAllMocks();
  });

  it('registers desktop features when Platform.isDesktopApp is true', async () => {
    Platform.isDesktopApp = true;
    const fakePlugin = {} as unknown as DrawioPlugin;
    await maybeRegisterDesktopFeatures(fakePlugin);
    expect(registerDesktopFeatures).toHaveBeenCalledWith(fakePlugin);
  });

  it('does nothing when Platform.isDesktopApp is false', async () => {
    Platform.isDesktopApp = false;
    const fakePlugin = {} as unknown as DrawioPlugin;
    await maybeRegisterDesktopFeatures(fakePlugin);
    expect(registerDesktopFeatures).not.toHaveBeenCalled();
  });
});
