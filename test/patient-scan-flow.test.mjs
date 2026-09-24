/* One find-patient flow for every carrier (owner, 2026-09-24): a QR, a Ni-Key tag, a barcode or a typed
 * StewardID all go to the SERVER lookup the host passes as opts.resolve (GET /patient/resolve).
 *
 * Two bugs this pins. The sheet resolved only against the device's own store, so a card scanned on a
 * second device found nobody; and an unknown code was typed into the patient's NAME field, which is how
 * a chart named "SMP-4K7Q-2M9X7" starts.
 *
 * node --test test/patient-scan-flow.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../patient-register.js", import.meta.url), "utf8");

function sheet(resolve) {
  const fields = {};
  const field = (sel) => (fields[sel] = fields[sel] || { value: "", checked: false, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, click() { this.clicked = true; }, focus() {}, blur() {}, select() {}, setAttribute() {}, getAttribute: () => null, removeAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  const host = { className: "", innerHTML: "", addEventListener() {}, onclick: null,
    querySelector: (sel) => field(sel), querySelectorAll: () => [] };
  const toasts = [];
  const win = { document: { getElementById: () => host, createElement: () => host, body: { appendChild() {} } },
    addEventListener() {}, removeEventListener() {}, toast: (m) => toasts.push(m) };
  win.window = win;
  new Function("window", "module", SRC)(win, { exports: {} });
  win.SMD_PATIENTREG.open({ mode: "native", resolve, submit: () => Promise.resolve({ ok: true }) });
  const scan = async (typed) => {
    win.prompt = globalThis.prompt = () => typed;   // no camera here: the sheet asks for the code, as it does on a desktop
    const btn = { getAttribute: (k) => (k === "data-a" ? "scan-qr" : null) };
    host.onclick({ target: { closest: (s) => (s === "[data-a]" ? btn : null) } });
    await new Promise((r) => setTimeout(r, 0));
  };
  return { fields, toasts, scan };
}

const PATIENT = { name: "Asha Rao", mobile: "9876500001", ageYears: 41, gender: "female", mrn: "SMD-CLIN01-000042", stewardId: "SMP-4K7Q-2M9X7" };

test("a scanned or typed StewardID is looked up on the SERVER and fills the sheet", async () => {
  const asked = [];
  const s = sheet((id) => { asked.push(id); return Promise.resolve({ ok: true, stewardId: "SMP-4K7Q-2M9X7", patient: PATIENT }); });
  await s.scan("smp 4k7q 2m9x7");
  assert.equal(asked.length, 1, "the server was asked");
  assert.equal(s.fields["#pr_name"].value, "Asha Rao");
  assert.equal(s.fields["#pr_mobile"].value, "9876500001");
  assert.equal(s.fields['[data-f="mrn"] input'].value, "SMD-CLIN01-000042", "the patient's own MR number");
  assert.ok(s.fields['[data-f="visitType"] [data-v="followup"]'].clicked, "a returning patient is a follow-up");
});

test("an unknown, mistyped or revoked code says so and fills NOTHING - never the name field", async () => {
  for (const answer of [
    { ok: false, error: "not_found", message: "No patient with this StewardID at this hospital." },
    { ok: false, error: "not_a_steward_id", message: "That is not a valid StewardID." },
    { ok: false, error: "revoked", message: "This card was reported lost or replaced." },
  ]) {
    const s = sheet(() => Promise.resolve(answer));
    await s.scan("SMP-4K7Q-2M9X8");
    assert.equal((s.fields["#pr_name"] || { value: "" }).value, "", answer.error + ": the name is untouched");
    assert.equal((s.fields['[data-f="mrn"] input'] || { value: "" }).value, "", answer.error + ": no MR number is guessed");
    assert.ok(s.toasts.some((t) => t === answer.message), answer.error + ": the server's own sentence is shown");
  }
});
