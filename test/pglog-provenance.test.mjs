/* test/pglog-provenance.test.mjs — NMC Logbook · does the module actually say what the NMC says?
 * ===========================================================================
 * THE TEST THIS MODULE WAS SUPPOSED TO HAVE FROM THE START.
 *
 * The first version of `pglog-curriculum.test.mjs` claimed to "fail the build if a numeric target
 * does not appear in its own quotation". It could not: the generator SYNTHESISED each procedure's
 * quote from that same target (`label + " (" + target + ")"`), so the assertion compared a number
 * against itself. It passed for all 64 shipped Emergency Medicine minima without ever looking at the
 * PDF — and did not notice that 17 more minima had been dropped entirely. (R1, 2026-08-27, C-tests.)
 *
 * This file compares the packs against the ACTUAL EXTRACTED TEXT of the NMC PDFs, checked into
 * `pglog-sources/`. A number that is not in the source is a build failure. A quotation that is not in
 * the source is a build failure. That is the whole point.
 *
 * If an NMC document is amended: re-extract into pglog-sources/, run this, and it will name every
 * claim that no longer matches.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKS = join(ROOT, "pglog", "curricula");
const SRC = join(ROOT, "pglog-sources");

const pack = (id) => JSON.parse(readFileSync(join(PACKS, id + ".json"), "utf8"));

/* Which source file backs which pack. A pack with no entry here cannot ship a quotation. */
const SOURCE_OF = {
  "_pgmer-common": ["PGMER-2023"],
  // The shared 2022 pack asserts its clauses appear in ALL FOUR revised curricula — so it is checked
  // against all four, and a clause missing from any one of them fails.
  "_revised-2022-common": ["gen_med", "ortho", "paeds", "patho"],
  "general-medicine": ["gen_med"],
  "general-surgery": ["gen_surg"],
  "obstetrics-gynaecology": ["obg"],
  "paediatrics": ["paeds"],
  "anaesthesiology": ["anaes"],
  "orthopaedics": ["ortho"],
  "radiodiagnosis": ["radio"],
  "pathology": ["patho"],
  "psychiatry": ["psych"],
  "dermatology": ["derm"],
  "ophthalmology": ["ophth"],
  "ent": ["ent"],
  "community-medicine": ["commed"],
  "emergency-medicine": ["emerg"],
  "respiratory-medicine": ["resp"],
  "generic-pg": ["PGMER-2023"]
};

/* Normalisation. `pdftotext -layout` wraps lines mid-sentence and pads columns, and the PDFs mix
 * curly and straight quotes, en/em dashes and the two spellings of "log book". Normalise both sides
 * to a single lower-case whitespace-collapsed string so a real quotation matches and a fabricated one
 * still does not. This is deliberately the ONLY latitude given. */
function norm(s) {
  return String(s || "")
    // Page numbers and running heads sit INSIDE a paragraph in the extracted text; drop any line
    // that is nothing but a number, so a long quotation is not split in half by one.
    .replace(/^[ \t]*\d{1,3}[ \t]*$/gm, " ")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ")
    .toLowerCase()
    .replace(/logbook/g, "log book")     // the 2022 PDFs use both spellings in the same paragraph
    // Hyphens are unreliable: `pdftotext -layout` breaks "clinico-pathological" across a line as
    // "clinico-" + "pathological", and the PDFs themselves write "intra- and inter- departmental"
    // with spaces. Treating every hyphen as a space normalises both sides identically.
    .replace(/-/g, " ")
    // "Pediatrics/ Neonatology" vs "Pediatrics/Neonatology" — the extractor pads around slashes.
    .replace(/\s*\/\s*/g, "/")
    .replace(/[^a-z0-9'"%().,\/:;+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const SOURCES = {};
readdirSync(SRC).filter((f) => f.endsWith(".txt")).forEach((f) => {
  SOURCES[f.replace(/\.txt$/, "")] = norm(readFileSync(join(SRC, f), "utf8"));
});

/* Does this quotation exist in that source document?
 *
 * Matched SENTENCE BY SENTENCE rather than as one contiguous string. A quotation in these packs is
 * often a faithful concatenation of consecutive numbered clause items ("i. … ii. … iii. …"), and the
 * enumerators sit between them in the extracted text. Requiring every sentence of six or more words
 * to appear verbatim still catches a fabricated or altered clause — which is the whole job — while
 * tolerating the PDF's own list markers. Fragments below six words are skipped: a four-word match
 * proves nothing.
 */
function quoteInSource(quote, srcKey) {
  const hay = SOURCES[srcKey];
  if (!hay) return false;
  const parts = String(quote)
    // Also split on the bullet separators used when a quotation reproduces a printed list.
    .split(/…|\.\.\.|·|•|(?<=[.;])\s+/)
    .map(norm)
    // A trailing "." the pack added to close a truncated sentence is not evidence of anything.
    .map((seg) => seg.replace(/^[^a-z0-9]+|[^a-z0-9)]+$/g, ""))
    .filter((seg) => seg.split(" ").length >= 6);
  // A legitimately SHORT quotation ("Thesis writing is compulsory.") has no six-word sentence. Match
  // it whole instead — at that length an exact match is the strong check, not the weak one.
  if (!parts.length) {
    const whole = norm(quote).replace(/^[^a-z0-9]+|[^a-z0-9)]+$/g, "");
    // Two words is the floor. Some NMC quotations genuinely ARE two words — "Seminar Presentation" is
    // a printed bullet in the MD Emergency Medicine academic-activities table — and the alternative
    // to accepting them is padding a quotation out to satisfy a test, which is the opposite of what
    // this file is for. An exact two-word match still catches a fabricated label.
    if (whole.split(" ").length < 2) return false;
    return hay.includes(whole) || hay.replace(/ /g, "").includes(whole.replace(/ /g, ""));
  }
  // Second pass with all spaces removed catches the extractor's own join errors — PGMER-2023 prints
  // "final examinationof the respective post-graduate course" with the space missing.
  const tight = hay.replace(/ /g, "");
  return parts.every((seg) => hay.includes(seg) || tight.includes(seg.replace(/ /g, "")));
}

/* ── 1. Every quotation is really in its source ─────────────────────────────── */

test("EVERY requirement quotation appears verbatim in the NMC source it cites", () => {
  const missing = [];
  Object.keys(SOURCE_OF).forEach((packId) => {
    const p = pack(packId);
    (p.requirements || []).forEach((r) => {
      if (!r.quote) return;
      // A requirement is checked against the document its OWN grade points at. A pack's listed
      // sources are its curriculum PDFs; an nmc_faq requirement belongs to the PGMEB FAQ instead.
      const BY_GRADE = { nmc_faq: ["PGMEB-FAQ-2024-04-10"], nmc_msr: ["PGMSR-2023"] };
      // s.16/s.17 of the 2025 faculty regulations live in their own gazette, not in PGMER-2023.
      /* A quote RECONSTRUCTED from a table cell cannot appear contiguously: `pdftotext -layout`
       * interleaves the other columns between its lines. Such a requirement declares
       * reconstructedFrom + sourceFragments, and every fragment is verified literally instead. The
       * reconstruction stays in `quote` because that is what a reader needs to see; the fragments are
       * what makes it evidence. */
      if (r.reconstructedFrom) {
        assert.ok(Array.isArray(r.sourceFragments) && r.sourceFragments.length >= 2,
          packId + "/" + r.id + ": a reconstructed quote must carry sourceFragments");
        assert.match(r.note || "", /RECONSTRUCTED/,
          packId + "/" + r.id + ": a reconstructed quote must say so in its note");
      }
      const keys = /Qualifications of Faculty/.test(r.clause || "")
        ? ["Faculty-Qualifications-Regulations-2025"]
        : (BY_GRADE[r.source] || SOURCE_OF[packId]);
      keys.forEach((srcKey) => {
        if (r.reconstructedFrom) {
          r.sourceFragments.forEach((frag) => {
            const f = norm(frag);
            if (!SOURCES[srcKey].includes(f)) missing.push(packId + "/" + r.id + " fragment not in " + srcKey + ": " + frag);
          });
          return;
        }
        if (!quoteInSource(r.quote, srcKey)) missing.push(packId + "/" + r.id + " not found in " + srcKey);
      });
    });
  });
  assert.deepEqual(missing, [], "quotations that are NOT in their cited source:\n  " + missing.join("\n  "));
});

test("the shared 2022 pack's claim that its clauses are in ALL FOUR revised curricula is true", () => {
  // This is the assertion `_revised-2022-common.json` makes about itself in source.note, and it is
  // the assertion that was false for the two summative pre-requisites until R1 caught it.
  const p = pack("_revised-2022-common");
  assert.match(p.source.note, /VERIFIED 2026-08-27/);
  const bad = [];
  p.requirements.forEach((r) => {
    if (!r.quote) return;
    ["gen_med", "ortho", "paeds", "patho"].forEach((k) => {
      if (!quoteInSource(r.quote, k)) bad.push(r.id + " missing from " + k);
    });
  });
  assert.deepEqual(bad, [], "shared clauses that are not actually shared:\n  " + bad.join("\n  "));
});

test("the misattributed summative pre-requisites are GONE from the shared pack", () => {
  const ids = pack("_revised-2022-common").requirements.map((r) => r.id);
  ["rev22_exam_conference_presentations", "rev22_exam_indexed_publication", "rev22_logbook_submitted"]
    .forEach((id) => assert.ok(!ids.includes(id), id + " is back in the shared pack — see R1 finding C4"));
});

test("Paediatrics states ONE presentation, accepts STATE level, and treats publication as an ALTERNATIVE", () => {
  const r = pack("paediatrics").requirements.find((x) => x.id === "pd_exam_dissemination");
  assert.ok(r, "paediatrics has no dissemination requirement");
  assert.equal(r.target, 1, "the Paediatrics floor is one presentation, not two");
  assert.ok(quoteInSource(r.quote, "paeds"));
  assert.match(r.quote, /at least one if not two/i);
  assert.match(r.quote, /national\/state level/i);
  assert.match(r.quote, /alternatively/i);
  assert.ok(Array.isArray(r.anyOf) && r.anyOf.length === 2, "it must be evaluated as a real OR");
});

test("Pathology accepts state level and a publication DRAFT", () => {
  const reqs = pack("pathology").requirements;
  const conf = reqs.find((x) => x.id === "pa_exam_conference_presentations");
  const pub = reqs.find((x) => x.id === "pa_exam_indexed_publication");
  assert.equal(conf.target, 2);
  assert.match(conf.quote, /state\/national level/i);
  assert.match(pub.quote, /publication draft/i);
  assert.ok(quoteInSource(conf.quote, "patho"));
});

/* ── 2. Every NUMBER is really in its source ────────────────────────────────── */

// Pull the "(N)" minima out of the Emergency Medicine "Procedural skills" section. This is the ONE
// place an NMC curriculum in this set prints procedure counts, so it is the one place a wrong number
// could ship. Parsed straight from the PDF text, never from the pack.
function emProceduralSkillsSection() {
  const raw = readFileSync(join(SRC, "emerg.txt"), "utf8");
  const start = raw.indexOf("Procedural skills:(Minimum number of procedures");
  assert.ok(start > 0, "the Procedural skills heading moved — re-check the extraction");
  const end = raw.indexOf("Affective Domain:", start);
  assert.ok(end > start, "the end of the Procedural skills section moved");
  return raw.slice(start, end);
}

test("EM: every procedure count in the pack appears in the NMC source section", () => {
  const section = emProceduralSkillsSection();
  // Every bracketed number the PDF prints in that section, as a multiset.
  const srcCounts = {};
  (section.match(/\((\d+)\)/g) || []).forEach((m) => {
    const n = m.slice(1, -1);
    srcCounts[n] = (srcCounts[n] || 0) + 1;
  });
  const packCounts = {};
  pack("emergency-medicine").procedures.forEach((p) => {
    if (p.target == null) return;
    packCounts[p.target] = (packCounts[p.target] || 0) + 1;
  });
  // Every number the pack asserts must exist in the source AT LEAST as many times.
  const bad = [];
  Object.keys(packCounts).forEach((n) => {
    if ((srcCounts[n] || 0) < packCounts[n]) {
      bad.push("pack claims " + packCounts[n] + " x '" + n + "' but the NMC section prints it " + (srcCounts[n] || 0) + " times");
    }
  });
  assert.deepEqual(bad, [], bad.join("\n  "));
});

test("EM: no NMC-stated minimum is MISSING from the pack — the failure R1 caught as I1", () => {
  const section = emProceduralSkillsSection();
  const srcCounts = {};
  (section.match(/\((\d+)\)/g) || []).forEach((m) => {
    const n = m.slice(1, -1);
    srcCounts[n] = (srcCounts[n] || 0) + 1;
  });
  const packCounts = {};
  pack("emergency-medicine").procedures.forEach((p) => {
    if (p.target == null) return;
    packCounts[p.target] = (packCounts[p.target] || 0) + 1;
  });
  const missing = [];
  Object.keys(srcCounts).forEach((n) => {
    if ((packCounts[n] || 0) < srcCounts[n]) {
      missing.push("the NMC section prints '(" + n + ")' " + srcCounts[n] + " times; the pack ships only " + (packCounts[n] || 0));
    }
  });
  assert.deepEqual(missing, [],
    "NMC procedure minima that never reached the pack — a resident would see a complete-looking " +
    "checklist that silently omits part of the requirement:\n  " + missing.join("\n  "));
});

test("EM: the high-consequence minima are individually correct against the PDF", () => {
  const by = Object.fromEntries(pack("emergency-medicine").procedures.map((p) => [p.id, p]));
  const section = norm(emProceduralSkillsSection());
  // label fragment -> expected minimum, read off the PDF by hand and re-checked here mechanically
  const spot = [
    ["em_intubation", "tracheal intubation", 100],
    ["em_ecg", "ecg interpretation", 250],
    ["em_ed_thoracotomy", "ed thoracotomy", 1],
    ["em_ng_tube", "nasogastric tube insertion", 100],
    ["em_investigation_interpretation", "interpretation of laboratory", 100],
    ["em_abscess", "incision and drainage of", 20],
    ["em_lateral_canthotomy", "lateral canthotomy", 1],
    ["em_arrest_pocus", "cardiac arrest pocus/tee", 5],
    ["em_major_incident", "major incident planning", 10]
  ];
  spot.forEach(([id, frag, n]) => {
    assert.ok(by[id], "pack is missing " + id);
    assert.equal(by[id].target, n, id + " target");
    assert.ok(section.includes(norm(frag)), "the PDF section does not contain '" + frag + "'");
  });
});

test("EM: a procedure the NMC lists WITHOUT a number is null, never back-filled", () => {
  const by = Object.fromEntries(pack("emergency-medicine").procedures.map((p) => [p.id, p]));
  // These appear in the source list with no "(N)" beside them.
  ["em_invasive_vent", "em_thoracentesis", "em_thoracostomy", "em_skin_eye_decon", "em_fasciotomy",
   "em_perimortem_caesarean"].forEach((id) => {
    assert.ok(by[id], "pack is missing " + id);
    assert.equal(by[id].target, null, id + " must have no target — the NMC gives it no number");
  });
});

test("every OTHER specialty pack ships NO procedure count at all — and this test is not vacuous", () => {
  const others = Object.keys(SOURCE_OF)
    .filter((k) => !k.startsWith("_") && k !== "emergency-medicine" && k !== "generic-pg");
  assert.ok(others.length >= 14, "expected 14+ non-EM specialty packs, got " + others.length);
  others.forEach((id) => {
    (pack(id).procedures || []).forEach((p) => {
      assert.equal(p.target, null, id + "/" + p.id + " ships a count no NMC source states");
    });
  });
});

test("EM ships an EXACT procedure count, so a future truncation is caught", () => {
  // Not a floor. A floor (`>= 65`) is what let 17 procedures go missing unnoticed.
  const p = pack("emergency-medicine").procedures;
  assert.equal(p.length, 87, "the EM procedure list changed size — verify against pglog-sources/emerg.txt before updating this number");
  assert.equal(p.filter((x) => x.target != null).length, 81);
  assert.equal(p.filter((x) => x.target == null).length, 6);
});

/* ── 3. Non-EM numeric targets ──────────────────────────────────────────────── */

test("every numeric target in every pack is present in its own source document", () => {
  const bad = [];
  Object.keys(SOURCE_OF).forEach((packId) => {
    if (packId === "emergency-medicine") return;      // procedures covered exhaustively above
    const p = pack(packId);
    (p.requirements || []).forEach((r) => {
      if (r.target == null || r.informational || r.advisory) return;
      // A target of 1 usually means "this must happen", not "the NMC printed the number 1" —
      // "the completed log book should be signed by the Head of the Department" is target 1 and
      // contains no numeral. Its QUOTATION is still verified verbatim above, which is the guarantee
      // that matters. Only counts greater than one are checked for the number itself.
      if (r.target === 1) return;
      const BY_GRADE2 = { nmc_faq: ["PGMEB-FAQ-2024-04-10"], nmc_msr: ["PGMSR-2023"] };
      (/Qualifications of Faculty/.test(r.clause || "") ? ["Faculty-Qualifications-Regulations-2025"]
        : (BY_GRADE2[r.source] || SOURCE_OF[packId])).forEach((srcKey) => {
        const hay = SOURCES[srcKey];
        // The number itself, or the word the source spells it with, must be in the source. The
        // ELEVEN word-numbers the NMC PDFs actually use are listed; nothing else is accepted.
        // The word-forms the NMC PDFs actually use for a count, including "twice a week".
        const words = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
                        7: "seven", 8: "eight", 9: "nine", 10: "ten", 12: "twelve", 80: "eighty" };
        const alt = { 2: ["twice", "both"], 3: ["thrice"] };
        const q = norm(r.quote || "");
        const n = String(r.target);
        const ok = q.includes(n) || (words[r.target] && q.includes(words[r.target])) ||
          (alt[r.target] || []).some((w) => q.includes(w));
        if (!ok) bad.push(packId + "/" + r.id + ": target " + n + " is in neither digits nor words in its quote");
        else if (r.reconstructedFrom) { /* fragments already verified above */ }
        else if (r.quote && !quoteInSource(r.quote, srcKey)) bad.push(packId + "/" + r.id + ": quote not in " + srcKey);
        else if (!hay.includes(n) && !(words[r.target] && hay.includes(words[r.target]))) {
          bad.push(packId + "/" + r.id + ": " + n + " does not occur anywhere in " + srcKey);
        }
      });
    });
  });
  assert.deepEqual(bad, [], "unsourced numbers:\n  " + bad.join("\n  "));
});

/* ── 4. The requirements doc is the index it claims to be ───────────────────── */

test("every clause a pack cites is named in NMC_PG_LOGBOOK_REQUIREMENTS.md", () => {
  // The doc's own maintenance rule: "A pack requirement whose `source` clause is not in this file is
  // a bug." Nothing enforced it, which is how the DRP 2.5-month tolerance and the appraisal total
  // got in without appearing in the doc at all.
  const doc = norm(readFileSync(join(ROOT, "NMC_PG_LOGBOOK_REQUIREMENTS.md"), "utf8"));
  const missing = new Set();
  Object.keys(SOURCE_OF).forEach((packId) => {
    (pack(packId).requirements || []).forEach((r) => {
      if (!r.clause || r.source === "institution") return;
      // A PGMER section number ("5.2(v)") must appear literally; a prose clause name is matched on
      // its first few words, since the doc paraphrases headings.
      const c = norm(r.clause);
      if (/^\d+\.\d+/.test(c)) {
        // A PGMER section number must be in the doc. Sub-items ("5.2(xi)(a)") are matched on their
        // parent section, which is how the doc quotes them.
        const m = c.match(/^\d+\.\d+(\([a-z0-9ivx]+\))?/);
        const key = m ? m[0] : c;
        if (!doc.includes(key)) missing.add(packId + " -> " + r.clause);
      } else {
        // A curriculum clause is a PDF heading, not a section number. The rule that matters for
        // those is that the SOURCE DOCUMENT is in the register — listing sixty heading names in the
        // requirements doc would be noise, not traceability. The quotation itself is already
        // verified against that PDF above.
        // A COMMON pack (_pgmer-common, _revised-2022-common) cites no single PDF of its own — its
        // clauses are checked against several, each of which is registered under its own specialty
        // pack. Nothing to look up here.
        if (packId.startsWith("_")) return;
        // The register (§10) lists each pack's source PDF by URL, so check the URL's file name.
        const url = (pack(packId).source || {}).url || "";
        // %20 in the pack's URL vs a literal space in the doc's register — same file.
        const base = norm(decodeURIComponent(url.split("/").pop() || ""));
        if (!base || !doc.includes(base)) {
          missing.add(packId + " -> source PDF " + url.split("/").pop() + " is not in the §10 register");
        }
      }
    });
  });
  assert.deepEqual([...missing], [], "clauses cited by a pack but absent from the requirements doc:\n  " + [...missing].join("\n  "));
});

test("the source register lists every file the packs are checked against", () => {
  const doc = readFileSync(join(ROOT, "NMC_PG_LOGBOOK_REQUIREMENTS.md"), "utf8");
  assert.match(doc, /pglog-sources/, "the requirements doc must point at the checked-in extracts");
  Object.keys(SOURCES).forEach((k) => {
    assert.ok(SOURCES[k].length > 2000, k + ".txt looks truncated (" + SOURCES[k].length + " chars)");
  });
  assert.ok(Object.keys(SOURCES).length >= 17, "expected the 16 curriculum extracts plus the PGMEB FAQ, got " + Object.keys(SOURCES).length);
});

/* ── coverage: every qualification the gazette recognises ─────────────────────
 * A rival product's department picker lists ~35 departments and it is their strongest coverage
 * claim. Ours is generated from PGMER-2023's own Annexure-1 and Annexure-2, so it cannot drift from
 * the regulation, and a specialty with no curriculum pack is supported honestly rather than absent.
 */

test("the specialty picker is generated from the gazette's own annexures", () => {
  const sp = JSON.parse(readFileSync(join(ROOT, "pglog", "specialties.json"), "utf8"));
  assert.ok(sp.broad.length >= 37, "PGMER Annexure-1 lists 32 MD + 6 MS; got " + sp.broad.length);
  assert.ok(sp.super.length >= 40, "PGMER Annexure-2 is the DM/MCh list; got " + sp.super.length);
  assert.match(sp.source.url, /nmc\.org\.in/);
  // every name must actually appear in the extracted gazette text
  const gazette = SOURCES["PGMER-2023"];
  sp.broad.concat(sp.super).forEach((x) => {
    assert.ok(gazette.includes(norm(x.name)), x.degree + " (" + x.name + ") is not in PGMER-2023");
  });
});

test("a specialty with no pack resolves to generic-pg, and is flagged as such", () => {
  const sp = JSON.parse(readFileSync(join(ROOT, "pglog", "specialties.json"), "utf8"));
  const pharm = sp.broad.find((x) => /Pharmacology/i.test(x.name));
  assert.ok(pharm, "MD Pharmacology must be selectable");
  assert.equal(pharm.packId, "generic-pg");
  assert.equal(pharm.hasSpecialtyPack, false);
  // and the fallback pack says so out loud rather than looking empty
  assert.match(pack("generic-pg").banner, /No NMC specialty curriculum pack is loaded/);
});

test("every packId in the picker is a pack that exists", () => {
  const sp = JSON.parse(readFileSync(join(ROOT, "pglog", "specialties.json"), "utf8"));
  const ids = new Set(Object.keys(SOURCE_OF));
  sp.broad.concat(sp.super).forEach((x) => {
    assert.ok(ids.has(x.packId), x.name + " points at a pack that does not exist: " + x.packId);
  });
});

test("the specialties with a real pack are exactly the 15 that were sourced", () => {
  const sp = JSON.parse(readFileSync(join(ROOT, "pglog", "specialties.json"), "utf8"));
  const withPack = sp.broad.concat(sp.super).filter((x) => x.hasSpecialtyPack);
  assert.equal(withPack.length, 15, "a pack appearing or vanishing here should be deliberate");
  assert.ok(withPack.every((x) => x.degree === "MD" || x.degree === "MS"),
    "no super-specialty curriculum has been sourced yet, so none may claim a pack");
});
