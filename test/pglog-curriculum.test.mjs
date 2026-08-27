/* test/pglog-curriculum.test.mjs — NMC Logbook · curriculum packs + the requirement mapper.
 *
 * THE POINT OF THIS FILE: the packs are the only place the module makes a claim about what the NMC
 * requires. So the tests here are provenance tests. Every requirement must name a source, a clause
 * and (where it states a number) a quote containing that number. A requirement that fails these is a
 * requirement the app would present to a resident as a regulation without being able to show them
 * where it came from.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../pglog-curriculum.js");
const M = require("../pglog-model.js");

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "pglog", "curricula");
const read = (f) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const packFiles = files.filter((f) => f !== "index.json" && !f.startsWith("_"));
const commonFiles = files.filter((f) => f.startsWith("_"));

const VALID_SOURCES = ["nmc_regulation", "nmc_curriculum", "nmc_faq_secondary", "institution", "unspecified"];

/* ── provenance ────────────────────────────────────────────────────────────── */

test("every pack file parses and declares its NMC source PDF", () => {
  assert.ok(packFiles.length >= 15, "expected at least 15 specialty packs, got " + packFiles.length);
  for (const f of packFiles) {
    const p = read(f);
    assert.ok(p.id, f + ": no id");
    assert.equal(p.programmeType, "PG", f + ": PG only in this phase");
    assert.ok(p.source && p.source.title, f + ": no source title");
    assert.ok(p.source.publisher, f + ": no publisher");
    assert.ok(/^https:\/\/www\.nmc\.org\.in\//.test(p.source.url), f + ": source url is not an nmc.org.in URL");
    assert.ok(p.source.retrieved, f + ": no retrieval date");
    assert.ok(p.disclaimer, f + ": no disclaimer");
  }
});

test("EVERY requirement in EVERY pack names a source and a clause", () => {
  for (const f of files.filter((x) => x !== "index.json")) {
    const p = read(f);
    for (const r of p.requirements || []) {
      assert.ok(r.id, f + ": a requirement has no id");
      assert.ok(VALID_SOURCES.includes(r.source), f + "/" + r.id + ": bad source '" + r.source + "'");
      assert.ok(r.clause, f + "/" + r.id + ": no clause");
      assert.ok(r.label, f + "/" + r.id + ": no label");
    }
  }
});

test("EVERY numeric target is backed by a quote containing that number", () => {
  const exempt = new Set([
    // Cadence targets of 1 ("once a week") - the number is the word, not a digit.
    "1"
  ]);
  for (const f of files.filter((x) => x !== "index.json")) {
    const p = read(f);
    for (const r of (p.requirements || []).concat(p.procedures || [])) {
      if (r.target == null) continue;
      if (r.informational || r.advisory) continue;
      const n = String(r.target);
      if (exempt.has(n)) continue;
      const hay = [r.quote, r.note, r.label].join(" ");
      assert.ok(hay.includes(n),
        f + "/" + r.id + ": target " + n + " does not appear in its own quote — an unsourced number");
    }
  }
});

test("no requirement claims an NMC source while having an unsourced number", () => {
  for (const f of files.filter((x) => x !== "index.json")) {
    const p = read(f);
    for (const r of p.requirements || []) {
      if (r.source === "institution" && r.target != null) {
        assert.ok(r.note || r.quote, f + "/" + r.id + ": institutional target with no explanation");
      }
    }
  }
});

test("PGMER-2023 clause references look like real clauses", () => {
  const common = read("_pgmer-common.json");
  for (const r of common.requirements) {
    assert.equal(r.source, "nmc_regulation", r.id + ": the PGMER pack must only carry regulation requirements");
    assert.match(r.clause, /^\d+\.\d+/, r.id + ": clause '" + r.clause + "' is not a PGMER section number");
    assert.ok(r.quote, r.id + ": a regulation requirement with no verbatim quote");
  }
});

test("the PGMER pack carries the six clauses the module is built on", () => {
  const ids = read("_pgmer-common.json").requirements.map((r) => r.id);
  ["pgmer_elogbook_weekly", "pgmer_monthly_attestation", "pgmer_surgical_log", "pgmer_ug_teaching",
   "pgmer_dissemination", "pgmer_attendance"].forEach((id) => assert.ok(ids.includes(id), "missing " + id));
});

test("the attendance day-counts are carried as a SECONDARY source, separately from the 80%", () => {
  const att = read("_pgmer-common.json").requirements.find((r) => r.id === "pgmer_attendance");
  assert.equal(att.source, "nmc_regulation");        // the 80% is the gazette's
  assert.equal(att.target, 80);
  assert.equal(att.secondary.source, "nmc_faq_secondary");
  assert.equal(att.secondary.days["36"], 751);
  assert.equal(att.secondary.days["24"], 501);
  assert.match(att.secondary.note, /SECONDARY SOURCE/);
});

/* ── the one pack with real NMC counts ─────────────────────────────────────── */

test("Emergency Medicine carries the NMC procedure minima verbatim", () => {
  const em = read("emergency-medicine.json");
  assert.equal(em.source.year, 2024);
  const byId = Object.fromEntries(em.procedures.map((p) => [p.id, p]));
  // spot-checks against the printed list
  assert.equal(byId.em_intubation.target, 100);
  assert.equal(byId.em_ecg.target, 250);
  assert.equal(byId.em_ed_thoracotomy.target, 1);
  assert.equal(byId.em_airway_neonatal.target, 5);
  assert.equal(byId.em_pelvic_stabilisation.target, 2);
  assert.equal(byId.em_fast.target, 50);
  // a procedure NAMED without a number stays null and is not back-filled
  assert.equal(byId.em_thoracentesis.target, null);
  assert.equal(byId.em_fasciotomy.target, null);
  assert.ok(em.procedures.length >= 65);
});

test("every OTHER specialty pack ships procedure targets of null — no invented counts", () => {
  for (const f of packFiles.filter((x) => x !== "emergency-medicine.json")) {
    const p = read(f);
    for (const pr of p.procedures || []) {
      assert.equal(pr.target, null, f + "/" + pr.id + ": a procedure count that no NMC source states");
    }
  }
});

test("packs whose source says 'a specified number' say so in a note", () => {
  for (const id of ["general-surgery", "ent", "psychiatry"]) {
    const p = read(id + ".json");
    const hay = JSON.stringify(p);
    assert.match(hay, /specified number/, id + ": the 'specified number' clause is not quoted");
  }
});

/* ── flatten + resolve ─────────────────────────────────────────────────────── */

function flat(id) {
  const pack = read(id + ".json");
  const commons = (pack.extends || []).map((e) => read(e + ".json"));
  return C.flatten(commons, pack);
}

test("extending merges the common packs and lets the specialty override by id", () => {
  const f = flat("general-medicine");
  const ids = f.requirements.map((r) => r.id);
  assert.ok(ids.includes("pgmer_elogbook_weekly"), "PGMER requirements must reach every pack");
  assert.ok(ids.includes("rev22_hod_sign"), "2022-revised common must reach a revised pack");
  assert.ok(ids.includes("gm_journal_club"), "the specialty's own requirements must be there");
  assert.equal(new Set(ids).size, ids.length, "duplicate requirement ids after flatten");
});

test("a 2019-era pack does NOT inherit the 2022-revised clauses it never contained", () => {
  const ids = flat("general-surgery").requirements.map((r) => r.id);
  assert.ok(ids.includes("pgmer_elogbook_weekly"));
  assert.ok(!ids.includes("rev22_hod_sign"), "MS Surgery 2019 has no 2022-revised HoD-signature clause");
});

test("procedures become procedure-kind requirements matched on procedureId", () => {
  const f = flat("emergency-medicine");
  const r = f.requirements.find((x) => x.id === "em_intubation");
  assert.equal(r.kind, "procedure");
  assert.equal(r.target, 100);
  assert.equal(r.match.procedureId, "em_intubation");
  assert.equal(r.isProcedure, true);
});

test("resolve filters by degree — an MS-only clause never reaches an MD resident", () => {
  const f = flat("general-medicine");
  const md = C.resolve(f, { degree: "MD" }).map((r) => r.id);
  const ms = C.resolve(flat("general-surgery"), { degree: "MS" }).map((r) => r.id);
  assert.ok(!md.includes("pgmer_surgical_log"), "5.2(v) surgical log is MS/M.Ch only");
  assert.ok(ms.includes("pgmer_surgical_log"));
});

test("an institutional override may change the target but never the source or the quote", () => {
  const f = flat("general-surgery");
  const out = C.resolve(f, { degree: "MS", overrides: {
    gs_procedures: { target: 200, note: "Departmental target agreed 2026-07." }
  }});
  const r = out.find((x) => x.id === "gs_procedures");
  assert.equal(r.target, 200);
  assert.equal(r.targetSource, "institution");
  assert.equal(r.nmcTarget, null);                            // NMC gave none, and that is recorded
  assert.equal(r.source, "nmc_curriculum");                   // the CLAUSE provenance is untouched
  assert.match(r.quote, /specified number/);
  assert.match(r.institutionNote, /Departmental target/);
});

test("an override can hide a requirement the department does not run", () => {
  const f = flat("general-medicine");
  const out = C.resolve(f, { degree: "MD", overrides: { gm_symposium: { hidden: true } } });
  assert.ok(!out.some((r) => r.id === "gm_symposium"));
});

test("dueByMonths resolves to a real date from the resident's start", () => {
  const out = C.resolve(flat("general-medicine"), { degree: "MD", startDate: "2025-07-01" });
  const rm = out.find((r) => r.id === "rev22_research_methodology_6m");
  assert.equal(rm.dueAt, "2026-01-01");
  const pgmer = out.find((r) => r.id === "pgmer_cert_ethics");
  assert.equal(pgmer.dueAt, "2026-07-01");
});

test("provenance grades all render to a human label", () => {
  VALID_SOURCES.forEach((s) => assert.ok(C.sourceLabel(s).length > 0, s));
  assert.equal(C.sourceLabel("nmc_regulation"), "PGMER-2023");
  assert.equal(C.sourceLabel("institution"), "Institutional policy");
  assert.equal(C.isNmc("nmc_curriculum"), true);
  assert.equal(C.isNmc("institution"), false);
});

/* ── the deterministic requirement mapper ──────────────────────────────────── */

test("a procedure entry maps to its own procedure requirement, top-scored", () => {
  const reqs = C.resolve(flat("emergency-medicine"), { degree: "MD" });
  const e = M.entry({ id: "e", kind: "procedure", occurredAt: "2026-08-20", procedureId: "em_intubation",
    procedureText: "Tracheal intubation", role: "performed_supervised" });
  const out = C.suggestRequirements(e, reqs);
  assert.equal(out[0].id, "em_intubation");
  assert.match(out[0].why, /same procedure/);
});

test("an academic entry maps by activity type, and says WHY", () => {
  const reqs = C.resolve(flat("general-medicine"), { degree: "MD" });
  const e = M.entry({ id: "e", kind: "academic", occurredAt: "2026-08-20", academicType: "journal_club",
    topic: "Critical appraisal of the SMART trial", role: "presented" });
  const out = C.suggestRequirements(e, reqs);
  assert.ok(out.length > 0);
  assert.ok(out.some((r) => r.id === "gm_journal_club"));
  assert.ok(out[0].why, "a suggestion with no explanation is an auto-tag");
});

test("the mapper never suggests a requirement of a different kind", () => {
  const reqs = C.resolve(flat("general-medicine"), { degree: "MD" });
  const e = M.entry({ id: "e", kind: "procedure", occurredAt: "2026-08-20", procedureText: "Journal club" });
  C.suggestRequirements(e, reqs).forEach((r) => {
    const full = reqs.find((x) => x.id === r.id);
    assert.ok(full.kind === "procedure" || full.kind === "meta", "suggested a " + full.kind + " for a procedure entry");
  });
});

test("an unrelated entry produces no suggestion rather than a bad one", () => {
  const reqs = C.resolve(flat("general-medicine"), { degree: "MD" });
  const e = M.entry({ id: "e", kind: "reflection", occurredAt: "2026-08-20", body: "zzz", subtype: "learning_point" });
  assert.equal(C.suggestRequirements(e, reqs).length, 0);
});

test("procedure search finds by wording and by substring", () => {
  const f = flat("emergency-medicine");
  assert.ok(C.searchProcedures(f, "intubation").some((p) => p.id === "em_intubation"));
  assert.ok(C.searchProcedures(f, "lumbar").some((p) => p.id === "em_lumbar_puncture"));
  assert.ok(C.searchProcedures(f, "FAST").some((p) => p.id === "em_fast"));
});

/* ── assessment templates ──────────────────────────────────────────────────── */

test("assessment templates come from NMC proformas, or say they are institutional", () => {
  const t = JSON.parse(readFileSync(join(DIR, "..", "assessment-templates.json"), "utf8"));
  assert.ok(t.templates.length >= 4);
  for (const tpl of t.templates) {
    assert.ok(tpl.id && tpl.label && tpl.criteria.length, tpl.id + ": incomplete template");
    assert.ok(["nmc_curriculum", "institution"].includes(tpl.source), tpl.id + ": bad source");
    assert.ok(tpl.sourceTitle, tpl.id + ": no source title");
    if (tpl.source === "institution") {
      assert.match(tpl.sourceTitle, /INSTITUTIONAL/, tpl.id + ": an institutional template must say so");
    }
  }
});

test("the NMC-sourced templates reproduce the printed mark totals", () => {
  const t = JSON.parse(readFileSync(join(DIR, "..", "assessment-templates.json"), "utf8"));
  const by = Object.fromEntries(t.templates.map((x) => [x.id, x]));
  assert.equal(by.dops.criteria.length * by.dops.scaleMax + by.dops.logbookMax, 50);
  assert.equal(by.wpba_shift.criteria.length * by.wpba_shift.scaleMax + by.wpba_shift.logbookMax, 50);
  assert.equal(by.wpba_clinical.criteria.length * by.wpba_clinical.scaleMax + by.wpba_clinical.logbookMax, 40);
  assert.equal(by.appraisal.criteria.length, 15);
  assert.equal(by.appraisal.requireDiscussed, true);
});

test("the 0-5 scale ships the curriculum's own anchor wording", () => {
  const t = JSON.parse(readFileSync(join(DIR, "..", "assessment-templates.json"), "utf8"));
  const anchors = t.scales.em_0_5.anchors;
  assert.equal(anchors.length, 6);
  assert.match(anchors[0].label, /did not perform/);
  assert.match(anchors[5].label, /Senior resident level/);
});

/* ── index ─────────────────────────────────────────────────────────────────── */

test("the index lists every pack and matches the files on disk", () => {
  const idx = read("index.json");
  assert.equal(idx.packs.length, packFiles.length);
  const onDisk = new Set(packFiles.map((f) => f.replace(/\.json$/, "")));
  idx.packs.forEach((p) => assert.ok(onDisk.has(p.id), "index lists a pack with no file: " + p.id));
});

test("a specialty with no pack falls back to PGMER-only and SAYS it has no specialty pack", () => {
  const g = read("generic-pg.json");
  assert.equal(g.requirements.length, 0);
  assert.match(g.banner, /No NMC specialty curriculum pack is loaded/);
  const f = flat("generic-pg");
  assert.ok(f.requirements.length > 0, "it must still carry the PGMER-2023 requirements");
  assert.ok(f.requirements.every((r) => r.source === "nmc_regulation"));
});

test("common packs are marked so they are never offered as a specialty", () => {
  commonFiles.forEach((f) => {
    const p = read(f);
    assert.ok(p.kindOfPack, f + ": a common pack must declare kindOfPack");
    assert.ok(!read("index.json").packs.some((x) => x.id === p.id), f + ": a common pack is listed as a specialty");
  });
});
