import test from "node:test";
import assert from "node:assert/strict";
import {
  bleepFridayUrl, boomkatWeeklyUrl, ordinal, parseBleepMarkdown,
  parseBoomkatMarkdown, parseBoomkatReleaseTitle,
} from "./curated-utils.mjs";

test("ordinal handles normal suffixes and teen exceptions", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
});

test("Bleep URL uses the latest Friday", () => {
  assert.equal(bleepFridayUrl(new Date("2026-09-06T00:00:00Z")),
    "https://bleep.com/newsletters/weekly-roundup-4th-september-2026");
});

test("Boomkat URL uses the latest Saturday and supports the previous edition", () => {
  const sunday = new Date("2026-10-11T00:00:00Z");
  assert.equal(boomkatWeeklyUrl(sunday), "https://boomkat.com/weekly-roundup/2026-10-10");
  assert.equal(boomkatWeeklyUrl(sunday, 1), "https://boomkat.com/weekly-roundup/2026-10-03");
});

test("Boomkat release links expose artist and title in the current layout", () => {
  assert.deepEqual(parseBoomkatReleaseTitle('View "Basilikum" by Holy Tongue'), {
    artist: "Holy Tongue",
    title: "Basilikum",
  });
  assert.deepEqual(parseBoomkatReleaseTitle('View "Three Movements from "Some Kind of Seasoning"" by Warren Burt'), {
    artist: "Warren Burt",
    title: 'Three Movements from "Some Kind of Seasoning"',
  });
  assert.equal(parseBoomkatReleaseTitle("Weekly Roundup"), null);
});

test("Bleep text fallback extracts only structured roundup releases", () => {
  const markdown = `Release of the Week\nView on Bleep\nArtist One\nAlbum One\nLabel\n· Vinyl · Download\nDescription`;
  assert.deepEqual(parseBleepMarkdown(markdown), [
    { artist: "Artist One", title: "Album One", section: "Release of the Week" },
  ]);
});

test("Boomkat text fallback extracts title attributes", () => {
  const markdown = `[cover](url "View \\"Album One\\" by Artist One")`;
  assert.deepEqual(parseBoomkatMarkdown(markdown), [
    { artist: "Artist One", title: "Album One", section: "Records of the Week" },
  ]);
});
