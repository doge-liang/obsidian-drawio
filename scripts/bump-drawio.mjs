// Check jgraph/drawio for a newer stable release and, when found, pin
// DRAWIO_VERSION + the draw.war SHA-256 in the three places that must stay
// in lockstep. Does not extract the webapp or touch VIEWER_SCRIPT_LOADER —
// CI on the resulting PR will fetch-drawio and fail loudly if the viewer
// shape changed. Semi-automatic on purpose.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const UPSTREAM = 'jgraph/drawio';

function pinnedVersion() {
  const src = readFileSync('src/constants.ts', 'utf8');
  const m = src.match(/export const DRAWIO_VERSION = '([^']+)'/);
  if (!m) throw new Error('Could not read DRAWIO_VERSION from src/constants.ts');
  return m[1];
}

function parseVer(tag) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmpVer(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function replaceOnce(src, re, replacement, label) {
  const matches = src.match(re);
  if (!matches || matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} to replace, found ${matches?.length ?? 0}`);
  }
  return src.replace(re, replacement);
}

async function latestReleaseTag() {
  const res = await fetch(`https://api.github.com/repos/${UPSTREAM}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'obsidian-drawio-bump',
      ...(process.env.GH_TOKEN || process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GH_TOKEN || process.env.GITHUB_TOKEN}` }
        : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} fetching ${UPSTREAM} latest release`);
  const body = await res.json();
  if (!body.tag_name || body.draft || body.prerelease) {
    throw new Error(`Unexpected latest release payload: ${JSON.stringify(body)}`);
  }
  return body.tag_name;
}

async function sha256OfWar(tag) {
  const url = `https://github.com/${UPSTREAM}/releases/download/${tag}/draw.war`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return createHash('sha256').update(buf).digest('hex');
}

function writePins(tag, sha) {
  let constants = readFileSync('src/constants.ts', 'utf8');
  constants = replaceOnce(
    constants,
    /export const DRAWIO_VERSION = '[^']+'/,
    `export const DRAWIO_VERSION = '${tag}'`,
    'DRAWIO_VERSION',
  );
  constants = replaceOnce(
    constants,
    /export const DRAWIO_WAR_SHA256 =\n  '[0-9a-f]{64}'/,
    `export const DRAWIO_WAR_SHA256 =\n  '${sha}'`,
    'DRAWIO_WAR_SHA256',
  );
  writeFileSync('src/constants.ts', constants);

  let script = readFileSync('scripts/fetch-drawio.mjs', 'utf8');
  script = replaceOnce(
    script,
    /const DRAWIO_VERSION = '[^']+'/,
    `const DRAWIO_VERSION = '${tag}'`,
    'fetch-drawio DRAWIO_VERSION',
  );
  script = replaceOnce(
    script,
    /const WAR_SHA256 = '[0-9a-f]{64}'/,
    `const WAR_SHA256 = '${sha}'`,
    'fetch-drawio WAR_SHA256',
  );
  writeFileSync('scripts/fetch-drawio.mjs', script);

  writeFileSync('drawio-version.json', `${JSON.stringify({ version: tag }, null, 2)}\n`);
}

function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  const current = pinnedVersion();
  const latest = await latestReleaseTag();
  const cur = parseVer(current);
  const next = parseVer(latest);
  if (!cur) throw new Error(`Pinned version is not vMAJOR.MINOR.PATCH: ${current}`);
  if (!next) throw new Error(`Latest tag is not vMAJOR.MINOR.PATCH: ${latest}`);

  if (cmpVer(next, cur) <= 0) {
    console.log(`Already on ${current} (latest ${latest}); nothing to bump.`);
    setOutput('changed', 'false');
    setOutput('version', current);
    return;
  }

  console.log(`Bumping ${current} → ${latest}; downloading draw.war to hash it…`);
  const sha = await sha256OfWar(latest);
  writePins(latest, sha);
  console.log(`Pinned ${latest} sha256 ${sha}`);
  setOutput('changed', 'true');
  setOutput('version', latest);
}

await main();
