/* Regressions from a bulk "36 bugs" change: screens that claimed writes that never happened, or showed
 * clinical facts nobody recorded. Each test pins the honest behaviour. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SRC = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");

function loadWard(fetchImpl) {
  const posts = [];
  const sandbox = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: fetchImpl || ((url, init) => { posts.push({ url, body: init && init.body }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }); }),
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(SRC, sandbox);
  return { W: sandbox.window.WARD, posts };
}

test("AN UNIDENTIFIED WOMAN IS NOT LABELLED MALE: sex comes from the record, never guessed from the MRN", () => {
  const { W } = loadWard();
  const html = W._render({ ...W._st, view: "chart", sel: { class: "ED", mrn: "TRAUMA-UNKNOWN-FEMALE-0001", patientId: "p1", encounterId: "e1" } });
  assert.ok(!/<b>MALE<\/b>/.test(html), "the MRN guess read FEMALE as MALE");
  const ed = W._render({ ...W._st, view: "ed", ed: { patients: [{ encounterId: "e1", mrn: "TRAUMA-UNKNOWN-FEMALE-0001" }] } });
  assert.ok(!/<b>MALE<\/b>/.test(ed));
});

test("no screen posts to a route the server does not have", () => {
  assert.ok(!SRC.includes("/ward/timeline-note"), "timeline-note does not exist on the server; saves there were reported as recorded");
});

test("no browser-only bed add/remove, blood-bank value guessing, or fake QR/imaging/scheme screens", () => {
  for (const gone of ["bedadd", "bedremove", "Auto-detected from latest patient records", "Secret verification token",
    "No acute bone fracture", "schemesearch", "acknext", "maitriFollowCare"]) {
    assert.ok(!SRC.includes(gone), `${gone} is back`);
  }
});

test("AN ANGIOGRAM NEVER CALLS A BLANK VESSEL NORMAL, and is only reported saved when the server wrote it", () => {
  assert.ok(!/\|\| "Normal"\)/.test(SRC), "a blank vessel must not default to Normal");
  assert.match(SRC, /function cardioNote[\s\S]{0,400}\/ward\/note[\s\S]{0,200}r\.written/);
});

test("an instruction note does not claim anyone was notified", () => {
  assert.ok(!SRC.includes("Instruction sent to team."));
  assert.ok(!SRC.includes("requires acknowledgement"));
  assert.match(SRC, /No one is notified by this/);
});

test("the trauma checkbox is actually sent with an unidentified arrival", () => {
  assert.match(SRC, /unknown: \{ sex: sex, isTrauma: checked\("wEdIsTrauma"\) \}/);
});

test("oncology protocol buttons do not invent a protocol version", () => {
  assert.ok(!/version: "20\d\d\.\d"/.test(SRC));
});
