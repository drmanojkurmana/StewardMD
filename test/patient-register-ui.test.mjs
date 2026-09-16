/* test/patient-register-ui.test.mjs — the shared OPD check-in sheet (window.SMD_PATIENTREG).
 *
 * ONE sheet is used by the phone app (queue.js) and the staff console (opd.html). Before it, the app
 * asked four sequential prompt() boxes and the console had a three-field sheet, and neither captured
 * gender, age or date of birth — which ABDM cannot work without.
 *
 * node --test test/patient-register-ui.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../patient-register.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../patient-register.css", import.meta.url), "utf8");
const QUEUE = readFileSync(new URL("../queue.js", import.meta.url), "utf8");
const CONSOLE_HTML = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
const INDEX = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// Load the IIFE with a minimal DOM stub — we only exercise the markup builders.
function load() {
  const win = { document: { getElementById: () => null, createElement: () => ({ id: "", className: "" }), body: { appendChild() {} } } };
  win.window = win;
  new Function("window", "module", SRC)(win, { exports: {} });
  return win.SMD_PATIENTREG;
}
const API = load();

test("the sheet captures every field ABDM needs, not just a name", () => {
  const h = API._sheetHtml({ mode: "native", clinicName: "Gastro OPD" });
  for (const id of ["pr_name", "pr_mobile", "pr_ageYears", "pr_ageMonths"]) {
    assert.ok(h.includes(id), "missing " + id);
  }
  assert.match(h, /data-seg="gender"/, "gender must be one tap, not free text");
  assert.match(h, /data-v="female"/);
  assert.match(h, /data-v="male"/);
  assert.match(h, /data-v="other"/);
  assert.match(h, /data-seg="visitType"/);
  assert.ok(h.includes("pr_abhaNumber") && h.includes("pr_abhaAddress"), "ABHA fields");
  assert.ok(h.includes("pr_pincode") && h.includes("pr_address"), "address for ABDM");
});

test("the four required fields are marked required, the rest are not", () => {
  const h = API._sheetHtml({ mode: "native" });
  const req = (h.match(/<i aria-hidden="true">\*<\/i>/g) || []).length;
  assert.equal(req, 4, "name, gender, age, mobile — and nothing else");
});

test("ABHA sits behind a disclosure so the desk stays fast", () => {
  const h = API._sheetHtml({ mode: "native" });
  assert.match(h, /data-a="more"[^>]*aria-expanded="false"/);
  assert.match(h, /id="prOpt" hidden/, "optional block starts collapsed");
});

test("SAFETY: ABHA consent is an explicit checkbox, never implied", () => {
  const h = API._sheetHtml({ mode: "native" });
  assert.match(h, /id="pr_abhaConsent"/);
  assert.match(h, /consents to linking/i);
});

test("a personal clinic is told the MR is automatic and is not asked for one", () => {
  const h = API._sheetHtml({ mode: "native" });
  assert.match(h, /assigned automatically/i);
  assert.equal(h.includes('id="pr_mrn"'), false, "never ask a clinic for an MR number - we issue it");
});

test("a hospital workplace IS asked for the hospital MR, and told it may be blank", () => {
  for (const mode of ["ghis", "connect"]) {
    const h = API._sheetHtml({ mode });
    assert.ok(h.includes('id="pr_mrn"'), mode + ": must accept the hospital's number");
    assert.match(h, /hospital EMR issues the MR/i, mode);
  }
});

test("a provisional id is shown with a warning; a real MR is not", () => {
  const prov = API._doneHtml({ mrn: "TMP-000001", pending: true, name: "Asha" });
  assert.match(prov, /TMP-000001/);
  assert.match(prov, /Temporary ID/);
  assert.match(prov, /do not write it on hospital records/i, "it must never be transcribed as a hospital MR");

  const real = API._doneHtml({ mrn: "SMD-CZWRWH-00001", pending: false, name: "Asha" });
  assert.match(real, /MR number/);
  assert.match(real, /Write this on the patient/i);
  assert.equal(/do not write it/i.test(real), false);
});

test("inputs are touch- and keyboard-friendly on a phone", () => {
  const h = API._sheetHtml({ mode: "native" });
  assert.match(h, /inputmode="numeric"/, "age + PIN open a number pad");
  assert.match(h, /inputmode="tel"/, "mobile opens a phone pad");
  assert.match(CSS, /min-height:\s*48px/, "48px touch targets");
  assert.match(CSS, /font:\s*400 16px/, "16px inputs stop iOS zooming on focus");
});

test("the sheet is accessible", () => {
  const h = API._sheetHtml({ mode: "native" });
  assert.match(h, /role="dialog"/);
  assert.match(h, /aria-modal="true"/);
  assert.match(h, /role="radiogroup"/);
  assert.match(h, /aria-checked=/);
  assert.match(h, /role="alert"/, "errors are announced");
  assert.match(CSS, /prefers-reduced-motion/);
  assert.match(CSS, /focus-visible/);
});

test("both hosts use the SAME sheet — that is the point", () => {
  assert.match(QUEUE, /SMD_PATIENTREG\.open/, "phone app");
  assert.match(CONSOLE_HTML, /SMD_PATIENTREG\.open/, "staff console");
  assert.match(INDEX, /patient-register\.js/, "app loads it");
  assert.match(CONSOLE_HTML, /patient-register\.js/, "console loads it");
});

test("REGRESSION: the app no longer registers patients through prompt() boxes", () => {
  const fn = QUEUE.slice(QUEUE.indexOf("function openAdd()"), QUEUE.indexOf("function openAdd()") + 1400);
  // a real call passes a string; the word also appears in the comment explaining what was removed
  assert.equal(/prompt\(\s*["']/.test(fn), false, "the prompt() chain must be gone");
  assert.match(fn, /workplaceMode/, "the workplace decides who issues the MR");
});

test("the sheet asks for a ZIP in a US org, a PIN in an Indian one - was hardcoded to India", () => {
  const us = API._sheetHtml({ mode: "native", region: "US" });
  assert.match(us, /ZIP code/);
  assert.ok(us.includes('maxlength="10"'), "must fit a ZIP+4 like 90210-1234");
  assert.equal(us.includes('maxlength="6"'), false);

  const india = API._sheetHtml({ mode: "native" });   // no region -> default IN, unchanged
  assert.match(india, /PIN code/);
  assert.ok(india.includes('maxlength="6"'));
  assert.equal(india.includes("ZIP code"), false);
});

test("the mobile field is labelled for a US org too, not a fixed Indian placeholder", () => {
  const us = API._sheetHtml({ mode: "native", region: "US" });
  assert.match(us, /Mobile number \(US\)/);
  const india = API._sheetHtml({ mode: "native" });
  assert.equal(india.includes("Mobile number (US)"), false);
  assert.match(india, /98765 43210/, "the Indian placeholder is unchanged");
});

test("REGRESSION: the local phone check no longer hardcodes India's 91/0-stripped 10-digit shape", () => {
  // That regex refused a valid "+14155550132" (11 digits, nothing to strip) even though the server
  // accepts it - the file's own comment says local checks are UX hints, not a second authority.
  assert.equal(/replace\(\/\^\(91\|0\)\//.test(SRC), false, "the India-only local mobile regex must be gone");
});

test("LT-29 (retest 2026-09-16): moving to another screen closes the sheet, so the added card never covers the ED board", () => {
  const listeners = {};
  const host = { className: "", innerHTML: "", querySelector: () => null, addEventListener() {}, onclick: null };
  const win = { document: { getElementById: () => host, createElement: () => host, body: { appendChild() {} } },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); } };
  win.window = win;
  new Function("window", "module", SRC)(win, { exports: {} });
  win.SMD_PATIENTREG.open({ mode: "native", submit: () => Promise.resolve({ ok: true }) });
  assert.equal(host.className, "on");
  win.SMD_PATIENTREG.open({ mode: "native", submit: () => Promise.resolve({ ok: true }) });   // "Add another"
  assert.equal((listeners.hashchange || []).length, 1, "one listener however often the sheet is reopened");
  listeners.hashchange[0]();
  assert.equal(host.className, ""); assert.equal(host.innerHTML, "", "the sheet is gone");
  assert.equal((listeners.hashchange || []).length, 0, "and stops listening");
});

test("LT-29: the Patients page registers; it does not say it queues", () => {
  const PAGE = readFileSync(new URL("../wardsynq/site/pages/patients.js", import.meta.url), "utf8");
  assert.match(PAGE, /submitLabel: T\(c, "site\.patients\.registerSubmit", "Register patient"\)/);
});

test("the client does not re-implement the server's validation rules", () => {
  // Local checks are UX hints; the authority is the server, whose field-keyed errors are rendered inline.
  // The ABHA number's check digit stays server-side (_opd_patient.js). The one checksum here is the AADHAAR number's,
  // which ABDM certification (CRT_ABHA_104) requires the desk to check BEFORE an OTP is requested, and it is never stored.
  assert.equal(/verhoeffOk|abhaNumber[^\n]*verhoeff/i.test(SRC), false, "ABHA checksum stays server-side, in one place");
  assert.match(SRC, /validAadhaar\(aad\)/, "the Aadhaar pre-check guards the OTP request");
  assert.match(SRC, /r\.errors/, "server errors are rendered per field");
  assert.match(SRC, /setErr\(/);
});
