import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { bleepFridayUrl, latestFriday, publicationTimestamp } from "./curated-utils.mjs";

const roundupFriday = latestFriday();
const source = bleepFridayUrl();
const verifiedSpotifyAlbums = new Map([
  ["topdown dialectic|false lp a", "1R570SkqASVYyKJJQAzV5v"],
]);
const excludedReleases = new Set(["mos def|the ecstatic"]);
const normalise = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

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
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  await page.goto(source, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForFunction(
    () => /Release of the Week|Featured Releases|Featured Albums/i.test(document.body?.innerText || ""),
    undefined,
    { timeout: 90_000 },
  );

  // Only accept Bleep's structured roundup metadata. Generic card/body text includes format and
  // purchase controls (for example "LP Download"), which must never be treated as an artist.
  const releases = await page.evaluate(() => {
    // Store-wide Record of the Month cards are promotions, not weekly-roundup content.
    const sectionNames = /^(Release of the Week|Featured Releases|Featured Albums)$/i;
    const formatOnly = /^(LP|CD|Vinyl|Cassette|Download|MP3|FLAC)(\s+(LP|CD|Vinyl|Cassette|Download|MP3|FLAC))*$/i;
    return [...document.querySelectorAll("dd.artist")].map((artistNode) => {
      let card = artistNode.parentElement;
      while (card && !card.querySelector("dd.release-title")) card = card.parentElement;
      const titleNode = card?.querySelector("dd.release-title");
      let previous = card;
      let section = "";
      while (previous && !section) {
        const headings = [...previous.querySelectorAll?.("h1,h2,h3,h4,h5,h6") || []];
        section = headings.map((node) => node.textContent?.trim() || "").find((text) => sectionNames.test(text)) || "";
        previous = previous.previousElementSibling || previous.parentElement;
      }
      const artist = artistNode.textContent?.trim() || "";
      const title = titleNode?.textContent?.trim() || "";
      return section && artist && title && !formatOnly.test(artist) ? { artist, title, section } : null;
    }).filter(Boolean);
  });

  const unique = [...new Map(
    releases.map((item) => [`${item.artist.toLowerCase()}|${item.title.toLowerCase()}`, item]),
  ).values()]
    .filter((item) => !excludedReleases.has(`${item.artist.toLowerCase()}|${item.title.toLowerCase()}`))
    .slice(0, 12);
  if (!unique.length) {
    throw new Error(`Bleep Friday roundup ${source} produced no structured releases; keeping the last good feed`);
  }

  const spotifyPage = await context.newPage();
  const resolved = [];
  for (const release of unique) {
    const releaseKey = `${release.artist.toLowerCase()}|${release.title.toLowerCase()}`;
    const verifiedId = verifiedSpotifyAlbums.get(releaseKey);
    const query = encodeURIComponent(`${release.artist} ${release.title}`);
    try {
      if (verifiedId) {
        const cover = await spotifyArtwork(verifiedId, release.title);
        resolved.push({ ...release, spotifyId: verifiedId, cover, publishedAt: publicationTimestamp(roundupFriday) });
        console.log(`Used verified Spotify album for ${release.artist} — ${release.title}`);
        continue;
      }
      let spotifyId;
      if (!spotifyId) {
        await spotifyPage.goto(`https://open.spotify.com/search/${query}/albums`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        const albumLink = spotifyPage.locator('a[href*="/album/"]').first();
        await albumLink.waitFor({ state: "attached", timeout: 15_000 });
        const href = await albumLink.getAttribute("href");
        spotifyId = href?.match(/\/album\/([^/?]+)/)?.[1];
        if (!spotifyId) throw new Error("Spotify returned no album ID");
      }

      const cover = await spotifyArtwork(spotifyId, release.title);
      resolved.push({ ...release, spotifyId, cover, publishedAt: publicationTimestamp(roundupFriday) });
      console.log(`Resolved ${release.artist} — ${release.title} to ${spotifyId}`);
    } catch (error) {
      console.warn(`Skipped ${release.artist} — ${release.title}: ${error.message}`);
    }
  }
  await spotifyPage.close();
  if (!resolved.length) throw new Error("Spotify produced no verified album IDs; keeping the last good feed");

  await mkdir("data", { recursive: true });
  await writeFile(
    "data/bleep-weekly.json",
    `${JSON.stringify({ updatedAt: new Date().toISOString(), source, releases: resolved }, null, 2)}\n`,
  );
  console.log(`Saved ${resolved.length} verified Bleep releases`);
} finally {
  await browser.close();
}
