import { App, TFile } from 'obsidian';
import { ExportingSource } from '../model/DrawioSource';
import {
  DualFormat, decodeDataUri, extractXmlFromPng, extractXmlFromSvg,
} from '../model/dualFormat';
import { EMPTY_DIAGRAM } from '../constants';

/** Edit target for dual-format files (`*.drawio.svg` / `*.drawio.png`):
 * reading extracts the embedded XML from the image body; saving goes through
 * the editor's export round-trip (see {@link ExportingSource}). */
export class DualFormatFileSource implements ExportingSource {
  constructor(private app: App, private file: TFile, private format: DualFormat) {}

  title(): string {
    // basename of "a.drawio.svg" is "a.drawio" — drop the inner suffix too.
    const n = this.file.basename;
    return n.toLowerCase().endsWith('.drawio') ? n.slice(0, -'.drawio'.length) : n;
  }

  async read(): Promise<string> {
    if (this.format === 'svg') {
      const text = await this.app.vault.read(this.file);
      if (!text.trim()) return EMPTY_DIAGRAM;
      const xml = extractXmlFromSvg(text);
      if (xml === null) throw new Error(`"${this.file.name}" has no embedded drawio diagram`);
      return xml;
    }
    const bytes = await this.app.vault.readBinary(this.file);
    if (bytes.byteLength === 0) return EMPTY_DIAGRAM;
    const xml = extractXmlFromPng(bytes);
    if (xml === null) throw new Error(`"${this.file.name}" has no embedded drawio diagram`);
    return xml;
  }

  exportFormat(): 'xmlsvg' | 'xmlpng' {
    return this.format === 'svg' ? 'xmlsvg' : 'xmlpng';
  }

  async writeExport(dataUri: string): Promise<void> {
    const bytes = decodeDataUri(dataUri);
    if (this.format === 'svg') {
      await this.app.vault.modify(this.file, new TextDecoder().decode(bytes));
      return;
    }
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    await this.app.vault.modifyBinary(this.file, copy);
  }

  async write(): Promise<void> {
    // Never called by the editor for exporting sources; a plain XML body
    // would destroy the image half of the file.
    throw new Error('dual-format files are saved via writeExport');
  }
}
