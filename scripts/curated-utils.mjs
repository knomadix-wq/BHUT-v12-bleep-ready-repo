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

export function bleepFridayUrl(now = new Date()) {
  const friday = latestFriday(now);
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
