/**
 * Dual-format drawio files (`*.drawio.svg` / `*.drawio.png`): the file body is
 * a standard SVG or PNG image with the diagram XML embedded inside — SVG keeps
 * it in the root element's `content` attribute, PNG in a `tEXt` chunk with
 * keyword `mxfile` (URI-encoded). This is the format drawio itself exports for
 * `xmlsvg`/`xmlpng` and the one the VS Code drawio extension edits in place,
 * so the files render as plain images everywhere (GitHub, other tools,
 * Obsidian's own image view) while staying fully editable.
 *
 * Everything in this module is pure data transformation with no Node or
 * Electron APIs, so it is safe to load on mobile.
 */

export type DualFormat = 'svg' | 'png';

/** The dual format a path denotes, or null for anything else (incl. plain `.drawio`). */
export function dualFormatOf(path: string): DualFormat | null {
  const p = path.toLowerCase();
  if (p.endsWith('.drawio.svg')) return 'svg';
  if (p.endsWith('.drawio.png')) return 'png';
  return null;
}

/** Extract the embedded diagram XML from an exported SVG, or null when absent. */
export function extractXmlFromSvg(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;
  const content = root.getAttribute('content');
  return content && content.trim() ? content : null;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal valid SVG carrying the given diagram XML — the initial body of a
 * newly created `.drawio.svg`, replaced by a real export on first save. */
export function buildInitialSvg(xml: string): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1" height="1" ' +
    `content="${escapeXmlAttr(xml)}"></svg>`;
}

/** Swap the embedded XML in an existing SVG body, leaving the rendered image
 * untouched (it goes stale until the next editor save re-exports it), or null
 * when the text isn't an SVG. */
export function replaceXmlInSvg(svg: string, xml: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;
  root.setAttribute('content', xml);
  return new XMLSerializer().serializeToString(doc);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_TEXT_KEYWORD = 'mxfile';

/** A 1×1 transparent PNG (no text chunks) — the image part of a newly created
 * `.drawio.png`, replaced by a real export on first save. */
const EMPTY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

/** Extract the embedded diagram XML from an exported PNG (tEXt chunk with
 * keyword `mxfile`, URI-encoded value), or null when absent or not a PNG. */
export function extractXmlFromPng(data: ArrayBuffer | Uint8Array): string | null {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u8.length < PNG_SIGNATURE.length) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (u8[i] !== PNG_SIGNATURE[i]) return null;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = PNG_SIGNATURE.length;
  while (off + 8 <= u8.length) {
    const len = view.getUint32(off);
    const type = latin1(u8, off + 4, off + 8);
    const dataStart = off + 8;
    if (dataStart + len > u8.length) return null;
    if (type === 'tEXt') {
      let nul = -1;
      for (let i = dataStart; i < dataStart + len; i++) {
        if (u8[i] === 0) { nul = i; break; }
      }
      if (nul > dataStart && latin1(u8, dataStart, nul) === PNG_TEXT_KEYWORD) {
        try {
          return decodeURIComponent(latin1(u8, nul + 1, dataStart + len));
        } catch {
          return null;
        }
      }
    }
    if (type === 'IEND') break;
    off = dataStart + len + 4; // skip data + CRC
  }
  return null;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 as specified by the PNG chunk format. */
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crcTable[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A tEXt chunk (length + type + keyword\0value + CRC) holding the XML. */
function makeMxfileChunk(xml: string): Uint8Array {
  // The chunk value must be Latin-1; encodeURIComponent leaves only ASCII.
  const value = encodeURIComponent(xml);
  const payloadLen = PNG_TEXT_KEYWORD.length + 1 + value.length;
  const chunk = new Uint8Array(8 + payloadLen + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payloadLen);
  const typeAndData = PNG_TEXT_KEYWORD + '\0' + value;
  for (let i = 0; i < 4; i++) chunk[4 + i] = 'tEXt'.charCodeAt(i);
  for (let i = 0; i < typeAndData.length; i++) chunk[8 + i] = typeAndData.charCodeAt(i);
  view.setUint32(8 + payloadLen, crc32(chunk.subarray(4, 8 + payloadLen)));
  return chunk;
}

/** Minimal valid PNG carrying the given diagram XML in a tEXt chunk. */
export function buildInitialPng(xml: string): Uint8Array {
  const base = base64ToBytes(EMPTY_PNG_BASE64);
  const chunk = makeMxfileChunk(xml);
  // Insert before IEND (the last 12 bytes of a minimal PNG).
  const iendStart = base.length - 12;
  const out = new Uint8Array(base.length + chunk.length);
  out.set(base.subarray(0, iendStart), 0);
  out.set(chunk, iendStart);
  out.set(base.subarray(iendStart), iendStart + chunk.length);
  return out;
}

/** Swap the embedded XML in an existing PNG (dropping any previous mxfile
 * chunk), leaving the image data untouched — it goes stale until the next
 * editor save re-exports it. Null when the bytes aren't a valid PNG. */
export function replaceXmlInPng(data: ArrayBuffer | Uint8Array, xml: string): Uint8Array | null {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u8.length < PNG_SIGNATURE.length) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (u8[i] !== PNG_SIGNATURE[i]) return null;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const kept: Array<[number, number]> = []; // chunk [start, end) ranges to copy
  let iendStart = -1;
  let off = PNG_SIGNATURE.length;
  while (off + 8 <= u8.length) {
    const len = view.getUint32(off);
    const type = latin1(u8, off + 4, off + 8);
    const end = off + 8 + len + 4;
    if (end > u8.length) return null;
    const isMxfileText = type === 'tEXt' &&
      latin1(u8, off + 8, off + 8 + PNG_TEXT_KEYWORD.length + 1) === PNG_TEXT_KEYWORD + '\0';
    if (!isMxfileText) kept.push([off, end]);
    if (type === 'IEND') { iendStart = off; break; }
    off = end;
  }
  if (iendStart < 0) return null;
  const chunk = makeMxfileChunk(xml);
  const keptLen = kept.reduce((sum, [s, e]) => sum + (e - s), 0);
  const out = new Uint8Array(PNG_SIGNATURE.length + keptLen + chunk.length);
  out.set(u8.subarray(0, PNG_SIGNATURE.length), 0);
  let cursor = PNG_SIGNATURE.length;
  for (const [s, e] of kept) {
    if (s === iendStart) { out.set(chunk, cursor); cursor += chunk.length; }
    out.set(u8.subarray(s, e), cursor);
    cursor += e - s;
  }
  return out;
}

/** Decode a `data:` URI (as the drawio export event delivers) into bytes. */
export function decodeDataUri(uri: string): Uint8Array {
  const comma = uri.indexOf(',');
  if (!uri.startsWith('data:') || comma < 0) throw new Error('not a data: URI');
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  if (meta.endsWith(';base64')) return base64ToBytes(payload);
  return new TextEncoder().encode(decodeURIComponent(payload));
}
