/* StewardMD — Specialty Workspaces feedback collector (Cloudflare Pages Function).
 *
 * A lightweight, ANONYMOUS signal pipe for the Early-access specialty workspaces so
 * clinicians can flag "was this helpful?" and report an error on any specialty
 * assessment. Its whole purpose is patient-safety signal: surface bad/confusing
 * advice fast.
 *
 * PRIVACY (strict):
 *   - No identity is required or stored — this is aggregate signal, not a user record.
 *   - Only: workspace id, syndrome id, the selected FINDING IDS (opaque tokens like
 *     "peritonism"), a helpful up/down, an optional free-text note, a server timestamp,
 *     and request country. NEVER names, MRNs, ages, dates of birth, images or any PHI.
 *   - The client shows a "do NOT include patient details" warning; the note is hard-
 *     capped server-side. GET returns COUNTS ONLY (never the free-text notes).
 *
 * Storage: env.WSFB_KV || CASES_KV || GHIS_KV || MAIK_KV || UPDATES_KV. Each submission
 * is its own key (loss-free) with a long TTL; a best-effort aggregate counter powers GET.
 * If no KV is bound the endpoint is a fail-open no-op (the client also mirrors locally).
 * Responses are never cached (sw.js also bypasses /api/).
 */
const AGG_KEY = "wsfb:agg";
const ENTRY_TTL = 60 * 60 * 24 * 400;   // ~400 days
const NOTE_MAX = 500;
const FIND_MAX = 40;
const IP_HOURLY_CAP = 120;              // crude anti-flood per client hash per hour

function kv(env) { return env.WSFB_KV || env.CASES_KV || env.GHIS_KV || env.MAIK_KV || env.UPDATES_KV || null; }
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});
function clip(s, n) { return (typeof s === "string" ? s : "").slice(0, n); }
function slug(s) { return clip(s, 48).replace(/[^a-z0-9_\-]/gi, ""); }

async function sha256hex(str) {
  const b = new TextEncoder().encode(str);
  const d = await crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}

export async function onRequestGet({ env }) {
  const store = kv(env);
  if (!store) return json({ ok: true, enabled: false, agg: null });
  let agg = null;
  try { agg = JSON.parse((await store.get(AGG_KEY)) || "null"); } catch (e) {}
  // COUNTS ONLY — never expose the free-text notes here.
  return json({ ok: true, enabled: true, agg: agg || { up: 0, down: 0, flag: 0, total: 0, syn: {} } });
}

export async function onRequestPost({ request, env }) {
  const store = kv(env);
  let body = {};
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }

  const ws = slug(body.ws), syn = slug(body.syn);
  const helpful = body.helpful === "up" ? "up" : body.helpful === "down" ? "down" : null;
  const kind = body.kind === "flag" ? "flag" : "rating";
  const findings = Array.isArray(body.findings) ? body.findings.slice(0, FIND_MAX).map(x => slug(x)).filter(Boolean) : [];
  const note = clip(String(body.note || ""), NOTE_MAX).trim();
  if (!ws && !syn) return json({ ok: false, error: "empty" }, 400);
  if (kind === "rating" && !helpful) return json({ ok: false, error: "no rating" }, 400);

  if (!store) return json({ ok: true, stored: false });   // fail-open no-op

  // crude per-client hourly cap (privacy-preserving: hashed IP+UA, not stored as identity)
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "0";
    const ua = request.headers.get("User-Agent") || "";
    const h = (await sha256hex(ip + "|" + ua)).slice(0, 16);
    const hourKey = "wsfb:rl:" + h + ":" + Math.floor(Date.now() / 3600000);
    const n = Number(await store.get(hourKey)) || 0;
    if (n >= IP_HOURLY_CAP) return json({ ok: true, stored: false, throttled: true });
    await store.put(hourKey, String(n + 1), { expirationTtl: 3600 });
  } catch (e) {}

  const entry = { ws, syn, kind, helpful, findings, note, ts: Date.now(), cc: (request.cf && request.cf.country) || null };
  try {
    const id = entry.ts + "-" + Math.random().toString(36).slice(2, 8);
    await store.put("wsfb:e:" + id, JSON.stringify(entry), { expirationTtl: ENTRY_TTL });
    // best-effort aggregate (KV has no atomic inc; a rare race under-counts, acceptable for signal)
    let agg = {};
    try { agg = JSON.parse((await store.get(AGG_KEY)) || "{}"); } catch (e) { agg = {}; }
    agg.up = (agg.up || 0) + (helpful === "up" ? 1 : 0);
    agg.down = (agg.down || 0) + (helpful === "down" ? 1 : 0);
    agg.flag = (agg.flag || 0) + (kind === "flag" ? 1 : 0);
    agg.total = (agg.total || 0) + 1;
    agg.syn = agg.syn || {};
    const sk = (ws || "?") + "/" + (syn || "?");
    const s = agg.syn[sk] || { up: 0, down: 0, flag: 0 };
    if (helpful === "up") s.up++; if (helpful === "down") s.down++; if (kind === "flag") s.flag++;
    agg.syn[sk] = s;
    await store.put(AGG_KEY, JSON.stringify(agg));
  } catch (e) { return json({ ok: true, stored: false }); }
  return json({ ok: true, stored: true });
}
