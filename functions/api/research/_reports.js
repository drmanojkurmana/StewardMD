/* ResearchMD Phase 6.3 cost reports + pricing note (ES module, server side).
 * Contract: docs/research/contracts/phase-6/reports.md. Deterministic SQL
 * aggregation over research_ai_usage and research_credit_ledger; no LLM.
 * Unit: integer micro-USD. Project reports need owner/editor; user reports
 * are the caller's own; the pricing note is adminAuth. Outsiders get 404.
 */
import { adminAuth, adminErr } from "./_institutions.js";
import { walletKeyFor } from "./_credits.js";

function bounds(url) {
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const from = fromRaw === null || fromRaw === "" ? null : Number(fromRaw);
  const to = toRaw === null || toRaw === "" ? null : Number(toRaw);
  if ((from !== null && !Number.isInteger(from)) || (to !== null && !Number.isInteger(to)) ||
      (from !== null && to !== null && from > to)) return { bad: true };
  return { from, to };
}
function timeClause(from, to, col) {
  let sql = "";
  const binds = [];
  if (from !== null) { sql += " AND " + col + ">=?"; binds.push(from); }
  if (to !== null) { sql += " AND " + col + "<=?"; binds.push(to); }
  return { sql, binds };
}
async function usageAgg(db, where, binds) {
  const totals = await db.prepare(
    "SELECT COUNT(*) AS calls, COALESCE(SUM(cost_micro_usd),0) AS cost, COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout FROM research_ai_usage WHERE " + where)
    .bind(...binds).first();
  const group = async (expr, order) => {
    const rows = (await db.prepare(
      "SELECT " + expr + " AS key, COALESCE(SUM(cost_micro_usd),0) AS cost, COUNT(*) AS calls FROM research_ai_usage WHERE " + where + " GROUP BY key ORDER BY " + order)
      .bind(...binds).all()).results || [];
    return rows.map((r) => ({ key: r.key, costMicroUsd: r.cost, calls: r.calls }));
  };
  return {
    totalCostMicroUsd: (totals && totals.cost) || 0,
    tokensIn: (totals && totals.tin) || 0,
    tokensOut: (totals && totals.tout) || 0,
    calls: (totals && totals.calls) || 0,
    byStep: await group("step", "cost DESC, key ASC"),
    byTier: await group("tier", "cost DESC, key ASC"),
    byModel: await group("model", "cost DESC, key ASC"),
    byDay: await group("strftime('%Y-%m-%d', ts/1000, 'unixepoch')", "key ASC"),
  };
}
async function ledgerAgg(db, where, binds) {
  const rows = (await db.prepare(
    "SELECT reason, COALESCE(SUM(delta),0) AS s FROM research_credit_ledger WHERE " + where + " GROUP BY reason")
    .bind(...binds).all()).results || [];
  const by = {};
  let net = 0;
  for (const r of rows) { by[r.reason] = r.s; net += r.s; }
  return {
    grantedMicroUsd: by.grant || 0,
    reservedMicroUsd: -(by.reserve || 0),
    releasedMicroUsd: by.release || 0,
    settledMicroUsd: -(by.settle || 0),
    netMicroUsd: net,
  };
}
function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
async function usageCsv(db, scope, id, where, binds) {
  const rows = (await db.prepare(
    "SELECT strftime('%Y-%m-%d', ts/1000, 'unixepoch') AS day, step, tier, model, COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout, COALESCE(SUM(cost_micro_usd),0) AS cost FROM research_ai_usage WHERE " + where + " GROUP BY day, step, tier, model ORDER BY day ASC, step ASC, tier ASC, model ASC")
    .bind(...binds).all()).results || [];
  const lines = ["scope,day,step,tier,model,tokens_in,tokens_out,cost_micro_usd"];
  let total = 0;
  for (const r of rows) {
    total += r.cost;
    lines.push([scope, r.day, r.step, r.tier, r.model, r.tin, r.tout, r.cost].map(csvCell).join(","));
  }
  lines.push([scope, "TOTAL", "", "", "", "", "", total].map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}
function csvResponse(text, requestId) {
  return new Response(text, { status: 200, headers: {
    "content-type": "text/csv; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "x-request-id": requestId } });
}

/* ---- GET /v1/projects/{pid}/cost-report[.csv] (owner/editor) ----------------- */
export async function projectCostReport(ctx, projectId, url, csv) {
  const { db, uid, requestId, api } = ctx;
  const gate = await api.projectGate(db, projectId, uid, ["owner", "editor"]);
  if (gate.status) return api.gateErr(gate, "Cost reports need an owner or editor role", requestId);
  const b = bounds(url);
  if (b.bad) return api.err(400, "invalid_body", "from/to must be epoch-ms integers with from <= to", requestId);
  const t = timeClause(b.from, b.to, "ts");
  const ai = await usageAgg(db, "project_id=?" + t.sql, [projectId, ...t.binds]);
  /* Ledger join covers the project's worker jobs (pdf compute + gateway AI
   * settles). Suggestion settles carry request-id pointers, not job ids; they
   * are counted in ai but not in this join (reports.md limitation). */
  const ledger = await ledgerAgg(db, "job_id IN (SELECT id FROM research_job_runs WHERE project_id=?)", [projectId]);
  if (csv) return csvResponse(await usageCsv(db, "project", projectId, "project_id=?" + t.sql, [projectId, ...t.binds]), requestId);
  return api.json({ report: { scope: "project", id: projectId, from: b.from, to: b.to, unit: "micro-USD",
    ai, ledger, totalChargedMicroUsd: ledger.settledMicroUsd }, generatedTs: Date.now() },
    200, { "x-request-id": requestId });
}

/* ---- GET /v1/cost-report[.csv] (the caller's own) ---------------------------- */
export async function userCostReport(ctx, url, csv) {
  const { db, uid, claims, requestId, api } = ctx;
  const b = bounds(url);
  if (b.bad) return api.err(400, "invalid_body", "from/to must be epoch-ms integers with from <= to", requestId);
  const t = timeClause(b.from, b.to, "ts");
  const ai = await usageAgg(db, "user_id=?" + t.sql, [uid, ...t.binds]);
  const walletKey = walletKeyFor(uid, claims && claims.email);
  const ledger = await ledgerAgg(db, "owner_type='user' AND owner_id=?", [walletKey]);
  if (csv) return csvResponse(await usageCsv(db, "user", uid, "user_id=?" + t.sql, [uid, ...t.binds]), requestId);
  return api.json({ report: { scope: "user", id: uid, from: b.from, to: b.to, unit: "micro-USD",
    ai, ledger, totalChargedMicroUsd: ledger.settledMicroUsd }, generatedTs: Date.now() },
    200, { "x-request-id": requestId });
}

/* ---- GET /v1/admin/pricing-note (adminAuth; measured cost per review) -------- */
function usd(micro) { return "US$" + (micro / 1e6).toFixed(2); }
export async function pricingNote(ctx) {
  const { db, requestId, api } = ctx;
  const auth = await adminAuth(ctx);
  if (!auth.ok) return adminErr(ctx, auth);
  const reviews = (await db.prepare("SELECT DISTINCT project_id FROM research_runs").all()).results || [];
  const costs = [];
  for (const r of reviews) {
    const row = await db.prepare("SELECT COALESCE(SUM(cost_micro_usd),0) AS n FROM research_ai_usage WHERE project_id=?")
      .bind(r.project_id).first();
    costs.push((row && row.n) || 0);
  }
  costs.sort((a, b) => a - b);
  const n = costs.length;
  const sum = costs.reduce((a, b) => a + b, 0);
  const mean = n ? Math.round(sum / n) : 0;
  const median = n ? (n % 2 ? costs[(n - 1) / 2] : Math.round((costs[n / 2 - 1] + costs[n / 2]) / 2)) : 0;
  const measured = {
    reviews: n, withSpend: costs.filter((c) => c > 0).length,
    meanMicroUsd: mean, medianMicroUsd: median,
    minMicroUsd: n ? costs[0] : 0, maxMicroUsd: n ? costs[n - 1] : 0,
    targetRangeMicroUsd: [500000, 2000000], minReviewsBeforePricing: 5,
  };
  const enough = n >= 5;
  const note =
    "Measured managed AI spend per review (a project with at least one saved analysis run): " +
    n + " review(s), mean " + usd(mean) + ", median " + usd(median) +
    (n ? ", range " + usd(measured.minMicroUsd) + " to " + usd(measured.maxMicroUsd) : "") + ". " +
    "Plan section 6 target: US$0.50 to US$2.00 managed AI spend per standard review. " +
    (enough
      ? "The section 12 gate (at least 5 real reviews) is met; the owner may set a price from these numbers. "
      : "The section 12 gate is NOT met: at least 5 real reviews must be measured before any price is set. ") +
    "Unit economics must also count worker compute, R2 storage, app-store fees (15 to 30 percent when bought in-app) and taxes; none of those are in the AI number above. " +
    "This note is deterministic and sets no price.";
  return api.json({ note, measured, generatedTs: Date.now() }, 200, { "x-request-id": requestId });
}
