/* test/wardsynq-site-headers.test.mjs - OPS-06/F6 and OPS-27/F27 (wardsynq.com half): wardsynq.com ships
 * the SAME clinical surfaces as the app (ward.js, discharge.js, patient-register.js, the OPD console)
 * but had none of the security headers the root _headers file (stewardmd.in) already carries.
 *
 * The full build script can't run end-to-end in this worktree (sparse checkout: assets/ is absent), so
 * this extracts the actual header-generation lines (CSP_RO=... and the printf) out of the real script
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
  const cspLine = SRC.split("\n").find((l) => l.startsWith("CSP_RO="));
  const printfLine = SRC.split("\n").find((l) => l.startsWith("printf '/*"));
  assert.ok(cspLine, "CSP_RO= line found in the build script");
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

test("OPS-06/F6 (partial OPS-27): an enforced frame-ancestors 'none' plus a Report-Only CSP that does not gate on the inline <script>", () => {
  const h = buildHeaders();
  assert.match(h, /Content-Security-Policy: frame-ancestors 'none'/, "enforced, even with no full script-src policy");
  assert.match(h, /Content-Security-Policy-Report-Only: default-src 'self'/, "the broader policy is Report-Only, not enforced");
  assert.match(h, /Content-Security-Policy-Report-Only:[^\n]*script-src[^\n]*'unsafe-inline'/, "index.html ships one inline <script>; Report-Only avoids breaking it without a nonce");
  assert.match(h, /Content-Security-Policy-Report-Only:[^\n]*fonts\.googleapis\.com/, "Google Fonts, actually loaded by index.html");
  assert.match(h, /Content-Security-Policy-Report-Only:[^\n]*www\.gstatic\.com/, "Firebase compat SDK, actually loaded by index.html");
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
