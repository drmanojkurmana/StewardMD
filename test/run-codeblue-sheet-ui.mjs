/* Code Blue sheet UI checks at 390 px, light and dark. Pure node with a small
 * DOM shim (no browser, no network): drives open, edit, delete, undo, note,
 * totals, debrief, share fallbacks and PDF through the real module and asserts
 * the CSS contract (width, targets, focus, motion, themes, palette).
 * USAGE: node test/run-codeblue-sheet-ui.mjs */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const require = createRequire(import.meta.url);

/* ---- minimal DOM shim (only what codeblue-sheet.js uses) ---- */
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this._listeners = {};
    this.style = {};
    this.className = "";
    this._text = "";
    this.value = "";
    this.type = "";
    this.maxLength = 0;
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  set innerHTML(v) { this._text = v === "" ? "" : String(v); if (v === "") this.children = []; }
  get innerHTML() { return this._text; }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  click() { (this._listeners.click || []).forEach((f) => f({ target: this })); }
  focus() {}
  _match(sel) {
    if (sel[0] === ".") return this.className.split(" ").includes(sel.slice(1));
    return this.tagName === sel.toUpperCase();
  }
  querySelector(sel) {
    const walk = (n) => {
      for (const c of n.children) { if (c._match(sel)) return c; const r = walk(c); if (r) return r; }
      return null;
    };
    return walk(this);
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (c._match(sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}

const fakeDoc = { createElement: (t) => new FakeEl(t), body: new FakeEl("body") };
globalThis.document = fakeDoc;
globalThis.window = globalThis.window || {};
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => "blob:fake";

const S = require(join(ROOT, "codeblue-sheet.js"));
const CSS = readFileSync(join(ROOT, "codeblue-sheet.css"), "utf8");
const SRC = readFileSync(join(ROOT, "codeblue-sheet.js"), "utf8");

let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (c) passes++; else fails++; };

const PAYLOAD = {
  v: 2, mode: "adult", startedAt: "2026-10-01T10:00:00Z", durationSeconds: 600, cycles: 2,
  events: [
    { id: "a", elapsed: 0, kind: "cprStart", label: "CPR started" },
    { id: "b", elapsed: 120, kind: "rhythm", label: "VF" },
    { id: "c", elapsed: 125, kind: "shock", label: "Shock delivered" },
    { id: "d", elapsed: 200, kind: "drug", label: "Epinephrine" },
    { id: "e", elapsed: 240, kind: "pauseStart", label: "Pause started" },
    { id: "f", elapsed: 260, kind: "resume", label: "Compressions resumed" },
    { id: "g", elapsed: 380, kind: "drug", label: "Epinephrine" }
  ],
  summary: { compressions: 1000, averageRateCPM: 110, compressionFractionPct: 82, shockCount: 1, adrenalineCount: 2, rosc: false }
};

/* ---- review screen flows (dark default) ---- */
const h = S.open(PAYLOAD);
ok(h && h.card, "open renders a review sheet");
ok(h.card.getAttribute("role") === "dialog" && h.card.getAttribute("aria-modal") === "true", "dialog role and modal");
ok(h.card.querySelectorAll(".cb-row").length === 7, "timeline shows all 7 events");
ok(h.card.textContent.includes("02:05"), "times render as mm:ss");
ok(h.totalsEl.textContent.includes("Epinephrine 2") && h.totalsEl.textContent.includes("Shocks 1"), "mode and totals shown");
ok(h.debriefEl.querySelectorAll(".cb-dt").length === 5, "debrief card has 5 rows");
ok(h.card.textContent.includes("Not attached to a patient record"), "never attaches; says so");
ok(h.card.textContent.includes(S.CLINICAL_DISCLAIMER), "clinical disclaimer shown");
ok(h.card.textContent.includes(S.MOTION_DISCLAIMER), "motion disclaimer shown");

h.editLabel("c", "Shock delivered, 200 J");
ok(h.card.textContent.includes("edited"), "edited marker after label edit");
ok(h.totalsEl.textContent.includes("Shocks 1"), "totals recomputed after edit");
h.editLabel("d", "Amiodarone");
ok(h.totalsEl.textContent.includes("Epinephrine 1"), "recount drops epinephrine after relabel");
h.deleteEvent("c");
ok(h.card.querySelectorAll(".cb-row").length === 6, "delete removes the row");
ok(h.totalsEl.textContent.includes("Shocks 0"), "totals recomputed after delete");
ok(h.undoEl.style.display !== "none", "undo offered after delete");
h.undo();
ok(h.card.querySelectorAll(".cb-row").length === 7, "undo restores the row");
ok(h.totalsEl.textContent.includes("Shocks 1"), "totals recomputed after undo");
ok(h.addNote("Family updated in relatives room.") === true, "free text note accepted");
ok(h.card.querySelectorAll(".cb-row").length === 8, "note row added");
ok(h.addNote("   ") === false, "blank note refused");

/* ---- v1 and empty payloads ---- */
h.close();
const v1 = S.open({ mode: "paediatric", events: [{ elapsed: 30, kind: "shock" }] });
ok(v1.card.querySelectorAll(".cb-row").length === 1, "v1 event renders with default label");
ok(v1.card.textContent.includes("Paediatric"), "v1 mode label resolves");
v1.close();
const em = S.open({});
ok(em.card.querySelector(".cb-empty") !== null, "empty state for missing events");
ok(em.card.textContent.includes("Epinephrine 0"), "zero totals shown, never blank");
em.close();

/* ---- light theme ---- */
const lt = S.open(PAYLOAD);
lt.card.setAttribute("data-cb-theme", "light");
ok(lt.card.querySelectorAll(".cb-row").length === 7, "light theme renders the same rows");
ok(CSS.includes('[data-cb-theme="light"]'), "CSS carries an explicit light theme");
ok(CSS.includes("prefers-color-scheme"), "CSS follows the system theme too");
lt.close();

/* ---- share fallbacks ---- */
const sh = S.open(PAYLOAD);
function setNav(n) { Object.defineProperty(globalThis, "navigator", { value: n, configurable: true, writable: true }); }
setNav({ clipboard: { writeText: () => Promise.resolve() } });
await sh.share();
ok(sh.statusEl.textContent === "Copied to clipboard.", "copy fallback inside try/catch");
setNav({ share: () => Promise.resolve() });
await sh.share();
ok(sh.statusEl.textContent === "Shared.", "navigator.share path");
setNav({ share: () => Promise.reject(new Error("x")) });
await sh.share();
ok(sh.statusEl.textContent === "Share cancelled.", "share rejection handled");

/* ---- PDF via mocked jsPDF ---- */
function mockJS() {
  return function () {
    return {
      internal: { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 } },
      setFont: () => {}, setFontSize: () => {},
      splitTextToSize: (t) => String(t).split("\n"),
      text: () => {}, output: () => new Uint8Array([37, 80, 68, 70]).buffer,
      getNumberOfPages: () => 1
    };
  };
}
globalThis.window.jspdf = { jsPDF: mockJS() };
setNav({});
await sh.pdf();
ok(sh.statusEl.textContent === "PDF downloaded.", "PDF download path with engine");
delete globalThis.window.jspdf;
delete globalThis.window.jsPDF;
await sh.pdf();
ok(sh.statusEl.textContent.includes("PDF engine unavailable"), "missing engine degrades to text");
sh.close();

/* ---- 390 px layout and interaction contract ---- */
ok(/max-width:\s*430px/.test(CSS), "sheet fits a 390 px viewport");
ok(CSS.includes("min-height:44px") && CSS.includes("min-height:52px"), "44 px quiet and 52 px primary targets");
ok(CSS.includes(":focus-visible"), "visible focus on controls and inputs");
ok(CSS.includes("prefers-reduced-motion"), "reduced motion honoured");
ok(CSS.includes("#071318") && CSS.includes("#0D1D23") && CSS.includes("#42CDB5"), "fixed project palette");
ok(!/linear-gradient|box-shadow|backdrop-filter|text-shadow/.test(CSS), "no glows, gradients, shadows or backdrops");
ok(!/[\u2014\u{1F300}-\u{1FAFF}]/u.test(SRC), "no em dashes or emoji in the module");
ok(SRC.includes("Paediatric"), "British spelling in mode labels");

/* ---- contrast (light and dark text pairs, WCAG AA 4.5) ---- */
function lum(hex) {
  const c = [1, 3, 5].map((i) => {
    let v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
ok(ratio("#EDF5F2", "#0D1D23") >= 4.5, "dark body text contrast AA");
ok(ratio("#42CDB5", "#0D1D23") >= 4.5, "dark accent timestamps contrast AA");
ok(ratio("#94B4AB", "#0D1D23") >= 4.5, "dark secondary text contrast AA");
ok(ratio("#0D1D23", "#FFFFFF") >= 4.5, "light body text contrast AA");
ok(ratio("#3E5A53", "#FFFFFF") >= 4.5, "light secondary text contrast AA");
ok(ratio("#071318", "#42CDB5") >= 4.5, "primary button text contrast AA");

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
