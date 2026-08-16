import test from "node:test";
import assert from "node:assert";
import { validateLogo, cleanName, logoKey, logoUrl, MAX_LOGO_BYTES } from "../functions/_clinic_branding.js";

test("validateLogo accepts png/webp/jpeg under the size cap", () => {
  assert.deepEqual(validateLogo("image/png", 1000), { ok: true, ext: "png" });
  assert.equal(validateLogo("image/webp", 5000).ext, "webp");
  assert.equal(validateLogo("image/jpeg", 5000).ext, "jpg");
  assert.equal(validateLogo("image/png; charset=binary", 10).ext, "png"); // params ignored
});

test("validateLogo rejects svg, unknown types, empty, and oversize", () => {
  assert.equal(validateLogo("image/svg+xml", 100).ok, false);  // svg excluded: script-injection surface
  assert.equal(validateLogo("text/html", 100).ok, false);
  assert.equal(validateLogo("", 100).ok, false);
  assert.equal(validateLogo("image/png", 0).ok, false);
  assert.equal(validateLogo("image/png", MAX_LOGO_BYTES + 1).error, "too_large");
});

test("cleanName trims, collapses newlines/tabs, caps length", () => {
  assert.equal(cleanName("  Sunrise\nClinic  "), "Sunrise Clinic");
  assert.equal(cleanName("A\tB"), "A B");
  assert.equal(cleanName("x".repeat(200)).length, 60);
  assert.equal(cleanName(null), "");
});

test("logoKey + logoUrl are org-scoped and same-origin", () => {
  assert.equal(logoKey("SMD-AB12CD", "png"), "branding/SMD-AB12CD/logo.png");
  assert.ok(logoUrl("SMD-AB12CD").startsWith("/api/queue/branding/logo?orgId="));
  assert.ok(!/^https?:\/\//.test(logoUrl("SMD-AB12CD")));  // never a foreign URL
});
