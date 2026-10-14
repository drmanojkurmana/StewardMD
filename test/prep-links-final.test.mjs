// links-final: the committed topic map covers every overlay module, and the local (no-API)
// module-topic fallback fails closed. Fixtures synthetic except the overlay/topic-map coverage,
// which reads the committed prep/bank files exactly as the links build does.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addTopicLinks, moduleTopicFallback, gateSpecificLinks, entityOverlap, ktOk, SPECIFIC_MIN_E, SPECIFIC_MIN } from "../tools/prep-links.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJ = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

test("topic map covers every overlay prefix and module", () => {
  const topics = (readJ("prep/bank/topic-links.json").modules) || {};
  const lessons = (readJ("prep/lessons/v1/index.json").modules) || {};
  const sets = (readJ("prep/bank/overlay-counts.json").sets) || {};
  const prefixes = ["maikbook", "maikbook2", "maikss", "maikfill", "gap", "maikpearl", "maiktopic", "maikimg", "maik"];
  let checked = 0;
  for (const [set, subs] of Object.entries(sets)) {
    assert.ok(prefixes.some((p) => set.startsWith(p)) || /^(ck2|medcov4|mrcs|plab|radmax|radnotes)/.test(set), `unclassified overlay set ${set}`);
    for (const mods of Object.values(subs || {})) {
      for (const mid of Object.keys(mods || {})) {
        checked++;
        const e = topics[mid];
        const covered = !!((e && ((e.kb || []).length || (e.pr || []).length || (e.ls || []).length)) || lessons[mid]);
        assert.ok(covered, `overlay module ${mid} (set ${set}) has no topic-map or lesson target`);
      }
    }
  }
  assert.ok(checked > 1000, `expected the full overlay universe, got ${checked}`);
});

test("moduleTopicFallback: majority only, no tie, no generic-word overlap", () => {
  const tallies = [{ k: "kb", id: "a", title: "Heart Failure", n: 8 }, { k: "kb", id: "b", title: "Other Topic", n: 3 }];
  assert.deepEqual(moduleTopicFallback({ title: "Heart failure", tallies, linked: 12 }), { k: "kb", id: "a", title: "Heart Failure" });
  assert.equal(moduleTopicFallback({ title: "Heart failure", tallies, linked: 30 }), null, "below 40% stays unlinked");
  assert.equal(moduleTopicFallback({ title: "Bleeding disorders", tallies: [{ k: "kb", id: "j", title: "Jet lag disorder", n: 9 }], linked: 20 }), null, "a shared generic word is not overlap");
  assert.equal(moduleTopicFallback({ title: "Heart failure", tallies: [{ k: "kb", id: "a", title: "Heart Failure", n: 6 }, { k: "kb", id: "b", title: "Heart Failure", n: 6 }], linked: 12 }), null, "a tie stays unlinked");
  assert.deepEqual(
    moduleTopicFallback({ title: "Unrelated title", tallies: [], linked: 0, candTallies: [{ k: "kb", id: "c", title: "Dominant Concept", n: 20 }, { k: "kb", id: "d", title: "Runner Up", n: 5 }], items: 60 }),
    { k: "kb", id: "c", title: "Dominant Concept" }, "a dominant corpus concept is the module chapter");
});

test("gateSpecificLinks: weak or unevidenced specifics fall below their floor, evidenced ones stand", () => {
  assert.equal(SPECIFIC_MIN_E, 60); assert.equal(SPECIFIC_MIN, 50);
  const it = { q: "A child with profuse watery diarrhoea and vomiting. What is the cause?", o: ["Cholera", "Rotavirus", "Giardia", "Amoeba"], a: 0, exp: "Cholera causes rice-water stools." };
  const weakE = [{ k: "kb", id: "ovarian_remnant_syndrome", title: "Ovarian Remnant Syndrome", c: 55, v: "e", sec: "" }];
  gateSpecificLinks(weakE, it, {});
  assert.ok(weakE[0].c < SPECIFIC_MIN_E, "an explanation-only 55 with no entity overlap is demoted");
  const noOverlap = [{ k: "kb", id: "CELLULITIS", title: "Cellulitis", c: 80, v: "rm", sec: "" }];
  const finger = { q: "Sausage-shaped finger in a man with psoriasis. What is it?", o: ["Dactylitis", "Tenosynovitis", "Gout", "Septic arthritis"], a: 0, exp: "Dactylitis is diffuse finger swelling." };
  gateSpecificLinks(noOverlap, finger, {});
  assert.ok(noOverlap[0].c <= 40, "a rematch link with no stem/answer/option overlap is demoted however it was scored");
  const good = [{ k: "kb", id: "cholera", title: "Cholera", c: 92, v: "k", sec: "" }];
  gateSpecificLinks(good, it, {});
  assert.equal(good[0].c, 92, "an evidenced keyed-answer link is untouched");
  assert.equal(entityOverlap(it, { k: "kb", id: "cholera", title: "Cholera" }, {}), true);
  assert.equal(entityOverlap(it, { k: "kb", id: "x", title: "Ovarian Remnant Syndrome" }, {}), false);
  const kt = [{ k: "kb", id: "anything", title: "Anything", c: 75, v: "kt", sec: "" }];
  gateSpecificLinks(kt, it, {});
  assert.equal(kt[0].c, 75, "module-topic tier is exempt from the specific gate");
});

test("ktOk: a module-topic target must come from the item's own module", () => {
  const ctx = { topics: { m1: { t: "Opioid analgesics and abuse" } }, moduleTitle: "Opioid analgesics and abuse" };
  assert.equal(ktOk("Alcohol and Alcohol Use Disorders", ctx, "m1"), false, "another module's topic is not this module's chapter");
  assert.equal(ktOk("Opioid Use Disorder", ctx, "m1"), true);
  assert.equal(ktOk("Anything", { topics: {} }, "unknown"), true, "no known module title: the verified map stands");
  const topics = { m1: { t: "Opioid analgesics and abuse", kb: [["alcohol_and_alcohol_use_disorders", "Alcohol and Alcohol Use Disorders"], ["opioid_use_disorder", "Opioid Use Disorder"]], pr: [] } };
  const out = addTopicLinks([], { q: "Papaver somniferum latex exudes from which part?" },
    { mid: "m1", sid: "pharmacology", topics, lessons: new Map(), lessonMeta: new Map(), bridge: new Map(), midSid: new Map(), images: new Map(), moduleTitle: "Opioid analgesics and abuse" });
  assert.deepEqual(out.map((l) => l.id), ["opioid_use_disorder"], "only the module's own topic is linked");
});

test("addTopicLinks: a mapped lesson (entry.ls) is the topic lesson when the module has none of its own", () => {
  const topics = { m0: { kb: [], pr: [], ls: [["les1", "Chapter One"]] } };
  const out = addTopicLinks([], { q: "What is the treatment?" },
    { mid: "m0", sid: "s", topics, lessons: new Map(), lessonMeta: new Map([["les1", { title: "Chapter One" }]]), bridge: new Map(), midSid: new Map(), images: new Map() });
  assert.deepEqual(out.map((l) => [l.k, l.id, l.v, l.c]), [["ls", "les1", "lt", 75]]);
  const missing = addTopicLinks([], { q: "What?" },
    { mid: "m0", sid: "s", topics, lessons: new Map(), lessonMeta: new Map(), bridge: new Map(), midSid: new Map(), images: new Map() });
  assert.equal(missing.length, 0, "a mapped lesson that does not exist is never linked");
});
