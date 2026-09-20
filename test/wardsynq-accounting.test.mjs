/* Double-entry accounting invariants (wardsynq/wardsynq-accounting.js). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CHART, account, journalEntry, reversalOf, trialBalance, closePeriod, entryForBillingEvent } from "../wardsynq/wardsynq-accounting.js";

const CHART = DEFAULT_CHART.map(account);
const je = (lines, extra) => journalEntry({ date: "2026-09-13", memo: "t", lines, ...extra }, CHART, []);

test("INVARIANT: an unbalanced entry is refused, never adjusted", () => {
  assert.throws(() => je([{ account: "1000", debit: 50000 }, { account: "4000", credit: 49999 }]), /do not balance/);
  assert.equal(je([{ account: "1000", debit: 50000 }, { account: "4000", credit: 50000 }]).totalPaise, 50000);
});

test("INVARIANT: amounts are whole non-negative paise; one side per line; accounts must exist and be open", () => {
  assert.throws(() => je([{ account: "1000", debit: 100.5 }, { account: "4000", credit: 100.5 }]), /whole paise/);
  assert.throws(() => je([{ account: "1000", debit: -5 }, { account: "4000", credit: -5 }]), /whole paise/);
  assert.throws(() => je([{ account: "1000", debit: 5, credit: 5 }, { account: "4000", credit: 0 }]), /exactly one/);
  assert.throws(() => je([{ account: "9999", debit: 5 }, { account: "4000", credit: 5 }]), /not in the chart/);
  const closedChart = CHART.map((a) => (a.code === "4000" ? { ...a, open: false } : a));
  assert.throws(() => journalEntry({ date: "2026-09-13", lines: [{ account: "1000", debit: 5 }, { account: "4000", credit: 5 }] }, closedChart, []), /is closed/);
  assert.throws(() => je([{ account: "1000", debit: 5 }]), /two lines/);
});

test("INVARIANT: nothing posts into a closed period, and a period closes only on balanced books", () => {
  assert.throws(() => journalEntry({ date: "2026-08-31", lines: [{ account: "1000", debit: 5 }, { account: "4000", credit: 5 }] }, CHART, ["2026-08"]), /2026-08 is closed/);
  const good = je([{ account: "1000", debit: 5 }, { account: "4000", credit: 5 }]);
  assert.deepEqual(closePeriod("2026-09", [good], CHART, []), ["2026-09"]);
  const corrupted = { ...good, lines: [{ account: "1000", debit: 5, credit: 0 }, { account: "4000", debit: 0, credit: 4 }] };
  assert.throws(() => closePeriod("2026-09", [corrupted], CHART, []), /do not balance/);
  assert.throws(() => closePeriod("2026-09", [good], CHART, ["2026-09"]), /already closed/);
});

test("INVARIANT: a correction is a reversal, only once, and never a reversal of a reversal", () => {
  const orig = { id: "je1", ...je([{ account: "1100", debit: 120000 }, { account: "4100", credit: 120000 }]) };
  const rev = reversalOf(orig, "2026-09-14", [orig], CHART, []);
  assert.equal(rev.reverses, "je1");
  assert.deepEqual(rev.lines.map((l) => [l.account, l.debit, l.credit]), [["1100", 0, 120000], ["4100", 120000, 0]]);
  const tb = trialBalance([orig, { id: "je2", ...rev }], CHART);
  assert.ok(tb.accounts.every((a) => a.balance === 0), "original + reversal nets to zero");
  assert.throws(() => reversalOf(orig, "2026-09-15", [orig, { id: "je2", ...rev }], CHART, []), /already reversed/);
  assert.throws(() => reversalOf({ id: "je2", ...rev }, "2026-09-15", [], CHART, []), /not by reversing it/);
});

test("the trial balance always balances for valid entries, with balances on each account's normal side", () => {
  const entries = [
    entryForBillingEvent({ kind: "invoice_posted", amountPaise: 200000, date: "2026-09-10", category: "inpatient", id: "inv1" }),
    entryForBillingEvent({ kind: "payment", amountPaise: 150000, date: "2026-09-11", method: "upi", id: "pay1" }),
    entryForBillingEvent({ kind: "discount", amountPaise: 20000, date: "2026-09-11", id: "d1" }),
    entryForBillingEvent({ kind: "write_off", amountPaise: 30000, date: "2026-09-12", id: "w1" }),
  ].map((e) => journalEntry(e, CHART, []));
  const tb = trialBalance(entries, CHART);
  assert.equal(tb.balanced, true);
  const bal = Object.fromEntries(tb.accounts.map((a) => [a.code, a.balance]));
  assert.equal(bal["1100"], 0, "receivable: 2000 invoiced - 1500 paid - 200 discount - 300 written off");
  assert.equal(bal["1010"], 150000, "a UPI payment lands in the bank, not the cash box");
  assert.equal(bal["4100"], 200000);
  assert.equal(bal["5000"] + bal["5100"], 50000);
  assert.equal(trialBalance(entries, CHART, "2026-09-10").accounts.find((a) => a.code === "1100").balance, 200000, "as at a date");
  assert.equal(entryForBillingEvent({ kind: "unknown" }), null);
});
