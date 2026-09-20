/* Ending a ward stay and requesting a follow-up: the buttons exist on a ward chart. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
function loadWard() {
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

test("a ward chart offers Discharge and Follow-up", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "chart", sel: { patientId: "p1", encounterId: "e1", name: "Ramesh Kumar", class: "IPD", admittedAt: "2026-09-10T08:00:00.000Z" } });
  assert.ok(html.includes('data-w-act="wardcloseopen"'), "a ward stay must be closable");
  assert.ok(html.includes('data-w-act="followup"'));
});

test("closing a stay as 'died' is refused from here - a death is recorded on its own screen first", () => {
  assert.match(src, /Record the death first on the Contacts screen/);
});

test("a follow-up requires a real date, because one with no date is never booked", () => {
  assert.match(src, /Give a date like 2026-10-01/);
});

/* ---- LT-17 / LT-30 / LT-32 (live test 2026-09-15) ---------------------------------------------------------- */
const fnBody = (name) => { const i = src.indexOf("function " + name + "("); return src.slice(i, src.indexOf("\n  }\n", i)); };

test("LT-17: Discharge and Follow-up are in-app forms: no browser prompt or confirm box is left in either flow", () => {
  for (const f of ["wardDischarge", "dischargeSubmit", "dischargeView", "followUpRequest", "followUpSubmit", "followUpView"]) {
    assert.ok(src.includes("function " + f + "("), f);
    assert.ok(!/\bprompt\(|\bconfirm\(/.test(fnBody(f)), f + " opens no native dialog");
  }
});

test("LT-17: the destination is a coded list, and each choice asks only for what it needs", () => {
  const W = loadWard();
  const sel = { patientId: "p1", encounterId: "e1", name: "Test Patient QA-01", mrn: "SMD-1" };
  const base = { ...W._st, view: "discharge", sel, dc: { encounterId: "e1", checklist: null, disposition: "", destination: "", note: "", billReason: "", overrideReason: "" } };
  const html = W._render(base);
  for (const v of ["home", "transferred", "left-against-advice", "died", "other"]) assert.ok(html.includes('<option value="' + v + '"'), v);
  assert.ok(!/data-w-dc="destination"/.test(html), "no free-text destination until transfer is picked");
  assert.match(html, /Loading\./, "an unloaded checklist is never shown as nothing open");
  assert.match(W._render({ ...base, dc: { ...base.dc, disposition: "transferred", destination: "City Cardiac" } }), /data-w-dc="destination" value="City Cardiac"/);
  assert.match(W._render({ ...base, dc: { ...base.dc, disposition: "other" } }), /data-w-dc="note"/);
  assert.match(W._render({ ...base, dc: { ...base.dc, disposition: "died" } }), /Record the death first on the Contacts screen/);
  assert.match(W._render({ ...base, dc: { ...base.dc, loadFailed: true } }), /could not be loaded\. Do not read this as nothing open\./);
});

test("LT-32: the checklist shows the bill, open orders and pending results; only a clinician is offered the override box", () => {
  const W = loadWard();
  const checklist = { bill: { state: "unbilled", balance: 0, unbilled: [], unpriced: [{ display: "Bed per day, GAS" }] }, openOrders: [{ kind: "medication", id: "rx1", drug: "Paracetamol 1 g", status: "active" }], pendingResults: [{ kind: "investigation", id: "sr1", display: "Chest X-ray PA view", status: "no result yet" }], unreadable: [] };
  const st = { ...W._st, view: "discharge", sel: { patientId: "p1", encounterId: "e1" }, dc: { encounterId: "e1", checklist, canOverride: false, disposition: "home", billReason: "Insurer settles", overrideReason: "" } };
  const nurse = W._render(st);
  assert.match(nurse, /Charges from this stay are not on a bill yet\./);
  assert.match(nurse, /Bed per day, GAS/);
  assert.match(nurse, /data-w-dc="billReason" value="Insurer settles"/, "a typed reason survives the repaint");
  assert.match(nurse, /Paracetamol 1 g/); assert.match(nurse, /Chest X-ray PA view/);
  assert.match(nurse, /Only a treating clinician can discharge with orders or results still open\./);
  assert.ok(!/data-w-dc="overrideReason"/.test(nurse));
  assert.match(W._render({ ...st, dc: { ...st.dc, canOverride: true, overrideReason: "Going home on it" } }), /data-w-dc="overrideReason">Going home on it<\/textarea>/);
});

test("LT-30: Raise invoice with nothing priced says so, names each charge with no price, and links to the Price list", () => {
  const W = loadWard();
  const cashier = { patientId: "p1", mrn: "SMD-1", invoices: [], raised: { ok: true, written: 0, skipped: "nothing_priced", unpriced: [{ display: "Complete blood count" }, { display: "Bed per day, GAS" }] } };
  const html = W._render({ ...W._st, view: "cashier", cashier });
  assert.match(html, /No invoice was raised: nothing from this patient's care has a price yet\./);
  assert.match(html, /<li>Complete blood count<\/li>/); assert.match(html, /<li>Bed per day, GAS<\/li>/);
  assert.match(html, /href="#\/admin\/tariff"/);
  assert.match(W._render({ ...W._st, view: "cashier", cashier: { ...cashier, raised: { ok: true, written: 1, invoiceId: "wsq-invoice-1" } } }), /Invoice raised: wsq-invoice-1/);
});
