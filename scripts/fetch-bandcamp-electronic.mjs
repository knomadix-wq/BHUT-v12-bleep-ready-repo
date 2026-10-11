import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const indexUrl = "https://daily.bandcamp.com/genres/electronic";
const normalise = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const verifiedSpotifyAlbums = new Map([
  ["the bug dis fig|ladybug 1", "0U171DRtrbqXZONDIPd14F"],
  ["hvl|formation", "70S5dpPzjDZJ6WzftyGjL4"],
  ["rekab|subtle beginnings", "6Pc0xUcMdQHcITAGRWYyRy"],
]);

async function spotifyArtwork(spotifyId, expectedTitle) {
  const response = await fetch(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/album/${spotifyId}`)}`,
  );
  if (!response.ok) throw new Error(`Spotify artwork HTTP ${response.status}`);
  const metadata = await response.json();
  const actual = normalise(metadata.title || "");
  const expected = normalise(expectedTitle);
  if (!actual || (actual !== expected && !actual.includes(expected) && !expected.includes(actual))) {
    throw new Error(`Spotify returned the wrong album: ${metadata.title || "unknown"}`);
  }
  if (!metadata.thumbnail_url) throw new Error("Spotify returned no artwork");
  return metadata.thumbnail_url;
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    locale: "en-GB",
    timezoneId: "Europe/London",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  });
  const page = await context.newPage();
  await page.goto(indexUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const articleLink = page.locator('a[href*="/best-electronic/"]')
    .filter({ hasText: /The Best Electronic Music on Bandcamp/i }).first();
  await articleLink.waitFor({ state: "attached", timeout: 30_000 });
  const href = await articleLink.getAttribute("href");
  if (!href) throw new Error("Bandcamp Daily supplied no current electronic article");
  const source = new URL(href, indexUrl).href;
  await page.goto(source, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const publishedAt = await page.locator('meta[property="article:published_time"], time[datetime]')
    .first().evaluate((node) => node.getAttribute("content") || node.getAttribute("datetime"))
    .catch(() => null) || new Date().toISOString();

  const picks = await page.locator("h3").evaluateAll((headings) => headings.map((heading) => {
    const link = heading.querySelector('a[href*="bandcamp.com"]');
    if (!link) return null;
    const artistParts = [];
    for (const node of heading.childNodes) {
      if (node.nodeName === "BR") break;
      artistParts.push(node.textContent || "");
    }
    const artist = artistParts.join("").trim();
    const title = link.textContent?.trim() || "";
    return artist && title ? { artist, title } : null;
  }).filter(Boolean));

  const unique = [...new Map(picks.map((pick) => [
    `${normalise(pick.artist)}|${normalise(pick.title)}`, pick,
  ])).values()].slice(0, 12);
  if (!unique.length) throw new Error("Bandcamp Daily produced no electronic picks");

  const spotifyPage = await context.newPage();
  const resolved = [];
  for (const pick of unique) {
    try {
      const key = `${normalise(pick.artist)}|${normalise(pick.title)}`;
      let spotifyId = verifiedSpotifyAlbums.get(key);
      if (!spotifyId) {
        const query = encodeURIComponent(`${pick.artist} ${pick.title}`);
        await spotifyPage.goto(`https://open.spotify.com/search/${query}/albums`, {
          waitUntil: "domcontentloaded", timeout: 30_000,
        });
        const albumLinks = spotifyPage.locator('a[href*="/album/"]');
        await albumLinks.first().waitFor({ state: "attached", timeout: 15_000 });
        const spotifyIds = [...new Set((await albumLinks.evaluateAll((items) =>
          items.map((item) => item.getAttribute("href")?.match(/\/album\/([^/?]+)/)?.[1]).filter(Boolean),
        )).slice(0, 8))];
        for (const candidateId of spotifyIds) {
          try {
            const cover = await spotifyArtwork(candidateId, pick.title);
            resolved.push({ ...pick, spotifyId: candidateId, cover, publishedAt: new Date(publishedAt).toISOString() });
            spotifyId = candidateId;
            break;
          } catch {
            // Spotify often ranks a popular but unrelated album first; try the next candidate.
          }
        }
        if (spotifyId) continue;
      }
      if (!spotifyId) throw new Error("Spotify returned no album ID");
      const cover = await spotifyArtwork(spotifyId, pick.title);
      resolved.push({ ...pick, spotifyId, cover, publishedAt: new Date(publishedAt).toISOString() });
    } catch (error) {
      console.warn(`Skipped ${pick.artist} — ${pick.title}: ${error.message}`);
    }
  }
  if (!resolved.length) throw new Error("Spotify produced no verified Bandcamp Daily matches");
  await mkdir("data", { recursive: true });
  await writeFile(
    "data/bandcamp-electronic.json",
    `${JSON.stringify({ updatedAt: new Date().toISOString(), source, releases: resolved }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
