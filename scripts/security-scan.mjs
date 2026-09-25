#!/usr/bin/env node
/* scripts/security-scan.mjs — P2.17 automated security scan.
 *
 * Four small rules, each guarding one way a secret or a hole gets committed
 * without anyone noticing:
 *
 *   secrets      Shape-match for credential-looking strings in everything git
 *                tracks (private keys, cloud API keys, chat/VCS tokens, live
 *                payment keys, non-empty "password" values in JSON). A key that
 *                reaches main is a key that must be rotated, so this fails the
 *                build instead of asking a reviewer to eyeball every diff.
 *                Two shapes stay quiet on purpose: values fingerprinted in
 *                KNOWN_PUBLIC (client keys that are public by design) and a
 *                bare private-key header with no key material near it.
 *   dangerous    eval(, new Function( and child_process under functions/, plus
 *                a fetch( whose URL comes straight from request input without
 *                passing through the SSRF guard (assertPublicHttpsUrl in
 *                functions/_connect/onboard/ssrf.js). Only clear direct cases
 *                are flagged, so the rule stays quiet instead of crying wolf.
 *   cors-auth    In functions/api/**: Access-Control-Allow-Origin * combined
 *                with credentials, and route handlers that never call the
 *                project's actor/auth resolver (a door nobody checked). The
 *                intentionally public doors are named in PUBLIC_ALLOWLIST with
 *                the reason, so adding an unauthenticated route fails loudly
 *                instead of slipping in beside them.
 *   dependency   npm audit --json --omit=dev, high and critical only. Each
 *                advisory prints as a WARN line and the summary counts them
 *                as owner review, but they NEVER fail the job: a red build
 *                nobody can fix trains people to ignore this file, while a
 *                hidden advisory trains them to trust it. When the audit
 *                cannot run (offline, registry error) it reports NOT RUN. It
 *                must never print "no vulnerabilities" when it did not run.
 *
 * Findings print as `file:line rule message` (never the matched value, so the
 * scan log itself cannot leak a secret) and any blocking finding exits
 * non-zero. Two kinds of match are reported but never fail the build:
 * KNOWN_PUBLIC fingerprints (client keys that are public by design, counted
 * as public-by-design in the summary) and dependency advisories (printed as
 * WARN lines, counted in a non-blocking audit line). A line carrying
 * `security-scan: allow <reason>` is skipped, so a reviewed exception (for
 * example the synthetic keys in this file's own unit test) stays visible next
 * to the reason instead of hiding in an ignore file.
 *
 * Usage: node scripts/security-scan.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/* A suppression needs a reason, on the same line, or it is not one. */
export function hasAllowComment(line) {
  return /security-scan:\s*allow\s+\S+/.test(String(line || ""));
}

/* ---- secrets ------------------------------------------------------------------ */
/* Each pattern is deliberately the documented shape of the credential and
 * nothing more: tight enough that prose about a key type does not match, loose
 * enough that a real pasted key does. Messages name the KIND, never the value. */
export const SECRET_RULES = [
  { id: "secret:aws-key", re: /AKIA[0-9A-Z]{16}/, describe: "possible AWS access key id" },
  { id: "secret:google-key", re: /AIza[0-9A-Za-z_-]{35}/, describe: "possible Google API key" },
  { id: "secret:slack-token", re: /xox[baprs]-[A-Za-z0-9-]{8,}/, describe: "possible Slack token" },
  { id: "secret:github-token", re: /gh[pousr]_[A-Za-z0-9]{36}/, describe: "possible GitHub token" },
  { id: "secret:stripe-key", re: /sk_live_[A-Za-z0-9]{8,}/, describe: "possible Stripe live secret key" },
  { id: "secret:razorpay-key", re: /rzp_live_[A-Za-z0-9_]{8,}/, describe: "possible Razorpay live key" },
];
/* Generic password values are only meaningful in JSON (config, fixtures, seed
 * data). In JS/TS the same text is usually code (`password: password`, a hash
 * comparison), so scoping to .json keeps this rule near zero false positives. */
export const PASSWORD_JSON_RE = /"password"\s*:\s*"[^"]+"/;

/* Known-public values, matched by fingerprint and nothing else.
 *
 * A Firebase client API key and AWS's own documentation example all have the
 * SHAPE of a credential without being one: the Firebase keys ship inside
 * every web bundle and iOS install (the web key in the JS firebase config,
 * the iOS key in GoogleService-Info.plist), and the AWS key is the example
 * from AWS's own docs. Writing any of those raw values here would teach the
 * scanner (and its log) a string shaped exactly like a key, so each entry
 * carries only the SHA-256 hex of the matched value plus the reason. A
 * DIFFERENT key of the same shape hashes differently and still fails, which
 * the unit test pins without ever holding a real value. A match whose every
 * value hashes to a listed entry comes back with `publicByDesign: true` and
 * is counted in the summary, never emitted as a finding; a line mixing a
 * known value with an unknown one still fails closed as a finding. */
export const KNOWN_PUBLIC = [
  { rule: "secret:google-key", sha256: "a48cac56a0778a65ad775357624a418eddd1635385c8476e4c7c7a0eaafecff4", reason: "Firebase web API key, public by design; access is enforced by Firebase security rules and App Check" },
  { rule: "secret:google-key", sha256: "0ac4fbacc4067f5e3e05b829db9439373554ef45a2df17c9ff93d0cb040ba331", reason: "Firebase iOS API key (GoogleService-Info.plist), public by design like the web key; shipped in every install, enforced by Firebase security rules and App Check" },
  { rule: "secret:aws-key", sha256: "1a5d44a2dca19669d72edf4c4f1c27c4c1ca4b4408fbb17f6ce4ad452d78ddb3", reason: "AWS documentation example key, not a real credential" },
];

export function sha256Hex(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function isKnownPublic(rule, value) {
  const hex = sha256Hex(value);
  return KNOWN_PUBLIC.some((e) => e.rule === rule && e.sha256 === hex);
}

/* Every non-empty match of one rule on one line, so the caller can hash each
 * VALUE instead of just noting the shape matched. A fresh global regex per
 * call keeps lastIndex state from leaking between lines. */
function matchedValues(line, re) {
  const out = [];
  const g = new RegExp(re.source, "g");
  let m;
  while ((m = g.exec(line)) !== null) {
    if (!m[0]) break;
    out.push(m[0]);
  }
  return out;
}

/* A bare PEM header with no key bytes after it is a label in a comment or a
 * doc, not a key: the push docs and the APNs sender comment both name the
 * header while telling the reader the real key lives in a Cloudflare secret.
 * Only flag when base64-looking key material (40 or more base64 characters)
 * follows within 3 lines, which is what a real pasted PEM block looks like.
 * This fails closed the safe way: material nearby flags, a bare label does
 * not. The lookahead comes from the caller as the lines after the match. */
export const PRIVATE_KEY_HEADER_RE = /-----BEGIN (?:[A-Z0-9 ]* )?PRIVATE KEY-----/;
export const KEY_MATERIAL_RE = /[A-Za-z0-9+/]{40,}/;

export function hasKeyMaterial(following) {
  const next = Array.isArray(following) ? following.slice(0, 3) : [];
  return next.some((l) => KEY_MATERIAL_RE.test(String(l || "")));
}

export function scanLineForSecrets(line, file, following) {
  const out = [];
  const text = String(line || "");
  if (hasAllowComment(text)) return out;
  for (const rule of SECRET_RULES) {
    const values = matchedValues(text, rule.re);
    if (!values.length) continue;
    if (values.every((v) => isKnownPublic(rule.id, v))) {
      out.push({ rule: rule.id, message: rule.describe, publicByDesign: true });
    } else {
      out.push({ rule: rule.id, message: rule.describe });
    }
  }
  if (PRIVATE_KEY_HEADER_RE.test(text) && hasKeyMaterial(following)) {
    out.push({ rule: "secret:private-key", message: "possible private key block" });
  }
  if (file && file.endsWith(".json") && PASSWORD_JSON_RE.test(text)) {
    out.push({ rule: "secret:json-password", message: 'non-empty "password" value in JSON' });
  }
  return out;
}

/* ---- dangerous server patterns ------------------------------------------------- */
/* Comment-only code is not code: a commented-out eval is a note, not a hole.
 * Block comments are blanked and full-line // comments dropped (newlines kept,
 * so reported line numbers still point at the right place). Trailing comments
 * are left alone, so `eval(x); // TODO remove` still flags the eval. */
export function stripComments(text) {
  const noBlock = String(text || "").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

export const DANGEROUS_RULES = [
  { id: "dangerous:eval", re: /\beval\s*\(/, describe: "eval( in server code" },
  { id: "dangerous:new-function", re: /\bnew\s+Function\s*\(/, describe: "new Function( in server code" },
  { id: "dangerous:child-process", re: /child_process/, describe: "child_process in server code" },
];
/* A fetch whose FIRST argument is request input on the SAME line:
 * fetch(body.callbackUrl), fetch(url.searchParams.get("next")). Only the URL
 * argument is read (firstArgOfCall, quote-aware), so an options object that
 * mentions body later on the line does not count. Anything indirect (a
 * variable built three lines up) or multi-line is left for human review rather
 * than guessed at. A file that calls the SSRF guard passes: the guard at save
 * time plus per-fetch re-check is the defence, and re-flagging guarded files
 * would train people to ignore this. */
export const SSRF_URL_HINT = /body\.|searchParams/;
export const SSRF_GUARD = /assertPublicHttpsUrl/;

/* The text between `call(` and the first comma at that call's own depth,
 * skipping over '...' "..." `...` literals, or the whole argument when the
 * call closes with a single argument. Regex literals are not tracked, so this
 * is a single-line heuristic, not a parser. Returns "" only when the call is
 * unterminated on this line. */
export function firstArgOfCall(line, callIndex, callLength) {
  const src = String(line || "");
  let i = callIndex + callLength;
  if (src[i] !== "(") return "";
  i += 1;
  let depth = 1;
  let quote = "";
  let buf = "";
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      buf += c;
      if (c === "\\") { buf += src[i + 1] || ""; i++; continue; }
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; buf += c; continue; }
    if (c === "(") { depth++; buf += c; continue; }
    if (c === ")") { depth--; if (depth === 0) return buf; buf += c; continue; }
    if (c === "," && depth === 1) return buf;
    buf += c;
  }
  return "";
}

export function scanTextForDangerous(text, file) {
  const out = [];
  const src = String(text || "");
  const stripped = stripComments(src).split("\n");
  const raw = src.split("\n");
  const hasGuard = SSRF_GUARD.test(src);
  stripped.forEach((line, i) => {
    if (hasAllowComment(raw[i])) return;
    for (const rule of DANGEROUS_RULES) {
      if (rule.re.test(line)) out.push({ rule: rule.id, line: i + 1, message: rule.describe });
    }
    if (!hasGuard) {
      let at = 0;
      let flagged = false;
      while (!flagged) {
        const idx = line.indexOf("fetch(", at);
        if (idx === -1) break;
        const arg = firstArgOfCall(line, idx, "fetch".length);
        if (arg && SSRF_URL_HINT.test(arg)) {
          out.push({ rule: "dangerous:ssrf-fetch", line: i + 1, message: "fetch( URL straight from request input without the SSRF guard" });
          flagged = true;
        }
        at = idx + "fetch(".length;
      }
    }
  });
  return out;
}

/* ---- CORS + auth --------------------------------------------------------------- */
export function scanTextForCors(text) {
  const out = [];
  const src = String(text || "");
  const starOrigin = /Access-Control-Allow-Origin["']?\s*[:=]\s*["']?\*/.test(src);
  const credentials = /Access-Control-Allow-Credentials/i.test(src);
  if (starOrigin && credentials) {
    out.push({ rule: "cors:star-with-credentials", message: "Access-Control-Allow-Origin * combined with credentials" });
  }
  return out;
}

/* Every substring here is a real identity/auth resolver in this repo, not a
 * guess: resolveActor is the queue router's identity entry point
 * (functions/api/queue/[[path]].js), resolveClinicalActor/resolveIdentity the
 * WardSynQ clinical actor (functions/_wardsynq/actor.js), authorizeOrg the org
 * capability gate (functions/_opd_org.js), verifyStaffSession the staff
 * session (functions/_opd_auth.js), verifyFirebaseToken Firebase
 * (functions/_fbauth.js), identify( the server-derived identity
 * (functions/_usage.js, functions/_fbauth.js), ownerOK the owner gate
 * (functions/_adminauth.js), resolveBearer/smartEnabled the SMART bearer door
 * (functions/_wardsynq/smart-server.js), callerUid the server-derived uid in
 * thorex/sknx, verifyDisplayToken the patient display token, redeemCode /
 * portalRead / sessionPatient the portal grant-code door
 * (functions/_wardsynq/patient-access.js), authorise the coarse app gate the
 * reference-data routes (icd, schemes, retrieve) define locally, hmacHex /
 * makeSecrets the runner HMAC (functions/api/connect/agent/runner), and
 * _rx_public the opaque-handle prescription verification. */
export const AUTH_MARKERS = [
  "resolveActor", "resolveClinicalActor", "resolveIdentity", "authorizeOrg",
  "verifyStaffSession", "verifyFirebaseToken", "identify(", "ownerOK",
  "resolveBearer", "callerUid", "verifyDisplayToken", "redeemCode",
  "portalRead", "sessionPatient", "smartEnabled", "authorise", "hmacHex",
  "makeSecrets", "_rx_public", "verifySecret", "verifyMfaChallenge",
  "verifyTotp", "mintStaffSession",
];

export function hasApiAuth(text) {
  const src = String(text || "");
  return AUTH_MARKERS.some((m) => src.indexOf(m) !== -1);
}

export function isHandlerFile(rel, text) {
  return (rel.endsWith(".js") || rel.endsWith(".mjs")) && /onRequest/.test(String(text || ""));
}

/* Doors that are public ON PURPOSE. Each names the file and the reason its own
 * header gives, so a new unauthenticated route cannot hide in this list: it
 * must add an entry admitting it, which is exactly the review moment wanted. */
export const PUBLIC_ALLOWLIST = {
  "functions/api/analytics.js": "public by design: header documents an unauthenticated always-200 product-event counter over allow-listed event names, no PHI",
  "functions/api/clientlog.js": "public by design: header documents unauthenticated crash telemetry (errors happen before sign-in), metadata only, always 200",
  "functions/api/config.js": "public by design: header documents an unauthenticated boot-config read; setting it is the separate owner route",
  "functions/api/hospital-request.js": "login-free by design: header documents a per-IP rate limit plus a CORS allow-list instead of auth, so a hospital without access can ask for onboarding",
  "functions/api/maik-feedback.js": "public by design: header documents an unauthenticated helpfulness signal (same reasoning as clientlog); reading entries is the owner route",
  "functions/api/validation.js": "passphrase gate acknowledged weak by design in its own header; append-only storage is the real protection, no patient data",
  "functions/api/ws-feedback.js": "anonymous by design: header documents an aggregate feedback signal pipe storing no identity; GET returns counts only",
  "functions/api/unsubscribe.js": "session-free by design: header documents a SIGNED unsubscribe token (functions/_unsub.js) as the credential, RFC 8058 one-click; a forged link does nothing and it flips only the marketing flag",
};

/* ---- dependency audit ----------------------------------------------------------- */
/* npm 7+ nests the advisory detail one level down: a vulnerability entry
 * usually has no top-level title/url of its own, only a `via` array whose
 * object members carry the advisory title and URL (string members are just
 * the dependency chain). Without this the WARN line would print
 * no-advisory-ref for every real advisory, which reads as broken. */
function firstViaField(entry, field) {
  const via = entry && entry.via;
  if (!Array.isArray(via)) return "";
  for (const item of via) {
    if (item && typeof item === "object" && item[field]) return String(item[field]);
  }
  return "";
}

export function parseNpmAudit(jsonText) {
  const data = JSON.parse(String(jsonText || ""));
  const entries = [];
  if (data && data.vulnerabilities && typeof data.vulnerabilities === "object") {
    for (const name of Object.keys(data.vulnerabilities)) {
      const v = data.vulnerabilities[name] || {};
      const severity = String(v.severity || "").toLowerCase();
      if (severity === "high" || severity === "critical") {
        entries.push({ name, severity, title: String(v.title || firstViaField(v, "title") || ""), url: String(v.url || firstViaField(v, "url") || "") });
      }
    }
  } else if (data && data.advisories && typeof data.advisories === "object") {
    for (const key of Object.keys(data.advisories)) {
      const a = data.advisories[key] || {};
      const severity = String(a.severity || "").toLowerCase();
      if (severity === "high" || severity === "critical") {
        entries.push({ name: String(a.module_name || key), severity, title: String(a.title || ""), url: String(a.url || "") });
      }
    }
  }
  return entries;
}

export function auditNotRunMessage(reason) {
  return "dependency audit: NOT RUN (" + String(reason || "unknown") + ")";
}

/* Dependency advisories warn but never fail the job: a red build over a
 * transitive advisory nobody on the team can fix trains people to ignore this
 * file, while hiding the advisory trains them to trust it. Each high or
 * critical advisory prints as its own WARN line (never the finding format, so
 * it cannot be mistaken for a blocking secret), and the summary counts them
 * as reviewed-but-open owner work. Only secrets, dangerous server patterns
 * and CORS/auth gaps exit non-zero; see isBlockingRule. */
export function formatDepWarning(entry) {
  const e = entry || {};
  const ref = String(e.url || e.title || "no-advisory-ref");
  return "WARN " + "dep:" + e.severity + " " + e.name + " " + e.severity + " " + ref;
}

export function depRanMessage(count) {
  const n = Number(count) || 0;
  return "dependency audit: RAN, " + n + " high/critical " + (n === 1 ? "advisory" : "advisories") + " (not blocking; owner review)";
}

export function isBlockingRule(rule) {
  return String(rule || "").indexOf("dep:") !== 0;
}

/* ---- file listing ---------------------------------------------------------------- */
const LOCKFILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "npm-shrinkwrap.json",
  "Gemfile.lock", "Cargo.lock", "composer.lock", "poetry.lock", "Pipfile.lock",
]);

export function shouldSkipFile(rel) {
  if (!rel) return true;
  if (rel.indexOf("node_modules/") !== -1 || rel.startsWith("node_modules")) return true;
  const base = rel.split("/").pop();
  if (LOCKFILES.has(base)) return true;
  if (/(^|\/)test\/fixtures\//.test(rel) || /(^|\/)tests\/fixtures\//.test(rel) || /(^|\/)__fixtures__\//.test(rel)) return true;
  return false;
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function readIfText(rel) {
  const buf = readFileSync(ROOT + "/" + rel);
  if (buf.length === 0) return "";
  if (buf.indexOf(0) !== -1) return null;
  if (buf.length > 5 * 1024 * 1024) return null;
  return buf.toString("utf8");
}

/* ---- main -------------------------------------------------------------------------- */
function runDependencyAudit() {
  if (!existsSync(ROOT + "/package-lock.json")) {
    return { ran: false, reason: "no package-lock.json", entries: [] };
  }
  const r = spawnSync("npm", ["audit", "--json", "--omit=dev"], {
    encoding: "utf8", cwd: ROOT, timeout: 120000, maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = String((r && r.stdout) || "");
  if (r.error || r.status !== 0) {
    if (stdout) {
      try {
        const parsed = JSON.parse(stdout);
        if (parsed && parsed.error) {
          return { ran: false, reason: "registry error: " + String(parsed.error.code || parsed.error.summary || "unknown"), entries: [] };
        }
        return { ran: true, reason: "", entries: parseNpmAudit(stdout) };
      } catch (e) { /* fall through to NOT RUN below */ }
    }
    const why = r.error ? String((r.error.code || r.error.message || "spawn failed")) : ("npm audit exited " + r.status);
    const tail = String((r && r.stderr) || "").split("\n").filter(Boolean).pop();
    return { ran: false, reason: tail ? (why + ": " + tail.slice(0, 160)) : why, entries: [] };
  }
  try {
    return { ran: true, reason: "", entries: parseNpmAudit(stdout || "{}") };
  } catch (e) {
    return { ran: false, reason: "unparseable audit output", entries: [] };
  }
}

function main() {
  let files;
  try {
    files = trackedFiles();
  } catch (e) {
    console.error("security-scan: cannot list tracked files (git ls-files failed)");
    process.exit(2);
  }
  const findings = [];
  const counts = {};
  const bump = (rule) => { counts[rule] = (counts[rule] || 0) + 1; };
  const emit = (file, line, rule, message) => {
    findings.push({ file, line, rule, message });
    bump(rule);
    console.log(file + ":" + line + " " + rule + " " + message);
  };

  let publicByDesign = 0;
  for (const rel of files) {
    if (shouldSkipFile(rel)) continue;
    let text;
    try { text = readIfText(rel); } catch (e) { continue; }
    if (text === null) continue;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      /* The private-key rule reads ahead for key material, so each line scan
       * gets the up-to-3 lines after it as lookahead. */
      for (const hit of scanLineForSecrets(line, rel, lines.slice(i + 1, i + 4))) {
        if (hit.publicByDesign) {
          publicByDesign += 1;
          bump("public-by-design");
          continue;
        }
        emit(rel, i + 1, hit.rule, hit.message);
      }
    });
    if (rel.startsWith("functions/") && (rel.endsWith(".js") || rel.endsWith(".mjs"))) {
      for (const hit of scanTextForDangerous(text, rel)) emit(rel, hit.line, hit.rule, hit.message);
    }
    if (rel.startsWith("functions/api/") && isHandlerFile(rel, text)) {
      for (const hit of scanTextForCors(text)) emit(rel, 1, hit.rule, hit.message);
      if (!hasApiAuth(text) && !PUBLIC_ALLOWLIST[rel]) {
        emit(rel, 1, "auth:missing-resolver", "route handler never calls the project actor/auth resolver (resolveActor, resolveClinicalActor, authorizeOrg, verifyFirebaseToken, identify(, ownerOK, ...)");
      }
    }
  }

  /* Advisories stay OUT of findings: they print as WARN lines and the job
   * stays green on dependencies alone. findings (and the exit code) belong
   * to secrets, dangerous patterns and CORS/auth gaps only. */
  const audit = runDependencyAudit();
  if (audit.ran) {
    for (const e of audit.entries) console.log(formatDepWarning(e));
    console.log(depRanMessage(audit.entries.length));
  } else {
    console.log(auditNotRunMessage(audit.reason));
  }

  const ran = ["secrets", "dangerous-patterns", "cors-auth", "dependency-audit"];
  const notRan = audit.ran ? [] : ["dependency-audit (" + audit.reason + ")"];
  console.log("security-scan summary: " + findings.length + " finding(s), " + publicByDesign + " public-by-design");
  const rules = Object.keys(counts).sort();
  if (rules.length) {
    for (const r of rules) console.log("  " + r + ": " + counts[r]);
  } else {
    console.log("  no findings");
  }
  console.log("  rules run: " + ran.filter((r) => notRan.every((n) => n.indexOf(r) !== 0)).join(", "));
  console.log("  rules not run: " + (notRan.length ? notRan.join(", ") : "none"));
  process.exit(findings.length ? 1 : 0);
}

const invoked = process.argv[1] && (process.argv[1].endsWith("security-scan.mjs") || process.argv[1].endsWith("security-scan"));
if (invoked) main();
