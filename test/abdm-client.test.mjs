/* test/abdm-client.test.mjs — abdm.js (the ABHA registration-desk client).
 *
 * The screens need a browser, so what is asserted here is the logic that must be right BEFORE anything is
 * sent to ABDM: the Aadhaar checksum ABDM requires us to validate (CRT_ABHA_104), the flag that keeps the
 * whole surface off by default, and the display formatting of a 14-digit ABHA number.
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const src = readFileSync(new URL("../abdm.js", import.meta.url), "utf8");

function fakeLS() { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, _s: s }; }
function load(search, lsSeed) {
  const win = {}; const ls = fakeLS();
  if (lsSeed) Object.entries(lsSeed).forEach(([k, v]) => ls.setItem(k, v));
  new Function("window", "localStorage", "location", "document", "fetch", src)(
    win, ls, { search: search || "", hostname: "stewardmd.in" }, { getElementById: () => null }, () => Promise.resolve({}));
  return { A: win.SMD_ABDM, ls };
}

const { A } = load("");
ok("module: exposes SMD_ABDM", !!A && typeof A.openCreate === "function" && typeof A.openVerify === "function");

// ── the flag. A patient-identity surface must not appear because someone shipped a file. ────────────
ok("flag: OFF by default", A.on() === false);
ok("flag: localStorage smd_abdm=1 turns it on", load("", { smd_abdm: "1" }).A.on() === true);
ok("flag: ?abdm=1 turns it on", load("?abdm=1").A.on() === true);
ok("flag: ?abdm=0 wins over localStorage on", load("?abdm=0", { smd_abdm: "1" }).A.on() === false);

// ── Aadhaar (Verhoeff). ABDM: "The system must check if this is a valid Aadhaar number using the ────
// verhoeff algorithm. The last digit of Aadhaar is the checksum digit." (CRT_ABHA_104)
// Checking it before the call spares the patient a pointless failed OTP and a wasted UIDAI hit.
const V = A._validAadhaar;
// Known-good Aadhaar-shaped numbers with correct Verhoeff checksums (test values, not real Aadhaars).
ok("aadhaar: a correct checksum passes", V("234123412346"));
ok("aadhaar: spaces and dashes are tolerated", V("2341 2341 2346") && V("2341-2341-2346"));
ok("aadhaar: a wrong checksum fails", !V("234123412345"));
ok("aadhaar: transposing two digits fails", !V("234123413246"));
ok("aadhaar: 11 or 13 digits fail", !V("23412341234") && !V("2341234123467"));
// UIDAI never issues a number starting 0 or 1, so those are rejected before the checksum.
ok("aadhaar: leading 0 or 1 is refused", !V("034123412346") && !V("134123412346"));
ok("aadhaar: empty, null, letters all fail", !V("") && !V(null) && !V(undefined) && !V("abcdefghijkl"));

// ── mobile + OTP ────────────────────────────────────────────────────────────────────────────────────
const M = A._validMobile, O = A._validOtp;
ok("mobile: Indian mobile series 6-9 pass", M("9876543210") && M("6000000000"));
ok("mobile: a landline-style leading digit fails", !M("5876543210") && !M("1234567890"));
ok("mobile: wrong length fails", !M("987654321") && !M("98765432101"));
ok("otp: exactly 6 digits", O("123456") && !O("12345") && !O("1234567") && !O("12a456") && !O(""));

// ── display ─────────────────────────────────────────────────────────────────────────────────────────
const F = A._fmtAbha;
ok("abha: a 14-digit number is grouped for reading", F("91234567890123") === "91-2345-6789-0123");
ok("abha: an already-grouped number regroups the same way", F("91-2345-6789-0123") === "91-2345-6789-0123");
ok("abha: anything not 14 digits is shown unchanged rather than mangled", F("1234") === "1234" && F("") === "");

// ── house rules ─────────────────────────────────────────────────────────────────────────────────────
ok("no emoji in app-facing text", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(src));
// App-facing copy uses no em-dash (MaiK AI output is the only exemption).
const strings = src.match(/"[^"\\]*"|'[^'\\]*'/g) || [];
ok("no em-dash in app-facing strings", !strings.some((s) => s.includes("\u2014")));
// The Aadhaar number must never be persisted: ABDM's own rule for an HMIS.
ok("the Aadhaar number is never written to storage", !/localStorage\.setItem\([^)]*aadhaar/i.test(src));

console.log(`\nabdm-client: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
