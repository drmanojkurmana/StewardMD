/* CLIN-15 (audit B:A5): a month's rota past 1000 rows was read as one capped query, so today's on-duty
 * staff could fall out of the critical-alert recipients with no sign the rota was cut short. The rota is
 * now read in pages, and a read that still stops short says so on the recipients.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-rota-paging.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
const { seedHospital, docs, ORG, NURSE, idFor } = await import("./_wardsynq-alert-harness.mjs");
const ROSTER = await import("../functions/_roster_store.js");
const { resolveRecipients } = await import("../functions/_wardsynq/alert-recipients.js");

const readers = (onDuty) => ({
  latest: async (t) => (t === "Encounter" ? { location: { ward: "Medical A" } } : null),
  members: async () => [{ identity: idFor(NURSE), role: "nurse", active: true }],
  onDuty, dutyStatuses: async () => ({ statuses: [] }),
});

test("1500 rota rows in the month: today's nurse is still on duty and still told", async () => {
  seedHospital();
  const month = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
  // Filler named to sort BEFORE the seeded rows, so a single capped read would return only filler.
  for (let i = 0; i < 1500; i++) {
    docs.set(`q_roster_assign/0000-f${String(i).padStart(4, "0")}`, { fields: { orgId: ORG, orgMonth: ORG + "|" + month, identity: "filler" + i, date: month + "-01", shiftId: "day", status: "active" }, updateTime: "t1" });
  }
  const duty = await ROSTER.onDuty({}, ORG, "Medical A", 330);
  assert.equal(duty.partial, false);
  assert.ok(duty.onDuty.some((a) => a.identity === idFor(NURSE)), "the nurse on the rota is on duty");
  const r = await resolveRecipients({ orgId: ORG, loop: { encounterId: "e1" }, level: "overdue", policy: null, nowMs: Date.now() },
    readers((u) => ROSTER.onDuty({}, ORG, u, 330)));
  assert.ok(r.recipients.includes(`${ORG}~${idFor(NURSE)}`), JSON.stringify(r));
  assert.equal("rotaPartial" in r, false);
});

test("a rota read that stopped short is said on the recipients, never silent", async () => {
  const r = await resolveRecipients({ orgId: ORG, loop: { encounterId: "e1" }, level: "overdue", policy: null, nowMs: Date.now() },
    readers(async () => ({ ok: true, onDuty: [], partial: true })));
  assert.equal(r.reason, "NO_RECIPIENT");
  assert.equal(r.rotaPartial, true);
});
