import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { parseAotyRow, selectDailyAdditions } from "./aoty-utils.mjs";

const source = "https://www.albumoftheyear.org/genre/6-electronic/recent/";
const normalise = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const existing = JSON.parse(await readFile("data/aoty-electronic.json", "utf8").catch(() => '{"releases":[]}'));
const previous = Array.isArray(existing.releases) ? existing.releases : [];

async function spotifyMatch(page, release) {
  const query = encodeURIComponent(`${release.artist} ${release.title}`);
  await page.goto(`https://open.spotify.com/search/${query}/albums`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const links = page.locator('a[href*="/album/"]');
  const count = Math.min(await links.count(), 5);
  for (let i = 0; i < count; i += 1) {
    const spotifyId = (await links.nth(i).getAttribute("href"))?.match(/\/album\/([^/?]+)/)?.[1];
    if (!spotifyId) continue;
    const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/album/${spotifyId}`)}`);
    if (!response.ok) continue;
    const metadata = await response.json();
    const actual = normalise(metadata.title || "");
    const expected = normalise(release.title);
    if (actual === expected || actual.includes(expected) || expected.includes(actual)) {
      return { ...release, spotifyId, cover: metadata.thumbnail_url };
    }
  }
  throw new Error("no matching Spotify album");
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  await page.goto(source, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const heading = await page.locator("body").innerText();
  if (!/New Electronic Albums/i.test(heading) || /Just a moment|Checking your browser/i.test(heading)) {
    throw new Error("Album of the Year bot-check or unexpected page; previous feed retained");
  }
  const rawRows = await page.locator(".albumListRow").evaluateAll((rows) => rows.map((row) => {
    const links = [...row.querySelectorAll('a[href*="/album/"]')];
    const album = links[0];
    const artistNode = row.querySelector('.albumListRowArtist, [class*="Artist"]');
    const artistLink = artistNode?.querySelector("a") || [...row.querySelectorAll("a")].find((a) => a !== album);
    return {
      artist: artistNode?.textContent?.trim() || artistLink?.textContent?.trim() || "",
      title: album?.textContent?.trim() || "",
      text: row.innerText,
      url: album?.href || "",
    };
  }));
  if (!rawRows.length) throw new Error("Album of the Year release rows were not found; previous feed retained");
  const candidates = rawRows.map((row) => parseAotyRow(row)).filter(Boolean);
  const additions = selectDailyAdditions(candidates, previous, 2);
  const spotify = await context.newPage();
  const resolved = [];
  for (const candidate of additions) {
    try { resolved.push(await spotifyMatch(spotify, candidate)); }
    catch (error) { console.warn(`Skipped ${candidate.artist} — ${candidate.title}: ${error.message}`); }
  }
  const releases = [...resolved.map((release) => ({
    ...release,
    source: "ALBUM OF THE YEAR",
    publishedAt: new Date().toISOString(),
  })), ...previous]
    .filter((release, index, all) => index === all.findIndex((item) => item.spotifyId === release.spotifyId || item.url === release.url))
    .slice(0, 60);
  await writeFile("data/aoty-electronic.json", `${JSON.stringify({ updatedAt: new Date().toISOString(), source, releases }, null, 2)}\n`);
  console.log(`Added ${resolved.length} Album of the Year recommendation(s); retained ${releases.length} total`);
} finally {
  await browser.close();
}
