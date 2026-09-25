/* Owner ask G2 (2026-09-25): the day close sent to the owner on WhatsApp at a set hour.
 *
 * What these defend:
 *   - the setting is the owner's and administrator's, validated, and the number is only ever shown back masked,
 *   - it is due at the chosen hour on the HOSPITAL's clock, and goes once a day however often the hourly job runs,
 *   - a failed send is retried on later hours, at most three times, and says why it failed,
 *   - the message is counts and totals: it names no patient,
 *   - Send now lets the owner see one arrive, and is refused honestly when WhatsApp is not set up.
 *
 * node --test --experimental-test-module-mocks test/opd-day-close-whatsapp.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sent = [];
let waUp = true;
mock.module("../functions/_followcare_whatsapp.js", { namedExports: {
  waConfigured: () => waUp,
  sendWhatsApp: async (_env, msg) => { sent.push(msg); return waUp ? { ok: true } : { ok: false, reason: "not_configured" }; },
  toWaNumber: (p) => String(p || "").replace(/\D/g, ""), fillTemplate: (t) => t, waProvider: () => "custom",
} });
const H = await import("./helpers/opd-router-harness.mjs");
const { docs, api, seed, ENV, OWNER_A, HR_A, NURSE_A, HR_B, DAY } = H;
const DC = await import("../functions/_day_close.js");
const { onRequest } = await import("../functions/api/queue/[[path]].js");   // the harness's instance (imported after its mocks)

test("pure: settings are off unless on, an hour 0-23, a real number; due at the hour on the hospital's clock", () => {
  assert.deepEqual(DC.dayCloseSettings(null), { enabled: false, hour: 20, mobile: "" });
  assert.deepEqual(DC.dayCloseSettings({ enabled: true, hour: 21, mobile: "98765 43210" }), { enabled: true, hour: 21, mobile: "919876543210" }, "a bare Indian number gets 91");
  assert.equal(DC.settingsRefusal({ enabled: true, hour: 24, mobile: "9876543210" }) !== "", true);
  assert.equal(DC.settingsRefusal({ enabled: true, hour: 21, mobile: "123" }) !== "", true, "no number, no daily message");
  assert.equal(DC.settingsRefusal({ enabled: false, hour: 21, mobile: "" }), "", "switching it off needs no number");
  const st = { enabled: true, hour: 21, mobile: "919876543210" };
  // 15:29 UTC is 20:59 IST: not yet. 15:30 UTC is 21:00 IST: due, dated the IST day.
  assert.equal(DC.dayCloseDue(st, Date.parse("2026-09-25T15:29:00Z"), 330).due, false);
  assert.deepEqual(DC.dayCloseDue(st, Date.parse("2026-09-25T15:30:00Z"), 330), { due: true, date: "2026-09-25" });
  assert.deepEqual(DC.dayCloseDue(st, Date.parse("2026-09-25T19:00:00Z"), 330), { due: false, date: "2026-09-26" }, "after midnight it is the next day, and its hour has not come");
  assert.equal(DC.maskMobile("919876543210"), "•••••3210");
});

test("pure: the message is the day in counts and totals, and names nobody", () => {
  const txt = DC.dayCloseText({ date: "2026-09-25", unbilled: 3,
    close: { pulse: { seen: 128, registered: 142, noShow: 6, waiting: 5, inConsultation: 2, doorToDoctor: { medianMin: 24, p90Min: 71 } },
      rooms: [{ room: "Room 1", doctor: "Dr Rao", seen: 45 }], priority: { senior: 9, emergency: 2 }, offline: 4 },
    money: { net: 18595000, count: 131, refunds: { total: 150000, count: 2 } } }, "City Hospital");
  assert.match(txt, /^City Hospital, day close 2026-09-25\./);
  assert.match(txt, /Patients seen: 128 of 142 registered, 6 no-shows\./);
  assert.match(txt, /Collected: ₹1,85,950 net from 131 bills, after 2 refunds of ₹1,500\. Not yet paid: 3\./);
  assert.match(txt, /Put ahead of the queue: 9 senior citizen, 2 emergency\./);
  assert.match(txt, /Busiest: Room 1 \(Dr Rao\), 45 seen\./);
  assert.match(DC.dayCloseText({ date: "d", moneyUnread: true, close: { pulse: {} } }, "X"), /Money: could not be read/, "a failed money read is said");
});

test("POST /org/day-close-settings: 401, 403 for a nurse and another hospital, bad input refused; saved, read back masked", async () => {
  seed();
  const body = { orgId: "org-a", settings: { enabled: true, hour: 21, mobile: "9876543210" } };
  assert.equal((await api("/org/day-close-settings", "POST", body)).__status, 401);
  assert.equal((await api("/org/day-close-settings", "POST", body, NURSE_A)).__status, 403);
  const other = await api("/org/day-close-settings", "POST", body, HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  const bad = await api("/org/day-close-settings", "POST", { ...body, settings: { enabled: true, hour: 30, mobile: "9876543210" } }, OWNER_A);
  assert.equal(bad.__status, 422); assert.match(bad.message, /Nothing was saved/);
  const ok = await api("/org/day-close-settings", "POST", body, OWNER_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.deepEqual([ok.settings.enabled, ok.settings.hour, ok.settings.mobileMasked], [true, 21, "•••••3210"]);
  assert.ok(!JSON.stringify(ok).includes("9876543210"), "the number never comes back whole");
  // Changing the hour with the number left blank keeps the saved number.
  const again = await api("/org/day-close-settings", "POST", { orgId: "org-a", settings: { enabled: true, hour: 19, mobile: "" } }, OWNER_A);
  assert.equal(again.__status, 200, JSON.stringify(again));
  assert.equal(docs.get("q_orgs/org-a").fields.wardsynq.dayClose.mobile, "919876543210");
  const got = await api("/org/day-close-settings?orgId=org-a", "GET", null, OWNER_A);
  assert.equal(got.__status, 200, JSON.stringify(got));
  assert.equal(got.settings.hour, 19);
});

test("POST /ops/day-close-all: only the admin token; sends once a day at the hour, retries a failure at most three times", async () => {
  seed();
  // Hour 0 on the hospital's clock is always past: due whenever the job runs.
  await api("/org/day-close-settings", "POST", { orgId: "org-a", settings: { enabled: true, hour: 0, mobile: "9876543210" } }, OWNER_A);
  const refused = await api("/ops/day-close-all", "POST", {}, NURSE_A);
  assert.ok(refused.__status === 401 || refused.__status === 403, JSON.stringify(refused));
  H.ENV.UPDATES_ADMIN_TOKEN = "admin-token-for-tests";
  const as = () => onRequest({ request: new Request("https://x/api/queue/ops/day-close-all", { method: "POST", headers: { "X-Admin-Token": H.ENV.UPDATES_ADMIN_TOKEN } }), env: H.ENV }).then((r) => r.json());
  sent.length = 0; waUp = true;
  const r1 = await as();
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(sent.length, 1, "sent");
  assert.equal(sent[0].toE164, "919876543210");
  assert.match(sent[0].body, /day close/);
  await as();
  assert.equal(sent.length, 1, "not twice in a day, however often the job runs");
  // A day whose send failed is retried on a later hour, at most three attempts.
  const key = [...docs.keys()].find((k) => k.startsWith("q_dayclose_sent/"));
  docs.get(key).fields.status = "failed"; docs.get(key).fields.at = Date.now() - 2 * 3600e3; docs.get(key).fields.attempts = 1;
  await as();
  assert.equal(sent.length, 2, "retried");
  assert.equal(docs.get(key).fields.attempts, 2);
  docs.get(key).fields.status = "failed"; docs.get(key).fields.at = Date.now() - 2 * 3600e3; docs.get(key).fields.attempts = 3;
  await as();
  assert.equal(sent.length, 2, "three attempts, then it stops and the screen says it failed");
  delete H.ENV.UPDATES_ADMIN_TOKEN;
});

test("POST /day-close/send: sends to the saved number now; says so plainly when WhatsApp is not set up", async () => {
  seed();
  assert.equal((await api("/day-close/send", "POST", { orgId: "org-a" }, OWNER_A)).error, "no_number");
  await api("/org/day-close-settings", "POST", { orgId: "org-a", settings: { enabled: false, hour: 21, mobile: "9876543210" } }, OWNER_A);
  sent.length = 0; waUp = true;
  const ok = await api("/day-close/send", "POST", { orgId: "org-a" }, OWNER_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok)); assert.match(ok.message, /Sent to •••••3210/);
  assert.equal(sent.length, 1);
  assert.ok(!/Asha|mrn|mobile/i.test(sent[0].body), "names nobody");
  waUp = false;
  const down = await api("/day-close/send", "POST", { orgId: "org-a" }, OWNER_A);
  assert.equal(down.__status, 502); assert.match(down.message, /WhatsApp is not set up on the server/);
  waUp = true;
  assert.equal((await api("/day-close/send", "POST", { orgId: "org-a" }, NURSE_A)).__status, 403);
});

test("the console: the WhatsApp block for the owner in Close the day, the number masked, failures in words, 44px controls", () => {
  const h = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
  assert.match(h, /can\("staff\.admin"\)\|\|st\.ownsOrg\?'<div id="dcWaHost"><\/div>'/, "only the owner or an administrator sees it");
  assert.match(h, /api\("org\/day-close-settings\?orgId="/);
  assert.match(h, /api\("day-close\/send",\{method:"POST"/);
  assert.match(h, /esc\(s\.mobileMasked\)\+" \(saved\)"/, "the saved number is only ever shown masked");
  assert.match(h, /whatsapp_not_configured:"WhatsApp is not set up on the server"/, "a failure is said in words, not a code");
  assert.match(h, /\.dc-wa select,\.dc-wa input\[type=tel\]\{min-height:44px/);
});

test("the hourly worker cron calls it, and the setting is kept on the hospital", () => {
  assert.match(readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8"), /post\("\/api\/queue\/ops\/day-close-all"\)/);
  assert.match(readFileSync(new URL("../functions/_opd_org.js", import.meta.url), "utf8"), /"freeReviewDays", "dayClose"\]/);
});
