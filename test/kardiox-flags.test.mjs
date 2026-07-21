/* test/kardiox-flags.test.mjs — KardioX central feature-flag registry (sibling of fundx-flags). */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
function fakeLS() { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, _s: s }; }
function load(searchStr) { const win = {}; const ls = fakeLS(); new Function("window", "localStorage", "location", src("kardiox-flags.js"))(win, ls, { search: searchStr || "" }); return { F: win.SMD_KARDIOX_FLAGS, ls }; }

const { F } = load("");
ok("flags: exposed", !!F && typeof F.get === "function");
ok("flags: BETA master default ON", F.get("smd_kardiox") === true && F.bool("smd_kardiox") === true);   // beta branch: on (public/web main keeps OFF)
ok("flags: BETA marker default ON", F.get("smd_kardiox_beta") === true);
ok("flags: confidence default true", F.get("smd_kardiox_confidence") === true);
ok("flags: haptics default true", F.get("smd_kardiox_haptics") === true);
ok("flags: cloud tri default null", F.get("smd_kardiox_cloud") === null);
ok("flags: dev default false", F.get("smd_kardiox_dev") === false);
ok("flags: unknown key → null", F.get("nope") === null);

const { F: F2, ls: ls2 } = load("");
F2.set("smd_kardiox", true); ok("flags: set master → true persisted '1'", F2.get("smd_kardiox") === true && ls2._s.smd_kardiox === "1");
F2.set("smd_kardiox_cloud", false); ok("flags: set tri false", F2.get("smd_kardiox_cloud") === false);
F2.set("smd_kardiox_confidence", false); ok("flags: set bool false", F2.get("smd_kardiox_confidence") === false);

const { F: F3, ls: ls3 } = load("?kardiox=1");
ls3.setItem("smd_kardiox", "0");
ok("flags: ?kardiox=1 overrides localStorage off", F3.get("smd_kardiox") === true);

const a = F.all();
ok("flags: all() lists every flag", Object.keys(a).length === Object.keys(F.DEFS).length && a.smd_kardiox === true);

console.log(`\nkardiox-flags: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
