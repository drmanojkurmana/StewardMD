/* The safety inbox, rendered for real.
 *
 * The assertions that matter most are about INCOMPLETENESS: a safety inbox that quietly drops the
 * patients it could not read, or stops at a cap without saying so, reads as a quiet ward - which is
 * worse than having no safety inbox at all. */
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

const ITEM = {
  type: "critical-result",
  detail: "Potassium 6.9 mmol/L — nobody has acknowledged this yet",
  since: "2026-09-13T09:00:00.000Z",
  escalation: { level: "escalate", hoursOpen: 3 },
  sourceRef: { loopId: "loop1" },
  patient: { patientId: "p1", name: "Ramesh Kumar", mrn: "M1", ward: "Ward A", bed: "3" },
};
const inbox = (extra) => ({ ok: true, items: [ITEM], escalated: 1, overdue: 0, totalOnWard: 1, scanned: 12, ...extra });
const view = (W, d, extra) => W._render({ ...W._st, view: "safetyinbox", inbox: d, ...extra });

test("a row names the patient, the bed, what is wrong and how long", () => {
  const W = loadWard();
  const html = view(W, inbox());
  assert.ok(html.includes("Ramesh Kumar"));
  assert.ok(html.includes("bed 3"));
  assert.ok(html.includes("Potassium 6.9 mmol/L"));
  assert.ok(html.includes("3h"));
  assert.match(html, /needs somebody now/);
});

test("a row leads to the action, not just to a display", () => {
  const W = loadWard();
  const html = view(W, inbox());
  assert.ok(html.includes('data-w-act="ackboard:loop1"'), "a critical result must be acknowledgeable from here");
  assert.ok(html.includes('data-w-act="inboxopen:p1"'), "and the patient must be one click away");
});

test("A TRUNCATED LIST SAYS SO, above the list, in words", () => {
  const W = loadWard();
  const html = view(W, inbox({ truncated: true, warning: "Only the first 60 patients were checked. This list is incomplete - do not read it as a quiet ward." }));
  assert.match(html, /do not read it as a quiet ward/);
  assert.ok(html.indexOf("do not read it as a quiet ward") < html.indexOf("Ramesh Kumar"), "the warning must come before the list");
});

test("PATIENTS WHO COULD NOT BE CHECKED ARE NAMED", () => {
  const W = loadWard();
  const html = view(W, inbox({ failed: [{ patientId: "p9", name: "Sita Devi", what: "critical results" }], warning: "1 patient could not be checked. This list is incomplete - do not read it as a quiet ward." }));
  assert.ok(html.includes("Sita Devi"));
  assert.ok(html.includes("critical results"));
});

test("an EMPTY but INCOMPLETE list never says 'nothing outstanding'", () => {
  const W = loadWard();
  const html = view(W, { ok: true, items: [], escalated: 0, overdue: 0, totalOnWard: 0, scanned: 60, truncated: true, warning: "Only the first 60 patients were checked. This list is incomplete - do not read it as a quiet ward." });
  assert.match(html, /the check was incomplete/);
  assert.ok(!html.includes("Nothing outstanding for this role."), "an incomplete check must never read as all-clear");
});

test("an empty and COMPLETE list is allowed to say nothing is outstanding", () => {
  const W = loadWard();
  const html = view(W, { ok: true, items: [], escalated: 0, overdue: 0, totalOnWard: 0, scanned: 12 });
  assert.match(html, /Nothing outstanding for this role/);
  assert.ok(!html.includes("incomplete"));
});

test("a role sees its own count and the ward's, so a quiet inbox is not mistaken for a quiet ward", () => {
  const W = loadWard();
  const html = view(W, { ok: true, items: [], escalated: 0, overdue: 0, totalOnWard: 7, scanned: 12 });
  assert.ok(html.includes("7 outstanding on the ward"));
});

test("the role filters are offered and the active one is marked", () => {
  const W = loadWard();
  const html = view(W, inbox(), { inboxRole: "nurse" });
  assert.ok(html.includes('data-w-act="inboxrole:doctor"'));
  assert.ok(html.includes('data-w-act="inboxrole:all"'));
  assert.match(html, /class="w-tl-f on" data-w-act="inboxrole:nurse"/);
});

test("a hospital with no rules configured is told why the list is thin", () => {
  const W = loadWard();
  const html = view(W, inbox({ note: "This hospital has configured no chart-completion rules, so only critical results are listed." }));
  assert.match(html, /no chart-completion rules/);
});

test("a list that has not loaded says loading rather than nothing outstanding", () => {
  const W = loadWard();
  const html = view(W, null);
  assert.match(html, /Loading/);
  assert.ok(!html.includes("Nothing outstanding"));
});
