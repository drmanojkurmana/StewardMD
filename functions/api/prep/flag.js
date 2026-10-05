/* /api/prep/flag - students report a PrepNucleus question as wrong or unclear (plan: vault/plans/PrepNucleus.md 5.2).
 *
 * POST { itemId, subject, module, reason }   signed-in users only (identify: Firebase or Cloudflare Access).
 *   reason: wrong-key | unclear | outdated | typo | other
 *   One report per user per item counts (a second report of the same item by the same user changes nothing).
 *   At most 60 reports per user per day. Stores KV prep:flag:<itemId> = { n, reasons, subject, module, first, last }
 *   and bumps the D1 day counter prep.flag.<subject> (functions/_counters.js) for the Review Desk.
 * GET ?top=1   owners only (ownerOK): the most-reported items, for the Review Desk.
 * GET ?hidden=1   public: ids of items hidden from every student after HIDE_AT separate reports (plan 11: auto-hide).
 *   The server never sees attempt counts, so the plan's "3% of attempts" is approximated as 3 separate reporters.
 *   KV prep:hidden = { <itemId>: <ts> }. The app fetches it at most every 6 hours and leaves those items out.
 * DELETE { itemId }   owners only: restore an item (drops it from prep:hidden and clears its report record).
 *
 * No question text and no free-text comment is accepted: the item id and a reason code are enough to find the
 * question, and nothing a student types is stored. KV binding: UPDATES_KV (falls back to MAIK_KV).
 */
import { identify } from "../../_fbauth.js";
import { ownerOK } from "../../_adminauth.js";
import { bump } from "../../_counters.js";

export const REASONS = ["wrong-key", "unclear", "outdated", "typo", "other"];
const ID_RE = /^[a-z0-9-]{4,80}$/i;
const SLUG_RE = /^[a-z0-9-]{2,80}$/;
const DAILY_CAP = 60;
export const HIDE_AT = 3;
const HIDDEN_KEY = "prep:hidden";
const KEEP_S = 180 * 86400;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const kvOf = (env) => (env && (env.UPDATES_KV || env.MAIK_KV)) || null;
const istDay = (t) => new Date((t || Date.now()) + 5.5 * 3600e3).toISOString().slice(0, 10);

export async function onRequestPost({ request, env }) {
  const who = await identify(request, env);
  if (!who) return json({ error: "sign-in-required" }, 401);
  const kv = kvOf(env);
  if (!kv) return json({ error: "not-configured" }, 503);
  let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
  const itemId = String(b.itemId || ""), subject = String(b.subject || ""), mod = String(b.module || ""), reason = String(b.reason || "");
  if (!ID_RE.test(itemId) || !SLUG_RE.test(subject) || !SLUG_RE.test(mod) || REASONS.indexOf(reason) < 0) return json({ error: "bad-request" }, 400);

  const now = Date.now(), day = istDay(now);
  const capKey = `prep:flagcap:${who}:${day}`;
  const used = Number(await kv.get(capKey)) || 0;
  if (used >= DAILY_CAP) return json({ error: "daily-limit" }, 429);
  const mine = `prep:flagu:${who}:${itemId}`;
  if (await kv.get(mine)) return json({ ok: true, counted: false });

  const key = `prep:flag:${itemId}`;
  let rec = null; try { rec = JSON.parse((await kv.get(key)) || "null"); } catch (e) { rec = null; }
  rec = rec && typeof rec === "object" ? rec : { n: 0, reasons: {}, subject, module: mod, first: now };
  rec.n = (rec.n || 0) + 1;
  rec.reasons[reason] = (rec.reasons[reason] || 0) + 1;
  rec.last = now;
  await Promise.all([
    kv.put(key, JSON.stringify(rec), { expirationTtl: KEEP_S }),
    kv.put(mine, "1", { expirationTtl: KEEP_S }),
    kv.put(capKey, String(used + 1), { expirationTtl: 2 * 86400 }),
  ]);
  try { await bump(env, day, { ["prep.flag." + subject]: 1 }); } catch (e) {}
  if (rec.n === HIDE_AT) {
    let hid = {}; try { hid = JSON.parse((await kv.get(HIDDEN_KEY)) || "{}") || {}; } catch (e) { hid = {}; }
    hid[itemId] = now;
    await kv.put(HIDDEN_KEY, JSON.stringify(hid));
  }
  return json({ ok: true, counted: true, n: rec.n });
}

async function hiddenMap(kv) { try { return JSON.parse((kv && (await kv.get(HIDDEN_KEY))) || "{}") || {}; } catch (e) { return {}; } }

export async function onRequestGet({ request, env }) {
  if (new URL(request.url).searchParams.get("hidden") === "1") {
    const ids = Object.keys(await hiddenMap(kvOf(env))).sort();
    return new Response(JSON.stringify({ ids }), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" } });
  }
  if (!(await ownerOK(request, env))) return json({ error: "forbidden" }, 403);
  const kv = kvOf(env);
  if (!kv || !kv.list) return json({ items: [] });
  const out = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const r = await kv.list({ prefix: "prep:flag:", cursor });
    for (const k of r.keys || []) {
      let rec = null; try { rec = JSON.parse((await kv.get(k.name)) || "null"); } catch (e) {}
      if (rec) out.push({ itemId: k.name.slice("prep:flag:".length), ...rec });
    }
    if (r.list_complete || !r.cursor) break;
    cursor = r.cursor;
  }
  const hid = await hiddenMap(kv);
  out.sort((a, b) => (b.n || 0) - (a.n || 0) || (b.last || 0) - (a.last || 0));
  return json({ items: out.slice(0, 200).map((x) => (hid[x.itemId] ? { ...x, hidden: true } : x)) });
}

export async function onRequestDelete({ request, env }) {
  if (!(await ownerOK(request, env))) return json({ error: "forbidden" }, 403);
  const kv = kvOf(env);
  if (!kv) return json({ error: "not-configured" }, 503);
  let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
  const itemId = String(b.itemId || "");
  if (!ID_RE.test(itemId)) return json({ error: "bad-request" }, 400);
  const hid = await hiddenMap(kv);
  delete hid[itemId];
  await kv.put(HIDDEN_KEY, JSON.stringify(hid));
  if (kv.delete) await kv.delete(`prep:flag:${itemId}`);
  return json({ ok: true });
}
