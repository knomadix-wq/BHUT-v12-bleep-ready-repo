import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const source = "https://stereogum.com/category/reviews/album-of-the-week";
const normalise = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const existing = JSON.parse(
  await readFile("data/stereogum-aotw.json", "utf8").catch(() => '{"releases":[]}'),
);
const previous = Array.isArray(existing.releases) ? existing.releases : [];

async function spotifyAlbum(context, queryText) {
  const spotifyPage = await context.newPage();
  try {
    const query = encodeURIComponent(queryText);
    await spotifyPage.goto(`https://open.spotify.com/search/${query}/albums`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const albumLink = spotifyPage.locator('a[href*="/album/"]').first();
    await albumLink.waitFor({ state: "attached", timeout: 15_000 });
    const href = await albumLink.getAttribute("href");
    const spotifyId = href?.match(/\/album\/([^/?]+)/)?.[1];
    if (!spotifyId) throw new Error("Spotify returned no album ID");

    const response = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/album/${spotifyId}`)}`,
    );
    if (!response.ok) throw new Error(`Spotify artwork HTTP ${response.status}`);
    const metadata = await response.json();
    const title = String(metadata.title || "").trim();
    const headline = normalise(queryText);
    const titleAt = queryText.toLocaleLowerCase().lastIndexOf(title.toLocaleLowerCase());
    const artist = titleAt > 0 ? queryText.slice(0, titleAt).trim().replace(/[\s:–—-]+$/, "") : "";
    if (!artist || !title || !headline.includes(normalise(artist)) || !headline.includes(normalise(title))) {
      throw new Error(`Spotify result did not match Stereogum headline: ${title}`);
    }
    if (!metadata.thumbnail_url) throw new Error("Spotify returned no artwork");
    return { artist, title, spotifyId, cover: metadata.thumbnail_url };
  } finally {
    await spotifyPage.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const archive = await context.newPage();
  await archive.goto(source, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const latestLink = archive.locator('a[href*="/album-of-the-week-"]').first();
  await latestLink.waitFor({ state: "attached", timeout: 30_000 });
  const articleUrl = await latestLink.getAttribute("href");
  if (!articleUrl) throw new Error("Stereogum returned no Album of the Week article");

  const article = await context.newPage();
  await article.goto(new URL(articleUrl, source).href, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  const headline = (await article.locator("h1").first().innerText())
    .replace(/^Album Of The Week:\s*/i, "")
    .trim();
  const publishedAt = await article
    .locator('meta[property="article:published_time"], time[datetime]')
    .first()
    .evaluate((node) => node.getAttribute("content") || node.getAttribute("datetime"));
  if (!headline || !publishedAt) throw new Error("Stereogum article metadata was incomplete");

  const canonicalUrl = article.url();
  const match = await spotifyAlbum(context, headline);
  const newest = {
    ...match,
    source: "STEREOGUM AOTW",
    url: canonicalUrl,
    publishedAt: new Date(publishedAt).toISOString(),
  };
  const releases = [newest, ...previous]
    .filter((release, index, all) =>
      index === all.findIndex((candidate) => candidate.url === release.url || candidate.spotifyId === release.spotifyId),
    )
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, 52);

  await mkdir("data", { recursive: true });
  await writeFile(
    "data/stereogum-aotw.json",
    `${JSON.stringify({ updatedAt: new Date().toISOString(), source, releases }, null, 2)}\n`,
  );
  console.log(`Saved Stereogum Album of the Week: ${newest.artist} — ${newest.title}`);
} finally {
  await browser.close();
}
