/* test/wardsynq-opd-render.test.mjs — the view, tested without a browser.
 *
 * A minimal DOM stub rather than a headless browser, because what is being tested is that the view
 * asks other modules every question with a clinical answer, holds no state of its own, and records
 * a read when somebody opens a value. None of that needs a rendering engine.
 *
 * node --test test/wardsynq-opd-render.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { render, attach, esc } from "../wardsynq/ui/opd-render.js";
import { BedsideSession } from "../wardsynq/ui/opd-emr.js";
import { ReadLog, READ_KIND } from "../wardsynq/wardsynq-readlog.js";
import { GovernedStore, makeActor, KIND, TIER } from "../wardsynq/wardsynq-actors.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq/wardsynq-store.js";
import { Patient } from "../wardsynq/wardsynq-model.js";

const NOW = "2026-09-04T09:00:00.000Z";

/** The smallest DOM that the renderer actually touches. */
function makeDoc() {
  const nodes = new Map();
  const listeners = new Map();
  const mk = (id) => {
    const el = {
      id, textContent: "", innerHTML: "", hidden: false, disabled: false, value: "",
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] ?? null; },
      _l: new Map(),
      addEventListener(t, fn) { this._l.set(t, fn); },
      removeEventListener(t) { this._l.delete(t); },
      closest() { return this; },
    };
    nodes.set(id, el);
    return el;
  };
  for (const id of ["header", "patient-name", "patient-ids", "patient-band", "offline",
    "held-count", "refusals", "due", "administer", "observations", "hold", "wristband", "identity-state"]) mk(id);

  return {
    getElementById: (id) => nodes.get(id) || null,
    addEventListener: (t, fn) => listeners.set(t, fn),
    removeEventListener: (t) => listeners.delete(t),
    _fire: (t, ev) => { const fn = listeners.get(t); if (fn) fn(ev); },
    _el: (id) => nodes.get(id),
  };
}

async function setup() {
  const raw = new ClinicalStore({ backend: new MemoryBackend() });
  const governed = new GovernedStore({ store: raw });
  const nurse = makeActor({ id: "nurse-7", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "RN-1" });
  const session = new BedsideSession({ store: governed, actor: nurse, now: () => NOW });
  session.open(Patient({ id: "pat-1", mrn: "MRN-1", name: "Test Patient", dob: "1960-01-01", wristbandBarcode: "WB-1" }));
  return { session, doc: makeDoc(), readLog: new ReadLog({ now: () => NOW }) };
}

/* ------------------------------------------------------------------ the screen follows the system */

test("the header reflects whether identity is confirmed, and starts unconfirmed", async () => {
  const { session, doc } = await setup();
  render({ session, doc });
  assert.equal(doc._el("header").getAttribute("data-identity"), "unconfirmed");
  assert.equal(doc._el("patient-name").textContent, "Test Patient");

  session.confirmIdentity("WB-1");
  render({ session, doc });
  assert.equal(doc._el("header").getAttribute("data-identity"), "confirmed");
});

test("ADVERSARIAL: the screen cannot disagree with the system about which patient is open", async () => {
  const { session, doc } = await setup();
  session.confirmIdentity("WB-1");
  render({ session, doc });
  assert.equal(doc._el("header").getAttribute("data-identity"), "confirmed");

  session.open(Patient({ id: "pat-2", mrn: "MRN-2", name: "Other Patient", dob: "1970-01-01", wristbandBarcode: "WB-2" }));
  render({ session, doc });
  assert.equal(doc._el("patient-name").textContent, "Other Patient");
  assert.equal(doc._el("header").getAttribute("data-identity"), "unconfirmed",
    "the view is a pure function of session.state(), so it cannot keep showing a confirmation the system revoked");
});

test("ADVERSARIAL: the identifiers are set as TEXT, never as markup", async () => {
  const { session, doc } = await setup();
  session.open(Patient({ id: "p", mrn: "<script>alert(1)</script>", name: "X", dob: "1960-01-01" }));
  render({ session, doc });
  assert.equal(doc._el("patient-ids").textContent, "<script>alert(1)</script>",
    "textContent, so a patient identifier is data rather than markup");
  assert.equal(esc('<b>"x"</b>'), "&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
});

test("buttons reflect state, and the ACTION refuses independently", async () => {
  const { session, doc } = await setup();
  render({ session, doc });
  assert.equal(doc._el("administer").disabled, true);

  session.confirmIdentity("WB-1");
  render({ session, doc });
  assert.equal(doc._el("administer").disabled, false);

  // And the underlying refusal does not depend on the attribute: opd-emr refuses on its own.
  session.open(session.patient);            // revokes confirmation
  const r = await session.recordObservation({ resourceType: "Observation", patientId: "pat-1", code: "x" });
  assert.equal(r.ok, false, "the disabled attribute is a courtesy to the person, not a control");
});

/* ------------------------------------------------------------------ refusals */

test("a refusal is rendered with EVERY reason, not the first", async () => {
  const { session, doc } = await setup();
  session.refusals.push({ code: "FIVE_RIGHTS", message: "5-rights check failed", reasons: [
    { code: "FIVE_RIGHTS_PATIENT", message: "no wristband scanned" },
    { code: "FIVE_RIGHTS_DRUG", message: "no unit-dose barcode scanned" },
  ] });
  render({ session, doc });
  const html = doc._el("refusals").innerHTML;
  assert.match(html, /no wristband scanned/);
  assert.match(html, /no unit-dose barcode scanned/);
  assert.match(html, /I have read this/, "it stays until acknowledged rather than fading");
});

test("acknowledging a refusal clears it and redraws", async () => {
  const { session, doc, readLog } = await setup();
  session.refusals.push({ code: "X", message: "blocked", reasons: [] });
  const detach = attach({ session, doc, readLog, rows: [] });

  doc._fire("click", { target: { closest: () => ({ getAttribute: (k) => (k === "data-action" ? "ack-refusal" : "0") }) } });
  assert.equal(session.state().refusals.length, 0);
  detach();
});

/* ------------------------------------------------------------------ ADVERSARIAL: colour is never alone */

test("ADVERSARIAL: a signalled row always renders its WORD, and an accessible label", async () => {
  const { session, doc } = await setup();
  render({ session, doc, rows: [{ signal: "stop", label: "Potassium", value: 6.4, unit: "mmol/L", valueId: "k" }] });
  const html = doc._el("due").innerHTML;
  assert.match(html, /class="signal-word">STOP</);
  assert.match(html, /aria-label="STOP: Potassium"/, "a screen reader gets the significance, not just the colour");
});

test("a zero renders rather than vanishing", async () => {
  const { session, doc } = await setup();
  render({ session, doc, rows: [{ label: "Urine output", value: 0, unit: "mL/h" }] });
  assert.match(doc._el("due").innerHTML, /class="value">0</, "0 mL/h is the important one");
});

/* ------------------------------------------------------------------ THE POINT: the read log */

test("ADVERSARIAL: opening a value RECORDS a read, which is what lets a correction find the reader", async () => {
  const { session, doc, readLog } = await setup();
  const rows = [{ valueId: "balance-0-6", version: 1, label: "0 to 6 hour balance", value: -320, unit: "mL" }];
  const detach = attach({ session, doc, readLog, rows });

  doc._fire("click", {
    target: {
      closest: () => ({
        getAttribute: (k) => (k === "data-action" ? "open-row" : k === "data-row" ? "0" : null),
      }),
    },
  });

  const reads = readLog.forPerson("nurse-7");
  assert.equal(reads.length, 1, "this is the gap HAZ-FLUID-01 named: nothing was calling readLog.record()");
  assert.equal(reads[0].valueId, "balance-0-6");
  assert.equal(reads[0].version, 1);
  assert.equal(reads[0].value, -320);
  assert.equal(reads[0].kind, READ_KIND.OPENED);
  assert.equal(reads[0].patientId, "pat-1");
  detach();
});

test("ADVERSARIAL: merely rendering rows records NOTHING", async () => {
  const { session, doc, readLog } = await setup();
  render({ session, doc, readLog, rows: [
    { valueId: "a", label: "A", value: 1 }, { valueId: "b", label: "B", value: 2 }, { valueId: "c", label: "C", value: 3 },
  ] });
  assert.equal(readLog.entries.length, 0,
    "logging every number painted produces a list nobody can act on and buries the three that mattered");
});

test("a row with no valueId is not logged, because there is nothing to correct later", async () => {
  const { session, doc, readLog } = await setup();
  const detach = attach({ session, doc, readLog, rows: [{ label: "Note", value: "seen" }] });
  doc._fire("click", { target: { closest: () => ({ getAttribute: (k) => (k === "data-action" ? "open-row" : "0") }) } });
  assert.equal(readLog.entries.length, 0);
  detach();
});

/* ------------------------------------------------------------------ the scan */

test("the wristband field confirms identity through the session, not the view", async () => {
  const { session, doc, readLog } = await setup();
  const detach = attach({ session, doc, readLog, rows: [] });

  doc._el("wristband").value = "WB-9";
  doc._el("wristband")._l.get("keydown")({ key: "Enter" });
  assert.equal(doc._el("identity-state").getAttribute("data-ok"), "false");
  assert.match(doc._el("identity-state").textContent, /wrong chart is open or you are at the wrong patient/);

  doc._el("wristband").value = "WB-1";
  doc._el("wristband")._l.get("keydown")({ key: "Enter" });
  assert.equal(doc._el("identity-state").getAttribute("data-ok"), "true");
  assert.equal(doc._el("wristband").value, "", "the field clears so the next scan is not appended to the last");
  detach();
});

test("offline is stated plainly and the held count is shown", async () => {
  const raw = new ClinicalStore({ backend: new MemoryBackend() });
  const session = new BedsideSession({
    store: new GovernedStore({ store: raw }),
    actor: makeActor({ id: "n", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "RN" }),
    now: () => NOW, online: () => false,
  });
  session.open(Patient({ id: "p", mrn: "M", name: "N", dob: "1960-01-01", wristbandBarcode: "W" }));
  const doc = makeDoc();
  render({ session, doc });
  assert.equal(doc._el("offline").hidden, false);
  assert.equal(doc._el("held-count").textContent, "0");
});

test("attach returns a detach, so handlers do not leak across patient switches", async () => {
  const { session, doc, readLog } = await setup();
  const detach = attach({ session, doc, readLog, rows: [] });
  assert.equal(typeof detach, "function");
  detach();
  assert.throws(() => render({ session: null, doc }), TypeError);
});
