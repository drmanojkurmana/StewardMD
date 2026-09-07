/* test/ward-ui.test.mjs — the WardSynQ inpatient ward screen (ward.js). Pure _render, no DOM/network.
 *
 * The tests that matter here are the three rules the screen must not bend: it never decides a dose
 * is safe, it renders a refusal verbatim, and it never invents a due time.
 *
 * node --test test/ward-ui.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
function load() {
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  return win.WARD;
}
const base = {
  orgId: "org-wsq", ward: "", patients: [], view: "list", sel: null,
  problems: [], due: [], dueAt: "", busy: false, err: "", note: "", refusal: null, loaded: true,
};
const chart = Object.assign({}, base, {
  view: "chart",
  sel: { encounterId: "wsq-adm-x", patientId: "opd-pat-x", ward: "Ward A", bed: "12", admittedAt: "2026-09-07T04:00:00.000Z" },
});

test("the ward list shows a bed per admitted patient and says so plainly when empty", () => {
  const W = load();
  const empty = W._render(base);
  assert.match(empty, /No patients are currently admitted/);
  assert.ok(!empty.includes("data-w-act=\"open:"), "nothing to open");

  const full = W._render(Object.assign({}, base, {
    patients: [{ encounterId: "wsq-adm-1", patientId: "opd-pat-1", ward: "Ward A", bed: "07", admittedAt: "2026-09-07T04:00:00.000Z" }],
  }));
  assert.match(full, /data-w-act="open:wsq-adm-1"/);
  assert.match(full, />07</);
  assert.match(full, /Ward A/);
});

test("A REFUSAL IS RENDERED VERBATIM: every reason code reaches the nurse, none are collapsed", () => {
  const html = load()._render(Object.assign({}, chart, {
    refusal: { action: "administer", reasons: ["ALLERGY_CONTRAINDICATION", "DOSE_CEILING_EXCEEDED"], detail: "The order exceeds the daily ceiling." },
  }));
  assert.match(html, /ALLERGY_CONTRAINDICATION/);
  assert.match(html, /DOSE_CEILING_EXCEEDED/);
  assert.match(html, /The order exceeds the daily ceiling\./);
  assert.match(html, /Refused on administer/);
  assert.ok(!/\bfailed\b/i.test(html), "a refusal is never flattened into a generic failure");
});

test("a governance refusal keeps its reason codes too, and an ordinary error does not masquerade as one", () => {
  const W = load();
  assert.deepEqual(W._problem({ ok: false, error: "governance", reasons: ["WRITE_NOT_PERMITTED"] }).refusal.reasons, ["WRITE_NOT_PERMITTED"]);
  // The server's own message is shown, because "only available for a WardSynQ-native hospital" is
  // actionable and "something went wrong" is not.
  assert.equal(W._problem({ ok: false, error: "not_a_wardsynq_hospital", message: "The inpatient ward is only available for a WardSynQ-native hospital." }).err,
    "The inpatient ward is only available for a WardSynQ-native hospital.");
  assert.equal(W._problem({ ok: true }), null);
  assert.match(W._problem(null).err, /No response/);
});

test("IT NEVER INVENTS A DUE TIME: the round time is empty until chosen, and the screen says it is the nurse's choice", () => {
  const html = load()._render(chart);
  assert.match(html, /id="wDueAt" type="datetime-local" value=""/, "no defaulted round time");
  assert.match(html, /This round time is the one you chose/);
  assert.match(html, /does not yet compute a schedule/);
});

test("the MAR offers only the transitions the state machine accepts, and nothing after a dose is given", () => {
  const W = load();
  assert.deepEqual(W._nextFor(null), ["verify"], "an unstarted dose can only be verified");
  assert.deepEqual(W._nextFor("ADMINISTERED"), [], "a given dose has nowhere left to go");
  assert.deepEqual(W._nextFor("REFUSED"), []);
  assert.ok(W._nextFor("DISPENSED").includes("scan"));
  assert.ok(!W._nextFor("DISPENSED").includes("administer"), "administering skips the scan; the five rights are checked on a scan");

  const html = W._render(Object.assign({}, chart, {
    dueAt: "2026-09-07T09:00",
    due: [
      { orderId: "rx-1", drug: "Paracetamol", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TDS", status: "DISPENSED", administrationId: "mar-1" },
      { orderId: "rx-2", drug: "Amoxicillin", dose: { value: 250, unit: "mg" }, status: "ADMINISTERED", administeredAt: "2026-09-07T09:05:00.000Z" },
    ],
  }));
  assert.match(html, /data-w-act="mar:scan\|rx-1"/);
  assert.ok(!html.includes('data-w-act="mar:administer|rx-1"'), "no administer button before the scan");
  assert.ok(!html.includes("|rx-2"), "a given dose offers no action at all");
  assert.match(html, /No further action\./);
  assert.match(html, /500 mg/);
});

test("IT NEVER DECIDES A DOSE IS SAFE: there is no client-side safety rule anywhere in the file", () => {
  // A second copy of the rules is how the screen and the server start disagreeing about whether a
  // drug is contraindicated. This asserts the absence, because the absence IS the safety property.
  // Comments are stripped first: the file explains at length why it has no safety logic, and
  // scanning the prose would fail on the very sentences that promise the code is not there.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.ok(!/allerg|interaction|contraindicat|maxdose|ceiling|cross.?react/i.test(code), "no clinical rule logic in the UI");
  assert.ok(!/wardsynq-safety|SafetyEngine|resolveGeneric|rulePack/i.test(code), "the UI does not reach for the safety engine");
  // It must not decide the five rights itself either: the scans go to the server untouched, and the
  // server compares them against the order. The UI only collects and forwards.
  assert.ok(!/scan\.patient\s*[=!]==|scan\.drug\s*[=!]==/.test(code), "the UI never compares a scan itself");
  assert.match(code, /body\.scan = \{ patient: val\("wScanP"\), drug: val\("wScanD"\) \}/, "scans are forwarded verbatim");
});

test("the problem list is read-only on the ward screen: a nurse sees the diagnosis, she does not assert one", () => {
  const html = load()._render(Object.assign({}, chart, {
    problems: [{ problemId: "p1", display: "Pneumonia", code: "J18.9", codeSystem: "ICD-10", verificationStatus: "confirmed", clinicalStatus: "active" }],
  }));
  assert.match(html, /Pneumonia/);
  assert.match(html, /J18\.9/);
  assert.match(html, /confirmed/);
  assert.ok(!/data-w-act="problem/.test(html), "no way to add a diagnosis from the ward screen");
  const none = load()._render(chart);
  assert.match(none, /A diagnosis is entered by the treating doctor\./);
});

test("vitals: every field the record path accepts is on the form, and blanks are not defaulted", () => {
  const html = load()._render(chart);
  for (const k of ["sbp", "dbp", "pulse", "rr", "temp", "spo2", "weight"]) {
    assert.match(html, new RegExp(`id="wv_${k}"`), `${k} is missing from the ward vitals form`);
  }
  assert.match(html, /Blank fields are not recorded/);
  assert.match(html, /never guessed at/);
});

test("HTML is escaped: a hostile ward or drug name cannot inject markup", () => {
  const html = load()._render(Object.assign({}, base, {
    patients: [{ encounterId: "<img src=x onerror=alert(1)>", patientId: "p&p", ward: '"><script>bad()</script>', bed: "1" }],
  }));
  assert.ok(!html.includes("<script>bad()"), "script tag escaped");
  // The payload's TEXT survives - that is correct, it is being displayed. What must not survive is
  // any character that could end an attribute or open a tag, so it can never stop being text.
  assert.ok(!html.includes("<img"), "tag never opens");
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, "rendered as inert text");
  assert.ok(!/value="[^"]*"[^>]*<script/.test(html), "the quoted attribute is never broken out of");
  assert.match(html, /p&amp;p/);
});
