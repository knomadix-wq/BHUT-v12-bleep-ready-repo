import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { boomkatWeeklyUrl, publicationTimestamp } from "./curated-utils.mjs";

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
  let source;
  let editionDate;
  for (let weeksAgo = 0; weeksAgo <= 1; weeksAgo += 1) {
    const candidate = boomkatWeeklyUrl(new Date(), weeksAgo);
    const hasRoundup = await page.goto(candidate, { waitUntil: "domcontentloaded", timeout: 90_000 })
      .then(() => page.locator("body").innerText())
      .then((text) => /Album of the week|Single of the week/i.test(text))
      .catch((error) => {
        console.warn(`Boomkat request failed at ${candidate}: ${error.message}`);
        return false;
      });
    if (hasRoundup) {
      source = candidate;
      editionDate = new Date(`${candidate.slice(-10)}T12:00:00Z`);
      break;
    }
    console.warn(`Boomkat roundup was unavailable at ${candidate}`);
  }
  if (!source) throw new Error("Current and previous Boomkat roundups were unavailable");
  const publishedAt = await page.locator('meta[property="article:published_time"], time[datetime]')
    .first().evaluate((node) => node.getAttribute("content") || node.getAttribute("datetime"))
    .catch(() => null) || publicationTimestamp(editionDate);

  const lines = (await page.locator("body").innerText())
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const releases = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^(?:Album|Albums|Single) of the week$/i.test(lines[i])) continue;
    const artist = lines[i + 1] || "";
    const title = lines[i + 2] || "";
    if (artist && title) releases.push({ artist, title, section: lines[i] });
  }

  const recommended = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h1, h2, h3, h4, div, span")]
      .find((element) => element.textContent?.trim() === "Recommended New Releases");
    if (!heading) return [];
    const all = [...document.querySelectorAll('a[href*="/products/"]')];
    return all.filter((anchor) =>
      Boolean(heading.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).map((anchor) => {
      let container = anchor;
      while (container.parentElement && container.parentElement.innerText.trim().split(/\n+/).length < 2) {
        container = container.parentElement;
      }
      const parts = container.innerText.split(/\n+/).map((part) => part.trim()).filter(Boolean);
      return { artist: parts[0] || "", title: parts[1] || "", section: "Recommended New Releases" };
    });
  });
  releases.push(...recommended.filter(({ artist, title }) => artist && title));
  const unique = [...new Map(
    releases.map((item) => [`${normalise(item.artist)}|${normalise(item.title)}`, item]),
  ).values()].slice(0, 12);
  if (!unique.length) throw new Error("Boomkat produced no weekly headline releases");

  const spotifyPage = await context.newPage();
  const resolved = [];
  for (const release of unique) {
    try {
      const query = encodeURIComponent(`${release.artist} ${release.title}`);
      await spotifyPage.goto(`https://open.spotify.com/search/${query}/albums`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      const albumLink = spotifyPage.locator('a[href*="/album/"]').first();
      await albumLink.waitFor({ state: "attached", timeout: 15_000 });
      const href = await albumLink.getAttribute("href");
      const spotifyId = href?.match(/\/album\/([^/?]+)/)?.[1];
      if (!spotifyId) throw new Error("Spotify returned no album ID");
      const cover = await spotifyArtwork(spotifyId, release.title);
      resolved.push({ ...release, spotifyId, cover, publishedAt: new Date(publishedAt).toISOString() });
    } catch (error) {
      console.warn(`Skipped ${release.artist} — ${release.title}: ${error.message}`);
    }
  }
  if (!resolved.length) throw new Error("Spotify produced no verified Boomkat albums");

  await mkdir("data", { recursive: true });
  await writeFile(
    "data/boomkat-weekly.json",
    `${JSON.stringify({ updatedAt: new Date().toISOString(), source, releases: resolved }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
