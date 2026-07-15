import { App, Notice, TFile, Vault } from 'obsidian';
import { DRAWIO_FILE_EXT } from '../constants';
import type DrawioPlugin from '../main';
import type { DrawioSource } from '../model/DrawioSource';
import { DualFormatFileSource } from '../file/DualFormatFileSource';
import { FileSource } from '../file/FileSource';
import { decodeDataUri, dualFormatOf } from '../model/dualFormat';
import { OfflineEditorNotInstalledError } from '../model/errors';
import { uniquePath } from '../model/uniquePath';
import { exportDiagramXml, PlainExportFormat } from '../editor/HeadlessExporter';

/** Whether the export commands can act on this file: a standalone `.drawio`
 * file or a dual-format `.drawio.svg` / `.drawio.png` image. */
export function isExportableDiagram(file: TFile): boolean {
  return file.extension.toLowerCase() === DRAWIO_FILE_EXT || dualFormatOf(file.path) !== null;
}

/** Diagram suffixes stripped from the source name when deriving the export
 * name — longest first so `a.drawio.svg` becomes `a`, not `a.drawio`. */
const DIAGRAM_SUFFIXES = ['.drawio.svg', '.drawio.png', '.drawio'];

/**
 * The `<source basename minus diagram suffix>.<format>` path in the source
 * file's folder, numbered ` 2`, ` 3`, … when taken (same scheme as
 * uniqueDiagramPath). Pure — `exists` abstracts the vault lookup.
 */
export function exportTargetPath(
  sourcePath: string,
  format: PlainExportFormat,
  exists: (path: string) => boolean,
): string {
  const slash = sourcePath.lastIndexOf('/');
  const folder = sourcePath.slice(0, slash + 1); // '' at the vault root
  const name = sourcePath.slice(slash + 1);
  const lower = name.toLowerCase();
  const suffix = DIAGRAM_SUFFIXES.find((s) => lower.endsWith(s));
  const base = suffix ? name.slice(0, -suffix.length) : name;
  return uniquePath(folder + base, `.${format}`, exists);
}

/** Persist an exported `data:` URI: SVG as a text file, PNG as binary. */
export async function writeExportedFile(
  vault: Vault,
  path: string,
  format: PlainExportFormat,
  dataUri: string,
): Promise<TFile> {
  const bytes = decodeDataUri(dataUri);
  if (format === 'svg') {
    return vault.create(path, new TextDecoder().decode(bytes));
  }
  // createBinary wants a plain ArrayBuffer; copy so no view offset or shared
  // underlying buffer leaks into the write.
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return vault.createBinary(path, copy);
}

/** The edit-target abstraction already knows how to read each diagram kind:
 * plain `.drawio` files hold bare XML, dual-format images embed it. */
function sourceFor(app: App, file: TFile): DrawioSource | null {
  const dual = dualFormatOf(file.path);
  if (dual) return new DualFormatFileSource(app, file, dual);
  if (file.extension.toLowerCase() === DRAWIO_FILE_EXT) return new FileSource(app, file);
  return null;
}

/**
 * Full export flow: read the diagram XML from `file`, render it to a plain
 * SVG/PNG through a hidden drawio iframe (see HeadlessExporter), and write
 * the image next to the source. Every failure surfaces as a Notice; nothing
 * is written on failure.
 */
export async function exportDiagramToFile(
  plugin: DrawioPlugin,
  file: TFile,
  format: PlainExportFormat,
): Promise<void> {
  const source = sourceFor(plugin.app, file);
  if (!source) return;
  try {
    const xml = await source.read();
    const dataUri = await exportDiagramXml(xml, format, plugin.editorDeps());
    const vault = plugin.app.vault;
    const path = exportTargetPath(file.path, format,
      (p) => vault.getAbstractFileByPath(p) !== null);
    const created = await writeExportedFile(vault, path, format, dataUri);
    new Notice(`Drawio: exported to "${created.path}"`);
  } catch (err) {
    console.error('[drawio] export failed:', err);
    new Notice(err instanceof OfflineEditorNotInstalledError
      ? err.message
      : `Drawio: could not export the diagram — ${String(err)}`);
  }
}
