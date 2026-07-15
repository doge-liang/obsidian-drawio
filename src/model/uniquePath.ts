/**
 * First free `<prefix><ext>` path; when taken, `<prefix> 2<ext>`, ` 3`, …
 * The single numbering scheme for every file this plugin creates
 * (extracted diagrams, exported images). `exists` abstracts the vault
 * lookup so this stays pure (and mobile-safe).
 */
export function uniquePath(
  prefix: string,
  ext: string,
  exists: (path: string) => boolean,
): string {
  for (let n = 1; ; n++) {
    const path = `${prefix}${n === 1 ? '' : ` ${n}`}${ext}`;
    if (!exists(path)) return path;
  }
}
