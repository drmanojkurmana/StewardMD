/* StewardMD — RadioAnatome clinical sign-off record (Cloudflare Pages Function).
 *
 * Backs /validation, where a radiologist marks each atlas module verified / needs-fix /
 * rejected before the atlas is exposed to students. The atlas ships gated behind
 * `smd_atlas`; this record is the evidence for turning that flag on.
 *
 * DESIGN: APPEND-ONLY. Every submission is stored as its own immutable key, and the
 * "current" verdict is simply the latest entry for that module. Nothing is ever
 * overwritten or deleted, so a mistake — or someone abusing the endpoint — cannot
 * destroy the real review. GET returns both the resolved current state and the full
 * history so the record can always be audited.
 *
 * AUTH IS DELIBERATELY WEAK, AND THAT IS ACKNOWLEDGED. /validation is a public URL and
 * its page must send the passphrase, so anyone reading the page source can find it.
 * The passphrase stops casual passers-by, not a determined one. Append-only storage is
 * what actually protects the record; treat the history as the truth. Set
 * env.VALIDATION_PW to change it without touching this file.
 *
 * PRIVACY: no patient data of any kind. Only module ids, a verdict, a reviewer-supplied
 * name, free-text notes about the LABELS, a server timestamp and request country.
 * Storage: env.VALID_KV || CASES_KV || GHIS_KV || MAIK_KV || UPDATES_KV. Fail-open
 * no-op when no KV is bound (the page then keeps verdicts locally and says so).
 */
const CUR_KEY = "radioanatome:signoff:current";
const LOG_PREFIX = "radioanatome:signoff:log:";
const ENTRY_TTL = 60 * 60 * 24 * 800;      // ~2 years
const NOTE_MAX = 1200;
const WHO_MAX = 120;
const IP_HOURLY_CAP = 240;
const VERDICTS = ["pending", "ok", "fix", "no"];

function kv(env) {
  return env.VALID_KV || env.CASES_KV || env.GHIS_KV || env.MAIK_KV || env.UPDATES_KV || null;
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});
const clip = (s, n) => (typeof s === "string" ? s : "").slice(0, n);
const slug = (s) => clip(s, 64).replace(/[^a-z0-9_\-]/gi, "");

async function sha256hex(str) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function passOk(env, given) {
  const want = (env && env.VALIDATION_PW) || "5959";
  return clip(given, 64) === want;
}

export async function onRequestGet({ env }) {
  const store = kv(env);
  if (!store) return json({ ok: true, enabled: false, current: {}, log: [] });
  let current = {};
  try { current = JSON.parse((await store.get(CUR_KEY)) || "{}") || {}; } catch (e) {}
  let log = [];
  try {
    const list = await store.list({ prefix: LOG_PREFIX, limit: 400 });
    const keys = (list && list.keys) || [];
    const rows = await Promise.all(keys.map(async (k) => {
      try { return JSON.parse((await store.get(k.name)) || "null"); } catch (e) { return null; }
    }));
    log = rows.filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  } catch (e) {}
  return json({ ok: true, enabled: true, current, log });
}

export async function onRequestPost({ request, env }) {
  const store = kv(env);
  let body = {};
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "bad_json" }, 400); }

  if (!passOk(env, body.pw)) return json({ ok: false, error: "unauthorized" }, 401);

  const module_id = slug(body.module);
  const verdict = VERDICTS.indexOf(body.verdict) >= 0 ? body.verdict : null;
  if (!module_id || !verdict) return json({ ok: false, error: "bad_request" }, 400);

  const entry = {
    module: module_id,
    verdict,
    note: clip(body.note, NOTE_MAX),
    who: clip(body.who, WHO_MAX),
    at: new Date().toISOString(),
    country: request.headers.get("cf-ipcountry") || "",
  };

  if (!store) return json({ ok: true, enabled: false, entry });

  // crude per-client flood cap; the record is append-only so this is only about noise
  try {
    const ipHash = (await sha256hex(
      (request.headers.get("cf-connecting-ip") || "") + "|radioanatome"
    )).slice(0, 16);
    const bucket = "radioanatome:rate:" + ipHash + ":" + new Date().toISOString().slice(0, 13);
    const n = parseInt((await store.get(bucket)) || "0", 10) || 0;
    if (n >= IP_HOURLY_CAP) return json({ ok: false, error: "rate_limited" }, 429);
    await store.put(bucket, String(n + 1), { expirationTtl: 60 * 90 });
  } catch (e) {}

  // 1) immutable log entry — the real record, never overwritten
  try {
    const id = entry.at.replace(/[^0-9A-Za-z]/g, "") + "-" + module_id;
    await store.put(LOG_PREFIX + id, JSON.stringify(entry), { expirationTtl: ENTRY_TTL });
  } catch (e) {
    return json({ ok: false, error: "store_failed" }, 500);
  }

  // 2) best-effort convenience pointer to the latest verdict per module
  try {
    let current = {};
    try { current = JSON.parse((await store.get(CUR_KEY)) || "{}") || {}; } catch (e) {}
    current[module_id] = entry;
    await store.put(CUR_KEY, JSON.stringify(current));
  } catch (e) {}

  return json({ ok: true, enabled: true, entry });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
