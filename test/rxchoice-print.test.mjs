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
  assert.ok(html.includes("BALANCED ⭐"), "Contains BALANCED ⭐ column header");
  assert.ok(html.includes("PREMIUM"), "Contains PREMIUM column header");
  assert.ok(html.includes("DOCTOR PRESCRIBED"), "Contains DOCTOR PRESCRIBED column header");
  assert.ok(html.includes("Moxikind-CV 625"), "Contains Generic candidate brand");
  assert.ok(html.includes("Clavam 625"), "Contains Balanced candidate brand");
  assert.ok(html.includes("Augmentin 625 Duo Tablet"), "Contains Doctor Prescribed brand");
  assert.ok(html.includes("Estimated Total"), "Contains Estimated Total row");
  assert.ok(html.includes("Potential saving on Balanced"), "Contains Potential saving banner");
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
