// functions/_connect/onboard/ssrf.js — SSRF guard for EVERY user-entered/discovered URL (the crux of
// self-service EMR onboarding). This DELIBERATELY REPLACES the Phase-0 sandbox host-allowlist with
// "any public HTTPS host, minus private/loopback/link-local/unique-local + cloud-metadata + localhost/
// *.local/*.internal" — because self-service means the admin brings their own EMR base URL. Call it at
// SAVE time and before EVERY fetch (base, discovered token endpoint, and any next URL). Fail-closed:
// throws OnboardError("bad-url") on any reject; the caller maps that to a 400 / a probe error class.
//
// // VERIFY (residual): DNS-rebinding is NOT closed here. A hostname that passes these literal-IP + name
// checks but RESOLVES to a private IP at fetch time is still reachable. An owner may later close this with
// resolve-then-pin (resolve the host once, pin the connection to that vetted public address). For now this
// is the literal-IP + hostname layer only, which is the standard first line and what the task scopes here.
import { OnboardError } from "./errors.js";

const isIp4 = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);

function ip4Private(h) {
  const p = h.split(".").map(Number);
  if (p.some((n) => !Number.isInteger(n) || n > 255)) return true;   // malformed octet => reject
  const [a, b] = p;
  return a === 0 ||                                   // 0.0.0.0/8 "this network"
    a === 10 ||                                       // 10/8 private
    a === 127 ||                                      // 127/8 loopback
    (a === 169 && b === 254) ||                       // 169.254/16 link-local (incl. 169.254.169.254 metadata)
    (a === 172 && b >= 16 && b <= 31) ||              // 172.16/12 private
    (a === 192 && b === 168) ||                       // 192.168/16 private
    (a === 100 && b >= 64 && b <= 127);               // 100.64/10 CGNAT (RFC 6598)
}

function ip6Private(hRaw) {
  const h = hRaw.toLowerCase();
  if (h === "::1" || h === "::") return true;          // loopback / unspecified
  const dq = h.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);   // IPv4-mapped, dotted: ::ffff:169.254.169.254
  if (dq && ip4Private(dq[1])) return true;
  // IPv4-mapped, HEX form (Node normalizes ::ffff:169.254.169.254 -> ::ffff:a9fe:a9fe)
  const mx = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mx) {
    const hi = parseInt(mx[1], 16), lo = parseInt(mx[2], 16);
    if (ip4Private([(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join("."))) return true;
  }
  const first = parseInt(h.split(":")[0] || "0", 16) || 0;
  if ((first & 0xfe00) === 0xfc00) return true;        // fc00::/7 unique-local (fc.. / fd..)
  if ((first & 0xffc0) === 0xfe80) return true;        // fe80::/10 link-local
  return false;
}

// Returns the parsed URL on success; throws OnboardError("bad-url", <label>) on any reject.
export function assertPublicHttpsUrl(urlStr, label = "url") {
  let u;
  try { u = new URL(String(urlStr)); } catch { throw new OnboardError("bad-url", label + " is not a valid URL"); }
  if (u.protocol !== "https:") throw new OnboardError("bad-url", label + " must be https");
  if (u.username || u.password) throw new OnboardError("bad-url", label + " must not contain userinfo");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");    // strip IPv6 brackets, if any
  if (!host) throw new OnboardError("bad-url", label + " has no host");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
    throw new OnboardError("bad-url", label + " host is not a public name");
  if (isIp4(host) && ip4Private(host)) throw new OnboardError("bad-url", label + " resolves to a private/loopback IP");
  if (host.includes(":") && ip6Private(host)) throw new OnboardError("bad-url", label + " resolves to a private/loopback IP");
  return u;
}
