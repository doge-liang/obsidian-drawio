import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const upstream = 'obsidianmd/obsidian-releases';
const statsFile = 'community-plugin-stats.json';
const pluginId = 'drawio-editor';
const dayLength = 86_400_000;
const archiveUrl = 'https://yulei-chen.github.io/obsidian-plugin-download-stats/'
  + `data/plugins/${pluginId}.json`;
const outDir = process.argv[2];
if (!outDir) throw new Error('Usage: node scripts/update-download-trend.mjs <output-directory>');
const dataFile = join(outDir, 'downloads.json');

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return response.json();
}

function validTotal(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

async function loadHistory() {
  try {
    return JSON.parse(await readFile(dataFile, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  // Bootstrap once from the public archive of Obsidian's official snapshots.
  const archive = await fetchJson(archiveUrl);
  const start = Date.parse(archive.startDate);
  if (archive.id !== pluginId || !Number.isFinite(start) || !Array.isArray(archive.totals)) {
    throw new Error('Unexpected Obsidian download archive format');
  }
  const history = {};
  archive.totals.forEach((total, index) => {
    if (total === null) return;
    if (!validTotal(total)) throw new Error('Invalid archived download total');
    const date = new Date(start + index * dayLength).toISOString().slice(0, 10);
    history[date] = total;
  });
  return history;
}

function renderChart(entries) {
  const first = entries[0][0];
  const [last, total] = entries.at(-1);
  const start = Date.parse(first);
  const span = Math.max(Date.parse(last) - start, dayLength);
  const maximum = Math.max(...entries.map(([, count]) => count), 1);
  const step = Math.max(1, 10 ** Math.floor(Math.log10(maximum / 4)));
  const yMax = 4 * step * Math.ceil(maximum / (4 * step));
  const x = (date) => 72 + 544 * (Date.parse(date) - start) / span;
  const y = (count) => 222 - 144 * count / yMax;
  const number = (value) => value.toLocaleString('en-US');
  const grid = Array.from({ length: 5 }, (_, i) => {
    const value = yMax * i / 4;
    return `<path d="M72 ${y(value)}H616" stroke="#ddd"/>`
      + `<text x="63" y="${y(value) + 4}" text-anchor="end">${number(value)}</text>`;
  }).join('\n');
  const points = entries.map(([date, count]) => `${x(date).toFixed(1)},${y(count).toFixed(1)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="267" viewBox="0 0 640 267" role="img">
<title>Cumulative Obsidian downloads</title>
<desc>${number(total)} downloads as of ${last} UTC. First snapshot: ${first}.</desc>
<rect width="640" height="267" fill="#fff"/>
<g fill="#303030" font-family="system-ui, sans-serif" font-size="12">
<text x="24" y="32" font-size="18" font-weight="600">Obsidian downloads</text>
<text x="24" y="54">${number(total)} cumulative · ${last} UTC</text>
${grid}
<polyline points="${points}" fill="none" stroke="#7046c4" stroke-width="3"/>
<circle cx="${x(last).toFixed(1)}" cy="${y(total).toFixed(1)}" r="4" fill="#7046c4"/>
<text x="72" y="246">${first}</text>
${first === last ? '' : `<text x="616" y="246" text-anchor="end">${last}</text>`}
</g></svg>
`;
}

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': pluginId };
if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
const commits = await fetchJson(
  `https://api.github.com/repos/${upstream}/commits?path=${statsFile}&per_page=1`, headers,
);
const { sha, commit } = commits[0] ?? {};
const date = commit?.committer?.date?.slice(0, 10);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
if (!/^[\da-f]{40}$/.test(sha ?? '') || !datePattern.test(date ?? '')) {
  throw new Error('Unexpected Obsidian stats commit');
}
const latest = await fetchJson(`https://raw.githubusercontent.com/${upstream}/${sha}/${statsFile}`);
const total = latest[pluginId]?.downloads;
if (!validTotal(total)) throw new Error('Missing current Obsidian download total');
const history = await loadHistory();
history[date] = total;
const entries = Object.entries(history).sort(([a], [b]) => a.localeCompare(b));
if (entries.some(([day, count]) => !datePattern.test(day) || !Number.isFinite(Date.parse(day)) || !validTotal(count))) {
  throw new Error('Invalid local download history');
}
await writeFile(dataFile, JSON.stringify(Object.fromEntries(entries), null, 2) + '\n');
await writeFile(join(outDir, 'obsidian-downloads.svg'), renderChart(entries));
