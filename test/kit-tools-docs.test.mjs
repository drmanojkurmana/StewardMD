// Wave 1 of the "every branch" plan: the new kit tools (local anaesthetic dose, Lund and Browder burns,
// KDIGO CKD grid, 28-joint count, MCCD check, WHO Labour Care Guide alerts, WHO growth chart), the kit
// picker / order sets / notifiable reminder / profile mapping, clinical documents, the review desk and its
// apply script, and the guideline source watch.
//
// Oracles are the published numbers, worked by hand here, never the engine's own output:
//   - Williams and Walker, Anaesthesia 2014 (Table 1): mg/kg by drug, ceilings, 70 kg dosing cap;
//   - CKD-EPI 2021 (Inker, NEJM 2021) worked for two patients; KDIGO 2012 G/A bands and heat map;
//   - DAS28 (Prevoo 1995) worked example; CDAI/SDAI cut-offs (Aletaha 2005);
//   - WHO Labour Care Guide 2020 alert thresholds; WHO wfa boys median at birth 3.3464 kg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const K = require("../specialty-kits.js");
const DOCS = require("../clinical-docs.js");
const REV = require("../review-desk.js");
const BUNDLE = JSON.parse(readFileSync(join(ROOT, "kb/specialty-kits/kits.json"), "utf8"));
const W = JSON.parse(readFileSync(join(ROOT, "kb/growth/who-growth.json"), "utf8"));
K._setBundle(BUNDLE); K._setGrowth(W);
const AR = await import("../scripts/apply-reviews.mjs");
const SW = await import("../scripts/check-guideline-updates.mjs");
const BD = await import("../scripts/build-documents.mjs");
const BK = await import("../scripts/build-specialty-kits.mjs");

/* ================================ local anaesthetic ================================ */
test("LA maximum dose: mg/kg, the mg ceiling, and nobody counted above 70 kg", () => {
  const la = (drug, weight, adr, strength) => K._laCalc({ drug, weight: String(weight), adr, strength });
  let r = la("Lidocaine (lignocaine)", 50, "Plain", "1%");
  assert.equal(r.mg, 150); assert.equal(r.ml, 15); assert.equal(r.capped, false);
  r = la("Lidocaine (lignocaine)", 80, "Plain", "2%");               // 70 x 3 = 210, ceiling 200
  assert.equal(r.w, 70); assert.equal(r.wCapped, true); assert.equal(r.mg, 200); assert.equal(r.capped, true); assert.equal(r.ml, 10);
  r = la("Lidocaine (lignocaine)", 120, "With adrenaline", "1%");     // 70 x 7 = 490, under the 500 mg ceiling
  assert.equal(r.mg, 490); assert.equal(r.ml, 49); assert.equal(r.capped, false);
  r = la("Lidocaine (lignocaine)", 69, "With adrenaline", "2%");      // 69 x 7 = 483
  assert.equal(r.mg, 483);
  r = la("Bupivacaine", 60, "Plain", "0.5%");
  assert.equal(r.mg, 120); assert.equal(r.ml, 24);
  r = la("Ropivacaine", 40, "With adrenaline", "0.75%");            // 3 mg/kg with or without adrenaline
  assert.equal(r.mg, 120); assert.equal(r.ml, 16);
  assert.equal(la("Bupivacaine", 60, "Plain", "2%").pct, null, "a strength the drug does not come in gives no volume");
  assert.equal(la("Bupivacaine", 0, "Plain", "0.5%"), null);
  const d = BUNDLE.data["la-doses"];
  d.drugs.forEach((x) => { assert.ok(x.plain.mgPerKg > 0); assert.ok(x.strengths.length); });
  assert.ok(K._tools["la-dose"].text({ drug: "Lidocaine (lignocaine)", weight: "90", adr: "Plain", strength: "1%" }).includes("capped at 70"));
});

/* ================================ burns ================================ */
test("Lund and Browder: every age column sums to 100 and the whole body is 100% at every age", () => {
  const d = BUNDLE.data["lund-browder"];
  d.ages.forEach((_, i) => assert.equal(Math.round(d.regions.reduce((s, r) => s + r.percent[i], 0) * 10) / 10, 100));
  ["Under 1 year", "Age 1 year", "Age 5 years", "Age 10 years", "Age 15 years", "Adult"].forEach((age) => {
    const t = { age, weight: "20" }; d.regions.forEach((r) => { t["r_" + r.id] = "All"; });
    const r = K._burnsCalc(t);
    assert.equal(r.tbsa, 100, age); assert.equal(r.parkland, 8000); assert.equal(r.first8, 4000);
  });
  const t = { age: "Adult", weight: "70" }; t["r_" + d.regions[0].id] = "1/2";
  assert.equal(K._burnsCalc(t).tbsa, Math.round(d.regions[0].percent[5] * 0.5 * 10) / 10);
});

/* ================================ CKD ================================ */
test("CKD-EPI 2021 (race-free) against hand-worked values", () => {
  assert.equal(Math.round(K._ckdEpi2021(1.0, 50, true) * 10) / 10, 68.6);    // 142 x 1.4286^-1.2 x 0.9938^50 x 1.012
  assert.equal(Math.round(K._ckdEpi2021(1.2, 60, false) * 10) / 10, 69.2);   // 142 x 1.3333^-1.2 x 0.9938^60
  assert.equal(Math.round(K._ckdEpi2021(0.5, 30, true) * 10) / 10, 129.3);   // below kappa: 142 x 0.7143^-0.241 x 0.9938^30 x 1.012
  const r = K._ckdCalc({ scr: "1.2", age: "60", sex: "Male" });
  assert.equal(r.egfr, 69); assert.equal(r.computed, true); assert.equal(r.g, "G2");
  assert.equal(K._ckdCalc({ scr: "1.2", age: "15", sex: "Male" }), null, "adult equation only");
});

test("KDIGO G and A bands at every edge, and the heat-map risk", () => {
  const g = (e) => K._ckdCalc({ egfr: String(e) }).g;
  [[90, "G1"], [89, "G2"], [60, "G2"], [59, "G3a"], [45, "G3a"], [44, "G3b"], [30, "G3b"], [29, "G4"], [15, "G4"], [14, "G5"]].forEach(([e, want]) => assert.equal(g(e), want, "eGFR " + e));
  const a = (acr, unit) => K._ckdCalc({ egfr: "70", acr: String(acr), acrUnit: unit }).a;
  assert.equal(a(29, "mg/g"), "A1"); assert.equal(a(30, "mg/g"), "A2"); assert.equal(a(300, "mg/g"), "A2"); assert.equal(a(301, "mg/g"), "A3");
  assert.equal(a(2.9, "mg/mmol"), "A1"); assert.equal(a(3, "mg/mmol"), "A2"); assert.equal(a(31, "mg/mmol"), "A3");
  const risk = (e, acr) => K._ckdCalc({ egfr: String(e), acr: String(acr), acrUnit: "mg/g" }).risk;
  assert.equal(risk(95, 10), 0); assert.equal(risk(95, 100), 1); assert.equal(risk(95, 400), 2);
  assert.equal(risk(50, 10), 1); assert.equal(risk(35, 10), 2); assert.equal(risk(20, 10), 3); assert.equal(risk(50, 400), 3);
  assert.equal(K._ckdCalc({ egfr: "50" }).risk, null, "no albuminuria, no risk colour");
});

/* ================================ joints ================================ */
test("28-joint count: DAS28-ESR worked example, CDAI/SDAI, and the activity bands at their edges", () => {
  const j = { "R:wrist": "T", "L:wrist": "TS", "R:mcp2": "TS", "L:knee": "TS", "R:shoulder": "S" };
  const r = K._jointCalc({ j, esr: "30", crp: "12", ptga: "50", evga: "4" });
  assert.equal(r.tjc, 4); assert.equal(r.sjc, 4);
  // 0.56 x sqrt4 + 0.28 x sqrt4 + 0.70 x ln30 + 0.014 x 50 = 1.12 + 0.56 + 2.3808 + 0.7
  assert.equal(r.das28esr, 4.76);
  assert.equal(r.das28crp, Math.round((0.56 * 2 + 0.28 * 2 + 0.36 * Math.log(13) + 0.7 + 0.96) * 100) / 100);
  assert.equal(r.cdai, 4 + 4 + 5 + 4); assert.equal(r.sdai, 4 + 4 + 5 + 4 + 1.2);
  const { das, cdai, sdai } = K._BANDS;
  assert.equal(K._activity(2.59, das), "Remission"); assert.equal(K._activity(2.6, das), "Low activity");
  assert.equal(K._activity(3.2, das), "Low activity"); assert.equal(K._activity(3.21, das), "Moderate activity");
  assert.equal(K._activity(5.1, das), "Moderate activity"); assert.equal(K._activity(5.11, das), "High activity");
  assert.equal(K._activity(2.8, cdai), "Remission"); assert.equal(K._activity(10, cdai), "Low activity"); assert.equal(K._activity(22.1, cdai), "High activity");
  assert.equal(K._activity(3.3, sdai), "Remission"); assert.equal(K._activity(26, sdai), "Moderate activity"); assert.equal(K._activity(26.1, sdai), "High activity");
  assert.equal(K._jointCalc({ j: {} }).das28esr, null);
});

/* ================================ body chart ================================ */
test("injury body chart: unique region ids, both views, left and right on the right sides", () => {
  const ids = K._BODY.map((b) => b[0]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(K._BODY.filter((b) => b[2] === "f").length, K._BODY.filter((b) => b[2] === "b").length);
  const x = (id) => K._BODY.find((b) => b[0] === id)[3][1];
  assert.ok(x("f-chest-r") < x("f-chest-l"), "front view: patient's right on the viewer's left");
  assert.ok(x("b-back-r") > x("b-back-l"), "back view: patient's right on the viewer's right");
});

/* ================================ MCCD ================================ */
test("MCCD check: order of Part I, intervals, and a mode of dying as the underlying cause", () => {
  let r = K._mccdCheck({ c0: "Cardiac arrest", i0: "minutes" });
  assert.ok(r.warnings.some((w) => /mode of dying/.test(w)));
  r = K._mccdCheck({ c0: "Septic shock", i0: "2 days", c1: "Lobar pneumonia", i1: "6 days", c2: "Chronic obstructive pulmonary disease", i2: "10 years" });
  assert.deepEqual(r.warnings, []); assert.equal(r.underlying, "Chronic obstructive pulmonary disease");
  r = K._mccdCheck({ c0: "Septic shock", i0: "2 days", c2: "Pneumonia", i2: "6 days" });
  assert.ok(r.warnings.some((w) => /without gaps/.test(w)));
  r = K._mccdCheck({ c0: "Pneumonia" });
  assert.ok(r.warnings.some((w) => /interval/.test(w)));
  r = K._mccdCheck({ c0: "Acute myocardial infarction with cardiac arrest", i0: "1 hour" });
  assert.deepEqual(r.warnings, [], "a named disease that mentions arrest is not flagged");
  r = K._mccdCheck({ c0: "Cardiorespiratory arrest", i0: "minutes", c1: "Acute myocardial infarction", i1: "2 hours", c2: "Type 2 diabetes mellitus", i2: "12 years" });
  assert.ok(r.warnings.some((w) => /^Line \(a\) \(Cardiorespiratory arrest\) is a mode of dying/.test(w)), "an arrest on line (a) is flagged too");
  r = K._mccdCheck({ c0: "Heart failure", i0: "2 days", c1: "Ischaemic cardiomyopathy", i1: "5 years" });
  assert.deepEqual(r.warnings, [], "heart failure due to a named disease on an upper line is allowed");
});

/* The source data (not the built kits.json), so these hold before the bundle is rebuilt. Oracles:
 * levobupivacaine 2 mg/kg (BJA Educ 2020 Table 1), 150 mg single dose (UK SmPC); bupivacaine with adrenaline
 * 150 mg single dose (UK SmPC); AAGBI 2010 lipid regimen; IDSP P form case definitions 2024. */
test("LA doses, MCCD vague terms and notifiable conditions read from the source data", () => {
  const { kits, data } = BK.loadAll();
  K._setBundle(BK.buildBundle(kits, data));
  try {
    const la = (drug, weight, adr, strength) => K._laCalc({ drug, weight: String(weight), adr, strength });
    let r = la("Levobupivacaine", 60, "Plain", "0.5%");
    assert.equal(r.mg, 120); assert.equal(r.ml, 24);
    r = la("Levobupivacaine", 90, "With adrenaline", "0.25%");            // no premix with adrenaline: plain, 70 kg
    assert.equal(r.withA, false); assert.equal(r.mg, 140); assert.equal(r.ml, 56);
    r = la("Bupivacaine", 70, "With adrenaline", "0.5%");                 // 2.5 x 70 = 175, SmPC ceiling 150
    assert.equal(r.mg, 150); assert.equal(r.capped, true); assert.equal(r.ml, 30);
    assert.equal(la("Bupivacaine", 50, "With adrenaline", "0.5%").mg, 125);
    // Prilocaine with adrenaline: 8 mg/kg, not more than 600 mg (Citanest Forte label); 70 x 8 = 560 is under it.
    const pri = data["la-doses"].drugs.find((x) => x.id === "prilocaine").withAdrenaline;
    assert.equal(pri.mgPerKg, 8); assert.equal(pri.maxMg, 600); assert.match(pri.ref, /600 mg/);
    r = la("Prilocaine", 90, "With adrenaline", "2%");
    assert.equal(r.mg, 560); assert.equal(r.capped, false);
    const T = K._tools["la-dose"];
    assert.match(T.text({ drug: "Levobupivacaine", weight: "60", adr: "Plain", strength: "0.5%" }), /^Local anaesthetic maximum dose \(BJA Education 2020/);
    assert.match(T.text({ drug: "Lidocaine (lignocaine)", weight: "60", adr: "Plain", strength: "1%" }), /^Local anaesthetic maximum dose \(Association of Anaesthetists 2014\)/);
    assert.ok(data["la-doses"].notes.some((n) => /1\.5 mL\/kg IV over 1 min/.test(n) && /15 mL\/kg\/h/.test(n) && /30 mL\/kg\/h/.test(n) && /12 mL\/kg/.test(n)), "lipid rescue note");

    const flagged = (c) => K._mccdCheck({ c0: c, i0: "2 days" }).warnings.some((w) => /mode of dying or a vague term/.test(w));
    ["Fever", "Fever with chills", "Fever of unknown origin", "PUO", "Abdominal pain", "Altered sensorium", "Cardiopulmonary arrest", "Multiple organ dysfunction syndrome"]
      .forEach((c) => assert.ok(flagged(c), c + " should be flagged"));
    ["Dengue fever", "Enteric fever", "Rheumatic fever", "Scrub typhus", "Plasmodium falciparum malaria"]
      .forEach((c) => assert.ok(!flagged(c), c + " is a specific disease"));

    const ids = (t) => K.notifiable(t).map((c) => c.id);
    assert.deepEqual(ids("Scrub typhus with ARDS"), ["scrub-typhus"]);
    assert.deepEqual(ids("Kala-azar"), ["kala-azar"]);
    assert.deepEqual(ids("Suspected KFD"), ["kyasanur-forest-disease"]);
    assert.ok(ids("Nipah virus encephalitis").includes("nipah"));
    assert.deepEqual(ids("Borderline lepromatous leprosy"), ["leprosy"]);
    assert.deepEqual(ids("Type 2 respiratory failure on NIV"), [], "NIV is not Nipah");
    assert.deepEqual(ids("Flame burns 35 percent, sari caught fire"), []);
    assert.deepEqual(ids("Insect bite"), [], "bite alone is not a snake or dog bite");
  } finally { K._setBundle(BUNDLE); }
});

/* ================================ Labour Care Guide ================================ */
test("Labour Care Guide: row alerts, cervix plateau and second-stage alerts from WHO thresholds", () => {
  const row = (id) => BUNDLE.data.lcg.sections.flatMap((s) => s.rows).find((r) => r.id === id);
  assert.equal(K._lcgAlert(row("fhr"), "109"), true); assert.equal(K._lcgAlert(row("fhr"), "110"), false);
  assert.equal(K._lcgAlert(row("fhr"), "159"), false); assert.equal(K._lcgAlert(row("fhr"), "160"), true);
  assert.equal(K._lcgAlert(row("sbp"), "140"), true); assert.equal(K._lcgAlert(row("dbp"), "89"), false);
  assert.equal(K._lcgAlert(row("contractions"), "2"), true); assert.equal(K._lcgAlert(row("contractions"), "5"), false); assert.equal(K._lcgAlert(row("contractions"), "6"), true);
  assert.equal(K._lcgAlert(row("amnioticFluid"), "M+++"), true); assert.equal(K._lcgAlert(row("amnioticFluid"), "C"), false);
  const e = [
    { at: "2026-09-25T08:00", v: { cervix: "5", fhr: "140" } },
    { at: "2026-09-25T14:00", v: { cervix: "5", fhr: "165" } },
    { at: "2026-09-25T15:00", v: { cervix: "10" }, ss: true },
    { at: "2026-09-25T18:00", v: { fhr: "150" } },
  ];
  const nullip = K._lcgAlerts({ e, b: { parity: "0" } });
  assert.ok(nullip.some((a) => /cervix at 5 cm for 6 h/.test(a)), nullip.join(" | "));
  assert.ok(nullip.some((a) => /FHR|heart rate/i.test(a) && /165/.test(a)), nullip.join(" | "));
  assert.ok(nullip.some((a) => /second stage 3 h/.test(a)));
  const multip = K._lcgAlerts({ e: e.slice(0, 1).concat([{ at: "2026-09-25T09:00", v: { cervix: "10" }, ss: true }, { at: "2026-09-25T10:30", v: {} }]), b: { parity: "2" } });
  assert.ok(!multip.some((a) => /second stage/.test(a)), "1.5 h is under the multiparous 2 h alert");
  assert.deepEqual(K._lcgAlerts({ e: [{ at: "2026-09-25T08:00", v: { cervix: "5" } }, { at: "2026-09-25T13:00", v: { cervix: "5" } }], b: {} }).filter((a) => /cervix/.test(a)), [], "5 h at 5 cm is under the 6 h alert");
});

/* ================================ growth chart ================================ */
test("growth chart: WHO SD curves ordered -3 < -2 < 0 < +2 < +3, median at birth, the visit plotted", () => {
  const c = K._growthChart(W, { sex: "Male", dob: "2026-01-01", asOf: "2026-07-01", weight: "7.9", lenhei: "67" }, "wfa");
  assert.deepEqual(c.curves.map((x) => x.z), [-3, -2, 0, 2, 3]);
  assert.equal(Math.round(c.curves[2].pts[0][1] * 1e4) / 1e4, 3.3464);
  c.curves[0].pts.forEach((p, i) => { for (let k = 1; k < 5; k++) assert.ok(c.curves[k].pts[i][1] > c.curves[k - 1].pts[i][1]); });
  assert.equal(c.points.length, 1); assert.match(c.points[0].label, /this visit/);
  const w = K._growthChart(W, { sex: "Female", dob: "2025-01-01", asOf: "2026-07-01", weight: "10", lenhei: "80", hist: [{ date: "2025-07-01", weight: "7.5", lenhei: "66" }] }, "wflh");
  assert.equal(w.points.length, 2); assert.equal(w.xUnit, "cm");
  assert.equal(K._growthChart(W, { dob: "2026-01-01", weight: "7" }, "wfa"), null, "no sex, no chart");
});

/* ================================ engine: picker, order sets, notifiable, profile ================================ */
test("every kit sits in a declared group, order-set tests are unique, and every kit id is reachable from a profile or the picker", () => {
  const groups = K.groups().map((g) => g[0]);
  assert.ok(groups.length >= 5);
  BUNDLE.kits.forEach((k) => {
    assert.ok(groups.includes(k.group), k.id + " group " + k.group);
    (k.orderSets || []).forEach((o) => assert.equal(new Set(o.tests).size, o.tests.length, k.id + "/" + o.id + " repeats a test"));
  });
});

test("profile speciality to kit: every mapped speciality exists in the sign-up list and maps to a real kit", () => {
  const src = readFileSync(join(ROOT, "profile-setup.js"), "utf8");
  const list = JSON.parse("[" + /var SPECIALITIES = \[([\s\S]*?)\];/.exec(src)[1] + "]");
  Object.keys(K._SPEC_TO_KIT).forEach((s) => {
    assert.ok(list.includes(s), `"${s}" is not a sign-up speciality`);
    assert.ok(BK.KIT_ORDER.includes(K._SPEC_TO_KIT[s]), s + " -> unknown kit " + K._SPEC_TO_KIT[s]);
  });
  assert.equal(K.kitForProfile("Obstetrics & Gynaecology"), "obgyn");
  assert.equal(K.kitForProfile("Internal Medicine", "MBBS, BDS"), "dental");
  assert.equal(K.kitForProfile("Internal Medicine", "MBBS, MD"), "");
});

test("notifiable reminder matches whole words only and names the condition", () => {
  const d = BUNDLE.data.notifiable;
  assert.ok(d && d.conditions.length >= 10, "data-notifiable.json is in the bundle");
  const hit = K.notifiable("Provisional diagnosis: dengue fever with warning signs");
  assert.ok(hit.some((c) => /dengue/i.test(c.label)), JSON.stringify(hit.map((c) => c.id)));
  assert.deepEqual(K.notifiable("patient reports mild headache"), []);
  d.conditions.forEach((c) => assert.ok(c.label && c.report && c.keywords.length && c.keywords.every((k) => k.trim().length >= 2), c.id));
  assert.deepEqual(K.notifiable("patient on ATT for pulmonary TB").map((c) => c.id), ["tuberculosis"]);
  assert.deepEqual(K.notifiable("tbsa 20 percent burns").filter((c) => c.id === "tuberculosis"), [], "tb inside tbsa is not a match");
});

/* ================================ clinical documents ================================ */
test("documents: every type renders, patient text is escaped, and the Reg. No. is a blank line unless verified", () => {
  const evil = "<img src=x onerror=alert(1)>";
  DOCS.TYPES.forEach(([type]) => {
    const html = DOCS._documentHtml(type, { name: evil, age: "40", sex: "Male", dx: "Viral fever", from: "2026-09-20", to: "2026-09-22", c0: "Septic shock", i0: "2 days" },
      { doc: { name: "A Rao", degree: "MBBS, MD" }, date: "2026-09-25", handover: [{ bed: "12", sev: "watcher", summary: "Day 2 pneumonia", actions: "Repeat lactate", cont: "If SpO2 falls, call" }], advice: [{ title: "Rest", text: "Drink fluids" }] });
    assert.ok(!html.includes(evil), type + " leaks raw HTML");
    assert.ok(!/undefined|NaN|[–—]/.test(html), type + " has undefined, NaN or a dash");
    if (type !== "handout") { assert.match(html, /Dr A Rao/); assert.match(html, /Reg\. No\. _{6,}/); }
  });
  const leave = DOCS._bodyHtml("leave", { name: "Ravi", age: "32", from: "2026-09-20", to: "2026-09-22", dx: "Acute gastroenteritis" });
  assert.match(leave, /3 days/);
  assert.match(DOCS._documentHtml("fitness", {}, { doc: { name: "Dr B", regNo: "APMC 12345" } }), /Reg\. No\. APMC 12345/);
  assert.match(DOCS._bodyHtml("consent", {}, {}), /Choose a consent template/);
});

test("consent: procedure-specific risks print under their own heading, in the form's language, escaped", () => {
  const consent = { procedure: { en: "Lap chole", te: "ల్యాప్ కోలి", hi: "लैप कोली" }, sections: [], declaration: { en: "I agree.", te: "నేను అంగీకరిస్తున్నాను.", hi: "मैं सहमत हूं।" } };
  const en = DOCS._bodyHtml("consent", { risks: "Bile leak\n<b>x</b>" }, { consent, lang: "en" });
  assert.match(en, /<h3>Other risks discussed for this procedure<\/h3><p>Bile leak<br>&lt;b&gt;x&lt;\/b&gt;<\/p>/);
  assert.ok(en.indexOf("Bile leak") < en.indexOf("I agree."), "risks come before the declaration");
  assert.match(DOCS._bodyHtml("consent", { risks: "Bile leak" }, { consent, lang: "hi" }), /इस प्रक्रिया के लिए बताए गए अन्य जोखिम/);
  assert.ok(!/Other risks discussed/.test(DOCS._bodyHtml("consent", {}, { consent, lang: "en" })), "no empty heading when nothing was entered");
  assert.ok(DOCS._forms.consent.some((f) => f[0] === "risks" && f[2] === "textarea"), "the consent form offers the risks box");
});

test("consent and handout validators: three languages, same item counts, no dashes, advice ids that exist", () => {
  const ok = {
    id: "demo-procedure", title: { en: "Consent", te: "సమ్మతి", hi: "सहमति" }, procedure: { en: "Demo", te: "డెమో", hi: "डेमो" },
    sections: ["a", "b", "c"].map((id) => ({ id, heading: { en: "H", te: "హ", hi: "ह" }, items: { en: ["one"], te: ["ఒకటి"], hi: ["एक"] } })),
    declaration: { en: "I agree", te: "నేను అంగీకరిస్తున్నాను", hi: "मैं सहमत हूँ" },
    sources: [{ org: "NMC", title: "Code", year: 2023, url: "https://www.nmc.org.in/" }],
    review: { status: "ai_drafted", compiled: "2026-09-25", translation: "machine_drafted" },
  };
  assert.deepEqual(BD.validateConsent(ok, "demo-procedure"), []);
  const bad = JSON.parse(JSON.stringify(ok)); bad.sections[0].items.hi = []; bad.title.en = "Consent — form"; bad.review.status = "reviewed";
  const e = BD.validateConsent(bad, "demo-procedure").join(" | ");
  assert.match(e, /same length/); assert.match(e, /dash/); assert.match(e, /must name its reviewer/);
  const keys = new Set(["obgyn/x"]);
  assert.deepEqual(BD.validateHandouts({ lang: "te", review: ok.review, texts: { "obgyn/x": { title: "t", text: "x" } } }, "te", keys), []);
  assert.match(BD.validateHandouts({ lang: "te", review: ok.review, texts: { "obgyn/nope": { title: "t", text: "x" } } }, "te", keys).join(), /not a kit advice id/);
  const { errors } = BD.loadAll();
  assert.deepEqual(errors, [], "shipped consent templates and handouts validate");
});

/* ================================ review desk + apply ================================ */
test("review export: stable shape, sorted, ids split once on the first colon", () => {
  const x = REV._buildExport({ "kit:obgyn": { decision: "changes", comment: "fix", at: "2026-09-25T10:00:00Z" }, "protocol:acne-vulgaris": { decision: "approve", at: "2026-09-25T09:00:00Z" } },
    { name: "Dr T", regNo: "1", verified: true }, "2026-09-25T11:00:00Z");
  assert.equal(x.schema, 1); assert.equal(x.reviewer.verified, true);
  assert.deepEqual(x.decisions.map((d) => d.kind + "/" + d.id), ["kit/obgyn", "protocol/acne-vulgaris"]);
  assert.deepEqual(AR.validateExport(x), []);
});

test("apply-reviews: validates, rewrites only the review object, and never downgrades or re-reviews", () => {
  assert.match(AR.validateExport({ schema: 1, reviewer: { name: "" }, decisions: [{ kind: "x", id: "../etc", decision: "changes", at: "no" }] }).join(" | "), /reviewer.name.*|kind must be.*|kebab-case.*|needs a comment/);
  const dir = mkdtempSync(join(tmpdir(), "rev-"));
  mkdirSync(join(dir, "kb/clinical-protocols"), { recursive: true }); mkdirSync(join(dir, "kb/specialty-kits/src"), { recursive: true });
  const proto = '{\n "id": "p-one",\n "aliases": ["a", "b"],\n "review": {\n  "status": "ai_drafted",\n  "compiled": "2026-09-25"\n }\n}\n';
  writeFileSync(join(dir, "kb/clinical-protocols/p-one.json"), proto);
  writeFileSync(join(dir, "kb/clinical-protocols/p-two.json"), '{ "id": "p-two", "review": { "status": "approved", "compiled": "2026-09-01", "reviewer": "Dr Z" } }\n');
  writeFileSync(join(dir, "kb/specialty-kits/src/k-one.json"), '{ "id": "k-one", "review": { "status": "ai_drafted", "compiled": "2026-09-25" } }\n');
  const x = { schema: 1, reviewer: { name: "Dr Q", regNo: "77", verified: true }, decisions: [
    { kind: "protocol", id: "p-one", decision: "approve", comment: "", at: "2026-09-26T08:00:00Z" },
    { kind: "protocol", id: "p-two", decision: "approve", comment: "", at: "2026-09-26T08:00:00Z" },
    { kind: "kit", id: "k-one", decision: "approve-minor", comment: "tweak X", at: "2026-09-26T08:00:00Z" },
    { kind: "consent", id: "c-none", decision: "changes", comment: "rewrite", at: "2026-09-26T08:00:00Z" } ] };
  const p = AR.plan(x, { root: dir });
  assert.equal(p.updates.length, 1);
  assert.equal(p.updates[0].review.reviewer, "Dr Q, Reg. No. 77, 2026-09-26");
  assert.equal(p.updates[0].text, proto.replace(/"review": \{[\s\S]*?\n \}/, '"review": { "status": "reviewed", "compiled": "2026-09-25", "reviewer": "Dr Q, Reg. No. 77, 2026-09-26" }'));
  assert.deepEqual(p.feedback.map((d) => d.id), ["k-one"]);
  assert.deepEqual(p.skipped.map((d) => d.id).sort(), ["c-none", "p-two"]);
  assert.equal(AR.plan(x, { root: dir, includeMinor: true }).updates.length, 2);
  const md = AR.feedbackMarkdown(x, p, "2026-09-26");
  assert.match(md, /Specialty kit `k-one`\*\*: Approve after minor edits/); assert.match(md, /> tweak X/); assert.match(md, /already approved by Dr Z/);
});

/* ================================ source watch ================================ */
test("source watch: collects cited URLs, fingerprints visible text only, and classifies changes", () => {
  const s = SW.collectSources();
  assert.ok(s.size > 300);
  [...s.keys()].forEach((u) => assert.match(u, /^https?:\/\//));
  const a = SW.fingerprint("<html><head><title> Guideline </title><script>var t=Date.now()</script></head><body><p>Dose 5 mg</p></body></html>", "text/html");
  const b = SW.fingerprint("<html><head><title>Guideline</title><script>var t=123</script></head><body><div><p>Dose   5 mg</p></div></body></html>", "text/html");
  assert.equal(a.hash, b.hash); assert.equal(a.title, "Guideline");
  assert.notEqual(SW.fingerprint("<p>Dose 10 mg</p>", "text/html").hash, a.hash);
  const ok = { status: 200, hash: "h1", finalUrl: "" };
  assert.equal(SW.classify(undefined, ok), "new");
  assert.equal(SW.classify(ok, { ...ok }), "same");
  assert.equal(SW.classify(ok, { ...ok, hash: "h2" }), "changed");
  assert.equal(SW.classify(ok, { ...ok, finalUrl: "https://x/new" }), "moved");
  assert.equal(SW.classify(ok, { status: 404 }), "broken");
  assert.equal(SW.classify({ status: 404 }, { status: 404 }), "still-broken");
  assert.equal(SW.classify(ok, { status: 403 }), "blocked");
  assert.equal(SW.classify({ status: 0 }, ok), "recovered");
});
