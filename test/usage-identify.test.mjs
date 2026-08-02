/* Regression: _usage.js identify() must key signed-in users PER-ACCOUNT as "fb:<uid>".
 *
 * verifyFirebaseToken (this file's OWN copy, ~line 59) returns an OBJECT { uid, email } or null, so
 * identify() must read `.uid` off it. #590 wrongly treated the return as a string and did `"fb:" + <obj>`,
 * which coerces to "fb:[object Object]" for EVERY signed-in user — collapsing all accounts onto ONE
 * shared KU ledger + quota bucket (KU balances appeared to "reset" to the shared total; metering merged).
 * Fixed to read fb.uid → per-account keys, so each doctor's real ledger (e.g. 789 KU) is read again. */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { identify, usageKeyFor } from "../functions/_usage.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("✅ " + m); pass++; };
const req = (h) => ({ headers: { get: (k) => h[k] ?? h[String(k).toLowerCase()] ?? null } });

// no token -> guest, keyed by IP
const guest = await identify(req({ "CF-Connecting-IP": "1.2.3.4" }), {});
ok(guest.guest === true && guest.id.startsWith("ip:"), "no token -> guest, id 'ip:<hash>'");

// Cloudflare-Access email -> identified, not guest
const cfa = await identify(req({ "Cf-Access-Authenticated-User-Email": "Doc@Hosp.org" }), {});
ok(cfa.guest === false && cfa.id.startsWith("cfa:") && cfa.email === "doc@hosp.org", "CF-Access email -> non-guest cfa id");

// source guard: verifyFirebaseToken returns an OBJECT { uid, email }; identify() reads .uid and keys
// per-account. Never "fb:" + the raw object (→ "fb:[object Object]", shared bucket for all users).
const src = readFileSync(join(ROOT, "functions/_usage.js"), "utf8");
ok(/return ok \? \{ uid: payload\.sub/.test(src), "verifyFirebaseToken returns an object { uid, email }");
ok(/if \(fb && fb\.uid\) return \{ id: "fb:" \+ fb\.uid/.test(src), "identify keys signed-in users per-account: 'fb:'+fb.uid");
ok(!/return \{ id: "fb:" \+ uid,/.test(src), "no 'fb:'+<object> coercion (that made fb:[object Object] for ALL signed-in users)");

ok(usageKeyFor({ id: "fb:abc", email: "Dr.X@Gmail.com", guest: false }) === "em:dr.x@gmail.com",
  "usageKeyFor: signed-in → em:<lowercased email>");
ok(usageKeyFor({ id: "ip:hash", guest: true }) === "ip:hash",
  "usageKeyFor: guest (no email) → ip:hash");

console.log(`\nALL ${pass} PASS — signed-in users are identified per-account, not lumped into the guest IP bucket`);
