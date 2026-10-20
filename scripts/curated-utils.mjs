export function ordinal(day) {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  return `${day}${day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th"}`;
}

export function latestFriday(now = new Date()) {
  const london = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const delta = (london.getDay() + 2) % 7;
  london.setDate(london.getDate() - delta);
  london.setHours(12, 0, 0, 0);
  return london;
}

export function bleepFridayUrl(now = new Date(), weeksAgo = 0) {
  const friday = latestFriday(now);
  friday.setDate(friday.getDate() - (weeksAgo * 7));
  const month = friday.toLocaleString("en-GB", { month: "long", timeZone: "Europe/London" }).toLowerCase();
  return `https://bleep.com/newsletters/weekly-roundup-${ordinal(friday.getDate())}-${month}-${friday.getFullYear()}`;
}

export function latestSaturday(now = new Date()) {
  const london = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const delta = (london.getDay() + 1) % 7;
  london.setDate(london.getDate() - delta);
  london.setHours(12, 0, 0, 0);
  return london;
}

export function boomkatWeeklyUrl(now = new Date(), weeksAgo = 0) {
  const saturday = latestSaturday(now);
  saturday.setDate(saturday.getDate() - (weeksAgo * 7));
  const date = [
    saturday.getFullYear(),
    String(saturday.getMonth() + 1).padStart(2, "0"),
    String(saturday.getDate()).padStart(2, "0"),
  ].join("-");
  return `https://boomkat.com/weekly-roundup/${date}`;
}

export function publicationTimestamp(date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12)).toISOString();
}

export function parseBoomkatReleaseTitle(value) {
  const match = value?.match(/^View "(.+)" by (.+)$/);
  if (!match) return null;
  const [, title, artist] = match;
  return artist.trim() && title.trim() ? { artist: artist.trim(), title: title.trim() } : null;
}

export function parseBoomkatMarkdown(markdown) {
  return [...markdown.matchAll(/"View \\"([^"\\]+)\\" by ([^"]+)"/g)]
    .map(([, title, artist]) => ({
      artist: artist.trim(), title: title.trim(), section: "Records of the Week",
    }));
}

export function parseBleepMarkdown(markdown) {
  const sectionNames = /^(Release of the Week|Featured Releases|Featured Albums)$/i;
  const lines = markdown.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const releases = [];
  let section = "";
  for (let i = 0; i < lines.length; i += 1) {
    if (sectionNames.test(lines[i])) {
      section = lines[i];
      continue;
    }
    if (!section || !/^·\s*(?:Vinyl|CD|Cassette|Download|MP3|FLAC)/i.test(lines[i])) continue;
    const prior = lines.slice(Math.max(0, i - 4), i)
      .filter((line) => line !== "View on Bleep" && line !== "…");
    const [artist, title] = prior.slice(-3, -1);
    if (artist && title) releases.push({ artist, title, section });
  }
  return releases;
}
