/* test/security-scan.test.mjs — P2.17 unit tests for scripts/security-scan.mjs.
 *
 * The scanner's rule functions are pure over small in-memory strings, so every
 * rule is pinned here without touching the network or the working tree: each
 * secret shape, the known-public fingerprint suppressions, the private-key
 * key-material lookahead (both cases), the inline allow comment, the
 * comment-only cases the dangerous rules claim to ignore, the SSRF
 * first-argument heuristic (including the real sknx line that must NOT flag),
 * and the dependency-audit WARN / NOT RUN reporting. If a rule's shape
 * drifts, this file says so before CI does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasAllowComment,
  scanLineForSecrets,
  stripComments,
  firstArgOfCall,
  scanTextForDangerous,
  scanTextForCors,
  hasApiAuth,
  PUBLIC_ALLOWLIST,
  parseNpmAudit,
  auditNotRunMessage,
  shouldSkipFile,
  KNOWN_PUBLIC,
  sha256Hex,
  isKnownPublic,
  hasKeyMaterial,
  formatDepWarning,
  depRanMessage,
  isBlockingRule,
} from "../scripts/security-scan.mjs";

/* Every example credential below is synthetic (obvious TEST fakes, never a
 * real key). Each line that matches a secret shape carries the scanner's own
 * inline suppression so the committed scanner stays green on its own test.
 * The REAL known-public values (the Firebase client keys, the AWS docs
 * example) appear in this repo only as SHA-256 fingerprints in KNOWN_PUBLIC,
 * never as literals, so they cannot be reconstructed from here. */

const AWS_SYNTHETIC = "AKIAZZZZZZZZZZZZZZZZ"; // security-scan: allow synthetic test key, not real
const GOOGLE_SYNTHETIC = "AIzaSyATESTKEY0123456789abcdefghijklm01"; // security-scan: allow synthetic test key, not real
const SLACK_EXAMPLE = "xoxb-12345678-abcdefghi"; // security-scan: allow synthetic test token, not real
const GITHUB_EXAMPLE = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"; // security-scan: allow synthetic test token, not real
const STRIPE_EXAMPLE = "sk_live_abc123DEF456ghi7"; // security-scan: allow synthetic test key, not real
const RAZORPAY_EXAMPLE = "rzp_live_abc123DEF456ghi7"; // security-scan: allow synthetic test key, not real
const PRIVKEY_LINE = "-----BEGIN PRIVATE KEY----- abcdef"; // security-scan: allow bare PEM header label, no key material
const RSA_PRIVKEY_LINE = "-----BEGIN RSA PRIVATE KEY----- abcdef"; // security-scan: allow bare PEM header label, no key material

test("each secret shape is found", () => {
  assert.equal(scanLineForSecrets("key = \"" + AWS_SYNTHETIC + "\"", "a.js")[0].rule, "secret:aws-key");
  assert.equal(scanLineForSecrets("apiKey: \"" + GOOGLE_SYNTHETIC + "\"", "a.js")[0].rule, "secret:google-key");
  assert.equal(scanLineForSecrets("token=" + SLACK_EXAMPLE, "a.js")[0].rule, "secret:slack-token");
  assert.equal(scanLineForSecrets("token=" + GITHUB_EXAMPLE, "a.js")[0].rule, "secret:github-token");
  assert.equal(scanLineForSecrets("key=" + STRIPE_EXAMPLE, "a.js")[0].rule, "secret:stripe-key");
  assert.equal(scanLineForSecrets("key=" + RAZORPAY_EXAMPLE, "a.js")[0].rule, "secret:razorpay-key");
});

test("a bare private-key header with no key material is not a finding", () => {
  /* The push docs and the APNs sender comment name the PEM header while the
   * real key lives in a Cloudflare secret: a label, not a leak. */
  assert.deepEqual(scanLineForSecrets(PRIVKEY_LINE, "docs/push.md"), []);
  assert.deepEqual(scanLineForSecrets(RSA_PRIVKEY_LINE, "functions/_apns.js"), []);
  assert.deepEqual(scanLineForSecrets("copy -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY-----", "docs/x.md"), []);
  assert.deepEqual(scanLineForSecrets("-----BEGIN PRIVATE KEY-----", "a.js", []), []);
  assert.deepEqual(scanLineForSecrets("-----BEGIN PRIVATE KEY-----", "a.js"), []);
});

test("a private-key header followed by key material flags", () => {
  /* Key bytes are built at runtime so no committed line holds a header next
   * to base64: the shape under test is assembled, never stored. */
  const material = "MIIE" + "A".repeat(60); // security-scan: allow assembled test fixture, not real key material
  const hits = scanLineForSecrets("-----BEGIN PRIVATE KEY-----", "a.js", [material]); // security-scan: allow test header fixture, not a real key
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, "secret:private-key");
  assert.ok(!hits[0].publicByDesign);
  const third = scanLineForSecrets("-----BEGIN RSA PRIVATE KEY-----", "a.js", ["x", "y", material]); // security-scan: allow test header fixture, not a real key
  assert.equal(third.length, 1);
  assert.equal(third[0].rule, "secret:private-key");
});

test("key material beyond the 3-line window does not flag", () => {
  const material = "MIIE" + "B".repeat(60); // security-scan: allow assembled test fixture, not real key material
  assert.deepEqual(scanLineForSecrets("-----BEGIN PRIVATE KEY-----", "a.js", ["a", "b", "c", material]), []); // security-scan: allow test header fixture, not a real key
});

test("hasKeyMaterial reads only the 3 following lines", () => {
  const material = "MIIE" + "C".repeat(60);
  assert.ok(hasKeyMaterial([material]));
  assert.ok(hasKeyMaterial(["a", "b", material]));
  assert.ok(!hasKeyMaterial(["a", "b", "c", material]));
  assert.ok(!hasKeyMaterial([]));
  assert.ok(!hasKeyMaterial());
  assert.ok(!hasKeyMaterial(["short", "-----END PRIVATE KEY-----"]));
});

test("sha256Hex matches the well-known empty-string and abc vectors", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("KNOWN_PUBLIC entries are fingerprints with reasons, never raw values", () => {
  assert.ok(KNOWN_PUBLIC.length >= 2, "the scanner must name its known-public values");
  const rules = [];
  for (const e of KNOWN_PUBLIC) {
    assert.ok(e.rule && typeof e.rule === "string");
    assert.ok(/^[0-9a-f]{64}$/.test(e.sha256), "each entry is a SHA-256 hex fingerprint");
    assert.ok(e.reason && e.reason.length > 20, "each entry carries a reviewable reason");
    assert.ok(e.sha256.indexOf("AKIA") === -1, "no raw key shape inside a fingerprint");
    assert.ok(e.sha256.indexOf("AIza") === -1, "no raw key shape inside a fingerprint");
    rules.push(e.rule);
  }
  assert.ok(rules.indexOf("secret:aws-key") !== -1, "the AWS docs example is fingerprinted");
  assert.ok(rules.indexOf("secret:google-key") !== -1, "the Firebase client key is fingerprinted");
});

test("a known-public value suppresses by hash, a different key still flags", () => {
  /* The probe is synthetic and built at runtime: it has the Google shape but
   * is not the fingerprinted value, so it flags until a fingerprint for its
   * own hash is added, then suppresses, then flags again once removed. */
  const probe = "AIzaSyA" + "z".repeat(32);
  assert.equal(probe.length, 39);
  assert.ok(!isKnownPublic("secret:google-key", probe));
  const before = scanLineForSecrets("k=\"" + probe + "\"", "a.js");
  assert.equal(before.length, 1);
  assert.ok(!before[0].publicByDesign);
  KNOWN_PUBLIC.push({ rule: "secret:google-key", sha256: sha256Hex(probe), reason: "test-only probe entry, removed below" });
  let hits;
  try {
    hits = scanLineForSecrets("k=\"" + probe + "\"", "a.js");
  } finally {
    KNOWN_PUBLIC.pop();
  }
  assert.equal(hits.length, 1);
  assert.ok(hits[0].publicByDesign);
  assert.ok(!isKnownPublic("secret:google-key", probe));
});

test("a line mixing a known value with an unknown one still fails closed", () => {
  const probe = "AIzaSyB" + "y".repeat(32);
  KNOWN_PUBLIC.push({ rule: "secret:google-key", sha256: sha256Hex(probe), reason: "test-only probe entry, removed below" });
  let hits;
  try {
    hits = scanLineForSecrets("a=" + probe + " b=" + GOOGLE_SYNTHETIC, "a.js");
  } finally {
    KNOWN_PUBLIC.pop();
  }
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, "secret:google-key");
  assert.ok(!hits[0].publicByDesign);
});

test("non-empty password values flag in JSON only", () => {
  const hits = scanLineForSecrets('  "password": "hunter2",', "config.json");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, "secret:json-password");
  assert.deepEqual(scanLineForSecrets('  "password": "",', "config.json"), []);
  assert.deepEqual(scanLineForSecrets('  "password": "hunter2",', "app.js"), []);
  assert.deepEqual(scanLineForSecrets("no secrets here", "a.js"), []);
});

test("finding messages never carry the matched value", () => {
  for (const hit of scanLineForSecrets("key=" + STRIPE_EXAMPLE, "a.js")) {
    assert.ok(hit.message.indexOf("abc123") === -1, "message must name the kind, not the value");
  }
});

test("the inline allow comment suppresses a finding on the same line", () => {
  assert.ok(hasAllowComment("x = 1 // security-scan: allow reviewed test fixture"));
  assert.ok(!hasAllowComment("x = 1 // nothing to do with scanning"));
  assert.ok(!hasAllowComment("x = 1 // security-scan: allow"));
  assert.deepEqual(scanLineForSecrets("key=" + AWS_SYNTHETIC + " // security-scan: allow reviewed", "a.js"), []);
});

test("comment-only dangerous patterns are ignored, real ones are not", () => {
  assert.deepEqual(scanTextForDangerous("// eval(userInput);\nconst x = 1;\n", "functions/a.js"), []);
  assert.deepEqual(scanTextForDangerous("/* eval(userInput); */\nconst x = 1;\n", "functions/a.js"), []);
  assert.deepEqual(scanTextForDangerous("/* multi\nline\neval(userInput); */\nconst x = 1;\n", "functions/a.js"), []);
  const hits = scanTextForDangerous("const out = eval(userInput); // TODO remove\n", "functions/a.js");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, "dangerous:eval");
  assert.equal(hits[0].line, 1);
});

test("trailing comments fail closed: the code before them still scans", () => {
  /* Stripping a trailing // would also strip one inside a string ("http://..")
   * and hide the real code after it, so trailing comments are never stripped:
   * a match there flags the line and a human decides. */
  const hits = scanTextForDangerous("const x = 1; // eval(userInput);\n", "functions/a.js");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, "dangerous:eval");
});

test("new Function and child_process flag in server code", () => {
  const fn = scanTextForDangerous("var imp = new Function(\"p\", \"return import(p)\");\n", "functions/a.js");
  assert.equal(fn.length, 1);
  assert.equal(fn[0].rule, "dangerous:new-function");
  const cp = scanTextForDangerous("import { execFileSync } from \"node:child_process\";\n", "functions/a.js");
  assert.equal(cp.length, 1);
  assert.equal(cp[0].rule, "dangerous:child-process");
});

test("stripComments keeps line numbers stable", () => {
  const stripped = stripComments("a\n/* multi\nline */\nb");
  assert.equal(stripped.split("\n").length, 4);
  assert.equal(stripped.split("\n")[3], "b");
});

test("firstArgOfCall reads only the URL argument", () => {
  assert.equal(firstArgOfCall("fetch(a, b)", 0, 5), "a");
  assert.equal(firstArgOfCall("fetch(f(a, b), c)", 0, 5), "f(a, b)");
  assert.equal(firstArgOfCall("fetch(\"a,b\", c)", 0, 5), "\"a,b\"");
  assert.equal(firstArgOfCall("fetch(a)", 0, 5), "a");
  assert.equal(firstArgOfCall("fetch(a", 0, 5), "");
});

test("fetch straight from request input flags without the guard", () => {
  const hits = scanTextForDangerous("const r = await fetch(body.callbackUrl, { method: \"POST\" });\n", "functions/api/x.js");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, "dangerous:ssrf-fetch");
  const qs = scanTextForDangerous("const r = await fetch(url.searchParams.get(\"next\"));\n", "functions/api/x.js");
  assert.equal(qs.length, 1);
  assert.equal(qs[0].rule, "dangerous:ssrf-fetch");
});

test("the sknx env-target fetch does not flag (options body is not the URL)", () => {
  const line = "const upstream = await fetch(target.replace(/\\/$/, \"\") + \"/classify\", { method: \"POST\", headers, body: JSON.stringify({ image: body.image }) });\n";
  assert.deepEqual(scanTextForDangerous(line, "functions/api/sknx/[[path]].js"), []);
});

test("a file calling the SSRF guard does not flag", () => {
  const src = "import { assertPublicHttpsUrl } from \"../_connect/onboard/ssrf.js\";\n"
    + "const u = assertPublicHttpsUrl(String(body.url), \"url\");\n"
    + "const r = await fetch(u.href, { method: \"GET\" });\n";
  assert.deepEqual(scanTextForDangerous(src, "functions/api/x.js"), []);
});

test("CORS star plus credentials flags; reflected origin without credentials does not", () => {
  const bad = scanTextForCors("\"Access-Control-Allow-Origin\": \"*\",\n\"Access-Control-Allow-Credentials\": \"true\",\n");
  assert.equal(bad.length, 1);
  assert.equal(bad[0].rule, "cors:star-with-credentials");
  assert.deepEqual(scanTextForCors("\"Access-Control-Allow-Origin\": origin || \"*\",\n"), []);
  assert.deepEqual(scanTextForCors("\"Access-Control-Allow-Origin\": \"*\",\n"), []);
});

test("hasApiAuth recognises the project's resolvers", () => {
  assert.ok(hasApiAuth("const who = await identify(request, env);"));
  assert.ok(hasApiAuth("const az = await ORG.authorizeOrg(env, actor, orgId, cap);"));
  assert.ok(hasApiAuth("const actor = await resolveActor(request, env);"));
  assert.ok(hasApiAuth("await verifyFirebaseToken(token, env);"));
  assert.ok(hasApiAuth("if (!(await ownerOK(request, env))) return;"));
  assert.ok(!hasApiAuth("export async function onRequestPost({ request, env }) { return json({ ok: true }); }"));
});

test("every public-route allowlist entry carries a reason", () => {
  const files = Object.keys(PUBLIC_ALLOWLIST);
  assert.ok(files.length > 0 && files.length <= 10, "allowlist must stay small, got " + files.length);
  for (const f of files) assert.ok(PUBLIC_ALLOWLIST[f].length > 20, f + " needs a real reason");
});

test("parseNpmAudit counts high and critical across npm shapes", () => {
  const modern = JSON.stringify({ vulnerabilities: {
    a: { severity: "high" }, b: { severity: "critical", title: "t", url: "u" },
    c: { severity: "moderate" }, d: { severity: "low" }, e: { severity: "info" },
  } });
  const got = parseNpmAudit(modern);
  assert.equal(got.length, 2);
  assert.deepEqual(got.map((x) => x.severity).sort(), ["critical", "high"]);
  const legacy = JSON.stringify({ advisories: {
    1: { module_name: "m", severity: "high", title: "t", url: "u" },
    2: { module_name: "n", severity: "low", title: "t2" },
  } });
  assert.equal(parseNpmAudit(legacy).length, 1);
  assert.deepEqual(parseNpmAudit("{}"), []);
  assert.throws(() => parseNpmAudit("not json{"), SyntaxError);
});

test("parseNpmAudit reads the advisory title and url from the via array", () => {
  /* npm 7+ puts the advisory detail under via, not top-level: string members
   * are the dependency chain and must be skipped for the object advisory. */
  const shaped = JSON.stringify({ vulnerabilities: {
    dep: { severity: "high", via: ["dep", { title: "Example advisory", url: "https://example.com/advisory/9" }] },
  } });
  const got = parseNpmAudit(shaped);
  assert.equal(got.length, 1);
  assert.equal(got[0].title, "Example advisory");
  assert.equal(got[0].url, "https://example.com/advisory/9");
  assert.equal(
    formatDepWarning(got[0]),
    "WARN dep:high dep high https://example.com/advisory/9");
});

test("dependency warnings print as WARN lines and never block the job", () => {
  assert.equal(
    formatDepWarning({ name: "brace-expansion", severity: "high", title: "", url: "https://example.com/advisory/1" }),
    "WARN dep:high brace-expansion high https://example.com/advisory/1");
  assert.equal(
    formatDepWarning({ name: "xmldom", severity: "critical", title: "Misinterpretation of malicious XML", url: "" }),
    "WARN dep:critical xmldom critical Misinterpretation of malicious XML");
  assert.equal(
    formatDepWarning({ name: "leftpad", severity: "high", title: "", url: "" }),
    "WARN dep:high leftpad high no-advisory-ref");
  assert.equal(depRanMessage(2), "dependency audit: RAN, 2 high/critical advisories (not blocking; owner review)");
  assert.equal(depRanMessage(1), "dependency audit: RAN, 1 high/critical advisory (not blocking; owner review)");
  assert.equal(depRanMessage(0), "dependency audit: RAN, 0 high/critical advisories (not blocking; owner review)");
});

test("only secrets, dangerous patterns and CORS/auth gaps block; dep rules do not", () => {
  assert.ok(isBlockingRule("secret:google-key"));
  assert.ok(isBlockingRule("secret:private-key"));
  assert.ok(isBlockingRule("dangerous:eval"));
  assert.ok(isBlockingRule("cors:star-with-credentials"));
  assert.ok(isBlockingRule("auth:missing-resolver"));
  assert.ok(!isBlockingRule("dep:high"));
  assert.ok(!isBlockingRule("dep:critical"));
});

test("the audit NOT RUN message never reads as clean", () => {
  const msg = auditNotRunMessage("registry unreachable");
  assert.equal(msg, "dependency audit: NOT RUN (registry unreachable)");
  assert.ok(msg.indexOf("no vulnerabilities") === -1);
  assert.ok(msg.indexOf("NOT RUN") !== -1);
});

test("shouldSkipFile skips lockfiles, node_modules and fixtures only", () => {
  assert.ok(shouldSkipFile("package-lock.json"));
  assert.ok(shouldSkipFile("node_modules/foo/index.js"));
  assert.ok(shouldSkipFile("test/fixtures/keys.json"));
  assert.ok(shouldSkipFile("tests/fixtures/keys.json"));
  assert.ok(!shouldSkipFile("functions/api/queue/[[path]].js"));
  assert.ok(!shouldSkipFile("test/security-scan.test.mjs"));
});
