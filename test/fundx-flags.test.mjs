/* test/fundx-flags.test.mjs — FundX central feature-flag registry. */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
function fakeLS() { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, _s: s }; }
function load(searchStr) { const win = {}; const ls = fakeLS(); new Function("window", "localStorage", "location", src("fundx-flags.js"))(win, ls, { search: searchStr || "" }); return { F: win.SMD_FUNDX_FLAGS, ls }; }

const { F } = load("");
ok("flags: exposed", !!F && typeof F.get === "function");
ok("flags: bool default true (smd_fundx ON for private dev/testing — PUBLIC-RELEASE-GATE)", F.get("smd_fundx") === true && F.bool("smd_fundx") === true);
ok("flags: bool default true (flash)", F.get("smd_fundx_flash") === true);
ok("flags: int default", F.get("smd_fundx_capture_threshold") === 60 && F.int("smd_fundx_capture_threshold") === 60);
ok("flags: tri default null (cloud)", F.get("smd_fundx_cloud") === null);
ok("flags: enum default standard", F.get("smd_fundx_mode") === "standard");
ok("flags: unknown key → null", F.get("nope") === null);

const { F: F2, ls: ls2 } = load("");
F2.set("smd_fundx", true); ok("flags: set bool → true + persisted as '1'", F2.get("smd_fundx") === true && ls2._s.smd_fundx === "1");
F2.set("smd_fundx_capture_threshold", 75); ok("flags: set int roundtrip", F2.get("smd_fundx_capture_threshold") === 75);
F2.set("smd_fundx_cloud", false); ok("flags: set tri false", F2.get("smd_fundx_cloud") === false);
F2.set("smd_fundx_mode", "expert"); ok("flags: set enum valid", F2.get("smd_fundx_mode") === "expert");
F2.set("smd_fundx_mode", "bogus"); ok("flags: enum invalid → default", F2.get("smd_fundx_mode") === "standard");
ok("flags: a11y flags default false", F.get("smd_fundx_a11y_contrast") === false && F.get("smd_fundx_a11y_large") === false && F.get("smd_fundx_a11y_cvd") === false);
ok("flags: autocapture + ar_guidance default true", F.get("smd_fundx_autocapture") === true && F.get("smd_fundx_ar_guidance") === true);
ok("flags: upload default true", F.get("smd_fundx_upload") === true);

const { F: F3, ls: ls3 } = load("?fundx=1");
ls3.setItem("smd_fundx", "0");
ok("flags: ?query overrides localStorage", F3.get("smd_fundx") === true);

const a = F.all();
ok("flags: all() lists every flag", Object.keys(a).length === Object.keys(F.DEFS).length && a.smd_fundx === true);

console.log(`\nfundx-flags: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
