/* The OPD board's "unbilled" amount counts each unpaid order ONCE.
 *
 * The console raises the consultation fee with the patient's MRN AND the ticket (opd.html autoQueueConsultationFee),
 * and the board summed the order under both keys: a 500 rupee fee read "1000 unbilled" on the patient's card, and
 * Quick Pay asked for 1000. Found by the full-stack e2e (test/run-opd-fullstack-e2e.mjs). Real routes throughout.
 *
 * node --test --experimental-test-module-mocks test/opd-board-unbilled.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
const { H, seed } = await import("./opd-fullstack-server.mjs");
const { as, docs, ORG, ADMIN } = H;

const cardsOf = (board) => [...(board.pool || []), ...(board.rooms || []).flatMap((r) => r.tickets || [])];

test("an order carrying both the MRN and the ticket is counted once on the board", async () => {
  await seed();
  const tariffId = [...docs.keys()].find((k) => k.startsWith("q_tariff/")).slice(9);
  const q = await as(ADMIN, "/pool", "POST", { orgId: ORG, name: "Asha Rao", mobile: "9876543210", mrn: "SMD-WARD01-00001" });
  assert.equal(q.__status, 200, JSON.stringify(q));
  const o = await as(ADMIN, "/bill/order", "POST", { orgId: ORG, patientId: "SMD-WARD01-00001", ticketId: q.ticket.id, tariffId, qty: 1 });
  assert.equal(o.ok, true, JSON.stringify(o));
  const b = await as(ADMIN, "/opd-board?orgId=" + ORG, "GET");
  assert.equal(b.__status, 200, JSON.stringify(b).slice(0, 300));
  const card = cardsOf(b).find((t) => t.id === q.ticket.id);
  assert.ok(card, "the patient is on the board");
  assert.equal(card.unbilledAmount, 50000, "one 500 rupee fee is 500 unbilled, not 1000");
  assert.equal(card.billingStatus, "unbilled");
  // A second order for the same patient (keyed by MRN only) is added, still once each.
  const o2 = await as(ADMIN, "/bill/order", "POST", { orgId: ORG, patientId: "SMD-WARD01-00001", tariffId, qty: 1 });
  assert.equal(o2.ok, true);
  const b2 = await as(ADMIN, "/opd-board?orgId=" + ORG, "GET");
  assert.equal(cardsOf(b2).find((t) => t.id === q.ticket.id).unbilledAmount, 100000);
});
