// functions/_connect/agent/hmac.js — the three primitives the agent broker's keyed artifacts need.
// Web Crypto only (Pages Functions runtime + Node >= 22 both provide globalThis.crypto.subtle), so this
// file is importable from a test with no polyfill and no dependency.
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function fromB64url(s) {
  const t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

export const utf8b64url = (s) => b64url(enc.encode(String(s)));
export const b64urlUtf8 = (s) => new TextDecoder().decode(fromB64url(s));

export async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(String(key)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(String(msg))));
}

export async function sha256hex(msg) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(msg))));
}

// Constant-time-ish hex comparison. Not a timing-attack panacea in a JS VM, but it removes the trivial
// early-exit that a plain === on a rejected signature gives an attacker, and it never short-circuits on
// content (only on length, which is public: both sides are fixed-width sha256 hex).
export function equalHex(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (x.length !== y.length || x.length === 0) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
