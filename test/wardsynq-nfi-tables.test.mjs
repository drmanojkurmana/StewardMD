/* test/wardsynq-nfi-tables.test.mjs - the National Formulary of India renal, pregnancy and lactation tables (owner decision
 * 2026-10-04): built from the NFI, and OFF until the owner signs them off.
 *
 * Pinned:
 *   - every entry carries the edition and its PDF page, and its rule is the quoted source text (never paraphrased): each renal
 *     band's dose IS the cell of the quoted row, each lactation and pregnancy finding quotes the source words it was built from;
 *   - a sample of entries matches the source text as transcribed from the PDF (and, when NFI_PAGES_JSON points at the PDF's
 *     extracted pages, every entry is checked against it);
 *   - the engine reads a table's own eGFR columns (>50, 10-50 inclusive, <10) and never fires at an eGFR of 90 or more;
 *   - before sign-off no NFI rule fires, and the order check says "NFI table loaded, awaiting clinical sign-off";
 *   - after sign-off of a table's CURRENT fingerprint its rules fire; a record for any other content (an edited table) does not
 *     turn it on; each table is signed on its own; unreadable sign-off records apply nothing and say so;
 *   - all of it through the real /ward/medication-order route.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-nfi-tables.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
const { as, seedHospital, admittedPatient, ORG, DOCTOR, H, docs } = await import("./_wardsynq-alert-harness.mjs");
const { NFI_SOURCE, NFI_RENAL, NFI_LACTATION, NFI_PREGNANCY } = await import("../wardsynq/adapters/nfi-tables.js");
const { nfiTableContent, withNfiTables, nfiRenalAdjustments } = await import("../wardsynq/adapters/nfi-rules.js");
const { SafetyEngine, compileRulePack, SEVERITY_ORDER } = await import("../wardsynq/wardsynq-safety.js");
const { getRulePack } = await import("../functions/_wardsynq/rulepack.js");
const { orderEntryRulePack, resetOrderEntryRulePack } = await import("../functions/_wardsynq/order-entry-pack.js");
const S = await import("../functions/_wardsynq/seed-signoff.js");
const { orderEntrySafety } = await import("../functions/_wardsynq/migrate-emar.js");

const byId = (arr, id) => { const e = arr.find((x) => x.id === id); assert.ok(e, "entry " + id); return e; };
const COL = { "GFR >50 ml/min": "gfrAbove50", "GFR 10-50 ml/min": "gfr10to50", "GFR <10 ml/min": "gfrBelow10" };
const ALL = [...NFI_RENAL, ...NFI_LACTATION, ...NFI_PREGNANCY];

/* A sign-off record exactly as /seed/signoff stores it (q_seed_signoffs, _seed_signoff_store.js). */
async function signoffRecord(table, content) {
  const hash = await S.fingerprint(content || nfiTableContent(table));
  const id = S.signoffId(S.NFI_LIST, table, hash);
  return { id, listId: S.NFI_LIST, itemId: table, contentHash: hash, version: NFI_SOURCE.id + "#" + hash.slice(0, 12), signedBy: S.SIGNATORY, signedAt: "2026-10-04T00:00:00Z", text: "Signed off by " + S.SIGNATORY };
}
const packFor = async (records) => { resetOrderEntryRulePack(); return orderEntryRulePack({}, { listSignoffs: async () => records }); };

/* ------------------------------------------------------------------ the tables */

test("data: every entry names the edition and a PDF page, and every rule is built from the quoted source words", () => {
  assert.equal(NFI_SOURCE.url, "https://ipc.gov.in/images/Draft_Version_NFI_6th_edition.pdf");
  assert.match(NFI_SOURCE.title, /National Formulary of India, 6th Edition 2019-20 \(Draft Version\)/);
  assert.match(NFI_SOURCE.sha256, /^[0-9a-f]{64}$/);
  assert.equal(NFI_RENAL.length, 39);
  assert.equal(NFI_LACTATION.length, 138);
  assert.ok(NFI_PREGNANCY.length > 300, "pregnancy entries from the monographs");
  const pack = getRulePack();
  for (const e of ALL) {
    assert.ok(Number.isInteger(e.page) && e.page >= 37 && e.page <= 877, e.id + " page " + e.page);
    assert.ok(e.quote && typeof e.quote === "string", e.id + " quote");
    for (const g of e.generics) assert.ok(pack.genericIndex.has(g), `${e.id}: ${g} is a rule-pack generic`);
    if (e.rule) assert.ok(e.generics.length, e.id + " has generics to fire on");
  }
  for (const e of NFI_RENAL) {
    const cells = e.quote.split(" | ");
    assert.equal(cells[0], e.drug);
    assert.deepEqual(cells.slice(1), [e.cells.method, e.cells.gfrAbove50, e.cells.gfr10to50, e.cells.gfrBelow10, e.cells.capd, e.cells.hd], e.id);
    if (!e.rule) continue;
    assert.ok(e.rule.source.endsWith("Appendix 10d, p. " + e.page), e.rule.source);
    for (const b of e.rule.gfrBands) {
      assert.equal(b.dose, e.cells[COL[b.band]], `${e.id} ${b.band} is the source cell`);
      if (b.capd !== undefined) { assert.equal(b.capd, e.cells.capd); assert.equal(b.hd, e.cells.hd); }
    }
  }
  for (const e of NFI_LACTATION) {
    const [drug, comment] = e.quote.split(" || ")[0].split(" | ");
    assert.equal(drug, e.drug);
    const text = e.quote.includes(" || ") ? e.quote.split(" || ")[1].split(" | ")[1] : comment;
    if (e.basis && !e.basis.startsWith("(")) assert.ok(text.includes(e.basis), `${e.id}: the level's basis "${e.basis}" is in the text`);
    if (e.rule) {
      assert.ok(SEVERITY_ORDER.includes(e.rule.level));
      assert.ok(e.rule.text.includes(`"${text}"`), `${e.id}: the finding quotes the source`);
      assert.ok(e.rule.text.includes("Appendix 10b, p" ), e.rule.text);
    }
  }
  for (const e of NFI_PREGNANCY) {
    for (const c of e.clause.split("; ")) assert.ok(e.quote.includes(c), `${e.id}: "${c}" is in the quoted ${e.field}`);
    assert.match(e.clause, /pregnan/i);
    assert.equal(e.rule.level, e.field === "Contraindications" ? "contraindicated" : "monitor", e.id);
    assert.ok(e.rule.text.includes(`${e.field}: "${e.clause}"`), e.id);
    assert.ok(e.rule.text.includes(e.pageEnd !== e.page ? `pp. ${e.page}-${e.pageEnd}` : `p. ${e.page}`), e.id);
  }
});

test("data: a sample of entries matches the source text as printed in the NFI", () => {
  // Transcribed from the PDF (Draft_Version_NFI_6th_edition.pdf) by hand, page by page (its en dashes written as hyphens).
  assert.equal(byId(NFI_RENAL, "renal/metformin").quote, "Metformin | D | 50% | Avoid | Avoid | Avoid | Avoid");
  assert.equal(byId(NFI_RENAL, "renal/metformin").page, 877);
  assert.equal(byId(NFI_RENAL, "renal/allopurinol").quote, "Allopurinol | D | 75% | 50% | 33% | Dose as GFR < 10 | Dose as GFR < 10");
  assert.equal(byId(NFI_RENAL, "renal/allopurinol").page, 874);
  assert.equal(byId(NFI_RENAL, "renal/gentamicin").quote, "Gentamicin | D, I | 60-90% q8-12h | 30-70% q12h | 20-30% q24-72h | 3-4 mg/L/day | Dose as GFR < 10 dose post HD");
  assert.equal(byId(NFI_RENAL, "renal/vancomycin").quote, "Vancomycin | D, I | 500 mg q6-12h | 500 mg q12-48h | 500 mg q48-96h | Dose as GFR < 10 | Dose as GFR < 10");
  assert.equal(byId(NFI_LACTATION, "lactation/lithium").quote, "Lithium | Present in milk and risk of toxicity in infant; continue lactation; monitor infant carefully, particularly if risk of dehydration");
  assert.equal(byId(NFI_LACTATION, "lactation/lithium").page, 865);
  assert.equal(byId(NFI_LACTATION, "lactation/methotrexate").quote, "Methotrexate | Lactation contraindicated");
  assert.equal(byId(NFI_LACTATION, "lactation/methotrexate").rule.level, "contraindicated");
  assert.equal(byId(NFI_LACTATION, "lactation/amoxycillin").rule, null, "NFI: safe in usual dosage, so nothing fires");
  const gem = NFI_PREGNANCY.find((e) => e.drug === "Gemcitabine");
  assert.equal(gem.field, "Contraindications");
  assert.equal(gem.quote, "Pregnancy (Appendix 10c); concurrent radial radiotherapy; hypersensitivity; lactation.");
  const tram = NFI_PREGNANCY.find((e) => e.drug === "Tramadol");
  assert.equal(tram.field, "Precautions", "the draft lists pregnancy under Tramadol's Precautions, not its Contraindications");
  assert.equal(tram.rule.level, "monitor");
});

/* Optional deep check against the PDF's own text layer (not in the repo): NFI_PAGES_JSON = a JSON array of page texts. */
test("data: every entry against the PDF text layer, when the extracted pages are supplied", { skip: !process.env.NFI_PAGES_JSON || !existsSync(process.env.NFI_PAGES_JSON) }, () => {
  const pages = JSON.parse(readFileSync(process.env.NFI_PAGES_JSON, "utf8"));
  const ns = (s) => String(s).replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, "");
  const around = (p, n) => pages.slice(p - 1, p - 1 + n).map(ns).join("");
  for (const e of NFI_PREGNANCY) for (const c of e.clause.split("; ")) assert.ok(around(e.page, e.pageEnd - e.page + 1).includes(ns(c)), e.id);
  const lact = around(861, 10);
  for (const e of NFI_LACTATION) if (!/^(Benzathine|Phenoxy|Pentavalent)/.test(e.drug)) assert.ok(lact.includes(ns(e.quote.split(" || ")[0].split(" | ")[1])), e.id);
  const ren = [874, 875, 877].map((p) => ns(pages[p - 1])).join("");
  for (const e of NFI_RENAL) for (const t of e.quote.split(" | ").slice(1).join(" ").split(" ")) if (t && !/mg\/L\/day|2-3\/week|^Cyclophosphamide$|^Metoclopramide$/.test(t)) assert.ok(ren.includes(ns(t)), e.id + " " + t);
});

/* ------------------------------------------------------------------ the engine */

test("engine: a table's own eGFR columns: >50, 10-50 inclusive, <10; nothing at 90 or more; CAPD and HD shown with <10", () => {
  const pack = compileRulePack({ generics: ["allopurinol"], renalAdjustments: { allopurinol: byId(NFI_RENAL, "renal/allopurinol").rule } });
  const at = (egfr) => new SafetyEngine({ rulePack: pack, checks: ["renal"] }).evaluate({ order: { drug: "Allopurinol 100 mg" }, egfr }).findings;
  assert.deepEqual(at(95), [], "normal renal function raises nothing");
  assert.match(at(70)[0].message, /GFR >50 ml\/min column of the renal table: Allopurinol 100 mg 75%/);
  assert.match(at(50)[0].message, /GFR 10-50 ml\/min column.*50%/);
  assert.match(at(10)[0].message, /GFR 10-50 ml\/min column/);
  const low = at(9.9)[0];
  assert.match(low.message, /GFR <10 ml\/min column.*33%.*On CAPD: Dose as GFR < 10\. On haemodialysis: Dose as GFR < 10\./);
  assert.match(low.message, /Source: NFI 6th ed\. draft 2019-20, Appendix 10d, p\. 874\./);
  assert.equal(low.disposition, "overridable");
  // A cell that is the usual dose raises nothing: vancomycin at eGFR 70 is its normal interval.
  const v = compileRulePack({ generics: ["vancomycin"], renalAdjustments: nfiRenalAdjustments() });
  assert.deepEqual(new SafetyEngine({ rulePack: v, checks: ["renal"] }).evaluate({ order: { drug: "Vancomycin" }, egfr: 70 }).findings, []);
});

/* ------------------------------------------------------------------ sign-off gating */

test("sign-off: the three tables are listed for sign-off, unapproved; editing a table changes its fingerprint", async () => {
  const lists = await S.seedStatus([]);
  const l = lists.find((x) => x.id === S.NFI_LIST);
  assert.deepEqual(l.items.map((i) => [i.id, i.status]), [["renal", "unapproved"], ["pregnancy", "unapproved"], ["lactation", "unapproved"]]);
  assert.match(l.source, /Draft_Version_NFI_6th_edition\.pdf/);
  const content = nfiTableContent("renal");
  const edited = JSON.parse(JSON.stringify(content));
  edited.entries.find((e) => e.id === "renal/metformin").rule.gfrBands[1].dose = "50%";
  assert.notEqual(await S.fingerprint(edited), await S.fingerprint(content));
  assert.deepEqual(await S.nfiSignoffState([]), { renal: "awaiting-signoff", pregnancy: "awaiting-signoff", lactation: "awaiting-signoff" });
  assert.deepEqual(await S.nfiSignoffState(null), { renal: "signoffs-unreadable", pregnancy: "signoffs-unreadable", lactation: "signoffs-unreadable" });
  assert.equal((await S.nfiSignoffState([await signoffRecord("renal")])).renal, "signed");
  assert.equal((await S.nfiSignoffState([await signoffRecord("renal", edited)])).renal, "awaiting-signoff", "a sign-off of other content is not this table's");
});

test("gating: before sign-off no NFI rule fires; after sign-off of the current content it does; each table on its own", async () => {
  const order = (drug) => ({ drug });
  const run = (pack, drug, extra) => new SafetyEngine({ rulePack: pack, checks: ["renal", "pregnancy"] }).evaluate({ order: order(drug), ...(extra || {}) });

  const unsigned = await packFor([]);
  assert.equal(unsigned.renalAdjustments.size, 0);
  assert.equal(unsigned.pregnancyLactation.size, 0);
  assert.equal(unsigned.clinicalTables.renal.state, "awaiting-signoff");
  assert.deepEqual(run(unsigned, "Metformin 500 mg", { egfr: 30 }).findings, []);
  assert.deepEqual(run(unsigned, "Methotrexate 10 mg", { pregnancyStatus: { pregnant: false, lactating: true } }).findings, []);

  const renalOnly = await packFor([await signoffRecord("renal")]);
  const f = run(renalOnly, "Metformin 500 mg", { egfr: 30 }).findings;
  assert.equal(f.length, 1);
  assert.equal(f[0].code, "RENAL_ADJUSTMENT_RECOMMENDED");
  assert.match(f[0].message, /GFR 10-50 ml\/min column of the renal table: Metformin 500 mg Avoid/);
  assert.match(renalOnly.version, /\+nfi-renal$/);
  assert.deepEqual(run(renalOnly, "Methotrexate 10 mg", { pregnancyStatus: { pregnant: false, lactating: true } }).findings, [], "lactation is still unsigned");

  const all = await packFor(await Promise.all(["renal", "pregnancy", "lactation"].map((t) => signoffRecord(t))));
  const lact = run(all, "Methotrexate 10 mg", { pregnancyStatus: { pregnant: false, lactating: true } }).findings;
  assert.deepEqual(lact.map((x) => [x.code, x.severity, x.disposition]), [["LACTATION_RISK", "contraindicated", "overridable"]]);
  assert.match(lact[0].message, /NFI 6th ed\. draft 2019-20, Appendix 10b, p\. 866: "Lactation contraindicated"/);
  const preg = run(all, "Gemcitabine 1 g", { pregnancyStatus: { pregnant: true, lactating: false } }).findings;
  assert.equal(preg[0].code, "PREGNANCY_RISK");
  assert.equal(preg[0].severity, "contraindicated");
  assert.match(preg[0].message, /Gemcitabine monograph, p\. 235, Contraindications: "Pregnancy \(Appendix 10c\)"/);
  // NFI says amoxycillin is safe in usual dosage: nothing fires, and the drug counts as covered.
  assert.deepEqual(run(all, "Amoxycillin 500 mg", { pregnancyStatus: { pregnant: false, lactating: true } }).findings.filter((x) => x.code === "LACTATION_RISK"), []);
  assert.ok(all.clinicalTables.lactation.covered.has("amoxycillin"));

  // An edited table: the record held is for the old content, so the table is off again.
  const edited = JSON.parse(JSON.stringify(nfiTableContent("renal")));
  edited.entries[0].quote += " ";
  const stale = await packFor([await signoffRecord("renal", edited)]);
  assert.equal(stale.clinicalTables.renal.state, "awaiting-signoff");
  assert.deepEqual(run(stale, "Metformin 500 mg", { egfr: 30 }).findings, []);

  // Records that cannot be read: nothing applied.
  resetOrderEntryRulePack();
  const unreadable = await orderEntryRulePack({}, { listSignoffs: async () => { throw new Error("firestore down"); } });
  assert.equal(unreadable.clinicalTables.renal.state, "signoffs-unreadable");
  assert.equal(unreadable.renalAdjustments.size, 0);
  resetOrderEntryRulePack();
});

test("coverage: unsigned says 'NFI table loaded, awaiting clinical sign-off'; signed but no entry for the drug says so; unreadable says so", async () => {
  const female = { pregnant: true, lactating: null };
  const cov = async (pack, drug, status) => {
    const { coverageFindings } = await import("../functions/_wardsynq/migrate-emar.js");
    const { resolveComponents } = await import("../wardsynq/wardsynq-safety.js");
    return coverageFindings({ drug }, { egfr: { value: 28, unit: "mL/min/1.73m2", at: "2026-10-04T00:00:00Z", ageDays: 0, stale: false }, creatinine: null },
      pack.renalAdjustments.size, pack.pregnancyLactation.size, status, pack.clinicalTables, resolveComponents(drug, pack));
  };
  const unsigned = await packFor([]);
  const c1 = await cov(unsigned, "Metformin 500 mg", female);
  const r1 = c1.find((x) => x.code === "RENAL_CHECK_NOT_AVAILABLE");
  assert.equal(r1.message, "Renal dose check not available: NFI table loaded, awaiting clinical sign-off. Metformin 500 mg was not checked for renal dosing. Latest recorded: eGFR 28 mL/min/1.73m2 on 2026-10-04.");
  assert.equal(r1.disposition, "warn");
  const p1 = c1.find((x) => x.code === "PREGNANCY_LACTATION_CHECK_NOT_AVAILABLE");
  assert.match(p1.message, /^Pregnancy and lactation check not available: NFI table loaded, awaiting clinical sign-off\. Metformin 500 mg was not checked for use in pregnancy or breastfeeding\. The patient is recorded as pregnant\.$/);
  // Recorded not breastfeeding: only pregnancy is spoken about.
  const c1b = await cov(unsigned, "Metformin 500 mg", { pregnant: null, lactating: false });
  assert.match(c1b.find((x) => x.code === "PREGNANCY_LACTATION_CHECK_NOT_AVAILABLE").message, /^Pregnancy check not available: .* for use in pregnancy\.$/);
  // Recorded neither: nothing about pregnancy.
  assert.ok(!(await cov(unsigned, "Metformin 500 mg", { pregnant: false, lactating: false })).some((x) => /PREGNANCY/.test(x.code)));

  const signed = await packFor(await Promise.all(["renal", "pregnancy", "lactation"].map((t) => signoffRecord(t))));
  const c2 = await cov(signed, "Metformin 500 mg", female);
  assert.ok(!c2.some((x) => x.code === "RENAL_CHECK_NOT_AVAILABLE" || x.code === "RENAL_CHECK_NOT_COVERED"), JSON.stringify(c2));
  const c3 = await cov(signed, "Atorvastatin 40 mg", female);
  assert.equal(c3.find((x) => x.code === "RENAL_CHECK_NOT_COVERED").message, "Renal dose check: Atorvastatin 40 mg is not in the NFI renal table, so it was not checked for renal dosing. Latest recorded: eGFR 28 mL/min/1.73m2 on 2026-10-04.");

  resetOrderEntryRulePack();
  const unreadable = await orderEntryRulePack({}, { listSignoffs: async () => { throw new Error("down"); } });
  assert.match((await cov(unreadable, "Metformin 500 mg", female)).find((x) => x.code === "RENAL_CHECK_NOT_AVAILABLE").message,
    /NFI table loaded, but its clinical sign-off could not be read, so it was not applied\./);
  resetOrderEntryRulePack();
});

/* ------------------------------------------------------------------ through the route */

test("route: /ward/medication-order says the NFI table awaits sign-off; once the owner's sign-off is stored, the renal rule fires", async () => {
  seedHospital({});
  resetOrderEntryRulePack();
  const p = await admittedPatient();
  const at = new Date(Date.now() - 3600e3).toISOString();
  const meta = { recordedAt: at, effectiveAt: at, amendedAt: null, source: { system: "wardsynq-native", sourceId: null, importedAt: at }, derivedFrom: [] };
  await H.RECORD.append("tenant-wsq", [{ resourceType: "Observation", id: "obs-egfr-nfi", version: 1, patientId: p.patientId, encounterId: p.encounterId, code: "98979-8", codeSystem: "LOINC", category: "laboratory", value: 28, unit: "mL/min/1.73m2", meta }]);
  const check = () => as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, checkOnly: true,
    order: { patientId: p.patientId, encounterId: p.encounterId, drug: "Metformin", dose: { value: 500, unit: "mg" }, route: "PO", frequency: "OD" } });

  const before = await check();
  assert.equal(before.__status, 200, JSON.stringify(before));
  assert.ok(!before.safety.findings.some((f) => f.code === "RENAL_ADJUSTMENT_RECOMMENDED"), "no NFI rule before sign-off");
  const nc = before.safety.coverage.find((f) => f.code === "RENAL_CHECK_NOT_AVAILABLE");
  assert.match(nc.message, /NFI table loaded, awaiting clinical sign-off/);
  assert.deepEqual(before.safety.clinicalTables, { source: "NFI 6th ed. draft 2019-20", renal: "awaiting-signoff", pregnancy: "awaiting-signoff", lactation: "awaiting-signoff" });
  assert.equal(before.safety.renal.tableLoaded, 0);

  // The owner's sign-off of the renal table, stored exactly as /seed/signoff stores it.
  const rec = await signoffRecord("renal");
  const { id, ...fields } = rec;
  docs.set("q_seed_signoffs/" + id, { fields, updateTime: "t1" });
  resetOrderEntryRulePack(); // the one-minute read cache, which a test cannot wait out

  const after = await check();
  assert.equal(after.__status, 200, JSON.stringify(after));
  const f = after.safety.overridables.find((x) => x.code === "RENAL_ADJUSTMENT_RECOMMENDED");
  assert.ok(f, JSON.stringify(after.safety));
  assert.match(f.message, /eGFR 28 is in the GFR 10-50 ml\/min column of the renal table: Metformin Avoid.*Appendix 10d, p\. 877/);
  assert.equal(after.safety.clinicalTables.renal, "signed");
  assert.ok(!after.safety.coverage.some((x) => /^RENAL_CHECK_NOT/.test(x.code)), JSON.stringify(after.safety.coverage));
  assert.ok(after.safety.renal.tableLoaded > 30);
  resetOrderEntryRulePack();
});

test("order entry: orderEntrySafety with an unsigned pack fires nothing from the NFI and lists the gap", async () => {
  const pack = await packFor([]);
  const svc = { byPatient: async () => [], get: async () => null, repository: null, tenantId: "t" };
  const v = await orderEntrySafety(svc, pack, { id: "o1", patientId: "p1", encounterId: "e1", drug: "Metformin 500 mg" }, []);
  assert.equal(v.checked, true, JSON.stringify(v));
  assert.ok(v.coverage.some((f) => f.code === "RENAL_CHECK_NOT_AVAILABLE" && /awaiting clinical sign-off/.test(f.message)));
  assert.equal(v.clinicalTables.renal, "awaiting-signoff");
  resetOrderEntryRulePack();
});

test("withNfiTables leaves the base pack untouched", async () => {
  const base = getRulePack();
  const before = base.renalAdjustments.size;
  withNfiTables(base, { renal: "signed", pregnancy: "signed", lactation: "signed" });
  assert.equal(base.renalAdjustments.size, before);
  assert.ok(!base.clinicalTables);
});
