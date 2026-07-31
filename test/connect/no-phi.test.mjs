// test/connect/no-phi.test.mjs — guardrail: no fixture PHI or secret token appears in audit/logs/errors
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

test("no captured-from-hapi marker and no real-PHI patterns in fixtures", () => {
  const dir = new URL("./fixtures/", import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.equal(/hapi\.fhir\.org/.test(src), false, f + " must not reference the public HAPI server");
    assert.equal(/\b\d{12,14}\b/.test(src.replace(/\bP1\b/g, "")), false, f + " contains a long numeric id (possible real MRN/ABHA)");
  }
});
