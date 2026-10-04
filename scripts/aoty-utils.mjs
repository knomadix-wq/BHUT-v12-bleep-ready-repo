const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

export function parseAotyRow({ artist, title, text, url }, now = new Date()) {
  const release = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s*[•·]\s*([^\n]+)/i);
  const critic = text.match(/\b(\d{1,3})\s*\n\s*critic score\s*\n\s*\(([\d,]+)\)/i);
  if (!artist?.trim() || !title?.trim() || !release || !critic) return null;
  const type = release[3].trim();
  if (!/^(LP|EP)$/i.test(type)) return null;
  const criticScore = Number(critic[1]);
  const criticReviews = Number(critic[2].replaceAll(",", ""));
  if (criticScore <= 78 || criticReviews < 2) return null;
  let year = now.getUTCFullYear();
  let releasedAt = new Date(Date.UTC(year, MONTHS[release[1].slice(0, 1).toUpperCase() + release[1].slice(1, 3).toLowerCase()], Number(release[2])));
  if (releasedAt.getTime() > now.getTime() + 86_400_000) {
    year -= 1;
    releasedAt = new Date(Date.UTC(year, releasedAt.getUTCMonth(), releasedAt.getUTCDate()));
  }
  const ageDays = (now.getTime() - releasedAt.getTime()) / 86_400_000;
  if (ageDays < 0 || ageDays >= 7) return null;
  return { artist: artist.trim(), title: title.trim(), url, type: type.toUpperCase(), criticScore, criticReviews, releasedAt: releasedAt.toISOString() };
}

export function selectDailyAdditions(candidates, previous, limit = 2) {
  const known = new Set(previous.map((item) => item.url || `${item.artist}\u0000${item.title}`));
  return candidates.filter((item) => !known.has(item.url || `${item.artist}\u0000${item.title}`)).slice(0, limit);
}
