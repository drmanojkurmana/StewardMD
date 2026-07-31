// test/connect/abdm/mock-gateway.mjs — adversarial mock ABDM gateway (+ HIP, wired in Stage 4). Test harness, not shipped.
import { ENDPOINTS, FIELDS } from "../../../functions/_connect/abdm/gateway.js";
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const pathOf = (url) => new URL(url).pathname;

export function makeMockGateway(opts = {}) {
  const calls = [];
  const behavior = {
    sessionExpiresIn: opts.sessionExpiresIn ?? 300,
    failSession: !!opts.failSession,
    // independent adversarial delivery knobs — combinable; Stage 4 consumes (stored-not-consumed here)
    outOfOrder: false,
    duplicate: false,
    partial: false,
    retryAfterAck: false,
    callbackDelayMs: 0,
  };
  async function fetch(url, init = {}) {
    const path = pathOf(url);
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch {}
    calls.push({ path, headers: { ...(init.headers || {}) }, body });   // shallow-copy: no by-reference sharing
    if (path === ENDPOINTS.sessions) {
      if (behavior.failSession) return json({ error: "invalid_client" }, 401);
      return json({ [FIELDS.resAccessToken]: "mock-token-" + calls.length, tokenType: "bearer", [FIELDS.resExpiresIn]: behavior.sessionExpiresIn });
    }
    if ([ENDPOINTS.consentInit, ENDPOINTS.consentFetch, ENDPOINTS.hiRequest, ENDPOINTS.hiNotify].includes(path)) {
      return json({}, 202);      // ABDM is fire-and-forget; the real work comes back via webhooks (Stage 4)
    }
    return json({ error: "not_found", path }, 404);
  }
  return { fetch, calls, behavior, setBehavior: (b) => Object.assign(behavior, b) };
}
