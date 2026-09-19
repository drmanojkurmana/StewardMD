/* StewardMD — Connect Agent SERVER-SIDE session: the doctor's own hospital login, a cookie jar, and
 * a fifteen minute life. The same contract as functions/api/ghis/[[path]].js, for a hospital that was
 * discovered instead of hand-written.
 *
 * WHAT IS DELIBERATELY THE SAME AS THE HAND-BUILT ADAPTER
 *   - the doctor signs in with their OWN hospital id and password, so the hospital's audit trail names
 *     the doctor and not a service account;
 *   - the password opens a session and is then GONE. Nothing here writes it anywhere;
 *   - the token maps to a cookie jar in KV, refreshed within the hospital's idle window;
 *   - an expired session surfaces `unauth` and the doctor signs in again. There is no stored password
 *     to re-login with, and that is the point, not a missing feature.
 *
 * WHAT IS NECESSARILY DIFFERENT
 *   The hand-built adapter knows GHIS's sign-in by heart: GET the SSO page for the antiforgery token,
 *   POST /Index, read `param1 == 200`, find the Doctor tile in /apps, follow route?id= through to
 *   /Doctor/Home, then read the CSRF token off the worklist page. None of that can be hard-coded for a
 *   hospital nobody has seen, so it is DATA here: a recorded recipe of the same steps, replayed. The
 *   mechanics around it (jar, headers, manual redirects) are identical.
 */
import { raw, follow, jarHeader } from "./http.js";

export const SESSION_TTL_MS = 15 * 60 * 1000;   // refresh inside the hospital's ~20 min idle window
export const SESS_KV_TTL = 1800;                // 30 min in KV, as the hand-built adapter keeps it
const SLIDE_AFTER_MS = 5 * 60 * 1000;           // throttle the sliding-expiry write, same as hand-built

const key = (token) => "casess:" + token;
const kvOf = (env) => (env && (env.GHIS_KV || env.MAIK_KV || env.UPDATES_KV)) || null;

/** Read a value out of a response body by the recipe's rule. Only two shapes, both observed live. */
function pluck(body, rule) {
  if (!rule) return "";
  if (rule.regex) {
    try { return (String(body || "").match(new RegExp(rule.regex)) || [])[1] || ""; } catch { return ""; }
  }
  if (rule.json) {
    try {
      let v = JSON.parse(body);
      if (typeof v === "string") v = JSON.parse(v);
      return String(v && v[rule.json] !== undefined ? v[rule.json] : "");
    } catch { return ""; }
  }
  return "";
}

/* ENCODING IS CONTEXT, NOT A CONSTANT. A form field must be percent-encoded; a captured URL fragment
 * must NOT be, or the launcher route `route?id=k/9J1c...==` turns into `route%3Fid%3D...` and 404s.
 * The hand-built adapter makes exactly this distinction: encodeURIComponent on every form value, and
 * the route taken raw with only `&amp;` un-escaped. */
function fillTemplate(tpl, vars, encode) {
  const out = String(tpl || "").replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k] === undefined ? "" : String(vars[k]);
    return encode ? encodeURIComponent(v) : v;
  });
  return encode ? out : out.replace(/&amp;/g, "&");
}

/**
 * Replay a recorded sign-in and return { cookie, csrf, referer } - the cookie jar for the DATA host.
 *
 * recipe = {
 *   origin,                       the host the data calls go to
 *   steps: [                      each step is one request, in order
 *     { method, url, body?, headers?, follow?: true,
 *       capture?: { name: {regex|json} },        values other steps can use as {{name}}
 *       expect?: { json: "param1", equals: 200 } a step that must succeed, else bad_credentials
 *     } ],
 *   cookieHost,                   which host's jar becomes the session cookie
 *   csrf?: { fromStep, regex }    where the antiforgery token is read
 * }
 * Credentials arrive as {{userId}} / {{password}} and are never stored, logged, or returned.
 */
export async function loginWithRecipe({ recipe, userId, password, fetchImpl = fetch }) {
  if (!recipe || !Array.isArray(recipe.steps) || !recipe.steps.length) {
    const e = new Error("no_login_recipe"); e.code = "no_login_recipe"; throw e;
  }
  const jar = {};
  const vars = { userId, password };
  const bodies = {};
  for (let i = 0; i < recipe.steps.length; i += 1) {
    const st = recipe.steps[i];
    const url = fillTemplate(st.url, vars, false);
    const body = st.body ? fillTemplate(st.body, vars, true) : null;
    let r = await raw(jar, st.method || "GET", url, body, st.headers || {}, fetchImpl);
    if (st.follow) r = await follow(jar, r, 10, fetchImpl);
    bodies[st.name || String(i)] = r.body;
    if (st.expect) {
      const got = pluck(r.body, st.expect);
      /* eslint-disable-next-line eqeqeq */
      if (st.expect.equals !== undefined && got != st.expect.equals) {
        const e = new Error("bad_credentials"); e.code = "bad_credentials"; throw e;
      }
    }
    if (st.capture) for (const k of Object.keys(st.capture)) vars[k] = pluck(r.body, st.capture[k]);
  }
  const host = recipe.cookieHost || new URL(recipe.origin).hostname;
  const cookie = jarHeader(jar, host);
  if (!cookie) { const e = new Error("session_not_established"); e.code = "session_not_established"; throw e; }
  const csrf = recipe.csrf ? pluck(bodies[recipe.csrf.fromStep], recipe.csrf) : "";
  return { cookie, csrf, referer: recipe.referer || "/" };
}

/** Store a freshly-minted session. The password is NOT among the fields written. */
export async function putSession(env, token, sess) {
  const kv = kvOf(env);
  if (!kv) return false;
  await kv.put(key(token), JSON.stringify({ ...sess, ts: Date.now() }), { expirationTtl: SESS_KV_TTL });
  return true;
}

/**
 * The cookie jar for a token, with the hand-built adapter's SLIDING expiry: using a session extends
 * it, so an active doctor never times out mid-round; it only lapses after real inactivity. The KV
 * write is throttled to once per five minutes so a busy ward does not write on every read.
 */
export async function getSession(env, token) {
  const kv = kvOf(env);
  if (!token || !kv) return null;
  const sess = await kv.get(key(token), "json");
  if (!sess) return null;
  try {
    if (Date.now() - (sess.ts || 0) > SLIDE_AFTER_MS) {
      sess.ts = Date.now();
      await kv.put(key(token), JSON.stringify(sess), { expirationTtl: SESS_KV_TTL });
    }
  } catch (e) { /* a failed refresh must never fail the read */ }
  return { token, ...sess };
}

export async function dropSession(env, token) {
  const kv = kvOf(env);
  if (!token || !kv) return false;
  await kv.delete(key(token));
  return true;
}
