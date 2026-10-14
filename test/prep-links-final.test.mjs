// links-final: the committed topic map covers every overlay module, and the local (no-API)
// module-topic fallback fails closed. Fixtures synthetic except the overlay/topic-map coverage,
// which reads the committed prep/bank files exactly as the links build does.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addTopicLinks, moduleTopicFallback, gateSpecificLinks, entityOverlap, stemEvidenced, tagEvidenced, promotable, ktOk, SPECIFIC_MIN_E, SPECIFIC_MIN } from "../tools/prep-links.mjs";

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
  assert.deepEqual(out.map((l) => l.id), ["alcohol_and_alcohol_use_disorders", "opioid_use_disorder"], "a mapped entry is the module's own verified topic list and stands without a lesson");
});

test("addTopicLinks: an unevidenced mapped article does not ride along when the module lesson covers the item", () => {
  const lessons = new Map([["m1", [{ key: "m1", title: "Viral Exanthems", own: true }]]]);
  const topics = { m1: { t: "Viral exanthems", kb: [["mumps", "Mumps"]], pr: [] } };
  const ctx = { mid: "m1", sid: "s", topics, lessons, lessonMeta: new Map([["m1", { title: "Viral Exanthems" }]]), bridge: new Map(), midSid: new Map(), images: new Map(), moduleTitle: "Viral exanthems" };
  const off = addTopicLinks([], { q: "Secondary attack rate of chickenpox is?", o: ["Low", "High"], a: 1 }, ctx);
  assert.deepEqual(off.map((l) => l.v), ["lt"], "the lesson is the module-level target, the mumps article is not linked");
  const on = addTopicLinks([], { q: "A child has parotid swelling. What is it?", o: ["Mumps", "Sialadenitis"], a: 0 }, ctx);
  assert.ok(on.some((l) => l.id === "mumps" && l.v === "kt"), "an evidenced mapped article still rides with the lesson");
});

test("addTopicLinks: a mixed module shows the item's own subtopic, not another subtopic's article", () => {
  const topics = { m1: { t: "Viral exanthems", kb: [["mumps", "Mumps"]], pr: [] } };
  const ctx = { mid: "m1", sid: "s", topics, lessons: new Map(), lessonMeta: new Map(), bridge: new Map(), midSid: new Map(), images: new Map(), moduleTitle: "Viral exanthems" };
  const it = { q: "Secondary attack rate of chickenpox is?", o: ["Low", "High", "Nil", "Same"], a: 1 };
  assert.equal(stemEvidenced(it, { k: "kb", id: "varicella", title: "Varicella (Chickenpox)" }, {}), true);
  assert.equal(stemEvidenced(it, { k: "kb", id: "mumps", title: "Mumps" }, {}), false);
  const links = [{ k: "kb", id: "varicella", title: "Varicella (Chickenpox)", c: 65, v: "s", sec: "" }];
  addTopicLinks(links, it, ctx);
  assert.deepEqual(links.map((l) => [l.id, l.v, l.c]), [["varicella", "kt", 75]], "the item's evidenced subtopic becomes its topic target");
  const noCand = [];
  addTopicLinks(noCand, it, ctx);
  assert.deepEqual(noCand.map((l) => l.id), ["mumps"], "with no evidenced candidate the module article remains the fallback");
  const multi = { m2: { t: "Liver diseases", kb: [["hepatitis_a", "Hepatitis A"], ["wilson_disease", "Wilson Disease"]], pr: [] } };
  const ctx2 = { mid: "m2", sid: "s", topics: multi, lessons: new Map(), lessonMeta: new Map(), bridge: new Map(), midSid: new Map(), images: new Map(), moduleTitle: "Liver diseases" };
  const out2 = addTopicLinks([], { q: "Kayser-Fleischer rings are seen in?", o: ["Wilson disease", "Haemochromatosis"], a: 0 }, ctx2);
  assert.deepEqual(out2.map((l) => l.id), ["wilson_disease"], "among several mapped topics only the evidenced one is shown");
});

test("addTopicLinks: subject rapid-review lesson replaces an unevidenced module article; evidenced articles stay", () => {
  const topics = { m1: { t: "Viral exanthems", kb: [["mumps", "Mumps"]], pr: [] } };
  const ctx = { mid: "m1", sid: "microbiology", topics, lessons: new Map(), lessonMeta: new Map(), bridge: new Map(), midSid: new Map(), images: new Map(), moduleTitle: "Viral exanthems", subjectLesson: { key: "mic-mixed", title: "Microbiology mixed rapid review" } };
  const off = addTopicLinks([], { q: "Secondary attack rate of chickenpox is?", o: ["Low", "High"], a: 1 }, ctx);
  assert.deepEqual(off.map((l) => [l.k, l.id, l.v]), [["ls", "mic-mixed", "lt"]], "the broad subject lesson, not another subtopic's article");
  const on = addTopicLinks([], { q: "A child has parotid swelling and orchitis. What is it?", o: ["Mumps", "Sialadenitis"], a: 0 }, ctx);
  assert.ok(on.some((l) => l.id === "mumps" && l.v === "kt"), "an evidenced module article still wins over the subject lesson");
  const shown = [{ k: "kb", id: "varicella", title: "Varicella (Chickenpox)", c: 92, v: "k", sec: "" }];
  addTopicLinks(shown, { q: "Vesicles in dermatomes?", o: ["Varicella zoster", "HSV"], a: 0 }, ctx);
  assert.ok(!shown.some((l) => l.id === "mumps"), "an unevidenced extra article does not ride along with a shown specific");
});

test("addTopicLinks: a stem-evidenced candidate becomes the per-item topic article next to the module lesson", () => {
  const lessons = new Map([["m1", [{ key: "m1", title: "Cardiology Review", own: true }]]]);
  const links = [{ k: "kb", id: "varicella", title: "Varicella (Chickenpox)", c: 65, v: "s", sec: "" }];
  const out = addTopicLinks(links, { q: "Secondary attack rate of chickenpox is?", o: ["Low", "High"], a: 1 },
    { mid: "m1", sid: "s", topics: {}, lessons, lessonMeta: new Map([["m1", { title: "Cardiology Review" }]]), bridge: new Map(), midSid: new Map(), images: new Map(), moduleTitle: "Cardiology" });
  assert.ok(out.some((l) => l.id === "varicella" && l.v === "kt" && l.c === 75), "the item's own article at topic tier");
  assert.ok(out.some((l) => l.id === "m1" && l.v === "lt"), "the module lesson remains");
  const expOnly = [{ k: "kb", id: "varicella", title: "Varicella (Chickenpox)", c: 55, v: "e", sec: "" }];
  const out2 = addTopicLinks(expOnly, { q: "A question about rashes in general?", o: ["Alpha", "Beta"], a: 0, exp: "Chickenpox is discussed in the explanation." },
    { mid: "m1", sid: "s", topics: {}, lessons, lessonMeta: new Map(), bridge: new Map(), midSid: new Map(), images: new Map(), moduleTitle: "Cardiology" });
  assert.ok(!out2.some((l) => l.id === "varicella" && l.c >= 75), "an explanation-only mention is never promoted");
});

test("promotable: topic tags promote, distractors and explanation-only mentions do not", () => {
  const it = { q: "A patient in the ICU has a new skin colonisation finding. What is it?", o: ["Candida auris", "Candida albicans", "Aspergillus", "Mucor"], a: 0, tg: ["Candida auris colonisation"], exp: "Candida auris colonises skin." };
  const cand = { k: "kb", id: "candida_auris", title: "Candida Auris", c: 55, v: "e", sec: "" };
  assert.equal(tagEvidenced(it, cand, {}), true);
  assert.equal(promotable(it, cand, {}), true, "a tag-named candidate above the distractor cap promotes");
  const distractor = { k: "kb", id: "x", title: "Mucor", c: 50, v: "s", sec: "" };
  assert.equal(promotable(it, distractor, {}), false, "a candidate at the distractor cap never promotes");
  const neg = { k: "kb", id: "candida_auris", title: "Candida Auris", c: 60, v: "k", sec: "" };
  assert.equal(promotable(it, neg, {}), false, "a negated keyed mention does not promote on tags alone");
  const noTag = { ...it, tg: [] };
  assert.equal(promotable(noTag, cand, {}), false, "an explanation-only mention without tags or stem evidence does not promote");
  const links = [{ ...cand }];
  const out = addTopicLinks(links, it, { mid: "m1", sid: "medicine", topics: {}, lessons: new Map(), lessonMeta: new Map(), bridge: new Map(), midSid: new Map(), images: new Map(), moduleTitle: "Medicine" });
  assert.ok(out.some((l) => l.id === "candida_auris" && l.v === "kt" && l.c === 75), "the tag-evidenced article becomes the topic target");
});

test("addTopicLinks: an explanation-only mapped article yields to the subject lesson; a tag-evidenced one stays", () => {
  const topics = { m1: { t: "Viral exanthems", kb: [["mumps", "Mumps"]], pr: [] } };
  const ctx = { mid: "m1", sid: "microbiology", topics, lessons: new Map(), lessonMeta: new Map(), bridge: new Map(), midSid: new Map(), images: new Map(), moduleTitle: "Viral exanthems", subjectLesson: { key: "mic-mixed", title: "Microbiology mixed rapid review" } };
  const expOnly = addTopicLinks([], { q: "A question about rashes in general?", o: ["Alpha", "Beta"], a: 0, exp: "Mumps is discussed in the explanation." }, ctx);
  assert.deepEqual(expOnly.map((l) => l.id), ["mic-mixed"], "explanation-only evidence is not enough for the module article");
  const tagged = addTopicLinks([], { q: "A question about rashes in general?", o: ["Alpha", "Beta"], a: 0, tg: ["Mumps parotitis"], exp: "" }, ctx);
  assert.ok(tagged.some((l) => l.id === "mumps" && l.v === "kt"), "a tag-evidenced module article stays");
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
