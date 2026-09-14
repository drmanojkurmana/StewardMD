import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Load rxchoice-core
import CORE from "../rxchoice-core.js";

// Evaluate prescription.js logic in a simulated browser environment
test("RxChoice Print Table: renders complete 4-way comparison table and totals", (t) => {
  // Mock window & globals
  global.window = {
    SMD_RXCHOICE: CORE,
    SMD_RXCHOICE_FLAGS: {
      bool: (k) => k === "smd_rxchoice_pdf" || k === "smd_rxchoice"
    }
  };

  // Mock results as produced by SMD_RXCHOICE.choose()
  const rx1 = {
    brand: "Augmentin 625 Duo Tablet",
    composition: "Amoxycillin (500mg) + Clavulanic Acid (125mg)",
    form: "tablet",
    mrp: 223.42,
    pack: "strip of 10 tablets",
    dose: "1 tab",
    freq: "BD",
    duration: "5 days"
  };
  const cands1 = [
    { id: 10, brand: "Moxikind-CV 625", composition: "Amoxycillin (500mg) + Clavulanic Acid (125mg)", form: "tablet", mrp: 72, pack: "strip of 10 tablets", manufacturer: "Mankind" },
    { id: 11, brand: "Clavam 625", composition: "Amoxycillin (500mg) + Clavulanic Acid (125mg)", form: "tablet", mrp: 95, pack: "strip of 10 tablets", manufacturer: "Alkem" },
    { id: 12, brand: "Augmentin 625", composition: "Amoxycillin (500mg) + Clavulanic Acid (125mg)", form: "tablet", mrp: 155, pack: "strip of 10 tablets", manufacturer: "GSK" }
  ];
  const res1 = CORE.choose(rx1, cands1);

  assert.ok(res1.generic, "Generic option present");
  assert.ok(res1.balanced, "Balanced option present");
  assert.ok(res1.premium, "Premium option present");
  assert.ok(res1.prescribed, "Doctor Prescribed option present");

  // Read prescription.js and extract rxcPrintSection
  const code = fs.readFileSync("prescription.js", "utf8");
  
  // Create a controlled scope to test rxcPrintSection
  const fnScope = new Function("sheet", "esc", "window", `
    ${code.slice(code.indexOf("function rxcPrintSection()"), code.indexOf("function rxvOn()"))}
    return rxcPrintSection();
  `);

  const mockEsc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const mockSheet = {
    _rxChoice: {
      "Amoxycillin + Clavulanic Acid": res1.balanced,
      _allResults: [res1],
      _allLines: [{ drug: "Amoxycillin + Clavulanic Acid", brand: "Augmentin 625 Duo Tablet", dose: "1 tab", freq: "BD", duration: "5 days" }],
      _allSelected: ["balanced"]
    }
  };

  const html = fnScope(mockSheet, mockEsc, global.window);
  assert.ok(html.includes("rxctbl"), "Contains 4-way comparison table class");
  assert.ok(html.includes("GENERIC"), "Contains GENERIC column header");
  assert.ok(html.includes("BALANCED<br>"), "Contains BALANCED column header (no emoji: test/no-ui-emoji.test.mjs)");
  assert.ok(html.includes("PREMIUM"), "Contains PREMIUM column header");
  assert.ok(html.includes("DOCTOR PRESCRIBED"), "Contains DOCTOR PRESCRIBED column header");
  assert.ok(html.includes("Moxikind-CV 625"), "Contains Generic candidate brand");
  assert.ok(html.includes("Clavam 625"), "Contains Balanced candidate brand");
  assert.ok(html.includes("Augmentin 625 Duo Tablet"), "Contains Doctor Prescribed brand");
  assert.ok(html.includes("Estimated Total"), "Contains Estimated Total row");
  assert.ok(html.includes("Potential saving on Balanced"), "Contains Potential saving banner");
});

/* ---------------- Phase D/E: presentation, page-breaks, acceptance (FINAL PLAN §2-3, §13, §17) --- */

const mockEsc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function printScope() {
  const code = fs.readFileSync("prescription.js", "utf8");
  // Slice covers rxcPrintSection AND renderRxChoicePrintTable (defined just after it, before rxvOn).
  const src = code.slice(code.indexOf("function rxcPrintSection()"), code.indexOf("function rxvOn()"));
  assert.ok(src.indexOf("function renderRxChoicePrintTable(") >= 0, "table builder ships with the section");
  return src;
}

function callTable(results, lines, selected, sel, mockWindow) {
  const src = printScope();
  const fn = new Function("results", "lines", "selected", "sel", "esc", "window",
    src + "\nreturn renderRxChoicePrintTable(results, lines, selected, sel, esc);");
  return fn(results, lines, selected, sel || {}, mockEsc, mockWindow);
}

function makeRes1() {
  const rx1 = {
    brand: "Augmentin 625 Duo Tablet",
    composition: "Amoxycillin (500mg) + Clavulanic Acid (125mg)",
    form: "tablet",
    mrp: 223.42,
    pack: "strip of 10 tablets",
    dose: "1 tab",
    freq: "BD",
    duration: "5 days"
  };
  const cands1 = [
    { id: 10, brand: "Moxikind-CV 625", composition: "Amoxycillin (500mg) + Clavulanic Acid (125mg)", form: "tablet", mrp: 72, pack: "strip of 10 tablets", manufacturer: "Mankind" },
    { id: 11, brand: "Clavam 625", composition: "Amoxycillin (500mg) + Clavulanic Acid (125mg)", form: "tablet", mrp: 95, pack: "strip of 10 tablets", manufacturer: "Alkem" },
    { id: 12, brand: "Augmentin 625", composition: "Amoxycillin (500mg) + Clavulanic Acid (125mg)", form: "tablet", mrp: 155, pack: "strip of 10 tablets", manufacturer: "GSK" }
  ];
  const res = CORE.choose(rx1, cands1);
  const line = { drug: "Amoxycillin + Clavulanic Acid", brand: "Augmentin 625 Duo Tablet", dose: "1 tab", freq: "BD", duration: "5 days" };
  return { res, line };
}

function flagsOn() {
  return { SMD_RXCHOICE: CORE, SMD_RXCHOICE_FLAGS: { bool: (k) => k === "smd_rxchoice_pdf" || k === "smd_rxchoice" } };
}

test("RxChoice Phase D: table rows are unbreakable medicine blocks with course costs and unit details", () => {
  const { res, line } = makeRes1();
  const html = callTable([res], [line], ["balanced"], {}, flagsOn());
  assert.ok(html.includes('<section class="rxcsec">'), "RxChoice is a separate section below the legal Rx");
  assert.ok(html.includes('<table class="rxctbl">'), "4-way comparison renders as a table");
  assert.ok(html.includes("rxc-tr rxcrow"), "each medicine row is an unbreakable block");
  assert.ok(html.includes("rxc-rxcol rxcmed"), "medicine cell carries the keep-together class");
  for (const h of ["GENERIC", "BALANCED", "PREMIUM", "DOCTOR PRESCRIBED"]) {
    assert.ok(html.includes(h), "column header present: " + h);
  }
  assert.ok(html.includes("Moxikind-CV 625") && html.includes("Clavam 625"), "alternative brands rendered");
  assert.ok(html.includes("Augmentin 625 Duo Tablet"), "doctor prescribed brand rendered");
  assert.ok(html.includes("/&nbsp;course"), "costs stated per course, never bare pack MRP");
  assert.ok(html.includes("pack of 10"), "unit detail: pack size shown");
  assert.ok(html.includes("units for this course"), "unit detail: required units shown");
  assert.ok(html.includes("SELECTED"), "chosen tier tagged SELECTED");
  assert.ok(html.includes("rxc-chosen"), "chosen cell highlighted");
  assert.ok(html.includes("1 tab") && html.includes("BD") && html.includes("5 days"), "prescribed dose/frequency/duration shown in the Rx column");
});

test("RxChoice Phase D: Doctor Prescribed restore shows KEPT, other tiers unmarked", () => {
  const { res, line } = makeRes1();
  const html = callTable([res], [line], ["prescribed"], {}, flagsOn());
  assert.ok(html.includes("KEPT"), "prescribed restore tagged KEPT");
  assert.ok(!html.includes("SELECTED"), "no tier claims SELECTED when the original was kept");
});

test("RxChoice Phase D: two medicines give two unbreakable rows plus totals and savings", () => {
  const a = makeRes1();
  const pcm = { brand: "Dolo 650 Tablet", composition: "Paracetamol (650mg)", form: "tablet", mrp: 30, pack: "strip of 15 tablets", manufacturer: "Micro Labs Ltd", dose: "1 tab", freq: "TDS", duration: "3 days" };
  const res2 = CORE.choose(pcm, [
    { id: 31, brand: "Calpol 650 Tablet", composition: "Paracetamol (650mg)", form: "tablet", mrp: 25, pack: "strip of 15 tablets", manufacturer: "Glaxo SmithKline Pharmaceuticals Ltd" }
  ]);
  const line2 = { drug: "Paracetamol", brand: "Dolo 650 Tablet", dose: "1 tab", freq: "TDS", duration: "3 days" };
  const html = callTable([a.res, res2], [a.line, line2], ["balanced", "prescribed"], {}, flagsOn());
  assert.equal((html.match(/rxc-tr rxcrow/g) || []).length, 2, "one unbreakable row per medicine");
  assert.ok(html.includes("Estimated Total"), "prescription-level totals row present");
  assert.ok(html.includes("Potential saving on Balanced"), "savings banner present");
  assert.ok(html.indexOf("Amoxycillin") < html.indexOf("Paracetamol"), "medicine order follows the prescription");
});

test("RxChoice Phase D: restricted medicine renders prescribed-only with its reason", () => {
  const warf = { brand: "Warf 5 Tablet", composition: "Warfarin (5mg)", form: "tablet", mrp: 60, pack: "strip of 10 tablets", manufacturer: "Cipla Ltd", dose: "1 tab", freq: "OD", duration: "30 days" };
  const res = CORE.choose(warf, [
    { brand: "Uniwarfin 5 Tablet", composition: "Warfarin (5mg)", form: "tablet", mrp: 30, pack: "strip of 10 tablets", manufacturer: "Mankind" }
  ]);
  assert.equal(res.blocked, true);
  const html = callTable([res], [{ drug: "Warfarin", brand: "Warf 5 Tablet", dose: "1 tab", freq: "OD", duration: "30 days" }], ["prescribed"], {}, flagsOn());
  assert.ok(html.includes("Warf 5 Tablet"), "original product survives a blocked result");
  assert.ok(html.includes("Blocked:"), "block reason shown instead of price cards");
  assert.ok(!html.includes("Uniwarfin"), "restricted alternative never offered");
});

test("RxChoice Phase D: section-13 disclaimer and no shopping language", () => {
  const { res, line } = makeRes1();
  const html = callTable([res], [line], ["balanced"], {}, flagsOn());
  assert.ok(html.includes("Final product selection remains the prescriber"), "restrained footer disclaimer present");
  assert.ok(html.includes("not a pharmacy quote"), "MRP framed as list price, not a quote");
  const upper = html.toUpperCase();
  assert.ok(!upper.includes("BEST MEDICINE") && !upper.includes("ADD TO CART") && !upper.includes("BUY NOW"), "no consumer-shopping language");
  assert.ok(!html.includes("Clinically better") || html.includes("never a claim"), "no clinical-superiority claim");
});

test("RxChoice Phase D: print CSS keeps medicine blocks together and repeats table headers", () => {
  const code = fs.readFileSync("prescription.js", "utf8");
  assert.ok(code.includes(".rxcrow,.rxcmed{page-break-inside:avoid;break-inside:avoid}"), "screen/doc CSS keeps each medicine block together");
  assert.ok(code.includes(".rxcrow,.rxcmed{break-inside:avoid;page-break-inside:avoid}"), "print CSS keeps each medicine block together");
  assert.ok(code.includes("thead{display:table-header-group}"), "table header repeats on every printed page");
  assert.ok(code.includes("tfoot{display:table-footer-group}"), "totals footer repeats on every printed page");
});

test("RxChoice Phase D: legal prescription builders carry no tier names", () => {
  const code = fs.readFileSync("prescription.js", "utf8");
  const cut = code.indexOf("function rxcPrintSection()");
  let i = -1, count = 0;
  while ((i = code.indexOf("GENERIC", i + 1)) !== -1) {
    count++;
    assert.ok(i > cut, "every GENERIC mention lives in the RxChoice layer, never in the legal prescription");
  }
  assert.ok(count > 0, "sanity: tier names exist in the file");
});

test("RxChoice Phase D: garbage in returns empty string, never throws", () => {
  assert.equal(callTable(null, null, null, null, flagsOn()), "");
  assert.equal(callTable(undefined, undefined, undefined, undefined, flagsOn()), "");
  assert.equal(callTable([], [], [], {}, flagsOn()), "", "no rows means no section");
  assert.equal(callTable([null], [{}], [], {}, flagsOn()), "", "null result skipped, empty section suppressed");
  assert.equal(callTable("nope", "nope", "nope", "nope", flagsOn()), "");
});

test("RxChoice Print Table: respects smd_rxchoice_pdf flag off", (t) => {
  global.window = {
    SMD_RXCHOICE: CORE,
    SMD_RXCHOICE_FLAGS: {
      bool: (k) => false
    }
  };
  const code = fs.readFileSync("prescription.js", "utf8");
  const fnScope = new Function("sheet", "esc", "window", `
    ${code.slice(code.indexOf("function rxcPrintSection()"), code.indexOf("function rxvOn()"))}
    return rxcPrintSection();
  `);
  const mockSheet = { _rxChoice: { _allResults: [{}] } };
  const html = fnScope(mockSheet, (s) => s, global.window);
  assert.equal(html, "", "Returns empty string when flag is disabled");
});
