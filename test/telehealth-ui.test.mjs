/* Video visits on the staff screens: the scheduling form in ward.js and the Admin > Hospital "Video visits" card.
 *
 * What these defend:
 *   - the booking form offers a video visit only when the diary says video is on, and asks who agreed,
 *   - a video appointment carries a "Video" chip and who agreed, in the diary,
 *   - the admin card reads and saves /org/telehealth-settings with a reason, turns video off with "",
 *     warns about a public video server, names the server's refusal, and never reads a failed load as off,
 *   - every new word is translated (a fake catalog marks each translated string).
 * The browser half (ticking the box, sending the consent, the arrival note) is test/run-ward-telehealth-ui.mjs.
 *
 * node --test test/telehealth-ui.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

function loadWard() {
  const sandbox = { navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} }, fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true }) }), setTimeout, clearTimeout, console, Promise, Date };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(read("ward.js"), sandbox);
  return sandbox.window.WARD;
}
const APPT = { appointmentId: "apt-1", patientId: "pat-1", clinicianId: "dr:1", startAt: "2026-09-26T04:30:00.000Z", minutes: 15, state: "booked" };

test("scheduling: no video box while video is off; the box, then who agreed and the consent box, when on", () => {
  const W = loadWard();
  const view = (sc) => W._render({ ...W._st, view: "scheduling", scheduling: sc, intake: null });
  const off = view({ diary: { ok: true, telehealth: false, appointments: [APPT] } });
  assert.doesNotMatch(off, /id="wSchedTele"/);
  const on = view({ diary: { ok: true, telehealth: true, appointments: [APPT] } });
  assert.match(on, /<label class="w-chk" style="min-height:44px"><input type="checkbox" id="wSchedTele">/);
  assert.match(on, /Video visit/);
  assert.doesNotMatch(on, /wSchedTeleGiver|wSchedTeleAgreed/, "who agreed is asked only once the box is ticked");
  const ticked = view({ diary: { ok: true, telehealth: true, appointments: [APPT] }, tele: true });
  assert.match(ticked, /id="wSchedTele" checked/);
  assert.match(ticked, /<select id="wSchedTeleGiver" aria-required="true"/);
  for (const g of ["patient", "parent", "legal-guardian", "next-of-kin", "power-of-attorney"]) assert.ok(ticked.includes('<option value="' + g + '">'), g);
  assert.match(ticked, /<option value="">Choose<\/option>/, "no giver is picked for the desk");
  assert.match(ticked, /id="wSchedTeleAgreed" aria-required="true"> They agreed to a video consultation/);
});

test("diary: a video appointment has a Video chip and who agreed; an ordinary one has neither", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "scheduling", intake: null, scheduling: { diary: { ok: true, telehealth: true, appointments: [
    { ...APPT, teleconsult: true, teleConsentBy: "next-of-kin" }, { ...APPT, appointmentId: "apt-2", teleconsult: false, teleConsentBy: null }] } } });
  assert.equal((html.match(/Video<\/span>/g) || []).length, 1);
  assert.match(html, /Agreed to a video visit: Next of kin/);
  const note = W._render({ ...W._st, view: "scheduling", intake: null, scheduling: { note: "The patient joined the queue as an in-person visit.", diary: { ok: true, appointments: [] } } });
  assert.match(note, /<p class="w-hint">.*The patient joined the queue as an in-person visit\./);
});

async function admin(lang, answer, post) {
  const site = loadSite({ lang, pages: ["admin.js"] });
  const sent = [], toasts = [];
  const c = { esc: site.win.WSQ.esc, t: site.win.WSQ.t, tSafe: site.win.WSQ.tSafe, en: site.win.WSQ.en, state: { orgId: "o1" }, toast(m) { toasts.push(m); },
    api: (p, body) => { sent.push([p, body]); return Promise.resolve(body ? (post ? post(body) : { ok: true, changed: ["baseUrl"], settings: { on: !!body.settings.baseUrl, baseUrl: body.settings.baseUrl, publicServer: false } }) : answer); } };
  const host = site.doc.getElementById("teleCard");
  await site.win.WSQ._telehealthSettings(c, host);
  return { site, host, sent, toasts, el: (id) => site.doc.getElementById(id) };
}

test("Admin > Hospital video card: coming soon shows the words and no form", async () => {
  const a = await admin("en", { ok: true, settings: { on: false, baseUrl: "", publicServer: false, comingSoon: true } });
  assert.match(a.host.innerHTML, /Coming soon\. Video consultations are not available yet\./);
  for (const id of ["admTeleUrl", "admTeleReason", "admTeleSave", "admTeleOff"]) assert.doesNotMatch(a.host.innerHTML, new RegExp('id="' + id + '"'), id);
});

test("Admin > Hospital video card: reads, saves with a reason, turns off with an empty address", async () => {
  const a = await admin("en", { ok: true, settings: { on: true, baseUrl: "https://video.example.org", publicServer: false } });
  assert.equal(a.sent[0][0], "/org/telehealth-settings?orgId=o1");
  assert.match(a.host.innerHTML, /Video visits are on\./);
  assert.match(a.host.innerHTML, /<dd lang="en">https:\/\/video\.example\.org<\/dd>/);
  assert.doesNotMatch(a.host.innerHTML, /does not run/, "a self-hosted server gets no public-server warning");
  assert.match(a.host.innerHTML, /id="admTeleOff"/);
  for (const id of ["admTeleUrl", "admTeleReason", "admTeleSave", "admTeleOff"]) assert.match(a.host.innerHTML, new RegExp('id="' + id + '"[^>]*style="min-height:44px"|id="' + id + '"[^>]*min-height:44px'), id + " is a 44px target");

  // A reason is required before anything is sent.
  a.el("admTeleUrl").value = "https://meet.example.org"; a.el("admTeleReason").value = "  ";
  a.el("admTeleSave").onclick();
  assert.equal(a.sent.length, 1);
  assert.match(a.el("admTeleMsg").innerHTML, /Say why the video visit settings are being changed\. Nothing was saved\./);
  // An empty address on Save is not a silent "off".
  a.el("admTeleUrl").value = ""; a.el("admTeleReason").value = "Moving";
  a.el("admTeleSave").onclick();
  assert.equal(a.sent.length, 1);
  assert.match(a.el("admTeleMsg").innerHTML, /use Turn off video visits/);

  a.el("admTeleUrl").value = " https://meet.example.org "; a.el("admTeleReason").value = " New server ";
  a.el("admTeleSave").onclick();
  assert.deepEqual(a.sent[1], ["/org/telehealth-settings", { orgId: "o1", settings: { baseUrl: "https://meet.example.org" }, reason: "New server" }]);

  const b = await admin("en", { ok: true, settings: { on: true, baseUrl: "https://video.example.org", publicServer: false } });
  b.el("admTeleReason").value = "Video visits stopped";
  b.el("admTeleOff").onclick();
  assert.deepEqual(b.sent[1], ["/org/telehealth-settings", { orgId: "o1", settings: { baseUrl: "" }, reason: "Video visits stopped" }]);
});

test("Admin video card: off, the public-server warning, the server's refusals, a failed load", async () => {
  const off = await admin("en", { ok: true, settings: { on: false, baseUrl: "", publicServer: false } });
  assert.match(off.host.innerHTML, /Video visits are off\./);
  assert.doesNotMatch(off.host.innerHTML, /id="admTeleOff"/);

  const pub = await admin("en", { ok: true, settings: { on: true, baseUrl: "https://meet.jit.si", publicServer: true } });
  assert.match(pub.host.innerHTML, /role="alert">This is a public video service\. Video visits then pass through a server this hospital does not run\. A video server run by this hospital is recommended\./);

  const errs = { invalid_url: /That is not a web address\. Nothing was saved\./, https_required: /must start with https:\/\/\. Nothing was saved\./,
    plain_address_required: /no sign-in, \? or # part\. Nothing was saved\./, reason_required: /Say why the video visit settings are being changed/ };
  for (const [code, re] of Object.entries(errs)) {
    const x = await admin("en", { ok: true, settings: { on: false, baseUrl: "", publicServer: false } }, () => ({ ok: false, error: code, message: "server words" }));
    x.el("admTeleUrl").value = "http://x"; x.el("admTeleReason").value = "r";
    x.el("admTeleSave").onclick();
    await new Promise((r) => setTimeout(r, 0));
    assert.match(x.el("admTeleMsg").innerHTML, re, code);
  }
  const other = await admin("en", { ok: true, settings: { on: false, baseUrl: "", publicServer: false } }, () => ({ ok: false, error: "not_saved", message: "The setting did not read back as sent." }));
  other.el("admTeleUrl").value = "https://v.example.org"; other.el("admTeleReason").value = "r";
  other.el("admTeleSave").onclick();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(other.el("admTeleMsg").innerHTML, /The setting did not read back as sent\./, "an unmapped refusal shows the server's own words");

  const failed = await admin("en", { ok: false, error: "not_a_wardsynq_hospital" });
  assert.match(failed.host.innerHTML, /Do not read this as off/);
  assert.doesNotMatch(failed.host.innerHTML, /admTeleUrl/);
});

test("every word on the video card and the video booking form is translated", async () => {
  const xx = await admin("xx", { ok: true, settings: { on: true, baseUrl: "https://meet.jit.si", publicServer: true } });
  assert.deepEqual(leftovers(xx.host.innerHTML, ["https://meet.jit.si"]), []);
  assert.match(read("wardsynq/site/pages/admin.js"), /<div id="intakeCard"><\/div><div id="teleCard"><\/div>/, "the card is on Admin > Hospital");
  const en = (() => { const w = {}; vm.runInNewContext(read("wardsynq/site/i18n.js"), { window: w }); return w.WSQI18n._catalogs.en; })();
  const keys = Object.keys(en).filter((k) => k.startsWith("ward.tele-") || k.startsWith("site.admin.telehealth."));
  assert.equal(keys.length, 36);
  for (const code of ["bn", "es", "hi", "kn", "ml", "mr", "ta", "te"]) {
    const I = { register(c, n, cat) { I.cat = cat; } };
    vm.runInNewContext(read("wardsynq/site/i18n/" + code + ".js"), { window: { WSQI18n: I } });
    for (const k of keys) assert.ok(I.cat[k] && I.cat[k] !== "", code + " translates " + k);
  }
});
