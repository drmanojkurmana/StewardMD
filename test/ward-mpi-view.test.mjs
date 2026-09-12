/* Duplicate records, rendered for real. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sandbox = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  return sandbox.window.WARD;
}

const SEL = { patientId: "p1", name: "Ramesh Kumar" };
const CAND = { patientId: "p2", name: "Ramesh Kumaar", mrn: "M2", dob: "1970-01-01", sex: "male", score: 0.91, band: "probable", agreed: ["dob", "sex"], disagreed: ["name"] };
const view = (W, d, extra) => W._render({ ...W._st, view: "mpi", mpi: d, ...extra });

test("a candidate shows which fields agreed and which disagreed, not just a score", () => {
  const W = loadWard();
  const html = view(W, { ok: true, candidates: [CAND], comparedAgainst: 40 }, { sel: SEL });
  assert.ok(html.includes("Ramesh Kumaar"));
  assert.match(html, /agreed: dob, sex/);
  assert.match(html, /disagreed: name/);
  assert.ok(html.includes('data-w-act="mpimerge:p1~p2"'));
  assert.ok(html.includes('data-w-act="mpiunmerge:p1~p2"'));
});

test("A PARTIAL SEARCH IS STATED ABOVE THE RESULTS, and an empty partial result is not 'no duplicate'", () => {
  const W = loadWard();
  const warn = "This compared against 500 patient records, which is the cap. The search was PARTIAL and an empty result does not mean this patient is new.";
  const html = view(W, { ok: true, candidates: [], partial: true, comparedAgainst: 500, partialWarning: warn }, { sel: SEL });
  assert.match(html, /search was PARTIAL/);
  assert.match(html, /not proof of a new patient/);
  assert.ok(!html.includes("No other record looks like this one"), "a partial search must never read as a clean result");
});

test("a complete search with nothing found says how many records it checked", () => {
  const W = loadWard();
  const html = view(W, { ok: true, candidates: [], partial: false, comparedAgainst: 40 }, { sel: SEL });
  assert.match(html, /No other record looks like this one. Checked 40 records/);
});

test("the screen says a match is a suggestion and nothing is joined without a person", () => {
  const W = loadWard();
  const html = view(W, null, { sel: SEL });
  assert.match(html, /A match is a suggestion/);
});

test("with no patient open it offers a search by name and date of birth, and no merge buttons", () => {
  const W = loadWard();
  const html = view(W, { ok: true, candidates: [CAND], comparedAgainst: 40 }, { sel: null });
  assert.ok(html.includes('id="wMpiName"'));
  assert.ok(html.includes('id="wMpiDob"'));
  assert.ok(!html.includes('data-w-act="mpimerge:'), "nothing to merge into without a subject");
});
