// FollowCare AI — i18n unit tests: deterministic state→language detection + reviewed translation registry.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "followcare-i18n.js"), "utf8"), { filename: "followcare-i18n.js" });
const I18N = globalThis.FollowCareI18n;
const det = s => I18N.detectLanguage(s).lang;

test("detect: explicit state name → regional language (the spec matrix)", () => {
  assert.equal(det("Telangana"), "te");
  assert.equal(det("Andhra Pradesh"), "te");
  assert.equal(det("Tamil Nadu"), "ta");
  assert.equal(det("Karnataka"), "kn");
  assert.equal(det("Kerala"), "ml");
  assert.equal(det("Odisha"), "or");
  assert.equal(det("Maharashtra"), "mr");
  assert.equal(det("Gujarat"), "gu");
  assert.equal(det("West Bengal"), "bn");
  assert.equal(det("Punjab"), "pa");
  assert.equal(det("Assam"), "as");
});

test("detect: the whole Hindi belt (+ Delhi/UTs) → Hindi", () => {
  ["Bihar", "Uttar Pradesh", "Madhya Pradesh", "Rajasthan", "Haryana", "Delhi",
   "Chhattisgarh", "Jharkhand", "Uttarakhand", "Himachal Pradesh", "New Delhi", "Chandigarh"
  ].forEach(s => assert.equal(det(s), "hi", s));
});

test("detect: works inside a full free-text address", () => {
  assert.equal(det("H.No 4-5-12, Warangal, Telangana 506002"), "te");
  assert.equal(det("12 Anna Salai, Chennai, Tamil Nadu 600002"), "ta");
  assert.equal(det("Sector 22, Gurugram, Haryana"), "hi");
});

test("detect: city fallback when the state is absent", () => {
  assert.equal(det("Bengaluru"), "kn");
  assert.equal(det("Kochi"), "ml");
  assert.equal(det("Mumbai 400001"), "mr");
  assert.equal(det("Kolkata"), "bn");
  assert.equal(det("Hyderabad"), "te");
});

test("detect: boundary-aware — 'Bengaluru' must NOT be read as 'bengal' (West Bengal)", () => {
  assert.equal(det("Bengaluru, Karnataka"), "kn");
  assert.equal(det("Bengaluru"), "kn");
});

test("detect: uppercase postal abbreviations (case-sensitive, lowest priority)", () => {
  assert.equal(det("Guntur, AP - 522001"), "te");
  assert.equal(det("Somewhere, TN"), "ta");
  assert.equal(det("Somewhere, MH"), "mr");
  // lowercase 'as'/'or' as ordinary English words must NOT trigger Assam/Odisha
  assert.equal(det("Meet me as soon as you can"), "en");
  assert.equal(det("apples or oranges"), "en");
});

test("detect: unknown / empty → English, with provenance", () => {
  assert.equal(det("Somewhere unknown"), "en");
  assert.equal(det(""), "en");
  assert.equal(det(null), "en");
  const d = I18N.detectLanguage("Andhra Pradesh");
  assert.equal(d.method, "state"); assert.equal(d.native, "తెలుగు"); assert.equal(d.name, "Telugu");
  assert.equal(I18N.detectLanguage("no match").method, "default");
});

test("t(): reviewed strings + interpolation", () => {
  assert.equal(I18N.t("fc.portal.submit", "en"), "Submit");
  assert.equal(I18N.t("fc.portal.submit", "hi"), "जमा करें");
  assert.equal(I18N.t("fc.msg.send", "en", { name: "Ravi", link: "https://x" }),
    "Hi Ravi, this is your StewardMD recovery check-in. It only takes a minute: https://x");
  // empty name is tidied (no dangling "Hi ,")
  assert.equal(I18N.t("fc.msg.send", "en", { name: "", link: "L" }),
    "Hi, this is your StewardMD recovery check-in. It only takes a minute: L");
  assert.equal(I18N.t("fc.lang.prompt", "en", { lang: "Telugu" }), "Would you like to continue in Telugu?");
});

test("t(): unknown language falls back to English; unknown key returns the key", () => {
  // An unsupported language code → English fallback (the fallback path still works).
  assert.equal(I18N.t("fc.portal.submit", "zz"), "Submit");
  assert.equal(I18N.t("fc.msg.send", "zz", { name: "A", link: "L" }), I18N.t("fc.msg.send", "en", { name: "A", link: "L" }));
  // The 9 workflow-translated languages now have real strings (no longer English fallback).
  assert.notEqual(I18N.t("fc.portal.submit", "ta"), "Submit");
  assert.ok(I18N.t("fc.q.edema", "kn") && I18N.t("fc.q.edema", "kn") !== I18N.STR["fc.q.edema"].en);
  // unknown key → the key itself (never empty/throw)
  assert.equal(I18N.t("fc.no.such.key", "en"), "fc.no.such.key");
});

test("catalogue helpers + extensibility invariants", () => {
  assert.equal(I18N.isReviewed("en"), true);
  assert.equal(I18N.isReviewed("hi"), true);
  assert.equal(I18N.isReviewed("te"), true);
  assert.equal(I18N.isReviewed("ta"), false);
  assert.equal(I18N.isSupported("gu"), true);
  assert.equal(I18N.isSupported("xx"), false);
  assert.equal(I18N.langNative("kn"), "ಕನ್ನಡ");
  // every language in the spec matrix is in the catalogue
  const codes = I18N.languages().map(l => l.code);
  ["en", "hi", "te", "ta", "kn", "ml", "mr", "gu", "bn", "pa", "or", "as"].forEach(c => assert.ok(codes.includes(c), c));
  // every registry key MUST have an English value (English is the guaranteed fallback)
  Object.keys(I18N.STR).forEach(k => assert.ok(I18N.STR[k].en != null, "missing en for " + k));
});
