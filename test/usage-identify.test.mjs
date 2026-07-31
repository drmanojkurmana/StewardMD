/* Regression: _usage.js identify() must treat verifyFirebaseToken's return as a STRING uid.
 *
 * Bug (31 Jul 2026): verifyFirebaseToken returns payload.sub (a STRING) or null, but identify() read
 * `fb.uid`/`fb.email` off it as an object — always undefined — so EVERY signed-in user fell through to
 * the guest branch and was metered by IP. Many doctors behind one hospital IP shared a single guest
 * quota bucket and hit the cap; guests-on-fresh-IPs and the admin-exempt owner emails still worked.
 * "MaiK works for guest but not for logged accounts (other than the 3 owner emails)." */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { identify } from "../functions/_usage.js";

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

// source guard: the fb-token branch uses the STRING uid (not fb.uid) and returns fb:<uid>
const src = readFileSync(join(ROOT, "functions/_usage.js"), "utf8");
ok(!/\bfb\.uid\b/.test(src), "identify no longer reads .uid off the token-verify return (the bug)");
ok(/const uid = await verifyFirebaseToken\(tok, env\);\s*if \(uid\) return \{ id: "fb:" \+ uid/.test(src), "signed-in token -> { id:'fb:'+uid, guest:false }");

console.log(`\nALL ${pass} PASS — signed-in users are identified per-account, not lumped into the guest IP bucket`);
