// Today in Medical History data: the month files are what the app reads (today-history.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build, clean, sameEvent, dropList, DEATH } from "../scripts/history/build-history.mjs";

const root = new URL("../", import.meta.url);
const src = JSON.parse(readFileSync(new URL("data/history/source/medical-history-365.json", root), "utf8"));
const india = JSON.parse(readFileSync(new URL("data/history/source/indian-medical-history.json", root), "utf8"));
const obs = JSON.parse(readFileSync(new URL("data/history/source/observances.json", root), "utf8"));
const months = Object.fromEntries(Array.from({ length: 12 }, (_, i) => {
  const mm = String(i + 1).padStart(2, "0");
  return [mm, JSON.parse(readFileSync(new URL(`data/history/${mm}.json`, root), "utf8"))];
}));

test("curated: no deaths, none of the dropped ids, and most days still have something", () => {
  const all = Object.values(months).flatMap((m) => Object.values(m).flat());
  const drop = dropList();
  assert.ok(drop.size > 50);
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
  const built = build(src, india, undefined, dropList(), obs);
  for (const m of Object.keys(built)) built[m] = Object.fromEntries(Object.entries(built[m]).sort());
  assert.deepEqual(built, months);
});

test("events are complete, oldest first, https sources, no em-dash", () => {
  for (const m of Object.values(months)) for (const evs of Object.values(m)) {
    evs.forEach((e, i) => {
      assert.ok((e.ob ? e.y === undefined : Number.isInteger(e.y)) && e.t && e.s && e.c, JSON.stringify(e));
      if (!e.ob) assert.match(e.u, /^https:\/\//);
      assert.doesNotMatch(e.t + e.s + e.c + e.sp, /—/);
      if (i && !evs[i - 1].ob) assert.ok(evs[i - 1].y <= e.y);
      if (e.ob) assert.equal(i, 0, "an observance leads its day");
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
    for (const id of ids) assert.match(id, new RegExp("^" + key + "-(\\d{3,4}b?|day)$"));
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

test("22 observance days, each leading its day, with its picture subject", () => {
  const all = Object.values(months).flatMap((m) => Object.values(m).flat());
  const ob = all.filter((e) => e.ob);
  assert.equal(ob.length, 22);
  assert.equal(months["07"]["07-01"][0].t, "National Doctors' Day (India)");
  assert.ok(months["07"]["07-01"][0].in);
  assert.ok(months["09"]["09-08"][0].ob, "World Physiotherapy Day fills a day that was empty");
  const subj = readFileSync(new URL("data/history/image-subjects.txt", root), "utf8");
  for (const e of ob) assert.ok(subj.includes(e.id.slice(0, 5) + "|day|"), e.id);
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

test("shipped pictures: only the day's chosen subject, WebP 480x360 under 40 KB, linked in the month file", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const want = new Set(readFileSync(new URL("data/history/image-subjects.txt", root), "utf8").split("\n")
    .filter((l) => l && !l.startsWith("#")).map((l) => { const [k, y] = l.split("|"); return k + "-" + y + ".webp"; }));
  const dir = new URL("data/history/img/", root);
  const files = readdirSync(dir).filter((f) => f.endsWith(".webp"));
  const days = new Set();
  for (const f of files) {
    assert.ok(want.has(f), f + " is not a day's chosen picture subject");
    days.add(f.slice(0, 5));
    const b = readFileSync(new URL(f, dir));
    assert.equal(b.toString("latin1", 8, 12), "WEBP", f);
    assert.ok(statSync(new URL(f, dir)).size < 40000, f + " too big");
    const ev = months[f.slice(0, 2)][f.slice(0, 5)].find((e) => e.id + ".webp" === f);
    assert.ok(ev && ev.img === f, f + " not linked in its month file");
  }
  assert.equal(days.size, files.length, "one picture per day");
});

test("banner flip classes never collide with sheet classes (uppercase Pro text bug)", () => {
  const js = readFileSync(new URL("today-history.js", root), "utf8");
  const css = readFileSync(new URL("today-history.css", root), "utf8");
  const onBanner = new Set([...js.matchAll(/\bb\.classList\.(?:add|remove|toggle)\("([\w-]+)"/g)].map((m) => m[1]));
  assert.ok(onBanner.has("th-flipin") && onBanner.has("th-flipout"));
  for (const c of onBanner) {
    const bare = new RegExp("(^|[},\\s])\\." + c + "(?![\\w-])[^{]*\\{", "m");
    for (const line of css.split("\n")) {
      if (bare.test(line)) assert.match(line, /hrf-banner/, "." + c + " is styled outside the banner: " + line.slice(0, 80));
    }
  }
  assert.match(css, /#thSheet \.th-in\{/, "India pill is scoped to the sheet");
});

test("banner swipes to flip and keeps vertical scroll", () => {
  const js = readFileSync(new URL("today-history.js", root), "utf8");
  const css = readFileSync(new URL("today-history.css", root), "utf8");
  assert.match(js, /function armSwipe\(b\)/);
  assert.match(js, /rotateY\(/);
  assert.match(css, /\.hrf-banner\[data-th-swipe\]\{touch-action:pan-y/);
});
