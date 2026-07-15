/** A thing that can be edited in the drawio editor: a code block or a file. */
export interface DrawioSource {
  /** Human label for the modal title. */
  title(): string;
  /** Current XML. */
  read(): Promise<string>;
  /** Persist new XML. */
  write(xml: string): Promise<void>;
}

/** A source whose on-disk body is an exported image with the XML embedded
 * (dual-format files): saving needs the editor's export payload — a plain
 * XML write would corrupt the image — so the editor answers save/autosave
 * with an export request and persists through {@link writeExport}. */
export interface ExportingSource extends DrawioSource {
  /** The embed-protocol export format producing the on-disk body. */
  exportFormat(): 'xmlsvg' | 'xmlpng';
  /** Persist an export payload (the `data:` URI from the export event). */
  writeExport(dataUri: string): Promise<void>;
}

export function isExportingSource(source: DrawioSource): source is ExportingSource {
  const s = source as Partial<ExportingSource>;
  return typeof s.exportFormat === 'function' && typeof s.writeExport === 'function';
}
