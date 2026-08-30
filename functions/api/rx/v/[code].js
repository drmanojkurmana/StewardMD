/* functions/api/rx/v/[code].js — the JSON form of a prescription verification.
 * ===========================================================================
 * DEPLOY PATH:  GET https://stewardmd.in/api/rx/v/<code>
 *
 * The machine-readable twin of /verify/<code>. A pharmacy system can call this directly instead of
 * scraping the page. Both go through _rx_public.resolve(), so the two can never disagree about what
 * a verification discloses.
 *
 * Public on purpose (see _rx_public.js): the record carries no patient data, the code is an opaque
 * 80-bit handle, and lookups are rate-limited per IP. Never cached — a revoked prescription must
 * stop reading ACTIVE the moment it is revoked, and a shared cache would keep saying otherwise.
 */
import { resolve } from "../../../_rx_public.js";

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const out = await resolve(env, request, (params && params.code) || "");
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (out.retryAfter) headers["retry-after"] = String(out.retryAfter);
  return new Response(JSON.stringify(out.body), { status: out.status, headers });
}

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405, headers: { "content-type": "application/json", allow: "GET", "cache-control": "no-store" },
    });
  }
  return onRequestGet(context);
}
