/* test/wardsynq-site-headers.test.mjs - OPS-06/F6 and OPS-27/F27 (wardsynq.com half): wardsynq.com ships
 * the SAME clinical surfaces as the app (ward.js, discharge.js, patient-register.js, the OPD console)
 * but had none of the security headers the root _headers file (stewardmd.in) already carries.
 *
 * The full build script can't run end-to-end in this worktree (sparse checkout: assets/ is absent), so
 * this extracts the actual header-generation lines (CSP=... and the printf) out of the real script
 * text and RUNS them in a throwaway $OUT, then reads the real _headers file they produce - not a
 * string match against the script source.
 *
 * node --test test/wardsynq-site-headers.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, readFileSync as readF, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const SRC = readFileSync(new URL("../scripts/build-wardsynq-site.sh", import.meta.url), "utf8");

function buildHeaders() {
  const cspLine = SRC.split("\n").find((l) => l.startsWith("CSP=\""));
  const printfLine = SRC.split("\n").find((l) => l.startsWith("printf '/*"));
  assert.ok(cspLine, "CSP= line found in the build script");
  assert.ok(printfLine, "the _headers printf line found in the build script");
  const dir = mkdtempSync(path.join(tmpdir(), "wsq-headers-"));
  const script = `set -euo pipefail\nOUT="${dir}"\n${cspLine}\n${printfLine}\n`;
  execFileSync("bash", ["-c", script]);
  const headers = readF(path.join(dir, "_headers"), "utf8");
  rmSync(dir, { recursive: true, force: true });
  return headers;
}

test("OPS-06/F6: wardsynq.com's _headers carries X-Frame-Options, HSTS and Permissions-Policy, same as the root site", () => {
  const h = buildHeaders();
  assert.match(h, /X-Frame-Options: DENY/);
  assert.match(h, /Strict-Transport-Security: max-age=31536000; includeSubDomains/);
  assert.match(h, /Permissions-Policy: geolocation=\(\), camera=\(self\), microphone=\(self\), payment=\(\), nfc=\(self\)/);
  assert.match(h, /X-Content-Type-Options: nosniff/);
  assert.match(h, /Referrer-Policy: strict-origin-when-cross-origin/);
});

/** The one Content-Security-Policy header, as a Map of directive -> source list. */
function enforcedCsp() {
  const h = buildHeaders();
  const lines = h.split("\n").filter((l) => /^\s+Content-Security-Policy/.test(l));
  assert.equal(lines.length, 1, "exactly one CSP header, and it is the enforcing one (no Report-Only left)");
  assert.match(lines[0], /^\s+Content-Security-Policy: /);
  const d = new Map();
  for (const part of lines[0].replace(/^\s+Content-Security-Policy: /, "").split(";")) {
    const [name, ...src] = part.trim().split(/\s+/);
    if (name) d.set(name, src);
  }
  return d;
}

test("2026-10-04: the wardsynq.com CSP is ENFORCED, not Report-Only, and keeps frame-ancestors 'none'", () => {
  const h = buildHeaders();
  assert.ok(!/Report-Only/.test(h), "no Report-Only header remains");
  const d = enforcedCsp();
  assert.deepEqual(d.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(d.get("default-src"), ["'self'"]);
  assert.deepEqual(d.get("base-uri"), ["'self'"]);
  assert.deepEqual(d.get("object-src"), ["'none'"]);
});

test("the CSP never allows eval, wildcards or a bare scheme in a script or connect source", () => {
  const d = enforcedCsp();
  for (const [name, src] of d) {
    assert.ok(!src.includes("'unsafe-eval'") && !src.includes("'wasm-unsafe-eval'"), `${name} allows eval`);
    if (name === "script-src" || name === "connect-src" || name === "frame-src") {
      for (const s of src) assert.ok(s !== "*" && s !== "https:" && s !== "http:" && s !== "data:" && s !== "blob:", `${name} has the broad source ${s}`);
    }
  }
});

test("the CSP allows exactly the sources the pages were seen to need (browser run, 2026-10-04)", () => {
  const d = enforcedCsp();
  const script = d.get("script-src");
  assert.ok(script.includes("https://www.gstatic.com"), "Firebase compat SDK");
  assert.ok(script.includes("https://apis.google.com"), "Firebase signInWithPopup loads gapi");
  assert.ok(script.includes("'unsafe-inline'"), "inline <script> blocks in index.html, opd.html, clinic-billing.html");
  assert.ok(d.get("style-src").includes("https://fonts.googleapis.com"), "Google Fonts CSS");
  assert.ok(d.get("font-src").includes("https://fonts.gstatic.com"), "Google Fonts files");
  assert.ok(d.get("connect-src").includes("https://stewardmd.in"), "opd.html / clinic-billing.html call the record service directly from wardsynq.com");
  assert.ok(d.get("frame-src").includes("https://stewardmd-498ec.firebaseapp.com"), "Firebase sign-in helper frame");
  for (const h of ["https://securetoken.googleapis.com", "https://identitytoolkit.googleapis.com"]) assert.ok(d.get("connect-src").includes(h), h);
});

test("the DICOM viewer's parser is allowed as ONE exact file, equal to the URL ward-dicom-viewer.js loads", () => {
  const viewer = readFileSync(new URL("../ward-dicom-viewer.js", import.meta.url), "utf8");
  const url = (viewer.match(/PARSER_URL = "([^"]+)"/) || [])[1];
  assert.ok(url && url.startsWith("https://cdn.jsdelivr.net/npm/dicom-parser@"), "viewer parser URL found");
  const script = enforcedCsp().get("script-src");
  assert.ok(script.includes(url), "the CSP names the exact parser file");
  assert.ok(!script.includes("https://cdn.jsdelivr.net"), "not the whole CDN");
});

test("the asset cache-control block is unchanged", () => {
  const h = buildHeaders();
  assert.match(h, /\/assets\/\*\n  ! Cache-Control\n  Cache-Control: public, max-age=604800/);
});

test("OPS-27/F27: the root _headers (stewardmd.in) gets a Report-Only CSP without touching the enforced headers", () => {
  const h = readFileSync(new URL("../_headers", import.meta.url), "utf8");
  // The existing four enforced headers are untouched.
  assert.match(h, /X-Frame-Options: SAMEORIGIN/);
  assert.match(h, /Strict-Transport-Security: max-age=31536000; includeSubDomains/);
  assert.match(h, /Permissions-Policy: geolocation=\(\), camera=\(self\), microphone=\(self\), payment=\(\), nfc=\(self\)/);
  // No ENFORCED Content-Security-Policy on the site-wide block (still deferred - inline scripts, no nonce yet).
  const siteWideBlock = h.slice(h.indexOf("/*\n"), h.indexOf("/_site/yt"));
  assert.ok(!/\n  Content-Security-Policy:/.test(siteWideBlock), "no enforced CSP on the site-wide block yet");
  assert.match(siteWideBlock, /Content-Security-Policy-Report-Only: default-src 'self'/);
});
