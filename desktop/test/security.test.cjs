"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { safeResolve, isAllowedExternalUrl } = require("../security.cjs");

test("safeResolve keeps normal assets inside the bundle", () => {
  const root = path.resolve("/tmp/stewardmd-app");
  assert.equal(safeResolve(root, "/index.html"), path.join(root, "index.html"));
  assert.equal(safeResolve(root, "/kb/disease.json"), path.join(root, "kb", "disease.json"));
});

test("safeResolve rejects traversal outside the bundle", () => {
  const root = path.resolve("/tmp/stewardmd-app");
  assert.equal(safeResolve(root, "/../../etc/passwd"), null);
});

test("external navigation only accepts credential-free HTTPS URLs", () => {
  assert.equal(isAllowedExternalUrl("https://stewardmd.in/privacy"), true);
  assert.equal(isAllowedExternalUrl("http://stewardmd.in"), false);
  assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedExternalUrl("https://user:pass@example.com"), false);
});
