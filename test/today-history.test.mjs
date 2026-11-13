// Today in Medical History data: the month files are what the app reads (today-history.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build, clean, sameEvent, dropList, DEATH } from "../scripts/history/build-history.mjs";

const root = new URL("../", import.meta.url);
const src = JSON.parse(readFileSync(new URL("data/history/source/medical-history-365.json", root), "utf8"));
const india = JSON.parse(readFileSync(new URL("data/history/source/indian-medical-history.json", root), "utf8"));
const months = Object.fromEntries(Array.from({ length: 12 }, (_, i) => {
  const mm = String(i + 1).padStart(2, "0");
  return [mm, JSON.parse(readFileSync(new URL(`data/history/${mm}.json`, root), "utf8"))];
}));

test("curated: no deaths, none of the dropped ids, and most days still have something", () => {
  const all = Object.values(months).flatMap((m) => Object.values(m).flat());
  const drop = dropList();
  assert.ok(drop.size > 100);
  for (const e of all) {
    assert.doesNotMatch(e.t, DEATH, e.id);
    assert.ok(!drop.has(e.id), e.id);
  }
  const days = Object.values(months).flatMap((m) => Object.keys(m));
  assert.ok(days.length >= 320, "days with events: " + days.length);
  for (const m of Object.values(months)) for (const evs of Object.values(m)) assert.ok(evs.length > 0);
  assert.ok(months["02"]["02-29"].length > 0);
});

test("month files are current with the source (rerun build-history.mjs)", () => {
  assert.deepEqual(build(src, india, undefined, dropList()), months);
});

test("events are complete, oldest first, https sources, no em-dash", () => {
  for (const m of Object.values(months)) for (const evs of Object.values(m)) {
    evs.forEach((e, i) => {
      assert.ok(Number.isInteger(e.y) && e.t && e.s && e.c, JSON.stringify(e));
      assert.match(e.u, /^https:\/\//);
      assert.doesNotMatch(e.t + e.s + e.c + e.sp, /—/);
      if (i) assert.ok(evs[i - 1].y <= e.y);
      assert.ok(e.in === undefined || e.in === 1);
    });
  }
});

test("pictures match the event by its id (date and year)", () => {
  const evs = months["01"]["01-02"];
  const has = (f) => f === evs[1].id + ".webp";
  const m = build(src, india, has, dropList())["01"]["01-02"];
  assert.equal(m[0].img, undefined);
  assert.equal(m[1].img, evs[1].id + ".webp");
});

test("ids are unique within a day, and a same-year pair is told apart", () => {
  for (const m of Object.values(months)) for (const [key, evs] of Object.entries(m)) {
    const ids = evs.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, key);
    for (const id of ids) assert.match(id, new RegExp("^" + key + "-\\d{3,4}b?$"));
  }
  assert.ok(months["11"]["11-26"].some((e) => /b$/.test(e.id)));   // Covishield billion, same year as Omicron
});

test("India events merged; a repeat of a world event replaces it", () => {
  const full = build(src, india, () => false, new Set());
  const all = Object.values(full).flatMap((m) => Object.values(m).flat());
  assert.ok(all.filter((e) => e.in).length > 150);
  assert.equal(months["08"]["08-20"].filter((e) => e.y === 1897).length, 1);
  assert.ok(months["08"]["08-20"].find((e) => e.y === 1897).in);
  assert.ok(sameEvent({ year: 1887, title: "Passing of Dr. Anandi Gopal Joshi" }, { year: 1887, title: "Death of Pioneer Physician Anandibai Gopal Joshi" }));
  assert.ok(!sameEvent({ year: 2021, title: "Serum Institute of India Passes 1 Billion COVISHIELD Dose Milestone" }, { year: 2021, title: "WHO Designates Omicron as a SARS-CoV-2 Variant of Concern" }));
});

test("clean turns em-dash breaks into commas", () => {
  assert.equal(clean("a mold—anticipating penicillin—was born"), "a mold, anticipating penicillin, was born");
});

test("picture subjects: one per day, each naming a real event", () => {
  const lines = readFileSync(new URL("data/history/image-subjects.txt", root), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
  const keys = new Set();
  for (const l of lines) {
    const [key, y, subject] = l.split("|");
    assert.ok(!keys.has(key), "duplicate " + key);
    keys.add(key);
    assert.ok(months[key.slice(0, 2)][key].some((e) => e.id === key + "-" + y), "no event " + key + "-" + y);
    assert.match(subject, /amber/, key);
  }
  assert.equal(keys.size, Object.values(months).reduce((a, m) => a + Object.keys(m).length, 0));
});
