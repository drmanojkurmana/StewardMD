// Wave 2 server side of the specialty kits (functions/_kits_share.js, /api/kits/*): referrals and
// handovers between verified doctors, case rooms, unit versions of a kit, per-patient kit history and
// review sync. Everything runs against an in-memory Firestore with the real commit guards (create-only,
// updateTime compare-and-set), and injected directory / claims / org / push fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const K = await import("../functions/_kits_share.js");
const AR = await import("../scripts/apply-reviews.mjs");

import { ENV, world } from "./helpers/kits-share-world.mjs";
const REF = { kind: "referral", to: { smdId: "SMD-BBB222" }, kitId: "obgyn", urgency: "Urgent (within 24 hours)",
  payload: { patient: { name: "Lakshmi Devi", age: "28", sex: "Female" }, reason: "Severe pre-eclampsia at 34 weeks", history: "BP 170/112, protein 3+", question: "Please admit" } };

test("cleanText: no HTML, no control characters, dashes become commas or hyphens, capped", () => {
  assert.equal(K.cleanText("a <b>bold</b>\u0007 move — now, 2–3 days"), "a  bold  move, now, 2-3 days");
  assert.equal(K.cleanText("x".repeat(50), 10).length, 10);
  assert.equal(K.cleanText({}), "");
});

test("PHI sealing round-trips, hides the plaintext, and the history key is per doctor and never the id", async () => {
  const s = await K.seal(ENV, { name: "Lakshmi Devi" });
  assert.match(s, /^kx1:/); assert.ok(!s.includes("Lakshmi"));
  assert.deepEqual(await K.unseal(ENV, s), { name: "Lakshmi Devi" });
  assert.notEqual(await K.seal(ENV, { a: 1 }), await K.seal(ENV, { a: 1 }), "random IV");
  const k1 = await K.patientKey(ENV, "uA", "MR 12345"), k2 = await K.patientKey(ENV, "uA", "mr12345"), k3 = await K.patientKey(ENV, "uB", "MR 12345");
  assert.equal(k1, k2, "spaces and case do not split a patient"); assert.notEqual(k1, k3, "another doctor gets another key");
  assert.match(k1, /^[0-9a-f]{40}$/); assert.ok(!k1.includes("12345"));
  await assert.rejects(K.seal({}, {}), /phi_key_missing/);
});

test("referral: only between verified doctors, sealed at rest, fixed-text push, recipient sees it", async () => {
  const w = world();
  assert.equal((await K.msgSend(w.ctx("uU"), REF)).status, 403, "unverified sender");
  assert.equal((await K.msgSend(w.ctx("uA"), { ...REF, to: { smdId: "SMD-NOPE00" } })).status, 404);
  assert.equal((await K.msgSend(w.ctx("uA"), { ...REF, to: { smdId: "SMD-UNV000" } })).body.error, "recipient_not_verified");
  assert.equal((await K.msgSend(w.ctx("uA"), { ...REF, to: { smdId: "SMD-AAA111" } })).body.error, "cannot_send_to_self");
  assert.equal((await K.msgSend(w.ctx("uA"), { ...REF, payload: { patient: { name: "X" } } })).body.error, "reason_required");
  const r = await K.msgSend(w.ctx("uA"), REF);
  assert.equal(r.status, 200);
  const stored = w.docs.get("kx_msgs/" + r.body.id).fields;
  assert.ok(!JSON.stringify(stored).includes("Lakshmi") && !JSON.stringify(stored).includes("pre-eclampsia"), "no PHI in plain fields");
  assert.equal(stored.fromName, "Dr Asha"); assert.equal(stored.urgency, "Urgent (within 24 hours)");
  assert.equal(w.pushes.length, 1); assert.equal(w.pushes[0].uid, "uB");
  assert.ok(!/Lakshmi|Asha|eclampsia/.test(JSON.stringify(w.pushes[0].msg)), "push text is fixed");
  const inbox = (await K.msgList(w.ctx("uB"))).body;
  assert.equal(inbox.inbox.length, 1); assert.equal(inbox.inbox[0].fromName, "Dr Asha"); assert.equal(inbox.inbox[0].payload, undefined);
  assert.equal((await K.msgList(w.ctx("uA"))).body.sent.length, 1);
  assert.equal((await K.msgRead(w.ctx("uC"), { id: r.body.id })).status, 404, "a third doctor cannot read it");
  const rd = (await K.msgRead(w.ctx("uB"), { id: r.body.id })).body.msg;
  assert.equal(rd.payload.patient.name, "Lakshmi Devi"); assert.equal(rd.status, "seen");
});

test("referral status: only the recipient accepts or declines, once; only the sender withdraws", async () => {
  const w = world(), id = (await K.msgSend(w.ctx("uA"), REF)).body.id;
  assert.equal((await K.msgStatus(w.ctx("uA"), { id, status: "accepted" })).status, 403);
  assert.equal((await K.msgStatus(w.ctx("uB"), { id, status: "withdrawn" })).status, 403);
  assert.equal((await K.msgStatus(w.ctx("uB"), { id, status: "acknowledged" })).body.error, "bad_status");
  assert.equal((await K.msgStatus(w.ctx("uB"), { id, status: "accepted", note: "Bed ready in labour ward" })).status, 200);
  assert.equal((await K.msgStatus(w.ctx("uB"), { id, status: "declined" })).status, 409);
  const back = (await K.msgRead(w.ctx("uA"), { id })).body.msg;
  assert.equal(back.status, "accepted"); assert.equal(back.reply.note, "Bed ready in labour ward"); assert.equal(back.reply.by, "Dr Bala");
  const id2 = (await K.msgSend(w.ctx("uA"), REF)).body.id;
  assert.equal((await K.msgStatus(w.ctx("uA"), { id: id2, status: "withdrawn" })).status, 200);
  assert.equal((await K.msgList(w.ctx("uB"))).body.inbox.length, 1, "a withdrawn referral leaves the inbox");
});

test("handover: rows required, acknowledgement needs a read-back, expires after 3 days and is deleted", async () => {
  const w = world(), H = { kind: "handover", to: { smdId: "SMD-BBB222" }, payload: { unit: "Ward 5", shift: "Night to morning", rows: [{ bed: "12", sev: "watcher", summary: "Day 2 pneumonia", actions: "Repeat lactate 6 am", cont: "If SpO2 below 92, call" }] } };
  assert.equal((await K.msgSend(w.ctx("uA"), { ...H, payload: { rows: [] } })).body.error, "rows_required");
  const id = (await K.msgSend(w.ctx("uA"), H)).body.id;
  assert.match(w.pushes[0].msg.body, /handed over patients/);
  assert.equal((await K.msgStatus(w.ctx("uB"), { id, status: "acknowledged" })).body.error, "readback_required");
  assert.equal((await K.msgStatus(w.ctx("uB"), { id, status: "acknowledged", note: "Bed 12: lactate at 6, call if SpO2 below 92" })).status, 200);
  const later = w.ctx("uB", 1_000_000 + K.TTL.handover + 1);
  assert.equal((await K.msgList(later)).body.inbox.length, 0);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(w.docs.has("kx_msgs/" + id), false, "expired messages are deleted on the next list");
});

test("rate limit and size limit", async () => {
  const w = world(); w.limits.block = true;
  assert.equal((await K.msgSend(w.ctx("uA"), REF)).status, 429);
  w.limits.block = false;
  assert.equal((await K.msgSend(w.ctx("uA"), { ...REF, payload: { ...REF.payload, kitSummary: "x".repeat(6000), history: "y".repeat(4000), treatment: "z".repeat(2000), investigations: "q".repeat(2000), question: "w".repeat(2000) }, kind: "referral" })).status, 200, "each field is capped, so the payload fits");
});

test("case room: de-identified, invite by StewardMD ID, members only, owner controls, replies notify others", async () => {
  const w = world();
  const r = await K.caseCreate(w.ctx("uA"), { title: "Recurrent pleural effusion UHID 44812345", question: "Would you tap again or refer for thoracoscopy? call 9876543210", summary: "58M, exudate, cytology negative twice", kitId: "pulmonology", invite: ["SMD-BBB222", "SMD-UNV000", "SMD-NOPE00"] });
  assert.equal(r.status, 200); assert.equal(r.body.invited, 1);
  assert.deepEqual(r.body.notFound.map((x) => x.error).sort(), ["recipient_not_found", "recipient_not_verified"]);
  assert.match(w.pushes[0].msg.body, /asked for your opinion/);
  const rd = (await K.caseRead(w.ctx("uB"), { id: r.body.id })).body;
  assert.ok(!/44812345|9876543210/.test(rd.case.title + rd.case.question), "identifiers stripped: " + rd.case.title + " | " + rd.case.question);
  assert.equal(rd.members.length, 2);
  assert.equal((await K.caseRead(w.ctx("uC"), { id: r.body.id })).status, 404, "not a member");
  assert.equal((await K.casePost(w.ctx("uB"), { id: r.body.id, text: "Thoracoscopy. Bed 7 patient seen." })).status, 200);
  assert.deepEqual(w.pushes.slice(1).map((p) => p.uid), ["uA"], "the reply notifies the other member only");
  const posts = (await K.caseRead(w.ctx("uA"), { id: r.body.id })).body.posts;
  assert.equal(posts.length, 1); assert.ok(!/Bed 7/.test(posts[0].text)); assert.equal(posts[0].by, "Dr Bala");
  assert.equal((await K.caseInvite(w.ctx("uB"), { id: r.body.id, smdIds: ["SMD-CCC333"] })).status, 403, "owner only");
  assert.equal((await K.caseInvite(w.ctx("uA"), { id: r.body.id, smdIds: ["SMD-CCC333", "SMD-BBB222"] })).body.invited, 1, "an existing member is not re-added");
  assert.equal((await K.caseList(w.ctx("uC"))).body.cases.length, 1);
  assert.equal((await K.caseClose(w.ctx("uA"), { id: r.body.id })).status, 200);
  assert.equal((await K.casePost(w.ctx("uC"), { id: r.body.id, text: "late" })).status, 409);
});

test("unit version of a kit: members read it, owner and HOD publish immutable versions, others cannot", async () => {
  const w = world(), content = { notes: "Our PPH trolley is in labour room 2 — check daily.", orderSets: [{ label: "Our pre-eclampsia panel", tests: ["CBC", "LFT", "Urine protein"] }], investigations: [{ label: "Hb (lab code H1)" }], contacts: ["On-call obstetrician ext 2345"] };
  assert.equal((await K.unitGet(w.ctx("uB"), { kit: "obgyn" })).body.canPublish.length, 0, "a doctor member cannot publish");
  assert.deepEqual((await K.unitGet(w.ctx("uC"), { kit: "obgyn" })).body.canPublish.map((x) => x.orgId), ["org1"], "HOD can");
  assert.equal((await K.unitPublish(w.ctx("uB"), { orgId: "org1", kitId: "obgyn", content, reason: "x" })).status, 403);
  assert.equal((await K.unitPublish(w.ctx("uA"), { orgId: "org1", kitId: "obgyn", content: {}, reason: "x" })).body.error, "empty");
  assert.equal((await K.unitPublish(w.ctx("uA"), { orgId: "org1", kitId: "obgyn", content })).body.error, "reason_required");
  assert.equal((await K.unitPublish(w.ctx("uA"), { orgId: "org1", kitId: "obgyn", content, reason: "Unit meeting 20 Sep" })).body.version, 1);
  assert.equal((await K.unitPublish(w.ctx("uC"), { orgId: "org1", kitId: "obgyn", content: { notes: "v2" }, reason: "update" })).body.version, 2);
  assert.ok(w.docs.has("kx_unit_ver/org1__obgyn__v1") && w.docs.has("kx_unit_ver/org1__obgyn__v2"), "every version is kept");
  const got = (await K.unitGet(w.ctx("uB"), { kit: "obgyn" })).body.versions;
  assert.equal(got.length, 1); assert.equal(got[0].version, 2); assert.equal(got[0].orgName, "City Hospital"); assert.equal(got[0].publishedBy, "Dr Chitra");
  const v1 = w.docs.get("kx_unit_ver/org1__obgyn__v1").fields.content;
  assert.equal(v1.notes, "Our PPH trolley is in labour room 2, check daily."); assert.equal(v1.orderSets[0].id, "unit-1");
  assert.equal((await K.unitRetire(w.ctx("uA"), { orgId: "org1", kitId: "obgyn", reason: "replaced" })).status, 200);
  assert.equal((await K.unitGet(w.ctx("uB"), { kit: "obgyn" })).body.versions.length, 0);
  assert.equal((await K.unitGet(w.ctx("uB"), { kit: "../x" })).status, 400);
});

test("kit history per patient: append, filter by kit, cap, private to the doctor, forget", async () => {
  const w = world();
  assert.equal((await K.histAdd(w.ctx("uA"), { patientId: "", kitId: "obgyn", entry: { vals: { bp: "120/80" } } })).status, 400);
  assert.equal((await K.histAdd(w.ctx("uA"), { patientId: "MR-9", kitId: "obgyn", entry: {} })).body.error, "empty");
  await K.histAdd(w.ctx("uA", 1000), { patientId: "MR-9", kitId: "obgyn", entry: { vals: { bp: "120/80", fundal: "24" }, summary: "24 weeks" } });
  await K.histAdd(w.ctx("uA", 2000), { patientId: "mr-9", kitId: "obgyn", entry: { vals: { bp: "130/85" } } });
  await K.histAdd(w.ctx("uA", 3000), { patientId: "MR-9", kitId: "diabetes-endocrine", entry: { vals: { hba1c: "7.1" } } });
  const all = (await K.histRead(w.ctx("uA"), { patientId: "MR-9" })).body.entries;
  assert.equal(all.length, 3);
  assert.deepEqual((await K.histRead(w.ctx("uA"), { patientId: "MR-9", kitId: "obgyn" })).body.entries.map((x) => x.entry.vals.bp), ["120/80", "130/85"]);
  assert.equal((await K.histRead(w.ctx("uB"), { patientId: "MR-9" })).body.entries.length, 0, "another doctor sees nothing");
  const paths = [...w.docs.keys()].filter((p) => p.startsWith("kx_hist/"));
  assert.equal(paths.length, 1); assert.ok(!/MR|9/.test(paths[0].split("__")[1]), "doc id is a keyed hash, not the MR number");
  assert.ok(!JSON.stringify(w.docs.get(paths[0]).fields).includes("120/80"));
  for (let i = 0; i < 45; i++) await K.histAdd(w.ctx("uA", 5000 + i), { patientId: "MR-9", kitId: "obgyn", entry: { vals: { n: String(i) } } });
  assert.equal((await K.histRead(w.ctx("uA"), { patientId: "MR-9" })).body.entries.length, K.LIMITS.histEntries);
  await K.histForget(w.ctx("uA"), { patientId: "MR-9" });
  assert.equal((await K.histRead(w.ctx("uA"), { patientId: "MR-9" })).body.entries.length, 0);
});

test("review sync: keeps valid decisions only; the owner export applies with apply-reviews unchanged", async () => {
  const w = world();
  const r = await K.reviewsPut(w.ctx("uA"), { decisions: [
    { kind: "protocol", id: "acne-vulgaris", decision: "approve", comment: "", at: "2026-09-26T08:00:00Z" },
    { kind: "kit", id: "obgyn", decision: "changes", comment: "", at: "2026-09-26T08:00:00Z" },
    { kind: "kit", id: "../etc", decision: "approve", at: "2026-09-26T08:00:00Z" } ] });
  assert.equal(r.body.count, 1);
  const all = (await K.reviewsAll(w.ctx("uA"))).body.reviews;
  assert.equal(all.length, 1); assert.equal(all[0].reviewer.verified, true); assert.equal(all[0].reviewer.name, "Dr Asha");
  assert.deepEqual(AR.validateExport(all[0]), []);
});

test("router: off unless KITS_SHARE_ON=1, and needs a verified token", async () => {
  const { onRequest } = await import("../functions/api/kits/[[path]].js");
  const req = (url, init) => new Request("https://stewardmd.in/api/kits/" + url, init);
  let r = await onRequest({ request: req("msg/list"), env: {}, params: { path: ["msg", "list"] } });
  assert.equal(r.status, 404); assert.equal((await r.json()).error, "disabled");
  r = await onRequest({ request: req("status"), env: { KITS_SHARE_ON: "1" }, params: { path: ["status"] } });
  assert.deepEqual(await r.json(), { enabled: true, signedIn: false, verified: false });
  r = await onRequest({ request: req("msg/list", { headers: { "Cf-Access-Authenticated-User-Email": "a@b.c" } }), env: { KITS_SHARE_ON: "1" }, params: { path: ["msg", "list"] } });
  assert.equal(r.status, 401, "a bare Access email header is not an identity here");
  r = await onRequest({ request: req("reviews/all"), env: { KITS_SHARE_ON: "1" }, params: { path: ["reviews", "all"] } });
  assert.equal(r.status, 403);
  const src = (await import("node:fs")).readFileSync(new URL("../kits-share.js", import.meta.url), "utf8");
  assert.match(src, /fetch\("\/api\/kits\/" \+ path/, "the client calls a relative /api path (native transport, no CORS)");
});

test("a colleague can be addressed by sign-in email; lookups are rate-limited before they happen", async () => {
  const w = world();
  const r = await K.msgSend(w.ctx("uA"), { ...REF, to: { email: "Bala@City.example" } });
  assert.equal(r.status, 200);
  assert.equal(w.docs.get("kx_msgs/" + r.body.id).fields.toLabel, "bala@city.example");
  assert.equal((await K.msgSend(w.ctx("uA"), { ...REF, to: { email: "nobody@city.example" } })).status, 404);
  w.limits.block = true;
  assert.equal((await K.msgSend(w.ctx("uA"), { ...REF, to: { smdId: "SMD-NOPE00" } })).status, 429, "a blocked caller learns nothing about the ID");
  w.limits.block = false;
  const c = await K.caseCreate(w.ctx("uA"), { title: "Wound dehiscence", question: "Resuture or VAC?", invite: ["chitra@city.example"] });
  assert.equal(c.body.invited, 1);
  const inv = await K.caseInvite(w.ctx("uA"), { id: c.body.id, smdIds: ["bala@city.example", "nobody@city.example"] });
  assert.equal(inv.body.invited, 1); assert.equal(inv.body.notFound[0].error, "recipient_not_found");
  w.limits.block = true;
  assert.equal((await K.caseInvite(w.ctx("uA"), { id: c.body.id, smdIds: ["SMD-CCC333"] })).status, 429);
});
