import { describe, it, expect } from 'vitest';
import { resolveNewDiagramFolder } from '../src/file/createDiagram';

const settings = (location: 'root' | 'current' | 'folder', folder = '') =>
  ({ newDiagramLocation: location, newDiagramFolder: folder });

describe('resolveNewDiagramFolder', () => {
  it('root mode always resolves to the vault root', () => {
    expect(resolveNewDiagramFolder(settings('root'), 'Notes/Daily')).toBe('');
    expect(resolveNewDiagramFolder(settings('root', 'Diagrams'), null)).toBe('');
  });

  it('current mode uses the active file parent', () => {
    expect(resolveNewDiagramFolder(settings('current'), 'Notes/Daily')).toBe('Notes/Daily');
  });

  it('current mode falls back to root when there is no active file', () => {
    expect(resolveNewDiagramFolder(settings('current'), null)).toBe('');
  });

  it('current mode treats the root folder path "/" as root', () => {
    expect(resolveNewDiagramFolder(settings('current'), '/')).toBe('');
  });

  it('folder mode uses the configured folder', () => {
    expect(resolveNewDiagramFolder(settings('folder', 'Diagrams'), 'Notes')).toBe('Diagrams');
  });

  it('folder mode with an empty setting resolves to root', () => {
    expect(resolveNewDiagramFolder(settings('folder', ''), 'Notes')).toBe('');
    expect(resolveNewDiagramFolder(settings('folder', '   '), 'Notes')).toBe('');
  });

  it('normalizes slashes and whitespace in the configured folder', () => {
    expect(resolveNewDiagramFolder(settings('folder', ' /Diagrams/sub/ '), null)).toBe('Diagrams/sub');
    expect(resolveNewDiagramFolder(settings('folder', 'Diagrams\\sub'), null)).toBe('Diagrams/sub');
    expect(resolveNewDiagramFolder(settings('folder', '//Diagrams//sub//'), null)).toBe('Diagrams/sub');
  });
});
