import { describe, it, expect, vi } from 'vitest';
import { InstallStatus, formatInstallProgress } from '../src/model/installStatus';

describe('InstallStatus', () => {
  it('notifies the current subscriber on set', () => {
    const s = new InstallStatus();
    const cb = vi.fn();
    s.subscribe(cb);
    s.set({ status: 'installing', progressText: 'Downloading… 10%' });
    expect(s.state).toEqual({ status: 'installing', progressText: 'Downloading… 10%' });
    expect(cb).toHaveBeenCalledWith({ status: 'installing', progressText: 'Downloading… 10%' });
  });

  it('replaces the previous subscriber (settings re-render)', () => {
    const s = new InstallStatus();
    const first = vi.fn();
    const second = vi.fn();
    s.subscribe(first);
    s.subscribe(second);
    s.set({ status: 'idle' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });
});

describe('formatInstallProgress', () => {
  it('formats download with a known total as a percentage', () => {
    expect(formatInstallProgress({ phase: 'download', received: 26_500_000, total: 53_000_000 }))
      .toBe('Downloading… 50%');
  });

  it('formats download without a total as received MB', () => {
    expect(formatInstallProgress({ phase: 'download', received: 5 * 1024 * 1024, total: null }))
      .toBe('Downloading… 5.0 MB');
  });

  it('formats extraction', () => {
    expect(formatInstallProgress({ phase: 'extract' })).toBe('Extracting…');
  });
});
