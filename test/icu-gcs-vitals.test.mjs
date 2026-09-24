/* GCS is charted by ingestMonitor and consumed by qSOFA / NEWS2 / SOFA / APACHE, but it had no
 * vitals column and no way to type a total, so clinicians saw "needs: GCS" with nowhere to put it.
 * These assert the three places it has to appear, straight from icu.js source - no browser needed. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "icu.js"), "utf8");

test("GCS has a trend/vitals column definition", () => {
  const m = SRC.match(/\n\s*gcs:\s*\{[^}]*\}/);
  assert.ok(m, "TREND_INTERP must define a gcs entry");
  assert.match(m[0], /label:\s*"GCS"/, "gcs entry is labelled GCS");
  assert.match(m[0], /src:\s*"vital"/, "gcs reads from the vitals series, like hr/spo2");
});

test("GCS is listed in the Vitals / Haemodynamics trend group", () => {
  const g = SRC.match(/\{\s*id:\s*"vitals",\s*name:\s*"Vitals \/ Haemodynamics",\s*keys:\s*\[([^\]]*)\]/);
  assert.ok(g, "vitals trend group exists");
  assert.match(g[1], /"gcs"/, "vitals group includes gcs so it renders as a column");
});

test("the manual ICU vitals form accepts a GCS total", () => {
  const f = SRC.match(/monitor:\s*\{\s*title:\s*"Vitals \(ICU monitor\)"[\s\S]*?\]\s*\}/);
  assert.ok(f, "monitor entry form exists");
  assert.match(f[0], /k:\s*"gcs"/, "monitor form has a gcs field so the value can be edited");
});

test("ingestMonitor still whitelists gcs (the write path the column reads)", () => {
  const pickLine = SRC.split("\n").find((l) => l.includes('pick(o, ["hr"'));
  assert.ok(pickLine, "ingestMonitor pick() list found");
  assert.match(pickLine, /"gcs"/, "gcs survives ingestMonitor, otherwise the column stays empty");
});
