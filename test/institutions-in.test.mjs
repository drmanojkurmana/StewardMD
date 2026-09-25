/* institutions-in.js — one directory, one set of answers.
 *
 * These tests exist because the reported failure was not a crash: it was a picker that quietly did
 * not contain the doctor's city or hospital, and a second form that asked the same question again.
 * So they assert coverage and the free-text escape hatch, not just that functions return arrays. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const I = require("../institutions-in.js");

/* ─────────────────────────── geography ─────────────────────────── */

test("all 28 states and 8 union territories are present, none of them empty", () => {
  assert.equal(I.states().length, 36);
  const empty = I.states().filter((s) => !I.CITIES[s] || I.CITIES[s].length === 0);
  assert.deepEqual(empty, [], "every state and UT must offer cities");
});

test("city coverage is district-scale, not a handful of metros", () => {
  // The list this replaced had 184 cities for the whole country.
  assert.ok(I.cityCount() > 1000, "only " + I.cityCount() + " cities");
  assert.ok(I.allCities().length > 1000);
  // and the big states carry real depth rather than three cities each
  ["Uttar Pradesh", "Maharashtra", "Tamil Nadu", "Karnataka", "Kerala", "Andhra Pradesh", "Bihar", "Gujarat", "Rajasthan", "West Bengal"]
    .forEach((s) => assert.ok(I.cities(s).length >= 30, s + " has only " + I.cities(s).length + " cities"));
});

test("the cities a doctor actually named are there", () => {
  // From the reported screenshots and the support thread.
  [["Visakhapatnam", "Andhra Pradesh"], ["Vijayawada", "Andhra Pradesh"], ["Kakinada", "Andhra Pradesh"],
   ["Rajahmundry", "Andhra Pradesh"], ["Tirupati", "Andhra Pradesh"], ["Guntur", "Andhra Pradesh"],
   ["Warangal", "Telangana"], ["Kozhikode", "Kerala"], ["Thrissur", "Kerala"],
   ["Tiruchirappalli", "Tamil Nadu"], ["Hubballi", "Karnataka"], ["Prayagraj", "Uttar Pradesh"],
   ["Siliguri", "West Bengal"], ["Dibrugarh", "Assam"], ["Imphal", "Manipur"], ["Leh", "Ladakh"]]
    .forEach(([city, state]) => {
      assert.ok(I.cities(state).some((c) => c === city), city + " missing from " + state);
      assert.equal(I.stateOf(city), state, city + " should resolve to " + state);
    });
});

test("searching a city works on a prefix and a fragment", () => {
  assert.ok(I.searchCities("visakha", "", 5).includes("Visakhapatnam"));
  assert.ok(I.searchCities("kochi", "", 5).includes("Kochi"));
  assert.ok(I.searchCities("guntur", "Andhra Pradesh", 5).includes("Guntur"));
  assert.equal(I.searchCities("zzzznotacity", "", 5).length, 0);
});

test("a state filter keeps other states' cities out", () => {
  const ap = I.cities("Andhra Pradesh");
  assert.ok(ap.includes("Visakhapatnam"));
  assert.equal(ap.includes("Lucknow"), false);
});

/* ─────────────────────────── the merged directory ─────────────────────────── */

test("with no curated list loaded the directory is empty rather than throwing", () => {
  // node has no window.SMD_HOSPITALS; the module must still answer.
  assert.equal(Array.isArray(I.all()), true);
  assert.equal(Array.isArray(I.search("aiims")), true);
});

test("whatever is typed is always offered as an answer", () => {
  const o = I.options("Some Brand New Rural Hospital", {});
  assert.equal(o.custom, "Some Brand New Rural Hospital",
    "a hospital that is on no list must still be a usable answer");
});

test("an exact hit is not offered back as free text", () => {
  // simulate a curated list
  globalThis.SMD_HOSPITALS = { all: () => [{ name: "King George Hospital", city: "Visakhapatnam", state: "Andhra Pradesh", type: "medical_college" }] };
  I.refresh();
  const o = I.options("King George Hospital", {});
  assert.equal(o.hits.length, 1);
  assert.equal(o.custom, "", "no point offering to 'use' something already in the list");
  delete globalThis.SMD_HOSPITALS;
  I.refresh();
});

test("both curated lists are merged and de-duplicated", () => {
  globalThis.SMD_HOSPITALS = { all: () => [
    { name: "AIIMS Bhopal", city: "Bhopal", state: "Madhya Pradesh", type: "medical_college" },
    { name: "King George Hospital", city: "Visakhapatnam", state: "Andhra Pradesh", type: "medical_college" }
  ] };
  globalThis.SMD_GEO = { hospitals: () => [
    { name: "AIIMS Bhopal", city: "Bhopal", state: "Madhya Pradesh" },          // the same one, twice
    { name: "Andhra Medical College", city: "Visakhapatnam", state: "Andhra Pradesh" }
  ] };
  I.refresh();
  const names = I.all().map((h) => h.name);
  assert.equal(names.filter((n) => n === "AIIMS Bhopal").length, 1, "the overlap collapses to one row");
  assert.ok(names.includes("Andhra Medical College"), "an entry only the second list had survives");
  assert.equal(I.count(), 3);
  delete globalThis.SMD_HOSPITALS; delete globalThis.SMD_GEO;
  I.refresh();
});

test("search ranks a name prefix above a city match, and understands initials", () => {
  globalThis.SMD_HOSPITALS = { all: () => [
    { name: "King George Hospital", city: "Visakhapatnam", state: "Andhra Pradesh" },
    { name: "Visakha Institute of Medical Sciences", city: "Visakhapatnam", state: "Andhra Pradesh" },
    { name: "Apollo Hospitals", city: "Chennai", state: "Tamil Nadu" }
  ] };
  I.refresh();
  assert.equal(I.search("visakha")[0].name, "Visakha Institute of Medical Sciences", "prefix beats city");
  assert.ok(I.search("kgh").some((h) => h.name === "King George Hospital"), "initials find it");
  assert.equal(I.search("apollo", { state: "Andhra Pradesh" }).length, 0, "a state filter excludes other states");
  delete globalThis.SMD_HOSPITALS;
  I.refresh();
});

test("a city filter narrows to that city", () => {
  globalThis.SMD_HOSPITALS = { all: () => [
    { name: "A Hospital", city: "Visakhapatnam", state: "Andhra Pradesh" },
    { name: "B Hospital", city: "Vijayawada", state: "Andhra Pradesh" }
  ] };
  I.refresh();
  const hits = I.search("", { city: "Visakhapatnam" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "A Hospital");
  delete globalThis.SMD_HOSPITALS;
  I.refresh();
});

test("a hospital the doctor types is remembered for the next colleague", () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  I.refresh();
  assert.equal(I.remember("Sunrise Multispeciality Hospital", "Eluru", "Andhra Pradesh"), true);
  assert.equal(I.remember("Sunrise Multispeciality Hospital", "Eluru", "Andhra Pradesh"), false, "added once, not twice");
  assert.ok(I.search("sunrise").some((h) => h.name === "Sunrise Multispeciality Hospital"));
  // and it now counts as an exact hit, so it is not offered as free text again
  assert.equal(I.options("Sunrise Multispeciality Hospital", {}).custom, "");
  delete globalThis.localStorage;
  I.refresh();
});

test("a remembered hospital's city joins that state's city list", () => {
  const store = {};
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  I.refresh();
  I.remember("Village Trust Hospital", "Somewhere New", "Kerala");
  assert.ok(I.cities("Kerala").includes("Somewhere New"),
    "an institution can never sit in a city the picker refuses to offer");
  delete globalThis.localStorage;
  I.refresh();
});

/* ─────────────────────────── the two forms became one ─────────────────────────── */

test("email-auth no longer renders a second profile form", () => {
  const src = readFileSync(join(HERE, "..", "email-auth.js"), "utf8");
  assert.equal(src.includes("#pfHosp"), false, "the duplicate hospital field is gone");
  assert.equal(src.includes("function wireProfile"), false, "the duplicate typeahead is gone");
  assert.equal(src.includes("function submitProfile"), false, "the duplicate save is gone");
  assert.ok(src.includes("SMD_PROFILE_SETUP"), "it delegates to the one form");
});

test("the one form asks for the institution exactly once", () => {
  const src = readFileSync(join(HERE, "..", "profile-setup.js"), "utf8");
  const keys = [...src.matchAll(/\{ key: "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["name", "phone", "state", "city", "hospital", "degree", "speciality"]);
  assert.equal(keys.filter((k) => k === "hospital").length, 1);
});

test("the profile form writes the same keys the old one did, so no profile is orphaned", () => {
  const src = readFileSync(join(HERE, "..", "profile-setup.js"), "utf8");
  ["name:", "state:", "city:", "hospital:", "degree:", "speciality:", "profileComplete:"]
    .forEach((k) => assert.ok(src.includes(k), "save is missing " + k));
});

test("the picker's dark mode restates every colour it uses", () => {
  // The bug: rows inherited --hink (light theme near-black) on a card repainted dark, so the
  // labels were black on black while the borders stayed light.
  const src = readFileSync(join(HERE, "..", "profile-setup.js"), "utf8");
  ["body.dark #\" + ROOT_ID + \" .pfs-opt b",
   "body.dark #\" + ROOT_ID + \" .pfs-opt span",
   "body.dark #\" + ROOT_ID + \" .pfs-opt{border-top-color",
   "body.dark #\" + ROOT_ID + \" .pfs-t",
   "body.dark #\" + ROOT_ID + \" .pfs-in::placeholder"]
    .forEach((sel) => assert.ok(src.includes(sel), "dark mode does not set " + sel));
});
