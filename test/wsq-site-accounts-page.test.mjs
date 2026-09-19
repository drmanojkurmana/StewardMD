/* The Accounts page: rupees become exact paise, and a failed or partial read never looks balanced. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const sb = { window: { WSQ: { page() {} } } };
vm.createContext(sb); vm.runInContext(readFileSync(new URL("../wardsynq/site/pages/accounts.js", import.meta.url), "utf8"), sb);
const P = sb.window.WSQ._accounts;
const C = { esc };

test("rupees typed become exact whole paise, and anything else is refused", () => {
  assert.equal(P.toPaise("1,250.50"), 125050);
  assert.equal(P.toPaise("0.07"), 7);
  assert.equal(P.toPaise("100"), 10000);
  assert.equal(P.toPaise("10.005"), null);
  assert.equal(P.toPaise("-5"), null);
  assert.equal(P.toPaise("abc"), null);
});

test("a failed trial balance never reads as balanced; a partial one says so; an unbalanced one shouts", () => {
  const failed = P.tbHtml(C, { ok: false, message: "Choose a date." });
  assert.match(failed, /Do not read this as balanced/);
  assert.ok(!/>Balanced/.test(failed));
  const partial = P.tbHtml(C, { ok: true, balanced: true, totalDebit: 5, totalCredit: 5, financialYearFrom: "2026-04-01", partial: true, accounts: [] });
  assert.match(partial, /may be incomplete/);
  assert.match(P.tbHtml(C, { ok: true, balanced: false, totalDebit: 5, totalCredit: 4, financialYearFrom: "2026-04-01", accounts: [] }), /NOT balanced/);
  assert.match(P.ledgerHtml(C, { ok: false }), /Do not read this as no movement/);
  const led = P.ledgerHtml(C, { ok: true, lines: [{ entryId: "e1", date: "2026-09-13", memo: "x", debit: 100, credit: 0 }, { entryId: "e2", date: "2026-09-14", memo: "y", debit: 0, credit: 100, reverses: "e1" }] });
  assert.ok(led.includes('data-acc="reverse" data-id="e1"'));
  assert.ok(!led.includes('data-id="e2"'), "a reversal is not offered for reversal");
});
