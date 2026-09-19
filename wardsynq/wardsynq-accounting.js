/* wardsynq/wardsynq-accounting.js — double-entry accounting. PURE: no I/O, every invariant unit-tested.
 *
 * SITS BESIDE THE BILLING LEDGER, DOES NOT REPLACE IT. The governed invoice ledger stays the source of what
 * a patient was charged and paid; this is the hospital's books - the chart of accounts, journal entries,
 * the general ledger, receivables, payables and closed periods - fed from those billing events.
 *
 * THE INVARIANTS, MACHINE-ENFORCED (an entry that breaks one is refused, never "fixed"):
 *   1. Money is integer paise. No floating point ever touches an amount.
 *   2. Every entry balances: total debits === total credits, and both are > 0.
 *   3. Every line names an account that exists and is open, with exactly one of debit or credit > 0.
 *   4. A posted entry is never edited or deleted. A mistake is corrected by a REVERSAL entry (every line
 *      flipped) that points back at the original, and an original can be reversed only once.
 *   5. Nothing posts into a closed period. Closing a period is refused if it would leave the books unbalanced.
 */

const ACCOUNT_TYPES = Object.freeze(["asset", "liability", "equity", "income", "expense"]);
// Which side increases a balance: assets and expenses grow with debits; the rest with credits.
const NORMAL = Object.freeze({ asset: "debit", expense: "debit", liability: "credit", equity: "credit", income: "credit" });

class AccountingError extends Error { constructor(code, message) { super(message); this.code = code; } }

const isPaise = (n) => Number.isSafeInteger(n) && n >= 0;
const periodOf = (date) => String(date).slice(0, 7);          // "YYYY-MM"

/** A starter chart of accounts for an Indian hospital. Codes are the hospital's to change. */
const DEFAULT_CHART = Object.freeze([
  { code: "1000", name: "Cash in hand", type: "asset" },
  { code: "1010", name: "Bank", type: "asset" },
  { code: "1100", name: "Patient receivables", type: "asset" },
  { code: "1110", name: "Insurance / TPA receivables", type: "asset" },
  { code: "1200", name: "Pharmacy inventory", type: "asset" },
  { code: "2000", name: "Supplier payables", type: "liability" },
  { code: "2100", name: "Patient advances and deposits", type: "liability" },
  { code: "2200", name: "GST payable", type: "liability" },
  { code: "3000", name: "Owner's equity", type: "equity" },
  { code: "4000", name: "Consultation income", type: "income" },
  { code: "4100", name: "Inpatient income", type: "income" },
  { code: "4200", name: "Pharmacy income", type: "income" },
  { code: "4300", name: "Laboratory and imaging income", type: "income" },
  { code: "5000", name: "Discounts allowed", type: "expense" },
  { code: "5100", name: "Bad debts written off", type: "expense" },
  { code: "5200", name: "Cost of medicines sold", type: "expense" },
]);

function account(input) {
  const i = input || {};
  const code = String(i.code || "").trim();
  if (!/^[A-Za-z0-9-]{2,20}$/.test(code)) throw new AccountingError("bad_code", "an account code is 2 to 20 letters, digits or dashes");
  if (!String(i.name || "").trim()) throw new AccountingError("name_required", "an account needs a name");
  if (!ACCOUNT_TYPES.includes(i.type)) throw new AccountingError("bad_type", "account type is one of " + ACCOUNT_TYPES.join(", "));
  return { code, name: String(i.name).trim(), type: i.type, open: i.open !== false };
}

/**
 * Validates a journal entry against the chart and the closed periods. Returns the normalised entry or throws.
 * input: { date, memo, lines: [{ account, debit?, credit?, memo? }], source?: {kind, id}, reverses? }
 */
function journalEntry(input, chart, closedPeriods) {
  const i = input || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(i.date))) throw new AccountingError("bad_date", "an entry date is YYYY-MM-DD");
  if ((closedPeriods || []).includes(periodOf(i.date))) throw new AccountingError("period_closed", `${periodOf(i.date)} is closed; post it in an open period`);
  const lines = Array.isArray(i.lines) ? i.lines : [];
  if (lines.length < 2) throw new AccountingError("too_few_lines", "an entry needs at least two lines");
  const byCode = new Map((chart || []).map((a) => [a.code, a]));
  let dr = 0, cr = 0;
  const out = lines.map((l, n) => {
    const acc = byCode.get(String(l.account || ""));
    if (!acc) throw new AccountingError("unknown_account", `line ${n + 1}: account ${l.account} is not in the chart`);
    if (!acc.open) throw new AccountingError("account_closed", `line ${n + 1}: account ${acc.code} is closed`);
    const d = l.debit == null ? 0 : l.debit, c = l.credit == null ? 0 : l.credit;
    if (!isPaise(d) || !isPaise(c)) throw new AccountingError("bad_amount", `line ${n + 1}: amounts are whole paise, never negative`);
    if ((d > 0) === (c > 0)) throw new AccountingError("one_side", `line ${n + 1}: exactly one of debit or credit`);
    dr += d; cr += c;
    if (!Number.isSafeInteger(dr) || !Number.isSafeInteger(cr)) throw new AccountingError("bad_amount", "entry total too large");
    return { account: acc.code, debit: d, credit: c, memo: String(l.memo || "").slice(0, 120) };
  });
  if (dr !== cr) throw new AccountingError("unbalanced", `debits ${dr} and credits ${cr} paise do not balance`);
  return { date: i.date, period: periodOf(i.date), memo: String(i.memo || "").slice(0, 200), lines: out, totalPaise: dr,
    source: i.source || null, reverses: i.reverses || null };
}

/** The reversal of a posted entry, dated `date`. Refused when it was already reversed. */
function reversalOf(original, date, existingEntries, chart, closedPeriods) {
  if (original.reverses) throw new AccountingError("cannot_reverse_reversal", "a reversal is corrected by posting a new entry, not by reversing it");
  if ((existingEntries || []).some((e) => e.reverses === original.id)) throw new AccountingError("already_reversed", `entry ${original.id} was already reversed`);
  return journalEntry({ date, memo: "Reversal of " + original.id + (original.memo ? ": " + original.memo : ""),
    lines: original.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, memo: l.memo })), reverses: original.id }, chart, closedPeriods);
}

/** General ledger: per account, debits, credits and balance on its normal side, over entries up to `toDate`. */
function trialBalance(entries, chart, toDate) {
  const rows = new Map((chart || []).map((a) => [a.code, { code: a.code, name: a.name, type: a.type, debit: 0, credit: 0 }]));
  for (const e of entries || []) {
    if (toDate && e.date > toDate) continue;
    for (const l of e.lines) { const r = rows.get(l.account); if (r) { r.debit += l.debit; r.credit += l.credit; } }
  }
  let dr = 0, cr = 0;
  const accounts = [...rows.values()].map((r) => {
    dr += r.debit; cr += r.credit;
    const balance = NORMAL[r.type] === "debit" ? r.debit - r.credit : r.credit - r.debit;
    return { ...r, balance };
  });
  return { accounts, totalDebit: dr, totalCredit: cr, balanced: dr === cr };
}

/** Closing a period: refused if any entry in or before it is unbalanced (which can only mean corrupted data). */
function closePeriod(period, entries, chart, closedPeriods) {
  if (!/^\d{4}-\d{2}$/.test(String(period))) throw new AccountingError("bad_period", "a period is YYYY-MM");
  if ((closedPeriods || []).includes(period)) throw new AccountingError("already_closed", `${period} is already closed`);
  const tb = trialBalance((entries || []).filter((e) => e.period <= period), chart);
  if (!tb.balanced) throw new AccountingError("books_unbalanced", `the books up to ${period} do not balance (${tb.totalDebit} vs ${tb.totalCredit}); investigate before closing`);
  return [...(closedPeriods || []), period].sort();
}

/* ---- billing events -> entries. The only place billing meets the books. ------------------------------ */
const INCOME_FOR = { consultation: "4000", inpatient: "4100", pharmacy: "4200", lab: "4300", imaging: "4300" };
/**
 * PURE. The entry a billing event implies, or null for events the books do not record.
 * event: { kind: "invoice_posted"|"payment"|"refund"|"discount"|"write_off"|"deposit", amountPaise, date,
 *          method?, category?, payer?: "patient"|"insurance", id }
 */
function entryForBillingEvent(ev) {
  const amt = ev.amountPaise, date = ev.date, src = { kind: "billing:" + ev.kind, id: ev.id };
  const receivable = ev.payer === "insurance" ? "1110" : "1100";
  const cashOrBank = ev.method === "cash" ? "1000" : "1010";
  switch (ev.kind) {
    case "invoice_posted": return { date, memo: "Invoice " + ev.id, source: src, lines: [{ account: receivable, debit: amt }, { account: INCOME_FOR[ev.category] || "4000", credit: amt }] };
    case "payment": return { date, memo: "Payment " + ev.id, source: src, lines: [{ account: cashOrBank, debit: amt }, { account: receivable, credit: amt }] };
    case "deposit": return { date, memo: "Deposit " + ev.id, source: src, lines: [{ account: cashOrBank, debit: amt }, { account: "2100", credit: amt }] };
    case "refund": return { date, memo: "Refund " + ev.id, source: src, lines: [{ account: receivable, debit: amt }, { account: cashOrBank, credit: amt }] };
    case "discount": return { date, memo: "Discount " + ev.id, source: src, lines: [{ account: "5000", debit: amt }, { account: receivable, credit: amt }] };
    case "write_off": return { date, memo: "Write-off " + ev.id, source: src, lines: [{ account: "5100", debit: amt }, { account: receivable, credit: amt }] };
    default: return null;
  }
}

export { ACCOUNT_TYPES, NORMAL, DEFAULT_CHART, AccountingError, account, journalEntry, reversalOf, trialBalance, closePeriod, entryForBillingEvent, periodOf };
