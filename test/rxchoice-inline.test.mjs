/* test/rxchoice-inline.test.mjs — RxChoice Sprint 2 Inline Tray & Typo-Tolerant Resolution Tests
 * Validates:
 * 1. normalizeBrand cleans hyphens, slashes, and whitespace.
 * 2. resolvePrescribed handles punctuation and stem typos (e.g. Augmentin-625 -> Augmentin 625 Duo Tablet).
 * 3. resolveLine produces complete 4-way choice objects with course costs and dispensing quantities.
 * 4. renderInlineTray generates 4 cards with Stitch tokens, badges, and click triggers.
 * 5. smd_rxchoice_inline flag gating.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function loadScript(file, sandbox) {
  const code = readFileSync(join(ROOT, file), "utf8");
  vm.runInNewContext(code, sandbox);
  return sandbox;
}

const COMP = "Amoxycillin + Clavulanic Acid";
const ROWS = [
  { id: 1, brand: "Augmentin 625 Duo Tablet", composition: COMP, manufacturer: "Glaxo SmithKline Pharmaceuticals Ltd", mrp: 223.42, form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
  { id: 2, brand: "Clavam 625 Tablet",        composition: COMP, manufacturer: "Alkem Laboratories Ltd",              mrp: 181,    form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
  { id: 3, brand: "Moxclav 625 Tablet",       composition: COMP, manufacturer: "Wanbury Ltd",                         mrp: 96,     form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
  { id: 4, brand: "Advent 625 Tablet",        composition: COMP, manufacturer: "Cipla Ltd",                           mrp: 198,    form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
  { id: 5, brand: "Clavam 375 Tablet",        composition: COMP, manufacturer: "Alkem Laboratories Ltd",              mrp: 88,     form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
  { id: 6, brand: "Clavam 625 Dry Syrup",     composition: COMP, manufacturer: "Alkem Laboratories Ltd",              mrp: 70,     form: "syrup",  pack: "bottle of 30 ml",     discontinued: 0 }
];

function createEnv() {
  const fakeDoc = {
    getElementById: () => null,
    head: { appendChild: () => {} },
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        className: "",
        style: {},
        innerHTML: "",
        textContent: "",
        children: [],
        listeners: {},
        setAttribute: (k, v) => { el[k] = v; },
        getAttribute: (k) => el[k] || null,
        appendChild: (c) => { el.children.push(c); },
        addEventListener: (ev, fn) => { (el.listeners[ev] = el.listeners[ev] || []).push(fn); },
        querySelectorAll: (sel) => {
          const res = [];
          function walk(node) {
            if (sel === ".rxc-icard" && (node.className || "").indexOf("rxc-icard") >= 0) res.push(node);
            if (node.children) node.children.forEach(walk);
          }
          walk(el);
          return res;
        }
      };
      return el;
    }
  };

  const sandbox = {
    window: {},
    globalThis: {},
    document: fakeDoc,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Event: function (type) { this.type = type; },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  // Stub MEDAPI
  sandbox.MEDAPI = {
    searchCompositions: function (q) {
      q = String(q || "").toLowerCase();
      return Promise.resolve({ results: (q.indexOf("amox") >= 0) ? [{ composition: COMP }] : [] });
    },
    composition: function (name) {
      return Promise.resolve({ composition: name, brands: ROWS.filter(r => r.composition === name) });
    },
    searchBrands: function (q) {
      q = String(q || "").toLowerCase().trim();
      if (!q || q.length < 2) return Promise.resolve({ results: [] });
      return Promise.resolve({
        results: ROWS.filter(r => r.brand.toLowerCase().indexOf(q) >= 0)
      });
    }
  };

  loadScript("rxchoice-flags.js", sandbox);
  loadScript("rxchoice-core.js", sandbox);
  loadScript("rxchoice-ui.js", sandbox);

  return sandbox;
}

test("RxChoice Sprint 2: normalizeBrand handles typos, hyphens, and whitespace", () => {
  const env = createEnv();
  const norm = env.SMD_RXCHOICE_UI.normalizeBrand;

  assert.equal(norm("Augmentin-625"), "augmentin 625");
  assert.equal(norm("Augmentin_625_Duo"), "augmentin 625 duo");
  assert.equal(norm("  Augmentin / 625  "), "augmentin 625");
  assert.equal(norm("Clavam + 625"), "clavam 625");
});

test("RxChoice Sprint 2: resolvePrescribed resolves exact and typo-hyphenated brand inputs", async () => {
  const env = createEnv();
  const resolve = env.SMD_RXCHOICE_UI.resolvePrescribed;

  // Exact match
  const r1 = await resolve({ brand: "Augmentin 625 Duo Tablet", drug: "Amoxycillin + Clavulanic Acid" });
  assert.ok(r1, "Exact brand should resolve");
  assert.equal(r1.brand, "Augmentin 625 Duo Tablet");

  // Hyphenated typo input
  const r2 = await resolve({ brand: "Augmentin-625", drug: "Amoxycillin + Clavulanic Acid" });
  assert.ok(r2, "Hyphenated typo Augmentin-625 should resolve");
  assert.equal(r2.brand, "Augmentin 625 Duo Tablet");

  // Stem input
  const r3 = await resolve({ brand: "Augmentin 625", drug: "Amoxycillin + Clavulanic Acid" });
  assert.ok(r3, "Stem Augmentin 625 should resolve");
  assert.equal(r3.brand, "Augmentin 625 Duo Tablet");
});

test("RxChoice Sprint 2: resolveLine produces 4-way choices with course costs and correct dispensing", async () => {
  const env = createEnv();
  const resolveLine = env.SMD_RXCHOICE_UI.resolveLine;

  const line = {
    drug: "Amoxycillin + Clavulanic Acid",
    brand: "Augmentin-625",
    dose: "1 tab",
    freq: "BD",
    duration: "5 days"
  };

  const res = await resolveLine(line);
  assert.ok(res, "Line should resolve");
  assert.equal(res.blocked, false);
  assert.equal(res.reason, "ok");

  // Check 4 options
  assert.ok(res.prescribed, "prescribed should be present");
  assert.equal(res.prescribed.brand, "Augmentin 625 Duo Tablet");
  assert.equal(res.prescribed.courseCost, 223.42);

  assert.ok(res.generic, "generic should be present");
  assert.equal(res.generic.brand, "Moxclav 625 Tablet");
  assert.equal(res.generic.courseCost, 96);

  assert.ok(res.balanced, "balanced should be present");
  assert.ok(res.premium, "premium should be present");

  // Invariant: Syrup must never be suggested for tablet
  assert.notEqual(res.generic.form, "syrup");
  assert.notEqual(res.balanced.form, "syrup");
  assert.notEqual(res.premium.form, "syrup");
});

test("RxChoice Sprint 2: renderInlineTray produces 4 cards matching Reference Image 2 structure", async () => {
  const env = createEnv();
  const resolveLine = env.SMD_RXCHOICE_UI.resolveLine;
  const renderInlineTray = env.SMD_RXCHOICE_UI.renderInlineTray;

  const line = {
    drug: "Amoxycillin + Clavulanic Acid",
    brand: "Augmentin 625 Duo Tablet",
    dose: "1 tab",
    freq: "BD",
    duration: "5 days"
  };

  const res = await resolveLine(line);
  const container = { innerHTML: "", querySelectorAll: () => [] };

  let selectedCat = null;
  let selectedOpt = null;
  renderInlineTray(container, res, "Augmentin 625 Duo Tablet", (cat, opt) => {
    selectedCat = cat;
    selectedOpt = opt;
  });

  assert.ok(container.innerHTML.indexOf("rxc-inline-tray") >= 0, "Tray container must be rendered");
  assert.ok(container.innerHTML.indexOf("Economy (Lowest Cost)") >= 0, "Generic pill must be present");
  assert.ok(container.innerHTML.indexOf("Best Value") >= 0, "Balanced pill must be present");
  assert.ok(container.innerHTML.indexOf("⭐") === -1, "No star emoji in inline tray");
  assert.ok(container.innerHTML.indexOf("Top Branded") >= 0, "Premium pill must be present");
  assert.ok(container.innerHTML.indexOf("Doctor Prescribed") >= 0, "Prescribed pill must be present");
  assert.ok(container.innerHTML.indexOf("Moxclav 625 Tablet") >= 0, "Generic brand name rendered");
  assert.ok(container.innerHTML.indexOf("₹96") >= 0, "Generic course price rendered");
});

test("RxChoice Sprint 2: smd_rxchoice_inline flag exists and defaults to true", () => {
  const env = createEnv();
  const flags = env.SMD_RXCHOICE_FLAGS;

  assert.ok(flags.defs().smd_rxchoice_inline, "smd_rxchoice_inline flag definition must exist");
  assert.equal(flags.defs().smd_rxchoice_inline.def, true, "default should be true");
  assert.equal(flags.bool("smd_rxchoice_inline"), true, "bool query returns true by default");
});

test("RxChoice Sprint 2: resolves DB records with form pack, bare duration and dose numbers (e.g. Azee 100)", async () => {
  const env = createEnv();
  const AZEE_ROWS = [
    { id: 101, brand: "Azee 100mg Tablet DT", composition: "Azithromycin (100mg)", manufacturer: "Cipla Ltd", mrp: 34.68, form: "3 tablet dt", pack: null, discontinued: 0 },
    { id: 102, brand: "Bactrocin 100mg Tablet DT", composition: "Azithromycin (100mg)", manufacturer: "Nexus India", mrp: 10.78, form: "3 tablet dt", pack: null, discontinued: 0 },
    { id: 103, brand: "Aziswift 100mg Tablet DT", composition: "Azithromycin (100mg)", manufacturer: "Lupin Ltd", mrp: 17.13, form: "3 tablet dt", pack: null, discontinued: 0 },
    { id: 104, brand: "Azysafe 100mg Tablet DT", composition: "Azithromycin (100mg)", manufacturer: "Overseas Healthcare Pvt Ltd", mrp: 19.88, form: "10 tablets", pack: null, discontinued: 0 }
  ];

  env.MEDAPI.searchBrands = (q) => Promise.resolve({ results: AZEE_ROWS.filter(r => r.brand.toLowerCase().indexOf(q.toLowerCase()) >= 0) });
  env.MEDAPI.composition = (name) => Promise.resolve({ composition: name, brands: AZEE_ROWS });

  const line = {
    drug: "Azithromycin",
    brand: "Azee 100mg Tablet DT",
    dose: "500",
    freq: "Bd",
    duration: "5"
  };

  const res = await env.SMD_RXCHOICE_UI.resolveLine(line);
  assert.ok(res, "Line must resolve");
  assert.equal(res.reason, "ok", "Reason must be ok, not no_course_quantity or no_validated_alternatives");
  assert.ok(res.generic, "Generic must be populated");
  assert.ok(res.balanced, "Balanced must be populated");
  assert.ok(res.premium, "Premium must be populated");
  assert.ok(res.prescribed, "Prescribed must be populated");
  assert.ok(res.prescribed.courseCost != null, "Prescribed courseCost must be calculated");
});

test("RxChoice Sprint 2: parses spaced frequencies, duration abbreviations and fractional doses", () => {
  const env = createEnv();
  const core = env.SMD_RXCHOICE;

  // Spaced frequency
  const q1 = core.requiredQuantity({ dose: "1 tab", freq: "1 - 0 - 1", duration: "5d" }, "tablet");
  assert.ok(q1, "Spaced frequency and 5d duration should parse");
  assert.equal(q1.perDay, 2);
  assert.equal(q1.days, 5);
  assert.equal(q1.units, 10);

  // Weeks abbreviation
  const q2 = core.requiredQuantity({ dose: "1", freq: "1-1-1", duration: "2w" }, "tablet");
  assert.ok(q2);
  assert.equal(q2.perDay, 3);
  assert.equal(q2.days, 14);
  assert.equal(q2.units, 42);

  // Month abbreviation
  const q3 = core.requiredQuantity({ dose: "1", freq: "OD", duration: "1m" }, "tablet");
  assert.ok(q3);
  assert.equal(q3.days, 30);
  assert.equal(q3.units, 30);

  // Fractional dose: 1/2 tab
  const q4 = core.requiredQuantity({ dose: "1/2 tab", freq: "BD", duration: "10 days" }, "tablet");
  assert.ok(q4);
  assert.equal(q4.perDose, 0.5);
  assert.equal(q4.units, 10);
});

test("RxChoice Sprint 2: resolves generic-only lines (NMC compliance)", async () => {
  const env = createEnv();
  const PARA_ROWS = [
    { id: 201, brand: "Alice 650mg Tablet", composition: "Paracetamol", manufacturer: "Zeelab Pharmacy Pvt Ltd", mrp: 3.31, form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
    { id: 202, brand: "Pyremol 650mg Tablet", composition: "Paracetamol", manufacturer: "Alkem Laboratories Ltd", mrp: 5.7, form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
    { id: 203, brand: "Dolo 650 Tablet", composition: "Paracetamol", manufacturer: "Micro Labs Ltd", mrp: 34.27, form: "tablet", pack: "strip of 15 tablets", discontinued: 0 }
  ];

  env.MEDAPI.composition = (name) => Promise.resolve({ composition: name, brands: PARA_ROWS });

  const line = {
    drug: "Paracetamol",
    brand: "",
    dose: "650",
    freq: "TDS",
    duration: "3"
  };

  const res = await env.SMD_RXCHOICE_UI.resolveLine(line);
  assert.ok(res, "Generic-only line should resolve");
  assert.equal(res.reason, "ok");
  assert.ok(res.generic, "Generic tier must be populated");
  assert.equal(res.generic.brand, "Alice 650mg Tablet");
  assert.ok(res.balanced, "Balanced tier must be populated");
  assert.ok(res.prescribed, "Prescribed tier must be preserved");
  assert.equal(res.prescribed.brand, "Paracetamol 650");
});

test("RxChoice Sprint 2: resolves standard adult combinations (Montair LC) and rejects pediatric", async () => {
  const env = createEnv();
  const MONTAIR_ROWS = [
    { id: 301, brand: "Montair-LC Tablet", composition: "Levocetirizine + Montelukast", manufacturer: "Cipla Ltd", mrp: 336, form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
    { id: 302, brand: "Pilzine M 5mg/10mg Tablet", composition: "Levocetirizine + Montelukast", manufacturer: "Psychotropics India Ltd", mrp: 7.7, form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
    { id: 303, brand: "Lizimont 5mg/10mg Tablet", composition: "Levocetirizine + Montelukast", manufacturer: "Medley Pharmaceuticals", mrp: 23.12, form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
    { id: 304, brand: "Newcold ml 5mg/10mg Tablet", composition: "Levocetirizine + Montelukast", manufacturer: "Abbott", mrp: 23.5, form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
    { id: 305, brand: "Miontizee-L Kid Tablet", composition: "Levocetirizine + Montelukast", manufacturer: "Zeelab Pharmacy Pvt Ltd", mrp: 8, form: "tablet", pack: "strip of 10 tablets", discontinued: 0 }
  ];

  env.MEDAPI.searchBrands = (q) => {
    q = q.toLowerCase();
    return Promise.resolve({ results: MONTAIR_ROWS.filter(r => r.brand.toLowerCase().indexOf(q) >= 0) });
  };
  env.MEDAPI.composition = (name) => Promise.resolve({ composition: name, brands: MONTAIR_ROWS });

  const line = {
    drug: "Montelukast + Levocetirizine",
    brand: "Montair LC",
    dose: "1",
    freq: "HS",
    duration: "10"
  };

  const res = await env.SMD_RXCHOICE_UI.resolveLine(line);
  assert.ok(res, "Montair LC should resolve");
  assert.equal(res.reason, "ok");
  assert.equal(res.prescribed.brand, "Montair-LC Tablet");
  assert.ok(res.generic, "Generic should be populated");
  assert.equal(res.generic.brand, "Pilzine M 5mg/10mg Tablet");
  assert.ok(res.balanced, "Balanced should be populated");
  assert.ok(res.premium, "Premium should be populated");

  // Invariant: Pediatric product must NEVER be chosen for adult prescription
  assert.notEqual(res.generic.brand, "Miontizee-L Kid Tablet");
  assert.notEqual(res.balanced.brand, "Miontizee-L Kid Tablet");
  assert.notEqual(res.premium.brand, "Miontizee-L Kid Tablet");
});

