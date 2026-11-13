// Today in Medical History data: the month files are what the app reads (today-history.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build, clean } from "../scripts/history/build-history.mjs";

const root = new URL("../", import.meta.url);
const src = JSON.parse(readFileSync(new URL("data/history/source/medical-history-365.json", root), "utf8"));
const months = Object.fromEntries(Array.from({ length: 12 }, (_, i) => {
  const mm = String(i + 1).padStart(2, "0");
  return [mm, JSON.parse(readFileSync(new URL(`data/history/${mm}.json`, root), "utf8"))];
}));

test("every day of a leap year has at least one event", () => {
  const days = Object.values(months).flatMap((m) => Object.keys(m));
  assert.equal(days.length, 366);
  assert.ok(months["02"]["02-29"].length > 0);
  for (const m of Object.values(months)) for (const evs of Object.values(m)) assert.ok(evs.length > 0);
});

test("month files are current with the source (rerun build-history.mjs)", () => {
  assert.deepEqual(build(src), months);
});

test("events are complete, oldest first, https sources, no em-dash", () => {
  for (const m of Object.values(months)) for (const evs of Object.values(m)) {
    evs.forEach((e, i) => {
      assert.ok(Number.isInteger(e.y) && e.t && e.s && e.c, JSON.stringify(e));
      assert.match(e.u, /^https:\/\//);
      assert.doesNotMatch(e.t + e.s + e.c + e.sp, /—/);
      if (i) assert.ok(evs[i - 1].y <= e.y);
    });
  }
});

test("pictures match the event by date and year", () => {
  const first = months["01"]["01-02"][0], second = months["01"]["01-02"][1];
  const has = (f) => f === "01-02-" + second.y + ".webp";
  const m = build(src, has)["01"]["01-02"];
  assert.equal(m[0].img, undefined);
  assert.equal(m[1].img, "01-02-" + second.y + ".webp");
  assert.ok(first.y !== second.y);
});

test("clean turns em-dash breaks into commas", () => {
  assert.equal(clean("a mold—anticipating penicillin—was born"), "a mold, anticipating penicillin, was born");
});
