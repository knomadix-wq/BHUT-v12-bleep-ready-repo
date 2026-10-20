import { chromium } from 'playwright';
import { readFile, writeFile, rename, readdir } from 'node:fs/promises';

const feeds = [
  ['IGLOO', 'https://igloomag.com/feed'],
  ['THE QUIETUS', 'https://thequietus.com/feed/'],
];
const output = 'data/label-watchlist.json';
const existing = JSON.parse(await readFile(output, 'utf8'));
const norm = s => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
const today = new Date().toISOString().slice(0, 10);
const previous = existing.releases || [];
let remaining = Math.max(0, 2 - previous.filter(r => feeds.some(([name]) => name === r.source) && r.discoveredAt?.startsWith(today)).length);
const known = new Set();
for (const file of await readdir('data')) {
  if (!file.endsWith('.json')) continue;
  const data = JSON.parse(await readFile(`data/${file}`, 'utf8'));
  for (const r of data.releases || []) {
    if (r.spotifyId) known.add(r.spotifyId);
    known.add(`${norm(r.artist || '')}|${norm(r.title || '')}`);
  }
}
const browser = await chromium.launch({headless: true});
const added = [];
try {
  const context = await browser.newContext();
  const parser = await context.newPage();
  const candidates = [];
  let healthy = 0;
  for (const [source, url] of feeds) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      const rows = await parser.evaluate(xml => {
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        if (doc.querySelector('parsererror') || !doc.querySelector('rss channel')) throw new Error('Invalid RSS');
        const decode = text => { const el = document.createElement('textarea'); el.innerHTML = text; return el.value; };
        return [...doc.querySelectorAll('item')].map(item => ({
          headline: decode(item.querySelector('title')?.textContent || ''),
          url: item.querySelector('link')?.textContent,
          date: item.querySelector('pubDate')?.textContent,
          categories: [...item.querySelectorAll('category')].map(c => c.textContent),
        }));
      }, xml);
      if (!rows.length) throw new Error('Empty RSS');
      healthy++;
      for (const row of rows) {
        if (!row.categories.includes('Reviews')) continue;
        const date = Date.parse(row.date);
        if (!Number.isFinite(date) || Date.now() - date > 30 * 86400000 || date > Date.now()) continue;
        const match = source === 'IGLOO' ? row.headline.match(/^(.+?) :: (.+?)(?: \([^)]*\))?$/) : row.headline.match(/^(.+?) [–—] (.+)$/);
        if (!match) continue;
        const artist = match[1].trim(), title = match[2].trim();
        if (known.has(`${norm(artist)}|${norm(title)}`)) continue;
        candidates.push({artist, title, source, url: row.url, publishedAt: new Date(date).toISOString()});
      }
      console.log(`${source}: ${rows.length} RSS entries read`);
    } catch (error) { console.warn(`::warning::${source}: ${error.message}`); }
  }
  if (!healthy) throw new Error('Both editorial feeds failed; previous feed retained');
  const page = await context.newPage();
  for (const release of candidates.sort((a,b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 16)) {
    if (!remaining) break;
    try {
      await page.goto(`https://open.spotify.com/search/${encodeURIComponent(release.artist + ' ' + release.title)}/albums`, {waitUntil:'domcontentloaded', timeout:30000});
      const links = page.locator('a[href*="/album/"]');
      await links.first().waitFor({timeout:15000});
      const ids = await links.evaluateAll(els => [...new Set(els.map(e => e.href.match(/\/album\/([A-Za-z0-9]+)/)?.[1]).filter(Boolean))].slice(0,5));
      for (const id of ids) {
        if (known.has(id)) continue;
        await page.goto(`https://open.spotify.com/embed/album/${id}`, {waitUntil:'domcontentloaded', timeout:30000});
        const body = await page.locator('body').innerText();
        if (!norm(body).includes(norm(release.artist))) continue;
        const res = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/album/${id}`, {signal:AbortSignal.timeout(15000)});
        if (!res.ok) continue;
        const metadata = await res.json();
        if (norm(metadata.title || '') !== norm(release.title) || !metadata.thumbnail_url) continue;
        added.push({...release, spotifyId:id, cover:metadata.thumbnail_url, discoveredAt:new Date().toISOString()});
        known.add(id); known.add(`${norm(release.artist)}|${norm(release.title)}`);
        remaining--; console.log(`Matched ${release.source}: ${release.artist} — ${release.title}`); break;
      }
    } catch (error) { console.warn(`Skipped ${release.artist} — ${release.title}: ${error.message}`); }
  }
  if (added.length) {
    const releases = [...previous, ...added];
    await writeFile(output + '.tmp', JSON.stringify({...existing, updatedAt:new Date().toISOString(), releases}, null, 2) + '\n');
    await rename(output + '.tmp', output);
  }
  console.log(`Published ${added.length} editorial additions; ${remaining} daily slots remain`);
} finally { await browser.close(); }
