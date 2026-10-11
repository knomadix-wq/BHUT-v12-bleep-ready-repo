import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const source = "https://www.twgeema.com/";
const normalise = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const oldFeed = JSON.parse(await readFile("data/twgeema-monthly.json", "utf8").catch(() => "{}"));

async function spotifyMatch(page, release) {
  const query = encodeURIComponent(`${release.artist} ${release.title}`);
  await page.goto(`https://open.spotify.com/search/${query}/albums`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const links = page.locator('a[href*="/album/"]');
  await links.first().waitFor({ state: "attached", timeout: 15_000 });
  const spotifyIds = [...new Set((await links.evaluateAll((items) =>
    items.map((item) => item.getAttribute("href")?.match(/\/album\/([^/?]+)/)?.[1]).filter(Boolean),
  )).slice(0, 8))];
  const expectedTitle = normalise(release.title);
  for (const spotifyId of spotifyIds) {
    const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/album/${spotifyId}`)}`);
    if (!response.ok) continue;
    const metadata = await response.json();
    const actualTitle = normalise(metadata.title || "");
    if (actualTitle && (actualTitle === expectedTitle || actualTitle.includes(expectedTitle) || expectedTitle.includes(actualTitle))) {
      return { ...release, spotifyId, cover: metadata.thumbnail_url };
    }
  }
  throw new Error("no verified Spotify album");
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ locale: "en-GB", timezoneId: "Europe/London" });
  const page = await context.newPage();
  await page.goto(source, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const lines = (await page.locator("body").innerText())
    .split(/\r?\n/)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const descriptionAt = lines.findIndex((line) => /best new Electronic Music artist albums of/i.test(line));
  if (descriptionAt < 0) throw new Error("Twgeema chart heading was not found");
  const description = lines[descriptionAt];
  const period = description.match(/albums of\s+([A-Za-z]+)\s+(\d{4})/i)?.slice(1).join(" ");
  if (!period) throw new Error("Twgeema chart period was not found");

  const candidates = [];
  for (let i = descriptionAt + 1; i < lines.length && candidates.length < 10; i += 1) {
    if (!/^\d+$/.test(lines[i])) continue;
    const rank = Number(lines[i]);
    if (rank < 1 || rank > 10) continue;
    const artist = lines[i + 1] || "";
    const title = lines[i + 2] || "";
    if (artist && title && !/^Genres?:/i.test(title)) candidates.push({ rank, artist, title });
  }
  if (!candidates.length) throw new Error("Twgeema top ten was empty");

  const spotify = await context.newPage();
  const resolved = [];
  for (const candidate of candidates) {
    try { resolved.push(await spotifyMatch(spotify, candidate)); }
    catch (error) { console.warn(`Skipped #${candidate.rank} ${candidate.artist} — ${candidate.title}: ${error.message}`); }
  }
  if (!resolved.length) throw new Error("No Twgeema albums matched Spotify");

  const activatedAt = oldFeed.period === period && oldFeed.activatedAt ? oldFeed.activatedAt : new Date().toISOString();
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(activatedAt)) / 86_400_000));
  const releases = resolved.slice(0, Math.min(10, (days + 1) * 2)).map((release) => ({
    ...release,
    source: `TWGEEMA #${release.rank}`,
    publishedAt: new Date(Date.parse(activatedAt) + Math.floor((release.rank - 1) / 2) * 86_400_000).toISOString(),
  }));
  await mkdir("data", { recursive: true });
  await writeFile("data/twgeema-monthly.json", `${JSON.stringify({ updatedAt: new Date().toISOString(), activatedAt, period, source, releases }, null, 2)}\n`);
} finally {
  await browser.close();
}
