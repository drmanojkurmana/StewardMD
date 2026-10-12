import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// `font: 600 28px/1.15 inherit` is INVALID CSS (inherit cannot be the family in the shorthand), so the browser
// drops the whole declaration: the Welcome screen's heading, role chips and call-to-action rendered at default
// size. Every font shorthand in onboarding.js must name a real family.
test("onboarding.js has no font shorthand ending in 'inherit'", () => {
  const src = fs.readFileSync(new URL("../onboarding.js", import.meta.url), "utf8");
  const bad = src.match(/font:\s*\d{3}\s+[\d.]+(?:px|rem|em)(?:\/[\d.]+(?:px|rem|em)?)?\s+inherit/g) || [];
  assert.deepEqual(bad, []);
});

test("the Welcome wordmark uses the app's own face, not an unbundled mono font", () => {
  const src = fs.readFileSync(new URL("../onboarding.js", import.meta.url), "utf8");
  assert.ok(!/smdt-wel-brand\{[^}]*IBM Plex Mono/.test(src));
  assert.ok(/smdt-wel-brand\{font:800 28px\/1 var\(--sans,'Inter'/.test(src));
});
