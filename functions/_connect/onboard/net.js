// functions/_connect/onboard/net.js — redirect-safe fetch (closes the CRITICAL redirect-follow SSRF).
// The raw global fetch defaults to redirect:"follow": a user-supplied PUBLIC host passes assertPublicHttpsUrl
// and then 302s to a private/internal host (169.254.169.254, 10.x, an internal http:// service) which the
// server would blindly follow — AND a cross-origin 307 would re-send the signed SMART client-assertion / the
// bearer to the attacker's host. makeSafeFetch does redirect:"manual" and RE-VALIDATES every hop's Location
// with assertPublicHttpsUrl (reject -> OnboardError("ssrf"), nothing sent onward), and on a CROSS-ORIGIN hop
// DROPS all request headers + the body so credentials never reach a redirected host. Bounded by maxHops.
//
// // VERIFY residual: DNS-rebinding (a host that passes these checks but RESOLVES to a private IP at connect
// time) is still open — close later with resolve-then-pin. Redirect-follow (this) was the live-exploitable one.
import { assertPublicHttpsUrl } from "./ssrf.js";
import { OnboardError } from "./errors.js";

const REDIRECT = new Set([301, 302, 303, 307, 308]);

export function makeSafeFetch(baseFetch, { maxHops = 5 } = {}) {
  if (baseFetch && baseFetch.__smdSafe) return baseFetch;          // idempotent: never double-wrap
  const safe = async (url, init = {}) => {
    let curUrl = assertPublicHttpsUrl(url).href;                   // validate the INITIAL url (throws bad-url)
    const startOrigin = new URL(curUrl).origin;
    let curInit = init;
    for (let hop = 0; ; hop++) {
      if (hop > maxHops) throw new OnboardError("unreachable", "too many redirects");
      const res = await baseFetch(curUrl, { ...curInit, redirect: "manual" });   // NEVER let the platform auto-follow
      if (!REDIRECT.has(res.status)) return res;                   // terminal response -> hand back to caller
      const loc = res.headers.get("location");
      if (!loc) return res;                                        // 30x without Location -> terminal (caller sees !ok)
      let next; try { next = new URL(loc, curUrl); } catch { throw new OnboardError("ssrf", "bad redirect location"); }
      try { assertPublicHttpsUrl(next.href); } catch { throw new OnboardError("ssrf", "redirect target blocked"); }   // per-hop SSRF re-check
      const crossOrigin = next.origin !== startOrigin;
      const nextInit = { ...curInit };
      // 301/302 demote POST->GET (browser behavior); 303 always GET. Either way drop the now-orphaned body.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && String(nextInit.method || "GET").toUpperCase() === "POST")) {
        nextInit.method = "GET"; delete nextInit.body;
      }
      // Cross-origin hop: NEVER forward credentials or body (drops Authorization, any custom header, and the
      // signed client-assertion). A rebinding-safe host still receives an unauthenticated request only.
      if (crossOrigin) { nextInit.headers = {}; delete nextInit.body; }
      curUrl = next.href; curInit = nextInit;
    }
  };
  safe.__smdSafe = true;
  return safe;
}
