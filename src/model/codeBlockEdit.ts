/**
 * Replace the body of a fenced code block.
 * @param doc full markdown source
 * @param lineStart 0-based line index of the opening fence (```drawio)
 * @param lineEnd   0-based line index of the closing fence (```)
 * @param newBody   replacement body (without fences); may contain newlines
 */
export function replaceCodeBlockBody(
  doc: string,
  lineStart: number,
  lineEnd: number,
  newBody: string,
): string {
  const lines = doc.split('\n');
  const opening = lines[lineStart] ?? '';
  const closing = lines[lineEnd] ?? '';
  const before = lines.slice(0, lineStart);
  const after = lines.slice(lineEnd + 1);
  // Match the note's dominant line ending: every inserted body line precedes
  // the closing fence, so in a CRLF note each one needs its CR — otherwise
  // the write produces mixed line endings.
  const eol = doc.includes('\r\n') ? '\r' : '';
  const bodyLines = newBody.split('\n').map((line) => line + eol);
  return [...before, opening, ...bodyLines, closing, ...after].join('\n');
}
