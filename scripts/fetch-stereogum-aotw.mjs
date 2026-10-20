import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const source = "https://stereogum.com/category/reviews/album-of-the-week/feed/";
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
    const albumLinks = spotifyPage.locator('a[href*="/album/"]');
    await albumLinks.first().waitFor({ state: "attached", timeout: 15_000 });
    const spotifyIds = [...new Set((await albumLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")?.match(/\/album\/([^/?]+)/)?.[1]).filter(Boolean),
    )).slice(0, 10))];
    const headline = normalise(queryText);
    for (const spotifyId of spotifyIds) {
      const response = await fetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/album/${spotifyId}`)}`,
      );
      if (!response.ok) continue;
      const metadata = await response.json();
      const title = String(metadata.title || "").trim();
      const titleAt = queryText.toLocaleLowerCase().lastIndexOf(title.toLocaleLowerCase());
      const artist = titleAt > 0 ? queryText.slice(0, titleAt).trim().replace(/[\s:–—-]+$/, "") : "";
      if (artist && title && headline.includes(normalise(artist)) && headline.includes(normalise(title)) && metadata.thumbnail_url) {
        return { artist, title, spotifyId, cover: metadata.thumbnail_url };
      }
    }
    throw new Error("Spotify returned no verified Stereogum album match");
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
  const rss = await fetch(source).then((response) => {
    if (!response.ok) throw new Error(`Stereogum RSS HTTP ${response.status}`);
    return response.text();
  });
  const item = rss.match(/<item>([\s\S]*?)<\/item>/i)?.[1] || "";
  const decode = (value) => value.replace(/<!\[CDATA\[|\]\]>/g, "").replaceAll("&amp;", "&").trim();
  const headline = decode(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/^Album Of The Week:\s*/i, "").trim();
  const articleUrl = decode(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "");
  const publishedAt = decode(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "");
  if (!headline || !publishedAt) throw new Error("Stereogum article metadata was incomplete");

  const canonicalUrl = articleUrl;
  const match = await spotifyAlbum(context, headline).catch((error) => {
    console.warn(`Stereogum's latest pick is not yet playable on Spotify: ${error.message}`);
    return null;
  });
  if (match) {
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
  }
} finally {
  await browser.close();
}
