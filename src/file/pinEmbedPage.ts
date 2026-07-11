import { App, Notice, TFile, parseLinktext } from 'obsidian';
import { rewriteEmbedSubpath, type EmbedSpan } from '../model/embedLink';

export type PinOutcome = 'pinned' | 'no-match' | 'ambiguous' | 'error';

/**
 * Persist an embed's currently shown page into the note: rewrite the one
 * embed link that (a) resolves to `targetFile` and (b) carries the subpath
 * this embed instance was created with, so its subpath names `pageName`.
 *
 * Never guesses: zero or multiple matching links leave the note untouched.
 * All user feedback (Notices) happens here; callers react to the outcome
 * only to update their own state.
 */
export async function pinEmbedPage(
  app: App,
  sourcePath: string,
  targetFile: TFile,
  originalSubpath: string | undefined,
  pageName: string,
): Promise<PinOutcome> {
  // A page name with link syntax in it can't round-trip through a wikilink.
  if (/[#|[\]]/.test(pageName)) {
    new Notice(`Drawio: page name "${pageName}" can't be used in a link (contains #, | or brackets).`);
    return 'error';
  }
  const note = app.vault.getAbstractFileByPath(sourcePath);
  const cache = app.metadataCache.getCache(sourcePath);
  if (!(note instanceof TFile) || !cache?.embeds) {
    new Notice('Drawio: couldn\'t read the embedding note — page not pinned.');
    return 'error';
  }

  const candidates: EmbedSpan[] = [];
  for (const e of cache.embeds) {
    const { path, subpath } = parseLinktext(e.link);
    const dest = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (dest?.path !== targetFile.path) continue;
    candidates.push({
      original: e.original,
      start: e.position.start.offset,
      end: e.position.end.offset,
      path,
      subpath: subpath || undefined,
    });
  }

  // Assigned inside the process callback; boxed so TS's control-flow
  // narrowing (which ignores closure assignments) tracks the union type.
  const result: { outcome: PinOutcome } = { outcome: 'error' };
  try {
    await app.vault.process(note, (data) => {
      const r = rewriteEmbedSubpath(data, candidates, originalSubpath, pageName);
      if (r.outcome !== 'ok') {
        result.outcome = r.outcome;
        return data;
      }
      result.outcome = 'pinned';
      return r.text;
    });
  } catch (err) {
    new Notice(`Drawio: failed to update the note — ${String(err)}`);
    return 'error';
  }
  const outcome = result.outcome;

  if (outcome === 'pinned') {
    new Notice(`Drawio: link updated to page "${pageName}".`);
  } else if (outcome === 'no-match') {
    new Notice('Drawio: couldn\'t find this embed\'s link in the note — page not pinned.');
  } else if (outcome === 'ambiguous') {
    new Notice('Drawio: several identical links to this file — edit the subpath in the note manually.');
  }
  return outcome;
}
