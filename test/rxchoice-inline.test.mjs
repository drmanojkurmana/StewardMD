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

/* ---------------- Phase C/D/E: selection, audit, acceptance (RxChoice FINAL PLAN §12-14, §17) --- */

function memoryStorage() {
  var store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _store: store
  };
}

// Container stub that behaves like a DOM node for renderInlineTray: innerHTML assignment parses
// the rxc-icard divs so tests can click them and the handler wiring can be proven.
function makeTrayContainer() {
  var cards = [];
  var c = {
    _html: "",
    querySelectorAll: function (sel) { return sel === ".rxc-icard" ? cards : []; },
    _cards: function () { return cards; }
  };
  Object.defineProperty(c, "innerHTML", {
    get: function () { return this._html; },
    set: function (h) {
      this._html = String(h);
      cards = [];
      var re = /data-rxc-cat="([^"]+)"/g, m;
      while ((m = re.exec(this._html))) {
        (function (cat) {
          var el = {
            cat: cat,
            className: "rxc-icard",
            listeners: {},
            getAttribute: function (k) { return k === "data-rxc-cat" ? cat : null; },
            addEventListener: function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
            click: function () {
              var e = { preventDefault: function () {} };
              (this.listeners.click || []).slice().forEach(function (fn) { fn(e); });
            }
          };
          cards.push(el);
        })(m[1]);
      }
    }
  });
  return c;
}

const PARA_COMP = "Paracetamol (650mg)";
const PARA_SYRUP_COMP = "Paracetamol (120mg/5ml)";
function paraEnv() {
  const env = createEnv();
  const ROWS = [
    { id: 501, brand: "Crocin 650 mg Tablet", composition: PARA_COMP, manufacturer: "Glaxo SmithKline Pharmaceuticals Ltd", mrp: 34.27, form: "tablet", pack: "strip of 15 tablets", discontinued: 0 },
    { id: 502, brand: "Dolo 650 Tablet", composition: PARA_COMP, manufacturer: "Micro Labs Ltd", mrp: 30, form: "tablet", pack: "strip of 15 tablets", discontinued: 0 },
    { id: 503, brand: "Calpol 650 Tablet", composition: PARA_COMP, manufacturer: "Glaxo SmithKline Pharmaceuticals Ltd", mrp: 25, form: "tablet", pack: "strip of 15 tablets", discontinued: 0 },
    { id: 504, brand: "P-650 Tablet", composition: PARA_COMP, manufacturer: "Mankind Pharma Ltd", mrp: 18, form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
    { id: 505, brand: "Crocin Syrup 120mg/5ml", composition: PARA_SYRUP_COMP, manufacturer: "Glaxo SmithKline Pharmaceuticals Ltd", mrp: 55, form: "syrup", pack: "bottle of 60 ml", discontinued: 0 },
    { id: 506, brand: "Dolo Syrup 120mg/5ml", composition: PARA_SYRUP_COMP, manufacturer: "Micro Labs Ltd", mrp: 42, form: "syrup", pack: "bottle of 60 ml", discontinued: 0 }
  ];
  env.MEDAPI.searchBrands = (q) => {
    q = String(q || "").toLowerCase().trim();
    if (!q || q.length < 2) return Promise.resolve({ results: [] });
    return Promise.resolve({ results: ROWS.filter(r => r.brand.toLowerCase().indexOf(q) >= 0) });
  };
  // Return the whole shelf either way: the CORE must refuse the wrong formulation, not the stub.
  env.MEDAPI.composition = () => Promise.resolve({ composition: PARA_COMP, brands: ROWS });
  return env;
}

test("RxChoice Phase C: recordAuditEvent keeps the spec section-14 audit shape", () => {
  const env = createEnv();
  const core = env.SMD_RXCHOICE;
  assert.equal(typeof core.recordAuditEvent, "function", "recordAuditEvent must exist alongside auditEntry");

  const rx = { brand: "Augmentin 625 Duo Tablet", composition: "Amoxycillin + Clavulanic Acid", form: "tablet", mrp: 223.42, pack: "strip of 10 tablets", dose: "1 tab", freq: "BD", duration: "5 days" };
  const alt = { brand: "Moxclav 625 Tablet", composition: "Amoxycillin + Clavulanic Acid", mrp: 96, courseCost: 96 };
  const a = core.recordAuditEvent({ prescriptionId: "rx-1", original: rx, alternative: alt, category: "generic", reasonShown: "Lowest Cost", doctorApproved: true });
  for (const k of ["originalProduct", "alternativeProduct", "category", "reasonShown", "priceAtTime", "courseCostAtTime", "doctorApproved", "timestamp"]) {
    assert.ok(k in a, "audit entry carries " + k);
  }
  assert.equal(a.originalProduct.brand, "Augmentin 625 Duo Tablet", "original prescription reconstructable from the entry");
  assert.equal(a.alternativeProduct.brand, "Moxclav 625 Tablet");
  assert.equal(a.category, "generic");
  assert.equal(a.priceAtTime, 96);
  assert.equal(a.courseCostAtTime, 96);
  assert.equal(a.doctorApproved, true);
  assert.ok(a.timestamp);

  // Garbage in never throws and still returns the shape.
  const g = core.recordAuditEvent(null);
  assert.ok(g && "originalProduct" in g && "timestamp" in g);
  assert.equal(core.recordAuditEvent(undefined).doctorApproved, false);
});

test("RxChoice Phase C: recordSelection trails one entry per doctor decision", async () => {
  const env = createEnv();
  env.localStorage = memoryStorage();
  const ui = env.SMD_RXCHOICE_UI;
  ui.clearAudit();
  assert.equal(ui.audit().length, 0, "audit trail starts empty");

  const res = await ui.resolveLine({ drug: "Amoxycillin + Clavulanic Acid", brand: "Augmentin 625 Duo Tablet", dose: "1 tab", freq: "BD", duration: "5 days" });
  const entry = ui.recordSelection(res, "balanced", { prescriptionId: "rx-9" });
  assert.ok(entry, "selection returns its audit entry");
  assert.equal(entry.category, "balanced");
  assert.equal(entry.originalProduct.brand, "Augmentin 625 Duo Tablet");
  assert.equal(entry.alternativeProduct.brand, res.balanced.brand);
  assert.equal(entry.doctorApproved, true);
  const trail = ui.audit();
  assert.equal(trail.length, 1, "exactly one audit entry recorded");
  assert.equal(trail[0].category, "balanced");

  ui.recordSelection(res, "prescribed", { prescriptionId: "rx-9" });
  assert.equal(ui.audit().length, 2, "keeping the original is trailed too");
  assert.equal(ui.audit()[1].alternativeProduct.brand, "Augmentin 625 Duo Tablet");

  assert.equal(ui.recordSelection(res, "nope", {}), null, "unknown category records nothing");
  assert.equal(ui.recordSelection(null, "generic", {}), null);
  assert.equal(ui.audit().length, 2, "failed selections leave no trail");
});

test("RxChoice Phase C: applyBrandOnly changes ONLY the brand", () => {
  const env = createEnv();
  const apply = env.SMD_RXCHOICE_UI.applyBrandOnly;
  const line = { drug: "Paracetamol", brand: "Crocin 650 mg Tablet", dose: "650 mg", freq: "TDS", duration: "5 days", route: "PO" };
  const out = apply(line, { brand: "Dolo 650 Tablet" });
  assert.equal(out.brand, "Dolo 650 Tablet");
  assert.equal(out.drug, "Paracetamol", "molecule untouched");
  assert.equal(out.dose, "650 mg", "strength/dose untouched");
  assert.equal(out.freq, "TDS", "frequency untouched");
  assert.equal(out.duration, "5 days", "duration untouched");
  assert.equal(out.route, "PO", "route untouched");
  assert.equal(line.brand, "Crocin 650 mg Tablet", "input line not mutated");

  assert.equal(apply(line, null).brand, "Crocin 650 mg Tablet", "no option keeps the line");
  assert.equal(apply(line, {}).brand, "Crocin 650 mg Tablet", "brandless option keeps the line");
  assert.equal(apply(null, null), null, "garbage returns null, never throws");
});

test("RxChoice Phase C: inline tray clicks fire per-tier selection and highlight the tier", async () => {
  const env = createEnv();
  env.localStorage = memoryStorage();
  const ui = env.SMD_RXCHOICE_UI;
  const res = await ui.resolveLine({ drug: "Amoxycillin + Clavulanic Acid", brand: "Augmentin 625 Duo Tablet", dose: "1 tab", freq: "BD", duration: "5 days" });

  const seen = [];
  const box = makeTrayContainer();
  ui.renderInlineTray(box, res, "Augmentin 625 Duo Tablet", (cat, opt) => { seen.push([cat, opt && opt.brand]); });
  assert.deepEqual(box._cards().map(c => c.cat), ["generic", "balanced", "premium", "prescribed"], "all four tiers render as clickable cards");

  box._cards()[0].click();
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], "generic");
  assert.equal(seen[0][1], res.generic.brand, "GENERIC click offers the validated cheapest tablet");

  box._cards()[3].click();
  assert.equal(seen[1][0], "prescribed");
  assert.equal(seen[1][1], "Augmentin 625 Duo Tablet", "DOCTOR PRESCRIBED restores the original brand");

  // Host re-renders with the newly current brand: the chosen tier highlights, others do not.
  const box2 = makeTrayContainer();
  ui.renderInlineTray(box2, res, res.generic.brand, () => {});
  assert.ok(box2.innerHTML.indexOf("rxc-icard generic sel") >= 0, "selected tier carries the sel highlight");
  assert.ok(box2.innerHTML.indexOf("rxc-icard prescribed sel") === -1, "unselected tiers do not highlight");
});

test("RxChoice Phase C: prescription pad selection wiring re-runs safety and trails audit", async () => {
  const code = readFileSync(join(ROOT, "prescription.js"), "utf8");

  const modal = code.slice(code.indexOf("onSelect: function (i, opt, line, res, st)"), code.indexOf("function rxcInlineOn()"));
  assert.ok(modal.indexOf('[data-f="brand"]') >= 0, "modal selection writes the brand field");
  assert.ok(modal.indexOf("refreshSafety()") >= 0, "modal selection re-runs safety with the new product");
  assert.ok(modal.indexOf('[data-f="drug"]') === -1 && modal.indexOf('[data-f="dose"]') === -1, "modal selection touches no clinical field");

  const inline = code.slice(code.indexOf("function onPick(cat, opt, allRes)"), code.indexOf("SMD_RXCHOICE_UI.renderInlineTray(b, res, curBrand, onPick);"));
  assert.ok(inline.indexOf("brandIn.value = opt.brand") >= 0, "inline selection writes only the brand input");
  assert.ok(inline.indexOf("recordSelection") >= 0, "inline selection records the audit event");
  assert.ok(inline.indexOf("refreshSafety()") >= 0, "inline selection re-runs safety with the new product");
});

test("RxChoice Phase C: modal results are copied to print state, never aliased", () => {
  const code = readFileSync(join(ROOT, "prescription.js"), "utf8");
  const modal = code.slice(code.indexOf("onSelect: function (i, opt, line, res, st)"), code.indexOf("function rxcInlineOn()"));
  // The inline tray writes its own resolutions into sheet._rxChoice._allResults by index. If the
  // modal stored its live arrays by reference, that write would corrupt the open panel: SELECT
  // generic, then KEEP, would "restore" the generic instead of the original (browser-proven).
  assert.ok(modal.indexOf("_allResults = (st.results || []).slice()") >= 0, "results copied on store");
  assert.ok(modal.indexOf("_allSelected = (st.selected || []).slice()") >= 0, "selection copied on store");
  assert.ok(modal.indexOf("_allResults = st.results;") === -1, "no live-array aliasing");
});

test("RxChoice Phase E Sec 17: Paracetamol tablet line shows tablets only, syrup line shows syrup only", async () => {
  const env = paraEnv();
  const ui = env.SMD_RXCHOICE_UI;

  const tabLine = { drug: "Paracetamol", brand: "Crocin 650 mg Tablet", dose: "650 mg", freq: "TDS", duration: "5 days" };
  const tabRes = await ui.resolveLine(tabLine);
  assert.equal(tabRes.reason, "ok");
  assert.equal(tabRes.prescribed.brand, "Crocin 650 mg Tablet", "DOCTOR PRESCRIBED is exactly what was written");
  for (const k of ["generic", "balanced", "premium"]) {
    assert.ok(tabRes[k], k + " populated for the tablet line");
    assert.match(tabRes[k].form || "", /tablet/i, k + " is a tablet");
  }
  const tabBox = makeTrayContainer();
  ui.renderInlineTray(tabBox, tabRes, "Crocin 650 mg Tablet", () => {});
  assert.ok(/syrup/i.test(tabBox.innerHTML) === false, "no syrup candidate appears anywhere for a tablet prescription");

  const syrLine = { drug: "Paracetamol", brand: "Crocin Syrup 120mg/5ml", dose: "5 ml", freq: "TDS", duration: "5 days" };
  const syrRes = await ui.resolveLine(syrLine);
  assert.equal(syrRes.reason, "ok");
  assert.equal(syrRes.prescribed.brand, "Crocin Syrup 120mg/5ml");
  for (const k of ["generic", "balanced", "premium"]) {
    assert.ok(syrRes[k], k + " populated for the syrup line");
    assert.match(syrRes[k].form || "", /syrup/i, k + " is a syrup");
  }
  const syrBox = makeTrayContainer();
  ui.renderInlineTray(syrBox, syrRes, "Crocin Syrup 120mg/5ml", () => {});
  assert.ok(/tablet/i.test(syrBox.innerHTML) === false, "no tablet candidate appears anywhere for a syrup prescription");
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

test("RxChoice Safety: prevents cross-molecule brand match (Ascoril LD Syrup must NEVER resolve to Deflazacort)", async () => {
  const env = createEnv();
  // Simulate D1 where searching "Ascoril LD" fuzzy matched "Ascort 6mg Tablet" (Deflazacort)
  const ASCORT_DEFLAZACORT = [
    { id: 401, brand: "Ascort 6mg Tablet", composition: "Deflazacort (6mg)", manufacturer: "Apex Laboratories", mrp: 110, form: "tablet", pack: "strip of 10 tablets", discontinued: 0 },
    { id: 402, brand: "Safecort 6mg Tablet", composition: "Deflazacort (6mg)", manufacturer: "Macleods Pharmaceuticals", mrp: 85, form: "tablet", pack: "strip of 10 tablets", discontinued: 0 }
  ];

  const AMBRO_GUAIF_ROWS = [
    { id: 501, brand: "Ambrodil Syrup", composition: "Ambroxol (30mg) + Guaifenesin (50mg)", manufacturer: "Aristo Pharmaceuticals", mrp: 65, form: "syrup", pack: "bottle of 100 ml", discontinued: 0 },
    { id: 502, brand: "Mucolite Syrup", composition: "Ambroxol (30mg) + Guaifenesin (50mg)", manufacturer: "Dr Reddy's Laboratories", mrp: 95, form: "syrup", pack: "bottle of 100 ml", discontinued: 0 },
    { id: 503, brand: "Kuff-Q Syrup", composition: "Ambroxol (30mg) + Guaifenesin (50mg)", manufacturer: "Cipla Ltd", mrp: 80, form: "syrup", pack: "bottle of 100 ml", discontinued: 0 }
  ];

  env.MEDAPI.searchBrands = (q) => {
    q = q.toLowerCase();
    // If searching ascoril, return Ascort (the bug scenario)
    if (q.indexOf("ascoril") >= 0 || q.indexOf("ascort") >= 0) {
      return Promise.resolve({ results: ASCORT_DEFLAZACORT });
    }
    return Promise.resolve({ results: [] });
  };

  env.MEDAPI.composition = (name) => {
    if (name.toLowerCase().indexOf("deflazacort") >= 0) {
      return Promise.resolve({ composition: name, brands: ASCORT_DEFLAZACORT });
    }
    if (name.toLowerCase().indexOf("ambroxol") >= 0) {
      return Promise.resolve({ composition: name, brands: AMBRO_GUAIF_ROWS });
    }
    return Promise.resolve({ composition: name, brands: [] });
  };

  const line = {
    drug: "Ambroxol (30mg) + Guaifenesin (50mg)",
    brand: "Ascoril LD Syrup",
    dose: "10 ml PO",
    freq: "TDS",
    duration: "5 days"
  };

  const res = await env.SMD_RXCHOICE_UI.resolveLine(line);
  assert.ok(res, "Result must exist");

  // Invariant 1: Prescribed card must NEVER resolve to Deflazacort
  assert.notEqual(res.prescribed.composition.toLowerCase(), "deflazacort (6mg)");
  assert.notEqual(res.prescribed.brand, "Ascort 6mg Tablet");
  assert.equal(res.prescribed.brand, "Ascoril LD Syrup");

  // Invariant 2: Alternatives must be Ambroxol + Guaifenesin syrups, NEVER Deflazacort steroids
  assert.ok(res.generic, "Generic alternative must be found for ambroxol+guaifenesin");
  assert.equal(res.generic.brand, "Ambrodil Syrup");
  assert.equal(res.generic.composition, "Ambroxol (30mg) + Guaifenesin (50mg)");
  assert.ok(res.balanced, "Balanced alternative must be found");
  assert.ok(res.premium, "Premium alternative must be found");
  assert.notEqual(res.generic.brand, "Safecort 6mg Tablet");
  assert.notEqual(res.premium.brand, "Ascort 6mg Tablet");
});

test("RxChoice: uncatalogued brand fallback (Ambro GT Syrup) resolves alternatives for generic", async () => {
  const env = createEnv();
  const AMBRO_GUAIF_ROWS = [
    { id: 501, brand: "Ambrodil Syrup", composition: "Ambroxol + Guaifenesin", manufacturer: "Aristo Pharmaceuticals", mrp: 65, form: "syrup", pack: "bottle of 100 ml", discontinued: 0 },
    { id: 502, brand: "Mucolite Syrup", composition: "Ambroxol + Guaifenesin", manufacturer: "Dr Reddy's Laboratories", mrp: 95, form: "syrup", pack: "bottle of 100 ml", discontinued: 0 }
  ];

  // Brand "Ambro GT Syrup" is not in searchBrands
  env.MEDAPI.searchBrands = () => Promise.resolve({ results: [] });
  env.MEDAPI.composition = (name) => Promise.resolve({ composition: name, brands: AMBRO_GUAIF_ROWS });

  const line = {
    drug: "Ambroxol + Guaifenesin",
    brand: "Ambro GT Syrup",
    dose: "10 ml PO",
    freq: "TDS",
    duration: "5 days"
  };

  const res = await env.SMD_RXCHOICE_UI.resolveLine(line);
  assert.ok(res, "Result must resolve");
  assert.equal(res.prescribed.brand, "Ambro GT Syrup");
  assert.ok(res.generic, "Generic syrup should be found");
  assert.equal(res.generic.brand, "Ambrodil Syrup");
  assert.ok(res.balanced, "Balanced syrup should be found");
});


