/* wardsynq/site/_worker.js - the wardsynq.com Pages worker.
 *
 * wardsynq.com is a separate Cloudflare Pages project ("wardsynq", direct upload) that holds only
 * static files. The record service, the OPD/ward routes and every binding they need (D1, KV, AI,
 * secrets) live in the "stewardmd" project behind stewardmd.in. Rather than duplicate those bindings
 * and secrets on a second project, this worker forwards /api/* to stewardmd.in on the server side,
 * so the browser sees one origin and the same code that runs in the StewardMD app runs here
 * unchanged. Everything else is served from the uploaded assets.
 *
 * What is forwarded: method, path, query, body, and the headers the API reads (Authorization,
 * X-Staff-Token, X-App-Token, X-Admin-Token, Content-Type, Idempotency-Key, X-Correlation-Id,
 * X-Device-Id). The caller's IP is passed as X-Forwarded-For. Cookies are not forwarded: no API
 * here uses them, and forwarding them would leak this origin's session to another.
 *
 * ponytail: a same-origin forward costs one extra hop. Upgrade path: move the wardsynq.com custom
 * domain onto the stewardmd Pages project and serve this site from _middleware.js by host.
 */
const UPSTREAM = "https://stewardmd.in";
const FORWARD = ["authorization", "x-staff-token", "x-app-token", "x-admin-token", "content-type", "idempotency-key", "x-correlation-id", "x-device-id", "accept", "if-none-match", "range"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // WSQ_UPSTREAM is set only by a local `wrangler pages dev --binding` run against a local record
    // service (test/wardsynq-persistence-server.mjs); the deployed project has no such binding.
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return forward(request, url, (env && env.WSQ_UPSTREAM) || UPSTREAM);
    return env.ASSETS.fetch(request);
  },
};

async function forward(request, url, upstream) {
  const target = upstream + url.pathname + url.search;
  const h = new Headers();
  for (const k of FORWARD) { const v = request.headers.get(k); if (v) h.set(k, v); }
  // NEVER in production: the record service trusts this header as an identity. It is forwarded only
  // to a LOCAL upstream (the WSQ_UPSTREAM dev binding), where the browser journey sets it on purpose.
  if (upstream !== UPSTREAM) { const v = request.headers.get("cf-access-authenticated-user-email"); if (v) h.set("cf-access-authenticated-user-email", v); }
  const ip = request.headers.get("cf-connecting-ip"); if (ip) h.set("x-forwarded-for", ip);
  const ua = request.headers.get("user-agent"); if (ua) h.set("user-agent", ua);
  h.set("origin", "https://wardsynq.com");
  const init = { method: request.method, headers: h, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer();
  let res;
  try { res = await fetch(target, init); }
  catch (e) { return new Response(JSON.stringify({ ok: false, error: "upstream_unreachable" }), { status: 502, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
  const out = new Headers(res.headers);
  out.delete("access-control-allow-origin"); out.delete("access-control-allow-credentials");
  out.delete("set-cookie");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}
