/* StewardMD — Search the Indian Medical Register (Cloudflare Pages Function).
 * ---------------------------------------------------------------------------
 * DEPLOY PATH:  functions/api/nmc-search.js  ->  https://stewardmd.in/api/nmc-search
 *
 * GET /api/nmc-search?q=<name or reg no>[&type=name|reg]  (Authorization: Bearer <firebase idToken>)
 *   -> { results:[{name,regNo,council,year?,degree?,university?}], source:"nmc"|"register", mode }
 *
 * Searches the LIVE NMC register (nmc.org.in), falling back to the D1 mirror (binding stewardmd_nmc)
 * if the live service is down. Signed-in clinicians only (guests 401) — this proxies a public gov
 * endpoint, and gating avoids turning the Worker into an open proxy. Returns PUBLIC register data
 * only (no phone/email/Aadhaar/address); the same data anyone can search at nmc.org.in.
 */
import { identify } from "../_usage.js";
import { NMC_SEARCH, NMC_REFERER, looksLikeReg, regCore, normalizeResults } from "./_nmc.js";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function nmcSearch(body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);   // don't let a hung NMC stall the request
  try {
    const res = await fetch(NMC_SEARCH, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Referer": NMC_REFERER, "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const arr = await res.json();
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return null; } finally { clearTimeout(t); }
}

async function d1Search(env, q, isReg) {
  const db = env.stewardmd_nmc;
  if (!db) return null;
  try {
    const rs = isReg
      ? await db.prepare("SELECT reg_no, name, council FROM doctors WHERE reg_core = ? LIMIT 25").bind(regCore(q)).all()
      : await db.prepare("SELECT reg_no, name, council FROM doctors WHERE name LIKE ? LIMIT 25").bind("%" + q.toUpperCase() + "%").all();
    const rows = (rs && rs.results) || [];
    return rows.map((r) => ({ registrationNo: r.reg_no, firstName: r.name, smcName: r.council }));
  } catch (e) { return null; }
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
  if (q.length < 2) return json({ error: "query_too_short" }, 400);

  // signed-in clinicians only (identify() flags guests / bare-IP callers)
  const who = await identify(request, env).catch(() => null);
  if (!who || who.guest) return json({ error: "auth_required" }, 401);

  const typeParam = url.searchParams.get("type");
  const isReg = typeParam === "reg" ? true : typeParam === "name" ? false : looksLikeReg(q);

  let rows = await nmcSearch(isReg ? { registrationNo: regCore(q) } : { name: q });
  let source = "nmc";
  if (rows === null) { rows = await d1Search(env, q, isReg); source = "register"; }   // live down → offline mirror
  if (rows === null) return json({ error: "register_unavailable" }, 503);

  return json({ results: normalizeResults(rows).slice(0, 25), source, mode: isReg ? "reg" : "name" });
}
