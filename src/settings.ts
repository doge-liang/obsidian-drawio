export type DrawioMode = 'online' | 'offline' | 'custom';
export type StoreFormat = 'xml' | 'compressed';
export type NewDiagramLocation = 'root' | 'current' | 'folder';
/** File format for newly created diagrams: plain XML, or a dual-format image
 * (standard SVG/PNG with the diagram XML embedded — renders as an image
 * everywhere, editable here). */
export type NewDiagramFormat = 'drawio' | 'svg' | 'png';
export type PreviewAlignment = 'center' | 'left';
export type PreviewClickAction = 'editor' | 'defaultApp' | 'interactive' | 'none';
export type EditButtonAction = 'editor' | 'defaultApp';

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
  newDiagramFormat: NewDiagramFormat;
  previewAlignment: PreviewAlignment;
  /** Desktop: open .drawio files as a static preview instead of the editor. */
  readonlyFileView: boolean;
  /** Desktop: what clicking a preview does (embeds and read-only file tabs). */
  previewClickAction: PreviewClickAction;
  /** Desktop interactive viewer: action used by its explicit Edit button. */
  editButtonAction: EditButtonAction;
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
  newDiagramFormat: 'drawio',
  previewAlignment: 'center',
  readonlyFileView: false,
  previewClickAction: 'editor',
  editButtonAction: 'editor',
};
