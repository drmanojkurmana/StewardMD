#!/usr/bin/env node
/* scripts/audit-chain-live-check.mjs - G4: confirm the LIVE clinical audit chain without anyone's cron.
 *
 * Compares production connect_audit_event rows (connector wardsynq) written since a timestamp with
 * wardsynq_audit_chain links, and re-hashes each hospital's newest links with the same code the app
 * uses (D1Repository.auditChainRows + verifyAuditChain), so "the chain is live" is measured, not assumed.
 *
 * READ ONLY: every statement is a SELECT, sent through `wrangler d1 execute --remote --json`.
 * Needs `wrangler login` with access to the database. Prints no audit row content: ids, seqs, counts.
 *
 *   node scripts/audit-chain-live-check.mjs --since 2026-09-14T11:10:00Z [--db stewardmd-connect] [--tenant <id>] [--limit 500]
 *
 * Exit 0: every row since the timestamp is linked, no link lost its row, and each chain verifies.
 * Exit 1: a finding (named on stdout). Exit 2: nothing to confirm (no rows since the timestamp) or a bad argument.
 * Exit 3: the database could not be read. None of these is ever reported as confirmed.
 */
import { execFileSync } from "node:child_process";
import { D1Repository } from "../functions/_wardsynq/repository-d1.js";
import { verifyAuditChain } from "../functions/_wardsynq/audit-chain.js";

const SAMPLE = 50;

/** PURE. A SQL literal for one bound value (wrangler's --command takes no parameters). */
function literal(v) {
  if (v == null) return "NULL";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}
/** PURE. `?` placeholders replaced left to right, skipping quoted text. */
function inline(sql, args) {
  let i = 0, out = "", quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    if (ch === "?" && !quoted) { out += literal(args[i++]); continue; }
    out += ch;
  }
  return out;
}

/** A read-only D1-shaped binding over `wrangler d1 execute --remote --json`. run(sql) -> rows[]. */
function wranglerBinding(db, run) {
  const exec = run || ((sql) => {
    const raw = execFileSync("npx", ["wrangler", "d1", "execute", db, "--remote", "--json", "--command", sql], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    const parsed = JSON.parse(raw.slice(raw.indexOf("[")));
    return (parsed[0] && parsed[0].results) || [];
  });
  return {
    prepare(sql) {
      if (!/^\s*SELECT\b/i.test(sql)) throw new Error("read-only check: refused a statement that is not a SELECT");
      const bound = (args) => ({ all: async () => ({ results: exec(inline(sql, args)) }), first: async () => exec(inline(sql, args))[0] || null });
      return { bind: (...args) => bound(args), ...bound([]) };
    },
  };
}

/**
 * The check itself, over any D1-shaped binding (production through wrangler, SQLite in the test).
 * @returns {{ok, status: "confirmed"|"findings"|"nothing_to_confirm", since, tenants: object[], findings: string[]}}
 */
async function liveCheck(binding, opts) {
  const since = new Date(opts.since).toISOString();
  const limit = Math.max(1, Math.min(5000, Number(opts.limit) || 500));
  const only = opts.tenant ? " AND tenant_id=?" : "";
  const arg = opts.tenant ? [opts.tenant] : [];
  const q = async (sql, args) => (await binding.prepare(sql).bind(...args).all()).results || [];

  const written = await q(`SELECT tenant_id, COUNT(*) AS n FROM connect_audit_event WHERE connector_id='wardsynq' AND ts>=?${only} GROUP BY tenant_id`, [since, ...arg]);
  const chains = await q(`SELECT tenant_id, MAX(chain_seq) AS head, COUNT(*) AS links FROM wardsynq_audit_chain WHERE 1=1${only} GROUP BY tenant_id`, arg);
  const unlinked = await q(`SELECT a.tenant_id, a.id, a.ts FROM connect_audit_event a LEFT JOIN wardsynq_audit_chain c ON c.audit_id=a.id AND c.tenant_id=a.tenant_id WHERE a.connector_id='wardsynq' AND a.ts>=?${only.replace("tenant_id", "a.tenant_id")} AND c.audit_id IS NULL ORDER BY a.ts LIMIT ${SAMPLE + 1}`, [since, ...arg]);
  const orphans = await q(`SELECT c.tenant_id, c.chain_seq, c.audit_id FROM wardsynq_audit_chain c LEFT JOIN connect_audit_event a ON a.id=c.audit_id WHERE a.id IS NULL${only.replace("tenant_id", "c.tenant_id")} ORDER BY c.chain_seq LIMIT ${SAMPLE + 1}`, arg);

  const findings = [];
  if (unlinked.length) findings.push(`${unlinked.length > SAMPLE ? "More than " + SAMPLE : unlinked.length} audit row(s) since ${since} have no chain link, e.g. ${unlinked.slice(0, 5).map((r) => `${r.tenant_id}/${r.id} at ${r.ts}`).join(", ")}.`);
  if (orphans.length) findings.push(`${orphans.length > SAMPLE ? "More than " + SAMPLE : orphans.length} chain link(s) point at an audit row that is gone, e.g. ${orphans.slice(0, 5).map((r) => `${r.tenant_id} seq ${r.chain_seq}`).join(", ")}.`);

  const repo = new D1Repository(binding);
  const tenants = [];
  for (const c of chains) {
    const head = Number(c.head), links = Number(c.links);
    if (links !== head) findings.push(`${c.tenant_id}: the chain head is ${head} but ${links} links exist, so ${Math.abs(head - links)} link number(s) are missing.`);
    const v = await verifyAuditChain(repo, c.tenant_id, { limit });
    if (v.status !== "ok") findings.push(`${c.tenant_id}: ${v.message}`);
    const w = written.find((x) => x.tenant_id === c.tenant_id);
    tenants.push({ tenantId: c.tenant_id, rowsSince: w ? Number(w.n) : 0, head, verify: v.status, checked: v.checked || 0 });
  }
  for (const w of written) if (!chains.some((c) => c.tenant_id === w.tenant_id)) {
    findings.push(`${w.tenant_id}: ${w.n} audit row(s) since ${since} but no chain at all.`);
    tenants.push({ tenantId: w.tenant_id, rowsSince: Number(w.n), head: 0, verify: "no_chain", checked: 0 });
  }
  const rowsSince = written.reduce((n, w) => n + Number(w.n), 0);
  const status = findings.length ? "findings" : rowsSince ? "confirmed" : "nothing_to_confirm";
  return { ok: status === "confirmed", status, since, rowsSince, tenants, findings };
}

function argOf(argv, name) { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : undefined; }

async function main(argv) {
  const since = argOf(argv, "since");
  if (!since || !Number.isFinite(Date.parse(since))) { console.error("Usage: node scripts/audit-chain-live-check.mjs --since <ISO time> [--db stewardmd-connect] [--tenant <id>] [--limit 500]"); return 2; }
  let r;
  try { r = await liveCheck(wranglerBinding(argOf(argv, "db") || "stewardmd-connect"), { since, tenant: argOf(argv, "tenant"), limit: argOf(argv, "limit") }); }
  catch (e) { console.error("NOT CONFIRMED: the database could not be read (" + String((e && e.message) || e).split("\n")[0].slice(0, 200) + ")."); return 3; }
  for (const t of r.tenants) console.log(`${t.tenantId}: ${t.rowsSince} row(s) since ${r.since}, chain head ${t.head}, newest ${t.checked} verified: ${t.verify}`);
  for (const f of r.findings) console.log("FINDING: " + f);
  if (r.status === "confirmed") { console.log(`CONFIRMED: ${r.rowsSince} audit row(s) since ${r.since} are all linked and every chain verifies.`); return 0; }
  if (r.status === "nothing_to_confirm") { console.log(`NOT CONFIRMED: no audit rows were written since ${r.since}, so the live chain has not been observed.`); return 2; }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).then((code) => process.exit(code));

export { literal, inline, wranglerBinding, liveCheck, main };
