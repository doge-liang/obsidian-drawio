/**
 * Pretty-print drawio mxfile XML onto multiple indented lines.
 *
 * drawio stores diagrams as a single very long line, which overflows Obsidian's
 * editor (a registered code-block processor means the source can't be reliably
 * soft-wrapped via CSS). Breaking it at tag boundaries — AND wrapping the
 * attributes of over-long tags onto continuation lines — keeps every line short
 * and readable. Only whitespace between/within tags is added, which is
 * insignificant in this XML, so the result still loads.
 *
 * The transform is purely lexical (no DOM round-trip) and conservative: it only
 * splits where a `>` is immediately followed by a `<` (a tag boundary in drawio's
 * compact output). Literal `<`/`>` inside attribute values are escaped by drawio
 * (`&lt;`/`&gt;`), so they never form a false boundary. Anything that isn't
 * tag-structured is returned unchanged.
 */
const MAX_WIDTH = 100;

export function formatDrawioXml(xml: string): string {
  const trimmed = xml.trim();
  if (!trimmed) return trimmed;

  // Collapse any existing inter-tag whitespace so re-formatting is idempotent,
  // then split at every tag boundary without consuming characters. Lookbehind
  // isn't supported on iOS before 16.4 — and unlike a skipped function body, an
  // unsupported regex *literal* fails to parse at script-load time regardless
  // of whether it's ever evaluated, which would crash the whole plugin on
  // mobile. Splitting on a captured `>` (with only a lookahead for `<`) and
  // re-merging each captured delimiter onto the preceding piece reproduces the
  // same tokens without lookbehind.
  const compact = trimmed.replace(/>\s+</g, '><');
  const boundaryParts = compact.split(/(>)(?=<)/);
  const tokens: string[] = [];
  for (let i = 0; i < boundaryParts.length; i += 2) {
    tokens.push((boundaryParts[i] ?? '') + (boundaryParts[i + 1] ?? ''));
  }

  let depth = 0;
  const pad = (d: number) => '  '.repeat(Math.max(0, d));
  const lines: string[] = [];

  for (const tok of tokens) {
    if (/^<\//.test(tok)) {
      // Closing tag: dedent first.
      depth--;
      lines.push(pad(depth) + tok);
    } else if (/^<[?!]/.test(tok)) {
      // XML declaration / comment.
      lines.push(pad(depth) + tok);
    } else if (/\/>$/.test(tok)) {
      // Self-closing tag (may have many attributes).
      lines.push(...wrapTag(tok, pad(depth)));
    } else if (/^<[^>]+>.*<\/[^>]+>$/.test(tok)) {
      // A complete <a>..</a> element on one token — leave as-is.
      lines.push(pad(depth) + tok);
    } else if (/^</.test(tok)) {
      // Opening tag (may have many attributes): emit, then indent.
      lines.push(...wrapTag(tok, pad(depth)));
      depth++;
    } else {
      // Stray text (shouldn't occur in drawio XML) — keep at the current depth.
      lines.push(pad(depth) + tok);
    }
  }

  return lines.join('\n');
}

/**
 * Render one opening or self-closing tag, wrapping its attributes onto
 * continuation lines if the single-line form would exceed MAX_WIDTH. Newlines
 * between attributes are valid XML whitespace, so drawio still parses the result.
 */
function wrapTag(tag: string, indent: string): string[] {
  const single = indent + tag;
  if (single.length <= MAX_WIDTH) return [single];

  const m = /^<([^\s>/]+)([\s\S]*?)(\/?)>$/.exec(tag);
  if (!m) return [single];
  const name = m[1] ?? '';
  const attrsStr = (m[2] ?? '').trim();
  const close = m[3] === '/' ? '/>' : '>';
  const attrs = attrsStr ? attrsStr.match(/[^\s=]+="[^"]*"/g) ?? [] : [];
  if (attrs.length <= 1) return [single]; // nothing splittable

  const cont = indent + '    ';
  const head = indent + '<' + name;
  const out: string[] = [];
  let line = head;
  for (const attr of attrs) {
    if (line !== head && line.length + 1 + attr.length > MAX_WIDTH) {
      out.push(line);
      line = cont + attr;
    } else {
      line += ' ' + attr;
    }
  }
  out.push(line + close);
  return out;
}
