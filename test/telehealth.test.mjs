/* Video visits: the pure rules (functions/_telehealth.js).
 *
 * What these defend: video is OFF unless a hospital saved an https server; the room name carries nothing about the
 * patient and cannot be guessed; the patient only gets the room while the doctor has the visit in consultation; the
 * consent says who agreed; the invite carries no name or MR number.
 *
 * node --test test/telehealth.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const T = await import("../functions/_telehealth.js");

test("providerFrom: empty turns video off; only a plain https address is accepted; public servers are flagged", () => {
  assert.deepEqual(T.providerFrom(""), { ok: true, baseUrl: "", publicServer: false });
  assert.deepEqual(T.providerFrom(null), { ok: true, baseUrl: "", publicServer: false });
  assert.equal(T.providerFrom("not a url").error, "invalid_url");
  assert.equal(T.providerFrom("http://video.example.org").error, "https_required");
  assert.equal(T.providerFrom("https://u:p@video.example.org").error, "plain_address_required");
  assert.equal(T.providerFrom("https://video.example.org/?x=1").error, "plain_address_required");
  assert.equal(T.providerFrom("https://video.example.org/#a").error, "plain_address_required");
  assert.deepEqual(T.providerFrom(" https://video.example.org/rooms/ "), { ok: true, baseUrl: "https://video.example.org/rooms", publicServer: false });
  assert.equal(T.providerFrom("https://meet.jit.si").publicServer, true);
  assert.equal(T.providerFrom("https://8x8.vc/tenant").publicServer, true);
  assert.equal(T.providerFrom("https://MEET.JIT.SI").publicServer, true);
});

test("telehealthSettings: off by default and off when the saved value no longer validates", () => {
  assert.deepEqual(T.telehealthSettings(null), { on: false, baseUrl: "", publicServer: false });
  assert.deepEqual(T.telehealthSettings({}), { on: false, baseUrl: "", publicServer: false });
  assert.deepEqual(T.telehealthSettings({ wardsynq: { telehealth: { baseUrl: "http://insecure.example.org" } } }), { on: false, baseUrl: "", publicServer: false });
  assert.deepEqual(T.telehealthSettings({ wardsynq: { telehealth: { baseUrl: "https://meet.jit.si" } } }), { on: true, baseUrl: "https://meet.jit.si", publicServer: true });
});

test("room names: wsq- plus 128 random bits, never repeated, nothing else in them", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const r = T.newRoomName();
    assert.match(r, /^wsq-[0-9a-f]{32}$/);
    assert.ok(!seen.has(r)); seen.add(r);
  }
  assert.equal(T.isRoomName("wsq-" + "a".repeat(31)), false);
  assert.equal(T.isRoomName("wsq-RAVI-9876543210"), false);
  assert.equal(T.roomUrl("https://v.example.org/", "wsq-" + "0".repeat(32)), "https://v.example.org/wsq-" + "0".repeat(32));
  assert.equal(T.roomUrl("", "wsq-" + "0".repeat(32)), "", "no server, no address");
  assert.equal(T.roomUrl("https://v.example.org", "ravi"), "", "a name that is not ours is never turned into an address");
});

test("joinState: the room opens only in consultation; a closed visit is closed", () => {
  const room = "wsq-" + "1".repeat(32);
  assert.equal(T.joinState({ status: "waiting" }).reason, "not_teleconsult");
  assert.equal(T.joinState({ teleconsult: true, teleRoom: "bad", status: "waiting" }).reason, "not_teleconsult");
  for (const s of ["registered", "waiting", "called"]) assert.deepEqual(T.joinState({ teleconsult: true, teleRoom: room, status: s }), { live: true, ready: false, reason: "" }, s);
  assert.deepEqual(T.joinState({ teleconsult: true, teleRoom: room, status: "in_consultation" }), { live: true, ready: true, reason: "" });
  for (const s of ["completed", "cancelled", "no_show"]) assert.equal(T.joinState({ teleconsult: true, teleRoom: room, status: s }).reason, "visit_closed", s);
});

test("consentFrom: agreed must be true and who agreed must be named from the list", () => {
  assert.equal(T.consentFrom(null).error, "consent_required");
  assert.equal(T.consentFrom({ givenBy: "patient" }).error, "consent_required");
  assert.equal(T.consentFrom({ givenBy: "patient", agreed: "yes" }).error, "consent_required");
  assert.equal(T.consentFrom({ agreed: true }).error, "giver_required");
  assert.equal(T.consentFrom({ agreed: true, givenBy: "clinician-override" }).error, "unknown_giver");
  assert.deepEqual(T.consentFrom({ agreed: true, givenBy: "parent" }), { ok: true, givenBy: "parent" });
});

test("patient link and invite: our domain, the token only, no patient data, no em dash", () => {
  const url = T.patientLink("https://stewardmd.in/", "TOKEN123");
  assert.equal(url, "https://stewardmd.in/tele?t=TOKEN123");
  assert.equal(T.patientLink(undefined, "X"), "https://stewardmd.in/tele?t=X");
  const txt = T.inviteText(url);
  assert.ok(txt.includes(url));
  assert.ok(!/—/.test(txt), "no em dash in app-facing text");
});
