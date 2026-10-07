import assert from "node:assert/strict";
import test from "node:test";
import { parseAotyRow, selectDailyAdditions } from "./aoty-utils.mjs";

const now = new Date("2026-09-24T12:00:00Z");
const row = (text, title = "Good Album") => parseAotyRow({ artist: "Artist", title, text, url: "/" + title }, now);

test("accepts a recent LP with a 79+ critic score", () => {
  assert.equal(row("Sep 18 • LP\\n80\\ncritic score\\n(2)\\n99\\nuser score\\n(900)").criticScore, 80);
  assert.equal(row("Sep 18 • LP\\n90\\ncritic score\\n(1)").criticScore, 90);
});
test("ignores user scores and rejects low or excluded releases", () => {
  assert.equal(row("Sep 18 • LP\\n78\\ncritic score\\n(20)"), null);
  assert.equal(row("Sep 18 • Remix\\n90\\ncritic score\\n(5)"), null);
  assert.equal(row("Sep 10 • EP\\n90\\ncritic score\\n(5)"), null);
});
test("limits each refresh to two unseen albums", () => {
  const candidates = [{ url: "/a" }, { url: "/b" }, { url: "/c" }];
  assert.deepEqual(selectDailyAdditions(candidates, [{ url: "/a" }]), [{ url: "/b" }, { url: "/c" }]);
});
