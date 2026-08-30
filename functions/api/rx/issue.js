/* functions/api/rx/issue.js — mint a prescription verification record.
 * ===========================================================================
 * DEPLOY PATH:  POST https://stewardmd.in/api/rx/issue
 *               POST https://stewardmd.in/api/rx/issue?action=revoke
 *
 * The app calls this when a prescription containing a habit-forming drug, an antibiotic, or an
 * explicitly scheduled drug is finalised. It returns the code that is printed on the sheet as a QR
 * pointing at /verify/<code>.
 *
 * AUTHENTICATION IS THE FEATURE. A Firebase ID token is required and the prescriber's identity is
 * taken from ITS custom claims (name / regNo / verified), never from the request body — see the
 * header of functions/_rx_store.js. Without that, "so no one can fake it" would be false: any
 * caller could POST someone else's registration number and mint a prescription in their name.
 *
 * Being SIGNED IN is required; being VERIFIED is not. An unverified prescriber can still issue, and
 * the verify page then says in plain words that the registration was not verified — far more useful
 * to a pharmacist than no QR at all, and the record stays honest either way.
 */
// verifyFirebaseClaims, NOT verifyFirebaseToken: this route needs the prescriber's name, regNo and
// verified flag, and verifyFirebaseToken returns only the uid. Because a uid is a STRING, and every
// string carries the legacy String.prototype.sub method, the `claims.sub` guard below passed on a
// uid anyway and every prescription was recorded with a blank prescriber.
import { verifyFirebaseClaims } from "../../_fbauth.js";
import { issue, revoke } from "../../_rx_store.js";

const json = (status, body, extra) => new Response(JSON.stringify(body), {
  status,
  headers: Object.assign({ "content-type": "application/json", "cache-control": "no-store" }, extra || {}),
});

async function claimsFrom(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try { return await verifyFirebaseClaims(token, env); } catch (e) { return null; }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const claims = await claimsFrom(request, env);
  // typeof check first: `claims.sub` alone is not enough, because a bare uid STRING answers .sub
  // with String.prototype.sub (a function, therefore truthy) and sails through into a record with
  // no prescriber on it. Demand a real object so that mistake fails loudly instead of silently.
  if (!claims || typeof claims !== "object" || !(claims.sub || claims.user_id)) {
    return json(401, { ok: false, error: "sign_in_required" });
  }

  let body = null;
  try { body = await request.json(); } catch (e) { return json(400, { ok: false, error: "bad_json" }); }

  const action = new URL(request.url).searchParams.get("action") || "";
  try {
    const out = action === "revoke"
      ? await revoke(env, claims, body && body.code, body && body.reason)
      : await issue(env, claims, body);
    return json(out.status, out.body);
  } catch (e) {
    console.warn("[rx/issue]", String((e && e.message) || e));
    return json(500, { ok: false, error: "server_error" });
  }
}

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" }, { allow: "POST" });
  }
  return onRequestPost(context);
}
