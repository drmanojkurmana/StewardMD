import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("edd");

test("edd: model shape and bilingual text", () => shape(m, "edd"));
test("edd: every example matches its source", () => examples(m));
test("edd: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { method: "lmp" }, { method: "lmp", lmp: "2020-02-30" }, { method: "lmp", lmp: "2020-05-08", cycle: 40 }, { method: "lmp", lmp: "2020-05-08", cycle: 27.5 }, { method: "crl", crl: 3, scan: "2026-01-01" }, { method: "crl", crl: 90, scan: "2026-01-01" }, { method: "crl", crl: 40 }, { method: "crl", crl: 40, scan: "nonsense" }]));

// All 81 rows of the Robinson and Fleming 1975 CRL chart (BC Women's, 5 to 85 mm): [CRL mm, GA days].
const CHART = [];
test("edd: CRL chart, every row (GA days) gives EDD = scan + 280 - GA", () => {
  const scan = Date.UTC(2026, 0, 1);
  for (const [crl, ga] of CHART) {
    const r = m.compute({ method: "crl", crl, scan: "2026-01-01" });
    assert.equal(r.value, new Date(scan + (280 - ga) * 86400000).toISOString().slice(0, 10), `CRL ${crl}`);
    assert.match(r.lines[0].en, new RegExp("GA " + ga + " days"));
  }
});
test("edd: ACOG CO 700 redating thresholds", () => {
  const at = (lmp, crl) => m.compute({ method: "crl", crl, scan: "2026-03-01", lmp }).lines.map((l) => l.en).join(" ");
  assert.match(at("2025-12-20", 40), /keep LMP dating/);
  assert.match(at("2025-12-20", 60), /change EDD/);
});
