/* test/wsq-site-inbasket-page.test.mjs - the In-basket screen (wardsynq/site/pages/inbasket.js) and the MaiK draft
 * button on the Patient portal worklist, rendered through the shell's real translation (wsq-site-i18n-harness.mjs).
 *
 * Loading, failed and empty stay three different screens; a recalled message shows who and why and never its text; a
 * push attempt never reads as delivered; every visible word is translated and server values are data.
 * The screen calls GET /api/queue/ward/staff-messages and POST /api/queue/ward/staff-message-send (route tests in
 * wardsynq-staff-messaging.test.mjs).
 *
 * node --test --test-concurrency=1 test/wsq-site-inbasket-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

function ctxOf(env, caps) { return { esc: env.win.WSQ.esc, t: env.win.WSQ.t, tSafe: env.win.WSQ.tSafe, en: env.win.WSQ.en, can: (x) => (caps || []).includes(x) }; }
const THREAD = {
  threadId: "t1", subject: "Bed 4 fluids", patientId: "opd-pat-gh-1", patient: { name: "Asha Rao", mrn: "GH-1" }, unit: null, toRoles: ["nurse"],
  unread: 2, lastAt: "2026-09-17T08:00:00.000Z",
  messages: [
    { messageId: "t1", threadId: "t1", body: "Recheck output", from: "cfa:doc", fromName: "Dr Mehta", fromRole: "doctor", sentAt: "2026-09-17T07:00:00.000Z", editedAt: null, recalled: null, urgent: false, escalations: [], version: 1 },
    { messageId: "m2", threadId: "t1", body: null, from: "cfa:doc", fromName: "Dr Mehta", fromRole: "doctor", sentAt: "2026-09-17T08:00:00.000Z", editedAt: null, recalled: { by: "cfa:doc", reason: "wrong thread" }, urgent: false, escalations: [{ recipients: 1, sent: 0, total: 1, reason: "PUSH_NOT_CONFIGURED" }], version: 2 },
  ],
};

test("threads: loading, failed and empty are three different screens", () => {
  const en = loadSite({ lang: "en", pages: ["inbasket.js"] });
  const c = ctxOf(en), I = en.win.WSQ._inbasket;
  const loading = I.threadsHtml(c, null), bad = I.threadsHtml(c, { ok: false }), empty = I.threadsHtml(c, { ok: true, threads: [] });
  assert.match(loading, /Loading messages/);
  assert.match(bad, /Do not read this as no messages/);
  assert.match(empty, /data-empty="threads"/);
  assert.ok(!/data-empty/.test(bad), "a failed load never renders as empty");
  const one = I.threadsHtml(c, { ok: true, threads: [THREAD] });
  assert.match(one, /2 unread/, "unread is said in words, not only a colour");
  assert.match(one, /Asha Rao/);
});

test("an open thread: a recalled message shows who recalled it and why, never its text; a push is never 'delivered'", () => {
  const en = loadSite({ lang: "en", pages: ["inbasket.js"] });
  const c = ctxOf(en), I = en.win.WSQ._inbasket;
  const html = I.threadHtml(c, THREAD, "cfa:doc");
  assert.match(html, /Recalled by the sender: wrong thread/);
  assert.match(html, /Alert not sent: push is not set up on this server/);
  assert.ok(!/delivered/i.test(html));
  assert.equal((html.match(/data-ib="recall"/g) || []).length, 1, "only the author's unrecalled message can be recalled");
  assert.ok(!/data-ib="recall"/.test(I.threadHtml(c, THREAD, "cfa:nurse")), "not by anyone else");
  assert.match(I.escalationText(c, { recipients: 3, sent: 2, total: 4 }), /Sent is not read/);
});

test("waiting on you: a source the role cannot open says so, a failed source is not 'nothing waiting'", () => {
  const en = loadSite({ lang: "en", pages: ["inbasket.js"] });
  const c = ctxOf(en), I = en.win.WSQ._inbasket;
  const rows = () => [];
  assert.match(I.sourceHtml(c, "Referrals", { ok: false, status: 403, error: "permission" }, rows), /Not part of your role/);
  const bad = I.sourceHtml(c, "Referrals", { ok: false, error: "network" }, rows);
  assert.match(bad, /Do not read this as nothing waiting/);
  assert.ok(!/Nothing waiting\./.test(bad));
  assert.match(I.sourceHtml(c, "Referrals", { ok: true }, () => [{ what: "Cardiology (urgent)", hours: 30, owner: "cardiology" }]), /waiting 30 h, for cardiology/);
});

test("every visible word on the In-basket helpers is translated; names, subjects and reasons are data", () => {
  const xx = loadSite({ lang: "xx", pages: ["inbasket.js", "portal-access.js"] });
  const c = ctxOf(xx, ["emr.treat"]), I = xx.win.WSQ._inbasket;
  const html = I.threadsHtml(c, { ok: true, threads: [THREAD] }) + I.threadHtml(c, THREAD, "cfa:doc");
  const data = ["Bed 4 fluids", "Asha Rao", "GH-1", "Dr Mehta", "doctor", "Recheck output", "wrong thread", "(", ")", ",", ":"];
  const left = leftovers(html, data).filter((s) => !/\d{1,2}[/:.]\d{1,2}|\b\d{2} ?[ap]m\b|2026/i.test(s));
  assert.deepEqual(left, []);
  // The portal worklist offers a MaiK draft only to a role that can reply.
  const work = xx.win.WSQ._portalAccess.worklistHtml(c, { ok: true, messages: [{ messageId: "m1", patientId: "opd-pat-gh-1", waitingHours: 5, subject: "Swelling" }] });
  assert.match(work, /⟦Draft with MaiK⟧/);
  assert.ok(!/Draft with MaiK/.test(xx.win.WSQ._portalAccess.worklistHtml(ctxOf(xx, ["emr.view"]), { ok: true, messages: [{ messageId: "m1", patientId: "p", waitingHours: 1, subject: "s" }] })));
});
