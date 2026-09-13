/* functions/_accounts_store.js — the hospital's books: storage for wardsynq/wardsynq-accounting.js.
 *
 * Every rule is in the pure module; this file reads, calls it, writes, audits. Financial data, not clinical.
 *
 * WRITE-ONCE. A journal entry is created with a "must not already exist" precondition and never updated or
 * deleted; a correction is a reversal entry. Entries posted from billing use an id derived from the billing
 * event (source kind + id), so the same event posted twice is refused by the store itself, not by a check
 * that could race.
 *
 * Entries are read by period ("org|YYYY-MM"), from the start of the Indian financial year (1 April) to the
 * date asked for, so a hospital's growing history never truncates this year's books.
 */
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { qAudit } from "./_queue_engine.js";
import * as A from "../wardsynq/wardsynq-accounting.js";

const now = () => Date.now();
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 120);
const audit = (env, orgId, actor, action, meta) => qAudit(env, { hospitalId: orgId, ticketId: "", actor: actor || "", action, meta: String(meta || "").slice(0, 200) });
const fail = (e) => ({ ok: false, error: e.code || "accounting_error", message: e.message });
const SCAN = 2000;

async function chartOf(env, orgId) {
  const r = await fsQuery(env, "q_acct_chart", { where: { field: "orgId", value: String(orgId) }, limit: 500 });
  if (!r.length) return { chart: A.DEFAULT_CHART.map(A.account), defaulted: true };
  return { chart: r.map((x) => A.account(x.fields)), defaulted: false };
}
async function closedOf(env, orgId) {
  const d = await fsGet(env, "q_acct_periods/" + sanitize(orgId));
  return (d && d.fields && d.fields.closed) || [];
}
function fyStart(date) { const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)); return `${m >= 4 ? y : y - 1}-04`; }
function periodsBetween(fromPeriod, toPeriod) {
  const out = []; let [y, m] = fromPeriod.split("-").map(Number);
  while (`${y}-${String(m).padStart(2, "0")}` <= toPeriod && out.length < 36) { out.push(`${y}-${String(m).padStart(2, "0")}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
}
async function entriesFor(env, orgId, periods) {
  const all = []; let partial = false;
  for (const p of periods) {
    const r = await fsQuery(env, "q_acct_entries", { where: { field: "orgPeriod", value: `${orgId}|${p}` }, limit: SCAN });
    if (r.length >= SCAN) partial = true;
    for (const x of r) all.push({ id: x.id, ...x.fields });
  }
  return { entries: all, partial };
}
async function write(env, orgId, id, entry, actorId) {
  const doc = { orgId: String(orgId), orgPeriod: `${orgId}|${entry.period}`, ...entry, postedBy: actorId, postedAt: now() };
  try { await fsCommit(env, [wCreate(env, "q_acct_entries/" + id, doc)]); }
  catch (e) { return { ok: false, error: "already_posted", message: "This entry was already posted." }; }
  return { ok: true, entry: { id, ...doc } };
}

export async function getChart(env, orgId) { return { ok: true, ...(await chartOf(env, orgId)) }; }

export async function saveAccount(env, orgId, input, actorId) {
  let a; try { a = A.account(input); } catch (e) { return fail(e); }
  const { chart, defaulted } = await chartOf(env, orgId);
  const writes = [];
  // The first change materialises the starter chart, so the hospital's chart is always complete on record.
  if (defaulted) for (const c of chart) if (c.code !== a.code) writes.push(wUpdate(env, "q_acct_chart/" + sanitize(orgId) + "__" + sanitize(c.code), { orgId: String(orgId), ...c }));
  writes.push(wUpdate(env, "q_acct_chart/" + sanitize(orgId) + "__" + sanitize(a.code), { orgId: String(orgId), ...a }));
  await fsCommit(env, writes);
  await audit(env, orgId, actorId, "accounts:account_saved", `${a.code} ${a.name} ${a.type} ${a.open ? "open" : "closed"}`);
  return { ok: true, account: a };
}

export async function postEntry(env, orgId, input, actorId) {
  const [{ chart }, closed] = await Promise.all([chartOf(env, orgId), closedOf(env, orgId)]);
  let e; try { e = A.journalEntry(input, chart, closed); } catch (err) { return fail(err); }
  const r = await write(env, orgId, crypto.randomUUID().replace(/-/g, ""), e, actorId);
  if (r.ok) await audit(env, orgId, actorId, "accounts:entry_posted", `${e.date} ${e.totalPaise} ${e.memo}`);
  return r;
}

export async function reverseEntry(env, orgId, entryId, date, reason, actorId) {
  if (!String(reason || "").trim()) return { ok: false, error: "reason_required", message: "Say why this entry is being reversed." };
  const d = await fsGet(env, "q_acct_entries/" + sanitize(entryId));
  if (!d || d.fields.orgId !== String(orgId)) return { ok: false, error: "not_found" };
  const [{ chart }, closed] = await Promise.all([chartOf(env, orgId), closedOf(env, orgId)]);
  let rev;
  // The reversal's own id is fixed by the original, so a second reversal collides in the store.
  try { rev = A.reversalOf({ id: d.id || entryId, ...d.fields }, date, [], chart, closed); } catch (err) { return fail(err); }
  rev.memo = rev.memo + " (" + String(reason).slice(0, 80) + ")";
  const r = await write(env, orgId, "rev-" + sanitize(entryId), rev, actorId);
  if (!r.ok) return { ok: false, error: "already_reversed", message: "This entry was already reversed." };
  await audit(env, orgId, actorId, "accounts:entry_reversed", `${entryId} ${reason}`);
  return r;
}

export async function trialBalanceAt(env, orgId, toDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(toDate))) return { ok: false, error: "bad_date", message: "Choose a date." };
  const { chart } = await chartOf(env, orgId);
  const { entries, partial } = await entriesFor(env, orgId, periodsBetween(fyStart(toDate), toDate.slice(0, 7)));
  return { ok: true, ...A.trialBalance(entries, chart, toDate), financialYearFrom: fyStart(toDate) + "-01", partial };
}

export async function ledger(env, orgId, code, from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to)) || to < from) return { ok: false, error: "bad_range", message: "Choose from and to dates, from first." };
  const { entries, partial } = await entriesFor(env, orgId, periodsBetween(from.slice(0, 7), to.slice(0, 7)));
  const lines = entries.filter((e) => e.date >= from && e.date <= to)
    .flatMap((e) => e.lines.filter((l) => l.account === code).map((l) => ({ entryId: e.id, date: e.date, memo: e.memo, debit: l.debit, credit: l.credit, reverses: e.reverses || null })))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, account: code, lines, partial };
}

export async function closePeriodFor(env, orgId, period, actorId) {
  const [{ chart }, closed] = await Promise.all([chartOf(env, orgId), closedOf(env, orgId)]);
  if (!/^\d{4}-\d{2}$/.test(String(period))) return fail(new A.AccountingError("bad_period", "a period is YYYY-MM"));
  const { entries, partial } = await entriesFor(env, orgId, periodsBetween(fyStart(period + "-01"), period));
  if (partial) return { ok: false, error: "too_many_entries_to_check", message: "Too many entries to check this period; nothing was closed." };
  let next; try { next = A.closePeriod(period, entries, chart, closed); } catch (e) { return fail(e); }
  await fsCommit(env, [wUpdate(env, "q_acct_periods/" + sanitize(orgId), { orgId: String(orgId), closed: next, updatedAt: now() })]);
  await audit(env, orgId, actorId, "accounts:period_closed", period);
  return { ok: true, closed: next };
}
export async function periods(env, orgId) { return { ok: true, closed: await closedOf(env, orgId) }; }

/** Billing -> books. Idempotent by the billing event: posting the same event again is refused by the store. */
export async function postBillingEvent(env, orgId, ev, actorId) {
  const draft = A.entryForBillingEvent(ev);
  if (!draft) return { ok: true, skipped: "not_an_accounting_event" };
  const [{ chart }, closed] = await Promise.all([chartOf(env, orgId), closedOf(env, orgId)]);
  let e; try { e = A.journalEntry(draft, chart, closed); } catch (err) { return fail(err); }
  const r = await write(env, orgId, "bill-" + sanitize(ev.kind) + "-" + sanitize(ev.id), e, actorId || "system:billing");
  if (!r.ok && r.error === "already_posted") return { ok: true, skipped: "already_posted" };
  if (r.ok) await audit(env, orgId, actorId || "system:billing", "accounts:billing_posted", `${ev.kind} ${ev.id} ${ev.amountPaise}`);
  return r;
}
