// Unit tests for Tokós Instruments: deck validation, option generation, grading, and search/filter.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import API from "../tokos-clinic-instruments.js";

const { hashSeed, nameOptions, useOptions, filterInstruments, gradeResident, L10N } = API;

const deckRaw = readFileSync("tokos/decks/instruments.json", "utf8");
const deck = JSON.parse(deckRaw);
const credits = JSON.parse(readFileSync("tokos/media/credits.json", "utf8"));

function readWebpDimensions(buf) {
  if (buf.toString("ascii", 12, 16) === "VP8X") {
    return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  }
  if (buf.toString("ascii", 12, 16) === "VP8 ") {
    return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  if (buf.toString("ascii", 12, 16) === "VP8L") {
    const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
    return {
      w: 1 + (((b1 & 0x3f) << 8) | b0),
      h: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    };
  }
  return null;
}

test("instruments deck: shape, exactly 29 unique cases, valid groups, and credit structure", () => {
  assert.equal(deck.v, 1);
  assert.equal(deck.id, "instruments");
  assert.equal(deck.review, "ai_drafted");
  assert.ok(deck.title && deck.title.en && deck.title.hi, "deck titles must have en and hi");
  assert.equal(deck.cases.length, 29, "deck must contain exactly 29 instruments");

  const ids = deck.cases.map((c) => c.id);
  assert.equal(new Set(ids).size, 29, "all case IDs must be unique");

  const validGroupIds = (deck.groups || []).map((g) => g.id);
  assert.equal(validGroupIds.length, 6, "must have 6 groups");
  deck.groups.forEach((g) => {
    assert.ok(g.id && typeof g.id === "string");
    assert.ok(g.label && g.label.en && g.label.hi, "group " + g.id + " must have bilingual labels");
  });

  deck.cases.forEach((c) => {
    assert.ok(c.id && /^in-\d{2}$/.test(c.id), "case id pattern: in-NN (" + c.id + ")");
    assert.ok(validGroupIds.includes(c.group), c.id + " has invalid group: " + c.group);
    assert.ok(c.name && c.name.en && c.name.en.trim(), c.id + " missing name.en");
    assert.ok(Array.isArray(c.identify) && c.identify.length > 0, c.id + " missing identify");
    assert.ok(Array.isArray(c.uses) && c.uses.length > 0, c.id + " missing uses");
    if (c.cautions) {
      assert.ok(Array.isArray(c.cautions) && c.cautions.length > 0, c.id + " empty cautions array");
    }
    assert.ok(c.w > 0 && c.h > 0, c.id + " invalid dimensions");
    assert.equal(c.img, "instruments/" + c.id + ".webp", c.id + " unexpected image path");
  });

  assert.ok(credits["instruments-sheet"], "credits.json must include instruments-sheet");
  assert.equal(credits["instruments-sheet"].licence, "unconfirmed (owner-supplied)");
});

test("instruments images: every image exists on disk as valid WebP with stated dimensions", () => {
  deck.cases.forEach((c) => {
    const p = join("tokos/media", c.img);
    assert.ok(existsSync(p), p + " does not exist on disk");
    const buf = readFileSync(p);
    assert.equal(buf.toString("ascii", 0, 4), "RIFF", p + " missing RIFF");
    assert.equal(buf.toString("ascii", 8, 12), "WEBP", p + " missing WEBP");
    const dims = readWebpDimensions(buf);
    assert.ok(dims, "could not parse dimensions for " + p);
    assert.equal(dims.w, c.w, c.id + " width mismatch");
    assert.equal(dims.h, c.h, c.id + " height mismatch");
  });
});

test("instruments deck and text: no em-dash or en-dash anywhere in app-facing content", () => {
  assert.ok(!deckRaw.includes("\u2014"), "deck must not contain em-dash");
  assert.ok(!deckRaw.includes("\u2013"), "deck must not contain en-dash");
  const cr = JSON.stringify(credits["instruments-sheet"]);
  assert.ok(!cr.includes("\u2014"), "credit entry must not contain em-dash");
  assert.ok(!cr.includes("\u2013"), "credit entry must not contain en-dash");
});

test("spotter option generation: MBBS 4 options, Resident 6 options, right answer present once, no duplicates", () => {
  deck.cases.forEach((c) => {
    const mbbs = nameOptions(deck, c, "mbbs");
    assert.equal(mbbs.length, 4, c.id + " mbbs option count");
    assert.equal(mbbs.filter((o) => o.id === c.id).length, 1, c.id + " correct answer not present once in MBBS");
    assert.equal(new Set(mbbs.map((o) => o.id)).size, 4, c.id + " duplicate option IDs in MBBS");
    assert.equal(new Set(mbbs.map((o) => o.name.en)).size, 4, c.id + " duplicate option names in MBBS");

    const res = nameOptions(deck, c, "resident");
    assert.equal(res.length, 6, c.id + " resident option count");
    assert.equal(res.filter((o) => o.id === c.id).length, 1, c.id + " correct answer not present once in Resident");
    assert.equal(new Set(res.map((o) => o.id)).size, 6, c.id + " duplicate option IDs in Resident");
    assert.equal(new Set(res.map((o) => o.name.en)).size, 6, c.id + " duplicate option names in Resident");
  });
});

test("spotter option generation: same-group preference is enforced", () => {
  deck.cases.forEach((c) => {
    const sameCount = deck.cases.filter((x) => x.group === c.group && x.id !== c.id).length;
    const mbbs = nameOptions(deck, c, "mbbs");
    const mbbsDistractors = mbbs.filter((o) => o.id !== c.id);
    const mbbsSame = mbbsDistractors.filter((o) => o.group === c.group).length;
    assert.equal(mbbsSame, Math.min(sameCount, 3), c.id + " mbbs same-group count");

    const res = nameOptions(deck, c, "resident");
    const resDistractors = res.filter((o) => o.id !== c.id);
    const resSame = resDistractors.filter((o) => o.group === c.group).length;
    assert.equal(resSame, Math.min(sameCount, 5), c.id + " resident same-group count");
  });
});

test("spotter option generation: deterministic output per case and level across repeated invocations", () => {
  deck.cases.forEach((c) => {
    const m1 = nameOptions(deck, c, "mbbs").map((o) => o.id);
    const m2 = nameOptions(deck, c, "mbbs").map((o) => o.id);
    assert.deepEqual(m1, m2, c.id + " mbbs not deterministic");

    const r1 = nameOptions(deck, c, "resident").map((o) => o.id);
    const r2 = nameOptions(deck, c, "resident").map((o) => o.id);
    assert.deepEqual(r1, r2, c.id + " resident not deterministic");

    const u1 = useOptions(deck, c);
    const u2 = useOptions(deck, c);
    assert.equal(u1.trueUse, u2.trueUse, c.id + " true use not deterministic");
    assert.deepEqual(u1.options.map((o) => o.text), u2.options.map((o) => o.text), c.id + " use options not deterministic");
  });
});

test("resident use step: exactly 4 options, true use present, distractors never contain the true use or case uses", () => {
  deck.cases.forEach((c) => {
    const u = useOptions(deck, c);
    assert.equal(u.options.length, 4, c.id + " use options count");
    assert.equal(u.options.filter((o) => o.ok).length, 1, c.id + " true use must appear exactly once");
    assert.ok(c.uses.includes(u.trueUse), c.id + " true use must be one of the case's uses");

    const distractorTexts = u.options.filter((o) => !o.ok).map((o) => o.text);
    assert.equal(distractorTexts.length, 3, c.id + " exactly 3 distractors");
    distractorTexts.forEach((d) => {
      assert.notEqual(d, u.trueUse, c.id + " distractor matches true use");
      assert.ok(!c.uses.includes(d), c.id + " distractor found in case uses: " + d);
    });
    assert.equal(new Set(u.options.map((o) => o.text)).size, 4, c.id + " duplicate use option texts");
  });
});

test("resident grading mapping: both right = Good (3), name only = Hard (2), wrong name = Again (1)", () => {
  assert.equal(gradeResident(true, true), 3, "both correct -> Good (3)");
  assert.equal(gradeResident(true, false), 2, "name correct, use wrong -> Hard (2)");
  assert.equal(gradeResident(false, true), 1, "name wrong, use correct -> Again (1)");
  assert.equal(gradeResident(false, false), 1, "both wrong -> Again (1)");
});

test("atlas search and filter pure functions: group filter, name match, aka match, and empty state", () => {
  const all = filterInstruments(deck.cases, "all", "");
  assert.equal(all.length, 29, "all instruments returned when no filter");

  const speculums = filterInstruments(deck.cases, "speculum", "");
  assert.equal(speculums.length, 3, "3 speculums");
  speculums.forEach((c) => assert.equal(c.group, "speculum"));

  const holding = filterInstruments(deck.cases, "holding", "");
  assert.equal(holding.length, 7, "7 holding instruments");

  // Name search (case insensitive)
  const cusco = filterInstruments(deck.cases, "all", "cusco");
  assert.equal(cusco.length, 1);
  assert.equal(cusco[0].id, "in-02");

  // Aka search
  const bivalve = filterInstruments(deck.cases, "all", "bivalve");
  assert.equal(bivalve.length, 1);
  assert.equal(bivalve[0].id, "in-02");

  const deLee = filterInstruments(deck.cases, "all", "de lee");
  assert.equal(deLee.length, 1);
  assert.equal(deLee[0].id, "in-23");

  // Combined group + search
  const inCatheterGroup = filterInstruments(deck.cases, "catheter", "foley");
  assert.equal(inCatheterGroup.length, 1);
  assert.equal(inCatheterGroup[0].id, "in-21");

  const wrongGroupMatch = filterInstruments(deck.cases, "speculum", "foley");
  assert.equal(wrongGroupMatch.length, 0);

  // Empty match
  const noMatch = filterInstruments(deck.cases, "all", "xyznotfound");
  assert.equal(noMatch.length, 0);
});

test("chrome strings: L10N dictionary has matching keys for en and hi with no dashes", () => {
  assert.ok(L10N.en && L10N.hi);
  const enKeys = Object.keys(L10N.en).sort();
  const hiKeys = Object.keys(L10N.hi).sort();
  assert.deepEqual(enKeys, hiKeys, "en and hi keys must match");

  enKeys.forEach((k) => {
    assert.ok(typeof L10N.en[k] === "string" && L10N.en[k].length > 0, "missing en." + k);
    assert.ok(typeof L10N.hi[k] === "string" && L10N.hi[k].length > 0, "missing hi." + k);
    assert.ok(!L10N.en[k].includes("\u2014"), "en." + k + " has em-dash");
    assert.ok(!L10N.en[k].includes("\u2013"), "en." + k + " has en-dash");
    assert.ok(!L10N.hi[k].includes("\u2014"), "hi." + k + " has em-dash");
    assert.ok(!L10N.hi[k].includes("\u2013"), "hi." + k + " has en-dash");
  });
});
