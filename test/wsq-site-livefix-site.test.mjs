/* test/wsq-site-livefix-site.test.mjs - wardsynq.com site pages fixed after the live test of 2026-09-15.
 *
 *   LT-36  the rota never shows a mobile number (or an account id) as a staff member's name
 *   LT-40  a failed Ask MaiK says why (not set up here / not answering), never a bare "bad_response"
 *
 * node --test test/wsq-site-livefix-site.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const sb = { window: { WSQ: { page() {} } } };
vm.createContext(sb);
vm.runInContext(read("wardsynq/site/pages/rota.js"), sb);
vm.runInContext(read("wardsynq/site/pages/maik.js"), sb);
const W = sb.window.WSQ;
const C = { esc, state: { who: {} } };

test("LT-36 rota: a mobile number or account id reads Name not set with the role; a chosen staff ID stays", () => {
  const duty = { ok: true, partial: false, wards: [{ ward: "Medical A", people: [{ identity: "nurse.asha@hosp.example", role: "nurse", via: "rota" }] }],
    off: [{ identity: "8897298117", role: "doctor", until: "2026-09-16T02:02:00.000Z" }, { identity: "fb:DcGIzIXwxURU0G9L4J5jehluENl1", role: "consultant", until: "2026-09-16T02:02:00.000Z" }] };
  const html = W._rota.dutyWardsHtml(C, duty);
  assert.ok(!html.includes("8897298117"), "the mobile number is not on screen");
  assert.ok(!html.includes("DcGIzIXwxURU0G9L4J5jehluENl1"), "the account id is not on screen");
  assert.match(html, /Name not set, doctor: off duty until/);
  assert.match(html, /Name not set, consultant/);
  assert.match(html, /nurse\.asha@hosp\.example, nurse: rota/);
  const onDuty = W._rota.dutyHtml(C, { ok: true, onDuty: [{ identity: "+91 98765 43210", shift: "Day", unit: "Medical A" }] });
  assert.ok(!onDuty.includes("98765"), onDuty);
  const pending = W._rota.pendingHtml(C, { ok: true, leave: [{ id: "l1", identity: "9876543210", from: "2026-09-20", to: "2026-09-21", reason: "Family" }] }, { ok: true, swaps: [{ id: "s1", date: "d", from: "9876543210", to: "n2", status: "accepted" }] });
  assert.ok(!pending.includes("9876543210"), pending);
});

test("LT-40 MaiK: not set up, not answering and refused each say so in words, with the server's reason under it", () => {
  const f = W._maikAskFailure;
  const notSetUp = f(C, { ok: false, error: "no_phi_approved_model", notConfigured: true, detail: "this request carries patient data and this hospital has approved no model provider" });
  assert.match(notSetUp, /MaiK is not set up for this hospital/);
  assert.match(notSetUp, /approved no model provider/);
  assert.match(f(C, { ok: false, error: "maik_disabled" }), /not set up for this hospital/);
  // The shell's api() answer when the body was not JSON (Cloudflare's own 502 page).
  const html502 = f(C, { ok: false, error: "bad_response", status: 502 });
  assert.match(html502, /MaiK did not answer: the AI service is not reachable right now\. Nothing was written\./);
  assert.ok(!/bad_response/.test(html502), "never the bare code");
  assert.match(f(C, { ok: false, error: "model_unavailable", detail: "vertex-flash could not answer: timeout. Nothing was written." }), /did not answer[\s\S]*vertex-flash could not answer/);
  assert.match(f(C, { ok: false, error: "network" }), /did not answer/);
  assert.match(f(C, null), /MaiK could not be reached/);
  assert.match(f(C, { ok: false, error: "patient_required", detail: "a MaiK request is always about one identified patient" }), /MaiK could not answer this request\.[\s\S]*one identified patient/);
  assert.ok(!f(C, { ok: false, error: "x", detail: "<img src=x>" }).includes("<img"), "the server's text is escaped");
});

test("LT-40 MaiK patient picker: no internal record id under each name", () => {
  assert.ok(!/quiet mono\\">" \+ EN\(c, esc\(p\.patientId\)\)/.test(read("wardsynq/site/pages/maik.js")));
});
