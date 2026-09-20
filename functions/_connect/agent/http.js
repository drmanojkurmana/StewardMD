/* StewardMD — Connect Agent SERVER-SIDE transport.
 * ---------------------------------------------------------------------------
 * THE AGENT-BUILT ADAPTER MUST BE THE SAME KIND OF THING AS THE HAND-BUILT ONE.
 *
 * `functions/api/ghis/[[path]].js` runs on Cloudflare, logs the doctor in with their own hospital id
 * and password, keeps a cookie jar in KV for fifteen minutes, and replays a fixed set of calls. The
 * agent's adapter ran only on the phone, inside the browser the doctor had already signed into. The
 * DATA matched (gold audit: medicines 158/158, 19/19, 325/325) but the adapter was a different shape
 * of thing, which is not what "100% similar to the hand-built one" means (owner, 2026-09-18).
 *
 * This module is the transport half of closing that: the SAME cookie-jar mechanics, the SAME header
 * set, the SAME `redirect: 'manual'` contract, and the SAME "302 means the session is gone" rule that
 * the hand-built adapter uses. Deliberately copied in behaviour, not imported: the hand-built file is
 * a live clinical path and must not grow a dependency on the agent.
 *
 * The one thing that is NOT copied is the hard-coded host. Every function here takes its origin from
 * the adapter being run, because the whole point is that it works for a hospital nobody has seen.
 */

const UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const FORM = "application/x-www-form-urlencoded; charset=utf-8";

/** Record every Set-Cookie of a response into the per-host jar (last write wins). */
export function jarSet(jar, host, res) {
  const all = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  for (const c of all) {
    const p = String(c).split(";")[0];
    const i = p.indexOf("=");
    if (i < 0) continue;
    (jar[host] = jar[host] || {})[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
}

/** The Cookie header for one host. */
export const jarHeader = (jar, host) =>
  Object.entries((jar && jar[host]) || {}).map(([k, v]) => `${k}=${v}`).join("; ");

/** Overlay Set-Cookie values onto a cookie string, so a POST carries the antiforgery cookie the
 *  preceding form GET handed back. Same last-write-wins rule as the hand-built adapter. */
export function mergeCookies(base, setCookieArr) {
  const jar = {};
  String(base || "").split(/;\s*/).forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1);
  });
  (setCookieArr || []).forEach((c) => {
    const p = String(c).split(";")[0];
    const i = p.indexOf("=");
    if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return Object.keys(jar).map((k) => k + "=" + jar[k]).join("; ");
}

/** One request through a cookie jar. Never follows redirects: a 302 is an ANSWER, not a detour. */
export async function raw(jar, method, url, body, extra = {}, fetchImpl = fetch) {
  const u = new URL(url);
  const headers = {
    "User-Agent": UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9",
    "Cookie": jarHeader(jar, u.hostname), ...extra,
  };
  if (body) headers["Content-Type"] = FORM;
  const res = await fetchImpl(url, { method, body: body || undefined, headers, redirect: "manual" });
  jarSet(jar, u.hostname, res);
  return { status: res.status, location: res.headers.get("location"), body: await res.text(), url };
}

/** Walk a redirect chain by hand, carrying the jar across hosts (the SSO -> EMR handoff). */
export async function follow(jar, r, max = 10, fetchImpl = fetch) {
  let n = 0;
  while (r.status >= 300 && r.status < 400 && r.location && n < max) {
    r = await raw(jar, "GET", new URL(r.location, r.url).href, null, {}, fetchImpl);
    n += 1;
  }
  return r;
}

/**
 * One data call inside an established session.
 *
 * A 302 here means the hospital dropped the session: the hand-built adapter surfaces `unauth` and
 * makes the doctor sign in again rather than silently re-logging in, because it stores no password.
 * The agent adapter must behave identically - a stored credential is the thing neither of them has.
 */
export async function adapterReq({ origin, session, method, path, body, extra = {}, fetchImpl = fetch }) {
  if (!session || !session.cookie) return { unauth: true };
  const headers = {
    "User-Agent": UA, "Accept": "*/*",
    "Referer": origin + (session.referer || "/"),
    "Cookie": session.cookie, ...extra,
  };
  if (body) headers["Content-Type"] = FORM;
  const url = /^https?:\/\//i.test(path) ? path : origin + path;
  const res = await fetchImpl(url, { method, body: body || undefined, headers, redirect: "manual" });
  if (res.status === 302) return { unauth: true };
  const setCookie = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  return { status: res.status, body: await res.text(), csrf: session.csrf, setCookie };
}
