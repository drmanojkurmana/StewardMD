/* test/rx-validity.test.mjs — prescription validity, schedules, and the lifecycle.
 *
 * The rule under test, in one line:
 *     validUntil = MIN(physician expiry, regulatory expiry, issued + system default)
 *
 * MIN is the safety property. A prescriber may always SHORTEN validity and must never be able to
 * lengthen it past what the drug's class allows - "If the doctor selects 90 days, your rules engine
 * should still cap it if the applicable regulatory policy requires a shorter period." Everything
 * here exists to stop that one direction of failure, so most of these tests are about the cap
 * holding rather than about the happy path.
 *
 * These encode a conservative SOFTWARE POLICY, not a claim about what the law requires in any
 * jurisdiction. Where a test names a rule (India Schedule H/H1/X, DEA II-V) it pins the behaviour
 * this app ships, which is deliberately at least as strict as the cited rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const V = require("../rx-validity.js");

const DAY = 86400000;
const T0 = Date.UTC(2026, 7, 30);                 // 30 Aug 2026, a fixed clock
const days = (r) => Math.round((r.validUntil - T0) / DAY);

/* ---------------- classification ---------------- */

test("an explicit schedule is recognised in the forms it actually arrives in", () => {
  for (const s of ["H1", "h1", "Schedule H1", "schedule-h1"]) {
    assert.equal(V.classify({ name: "Alprazolam", schedule: s }).schedule, "H1", `failed for ${s}`);
  }
  assert.equal(V.classify({ name: "X", schedule: "2" }).schedule, "CII", "DEA numerals map to CII-CV");
});

test("habit-forming is taken from the Drug Index flag, and an explicit negative stays negative", () => {
  assert.equal(V.classify({ name: "Paracetamol", habit_forming: "Yes" }).habitForming, true);
  assert.equal(V.classify({ name: "Paracetamol", habit_forming: "No" }).habitForming, false,
    '"No" must not read as truthy just because the field is present');
  assert.equal(V.classify({ name: "Paracetamol", habit_forming: "" }).habitForming, false);
});

test("the common habit-forming molecules are caught even with no flag from the server", () => {
  // Offline, or an API that never returned the field: these must not silently become unverifiable.
  for (const d of ["Alprazolam", "Tramadol", "Morphine", "Pregabalin", "Zolpidem", "Methylphenidate"]) {
    assert.equal(V.classify({ name: d }).habitForming, true, `${d} should be habit-forming`);
  }
});

test("antibiotics are recognised by name or by class", () => {
  assert.equal(V.classify({ name: "Ceftriaxone" }).antibiotic, true);
  assert.equal(V.classify({ name: "Zoledronic Acid", cls: "Bisphosphonate" }).antibiotic, false);
  assert.equal(V.classify({ name: "Some Brand", cls: "Third-generation cephalosporin" }).antibiotic, true);
});

test("classification never fires on an unrelated name that merely contains a fragment", () => {
  // Word boundaries, not substrings: this is how the wrong drug gets flagged.
  assert.equal(V.classify({ name: "Codeinophobia Tablets" }).habitForming, false);
  assert.equal(V.classify({ name: "Paracetamol" }).antibiotic, false);
  assert.equal(V.classify({ name: "Amlodipine" }).habitForming, false);
});

/* ---------------- which prescriptions become verifiable ---------------- */

test("only habit-forming, antibiotic or scheduled prescriptions get an ID", () => {
  assert.equal(V.requiresVerification([{ name: "Amlodipine" }, { name: "Metformin" }]), false,
    "a routine chronic sheet is not in scope");
  assert.equal(V.requiresVerification([{ name: "Amlodipine" }, { name: "Azithromycin" }]), true,
    "one antibiotic on the sheet brings it in scope");
  assert.equal(V.requiresVerification([{ name: "Alprazolam" }]), true);
  assert.equal(V.requiresVerification([{ name: "Something", schedule: "X" }]), true);
  assert.equal(V.requiresVerification([]), false);
});

test("the prescriber is told WHY the prescription is verifiable", () => {
  const r = V.verificationReasons([{ name: "Alprazolam", schedule: "H1" }, { name: "Azithromycin" }]);
  assert.ok(r.some((x) => /H1/.test(x)), "names the schedule");
  assert.ok(r.some((x) => /habit-forming/.test(x)));
  assert.ok(r.some((x) => /antibiotic/.test(x)));
});

/* ---------------- validity: the MIN rule ---------------- */

test("India Schedule H1: 30 days, the worked example from the spec", () => {
  // Issued 30-Aug-2026, default validity 30 days -> valid until 29-Sep-2026.
  const r = V.validity({ issuedAt: T0, country: "IN", drugs: [{ name: "Alprazolam", schedule: "H1" }] });
  assert.equal(days(r), 30);
  assert.equal(r.schedule, "H1");
  assert.equal(r.refillsAllowed, 0);
  assert.equal(new Date(r.validUntil).toISOString().slice(0, 10), "2026-09-29");
});

test("an antibiotic course expires in 30 days even with no category given", () => {
  const r = V.validity({ issuedAt: T0, country: "IN", drugs: [{ name: "Azithromycin" }] });
  assert.equal(days(r), 30);
});

test("category defaults: acute 30, chronic 90, long-term 180, PRN 90", () => {
  const plain = [{ name: "Amlodipine" }];
  assert.equal(days(V.validity({ issuedAt: T0, category: "acute", drugs: plain })), 30);
  assert.equal(days(V.validity({ issuedAt: T0, category: "chronic", drugs: plain })), 90);
  assert.equal(days(V.validity({ issuedAt: T0, category: "chronic_long", drugs: plain })), 180);
  assert.equal(days(V.validity({ issuedAt: T0, category: "prn", drugs: plain })), 90);
});

test("high-risk resolves to the SHORTER end of its 30-90 band", () => {
  assert.equal(days(V.validity({ issuedAt: T0, category: "high_risk", drugs: [{ name: "Amlodipine" }] })), 30);
});

test("THE CAP: a prescriber asking for 90 days on a Schedule H1 drug still gets 30", () => {
  const r = V.validity({
    issuedAt: T0, country: "IN", category: "chronic",
    drugs: [{ name: "Alprazolam", schedule: "H1" }],
    physicianExpiry: T0 + 90 * DAY,
  });
  assert.equal(days(r), 30, "the regulatory cap wins over both the category and the prescriber");
  assert.equal(r.cappedFromPhysician, true, "and the record records that it was capped");
});

test("a prescriber may always SHORTEN validity", () => {
  const r = V.validity({
    issuedAt: T0, country: "IN", category: "chronic",
    drugs: [{ name: "Amlodipine" }], physicianExpiry: T0 + 15 * DAY,
  });
  assert.equal(days(r), 15, "15 days beats the 90-day category default");
  assert.equal(r.cappedFromPhysician, false, "shortening is not a cap, it is the prescriber's choice");
});

test("nothing ever extends a date - every candidate can only pull validUntil earlier", () => {
  const args = { issuedAt: T0, category: "chronic_long", drugs: [{ name: "Amlodipine" }] };
  const base = V.validity(args);
  for (const extra of [
    { physicianExpiry: T0 + 3650 * DAY },
    { drugs: [{ name: "Amlodipine" }, { name: "Alprazolam", schedule: "H1" }] },
    { category: "acute" },
  ]) {
    const r = V.validity(Object.assign({}, args, extra));
    assert.ok(r.validUntil <= base.validUntil, `adding ${JSON.stringify(extra)} extended validity`);
  }
});

test("the STRICTEST drug on a mixed sheet governs the whole prescription", () => {
  const r = V.validity({
    issuedAt: T0, country: "US", category: "chronic_long",
    drugs: [{ name: "Amlodipine" }, { name: "Oxycodone", schedule: "CIII" }, { name: "Alprazolam", schedule: "CII" }],
  });
  assert.equal(r.schedule, "CII", "CII is stricter than CIII and decides the sheet");
  assert.equal(days(r), 30);
  assert.equal(r.refillsAllowed, 0, "Schedule II carries no refills");
});

test("US schedules: II no refills, III/IV up to 5 within 6 months, non-controlled 180", () => {
  const us = (d) => V.validity({ issuedAt: T0, country: "US", drugs: d, category: "chronic_long" });
  assert.equal(us([{ name: "X", schedule: "CII" }]).refillsAllowed, 0);
  assert.equal(us([{ name: "X", schedule: "CIII" }]).refillsAllowed, 5);
  assert.equal(days(us([{ name: "X", schedule: "CIV" }])), 180);
  assert.equal(days(us([{ name: "Amlodipine" }])), 180, "US non-controlled default");
});

test("the basis is recorded, so a validity date can always be explained", () => {
  const r = V.validity({ issuedAt: T0, country: "IN", drugs: [{ name: "Alprazolam", schedule: "H1" }], physicianExpiry: T0 + 90 * DAY });
  assert.ok(Array.isArray(r.basis) && r.basis.length >= 2);
  assert.ok(r.basis.some((b) => /Schedule H1/.test(b)), "the governing rule is named: " + r.basis.join(" | "));
});

/* ---------------- lifecycle ---------------- */

test("ACTIVE -> EXPIRED -> ARCHIVED is derived from the dates, never a stale stored flag", () => {
  const rec = { issuedAt: T0, validUntil: T0 + 30 * DAY };
  assert.equal(V.statusAt(rec, T0 + 1 * DAY), "ACTIVE");
  assert.equal(V.statusAt(rec, T0 + 29 * DAY), "ACTIVE");
  assert.equal(V.statusAt(rec, T0 + 31 * DAY), "EXPIRED");
  assert.equal(V.statusAt(rec, T0 + 800 * DAY), "ARCHIVED", "past the 2-year retention window");
});

test("an explicitly archived or revoked record says so regardless of dates", () => {
  assert.equal(V.statusAt({ issuedAt: T0, validUntil: T0 + 30 * DAY, archivedAt: T0 }, T0), "ARCHIVED");
  assert.equal(V.statusAt({ issuedAt: T0, validUntil: T0 + 30 * DAY, revokedAt: T0 }, T0), "REVOKED",
    "a revoked prescription must never read as merely expired");
});

test("retention outlives validity: 2 years from issue, not from expiry", () => {
  const rec = { issuedAt: T0, validUntil: T0 + 30 * DAY };
  assert.equal(Math.round((V.retentionUntil(rec) - T0) / DAY), 730);
  // Expired, but still inside retention -> the record is kept and readable.
  assert.equal(V.statusAt(rec, T0 + 100 * DAY), "EXPIRED");
});

test("only the RENDERED document may be dropped after expiry, never the record", () => {
  const rec = { issuedAt: T0, validUntil: T0 + 30 * DAY };
  assert.equal(V.mayDropRendered(rec, T0 + 10 * DAY), false, "still valid - keep it");
  assert.equal(V.mayDropRendered(rec, T0 + 31 * DAY), true, "expired - the PDF can be regenerated on demand");
});

/* ---------------- the id ---------------- */

test("the code is opaque, not a counter, and is grouped for reading off paper", () => {
  const a = V.newCode(), b = V.newCode();
  assert.match(a, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/, "XXXX-XXXX-XXXX-XXXX: " + a);
  assert.notEqual(a, b, "two codes must not collide");
  assert.equal(/[ILOU]/.test(a.replace(/-/g, "")), false, "ambiguous glyphs are excluded: " + a);
});

test("a code typed off paper survives the glyphs people confuse", () => {
  // Someone reading a printout types I for 1, O for 0 - the lookup must still find the record.
  const canonical = V.normalizeCode("1234-5678-90AB-CDEF");
  assert.equal(V.normalizeCode("I234 5678 9OAB CDEF"), canonical);
  assert.equal(V.normalizeCode("l234-5678-90ab-cdef"), canonical);
  assert.equal(V.normalizeCode("1234567890ABCDEF"), canonical, "separators are optional");
});

test("newCode uses the supplied randomness (so the server can use real CSPRNG bytes)", () => {
  const fixed = () => new Uint8Array(16).fill(0);
  assert.equal(V.newCode(fixed), "0000-0000-0000-0000", "byte 0 maps to the first alphabet glyph");
});

/* ── Brand names classify by their molecules ────────────────────────────────
 *
 * Nobody writes generics on a prescription. Matching the typed text is what let "Amoxiclav" - which
 * is simply how co-amoxiclav gets written - read as an unknown drug, so the sheet printed with no QR
 * while the app's own brand map already knew augmentin, piptaz and monocef.
 */
test("a brand-name antibiotic classifies as an antibiotic", () => {
  for (const brand of ["Augmentin", "Amoxiclav", "Piptaz", "Zosyn", "Magnex", "Monocef", "Augmentin 625"]) {
    assert.equal(V.classify({ name: brand }).antibiotic, true, `${brand} is an antibiotic`);
    assert.equal(V.requiresVerification([{ name: brand }]), true, `${brand} is worth verifying`);
  }
});

test("resolving brands does not sweep in drugs that are not antibiotics", () => {
  // Ecosprin is aspirin, Crocin is paracetamol: both must stay out, or "antibiotic" means nothing.
  for (const brand of ["Ecosprin", "Crocin", "Paracetamol", "Amlodipine", "Metformin", "Pan"]) {
    assert.equal(V.classify({ name: brand }).antibiotic, false, `${brand} is not an antibiotic`);
  }
});

test("there is exactly ONE brand map, and the old copies are gone", async () => {
  const { readFileSync } = await import("node:fs");
  const at = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

  // Two maps drift, and the copy that drifts is the one that misclassifies a drug.
  assert.ok(!/var BRAND_SEED = \{/.test(at("../medlist.js")), "medlist.js no longer keeps its own copy");
  assert.ok(!/\{"augmentin":\s*\[/.test(at("../app.js")), "app.js no longer inlines a copy");
  assert.match(at("../app.js"), /window\.SMD_BRANDS/, "app.js reads the shared map");
  assert.match(at("../medlist.js"), /brand-generics\.js/, "and so does medlist.js");

  // The map must load before every consumer - all three tags are defer, so document order is
  // execution order, and a map that loads late is a map that is empty when search runs.
  const html = at("../index.html");
  assert.ok(html.indexOf("brand-generics.js") < html.indexOf("/app.js"), "loads before app.js");
  assert.ok(html.indexOf("brand-generics.js") < html.indexOf("/medlist.js"), "and before medlist.js");
});
