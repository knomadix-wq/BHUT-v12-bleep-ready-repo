import test from "node:test";
import assert from "node:assert/strict";
import { bleepFridayUrl, ordinal } from "./curated-utils.mjs";

test("ordinal handles normal suffixes and teen exceptions", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
});

test("Bleep URL uses the latest Friday", () => {
  assert.equal(bleepFridayUrl(new Date("2026-09-06T00:00:00Z")),
    "https://bleep.com/newsletters/weekly-roundup-4th-september-2026");
});
