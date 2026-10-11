import test from "node:test";
import assert from "node:assert/strict";
import { bleepFridayUrl, boomkatWeeklyUrl, ordinal } from "./curated-utils.mjs";

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
