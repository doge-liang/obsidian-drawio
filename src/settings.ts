export type DrawioMode = 'online' | 'offline' | 'custom';
export type StoreFormat = 'xml' | 'compressed';
export type NewDiagramLocation = 'root' | 'current' | 'folder';
export type PreviewAlignment = 'center' | 'left';

export interface DrawioSettings {
  drawioMode: DrawioMode;
  customDrawioUrl: string;
  serverPortMin: number;
  serverPortMax: number;
  serverIdleTimeout: number; // seconds
  followObsidianTheme: boolean;
  showLibraries: boolean;
  storeFormat: StoreFormat;
  newDiagramLocation: NewDiagramLocation;
  /** Target folder for new diagrams when newDiagramLocation is 'folder'. */
  newDiagramFolder: string;
  previewAlignment: PreviewAlignment;
}

export const DEFAULT_SETTINGS: DrawioSettings = {
  drawioMode: 'offline',
  customDrawioUrl: '',
  serverPortMin: 3000,
  serverPortMax: 3999,
  serverIdleTimeout: 300,
  followObsidianTheme: true,
  showLibraries: true,
  storeFormat: 'xml',
  newDiagramLocation: 'root',
  newDiagramFolder: '',
  previewAlignment: 'center',
};
