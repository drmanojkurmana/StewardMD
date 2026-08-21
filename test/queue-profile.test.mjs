/* test/queue-profile.test.mjs — OPD Queue doctor-profile sheet + bigger top buttons.
 * The header avatar opens a profile sheet (name/dept/GHIS id/status + switch + sign out); sign-out moved
 * off the top bar into the profile. node --test test/queue-profile.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../queue.js", import.meta.url), "utf8");
function load() {
  const win = { localStorage: { getItem: () => null, setItem: () => {} }, addEventListener: () => {} };
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} }, style: {} }), body: { appendChild() {} }, addEventListener: () => {} };
  try { new Function("window", "document", "location", SRC)(win, doc, { search: "" }); } catch (e) {}
  return win.QUEUE;
}
const st = (extra) => Object.assign({ session: { doctorName: "Dr Asha", department: "General Medicine OPD", doctorStatus: "consulting" }, view: "dashboard", ghisToken: "t", ghisUser: "asha01", ghisDoctorName: "Dr Asha", me: {}, tickets: [] }, extra || {});

test("header avatar is a tappable profile button (signed in)", () => {
  const html = load()._render(st());
  assert.match(html, /q-avatar-btn/);
  assert.match(html, /data-q-act="docprofile"/);   // renamed from "profile" to avoid colliding with the EMR patient-profile action (profile:<id>)
});

// Regression: a PERSONAL-CLINIC doctor (no GHIS token) must still be able to open the profile sheet —
// it's the ONLY entry to the Clinic ID + staff-admin panel, which renders only for a personal clinic.
// (Previously the avatar was a tappable button only when state.ghisToken was set, so clinic doctors were
// locked out of their own staff management.)
test("clinic doctor (no GHIS) can still open the profile sheet", () => {
  const clinic = st({ ghisToken: null, ghisUser: "", ghisDoctorName: "", orgId: "org1" });
  const html = load()._render(clinic);
  assert.match(html, /q-avatar-btn/);
  assert.match(html, /data-q-act="docprofile"/);
});

test("clinic profile sheet renders the Clinic ID + staff admin", () => {
  const clinic = st({ ghisToken: null, ghisUser: "", ghisDoctorName: "", orgId: "org1", profileOpen: true,
    clinicAdmin: { code: "SMD-CLN001", members: [{ identity: "nurse1", role: "nurse", hasPin: true, active: true }] } });
  const html = load()._render(clinic);
  assert.match(html, /SMD-CLN001/);                 // Clinic ID shown
  assert.match(html, /data-q-act="addstaff"/);      // add-staff control present
  assert.match(html, /nurse1/);                     // existing staff listed
});

test("sign-out is moved OFF the top bar (declutter)", () => {
  const html = load()._render(st());
  assert.ok(!/q-iconbtn" data-q-act="logout"/.test(html), "no logout icon button in the top bar");
});

test("profile sheet shows identity + status + switch + sign out", () => {
  const html = load()._render(st({ profileOpen: true }));
  assert.match(html, /q-profile-top/);
  assert.match(html, /Dr Asha/);
  assert.match(html, /asha01/);            // GHIS id
  assert.match(html, /data-q-act="switch"/);
  assert.match(html, /Sign out of GHIS/);
  assert.match(html, /data-q-act="profile-close"/);
});

test("profile closed by default", () => {
  const html = load()._render(st());
  assert.ok(!/q-profile-top/.test(html));
});
