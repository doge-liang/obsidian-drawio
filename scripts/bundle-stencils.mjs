import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Bundle the pinned webapp's XML libraries, compressed independently so a
 * preview only inflates/parses the libraries it actually uses. */
export async function bundleStencils(webappDir, output) {
  const files = {};
  const namespaces = {};
  async function visit(dir, prefix = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) {
        await visit(join(dir, entry.name), relative + '/');
      } else if (entry.name.endsWith('.xml')) {
        const xml = await readFile(join(dir, entry.name), 'utf8');
        files[relative] = gzipSync(xml, { level: 9 }).toString('base64');
        // Index the declared namespace, not the filename: e.g. ibm_cloud.xml
        // declares mxgraph.ibm_cloud, and some files contain several sets.
        for (const match of xml.matchAll(/<shapes\b[^>]*\bname="([^"]+)"/g)) {
          const name = match[1].toLowerCase();
          (namespaces[name] ??= []).push(relative);
        }
      }
    }
  }
  await visit(join(webappDir, 'stencils'));
  if (!namespaces['mxgraph.office.security']) throw new Error('Missing pinned Office stencils');
  await writeFile(output, JSON.stringify({ files, namespaces }));
}
