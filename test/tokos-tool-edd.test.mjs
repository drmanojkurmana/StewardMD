import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("edd");

test("edd: model shape and bilingual text", () => shape(m, "edd"));
test("edd: every example matches its source", () => examples(m));
test("edd: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { method: "lmp" }, { method: "lmp", lmp: "2020-02-30" }, { method: "lmp", lmp: "2020-05-08", cycle: 40 }, { method: "lmp", lmp: "2020-05-08", cycle: 27.5 }, { method: "crl", crl: 3, scan: "2026-01-01" }, { method: "crl", crl: 90, scan: "2026-01-01" }, { method: "crl", crl: 85, scan: "2026-01-01" }, { method: "crl", crl: 40 }, { method: "crl", crl: 40, scan: "nonsense" }]));

// Robinson and Fleming 1975 CRL chart (BC Women's, 10.2023), rows 5 to 84 mm: [CRL mm, GA days]. The chart's 85 mm row is
// left out because CRL dating stops at 84 mm (ACOG CO 700) and the model rejects 85.
const CHART = [[5, 42], [6, 44], [7, 45], [8, 47], [9, 48], [10, 50], [11, 51], [12, 52], [13, 53], [14, 54], [15, 55], [16, 57], [17, 58], [18, 59], [19, 59], [20, 60], [21, 61], [22, 62], [23, 63], [24, 64], [25, 65], [26, 66], [27, 66], [28, 67], [29, 68], [30, 69], [31, 69], [32, 70], [33, 71], [34, 72], [35, 72], [36, 73], [37, 74], [38, 74], [39, 75], [40, 76], [41, 76], [42, 77], [43, 77], [44, 78], [45, 79], [46, 79], [47, 80], [48, 81], [49, 81], [50, 82], [51, 82], [52, 83], [53, 83], [54, 84], [55, 85], [56, 85], [57, 86], [58, 86], [59, 87], [60, 87], [61, 88], [62, 88], [63, 89], [64, 89], [65, 90], [66, 90], [67, 91], [68, 91], [69, 92], [70, 92], [71, 93], [72, 93], [73, 94], [74, 94], [75, 95], [76, 95], [77, 96], [78, 96], [79, 97], [80, 97], [81, 98], [82, 98], [83, 98], [84, 99]];
test("edd: CRL chart, every row 5 to 84 mm (GA days) gives EDD = scan + 280 - GA", () => {
  assert.equal(CHART.length, 80);
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
test("edd: when ACOG says keep LMP dating, the headline EDD and GA follow the LMP", () => {
  const r = m.compute({ method: "crl", crl: 45, scan: "2026-03-01", lmp: "2025-12-07", asof: "2026-03-01" });
  assert.equal(r.value, "2026-09-14"); // the Naegele date the LMP method shows; the CRL alone would give 2026-09-18
  assert.match(r.lines.map((l) => l.en).join(" "), /keep LMP dating.*EDD shown is the LMP date.*12w 0d/);
});
test("edd: redating advice still given from 14w0d to 15w6d by LMP (more than 7 days)", () => {
  const t = m.compute({ method: "crl", crl: 80, scan: "2026-03-01", lmp: "2025-11-10" }).lines.map((l) => l.en).join(" ");
  assert.match(t, /change EDD to the ultrasound date/);
});
test("edd: an as-of date far beyond term is not shown as weeks", () => {
  const r = m.compute({ method: "lmp", lmp: "2025-01-01", asof: "2026-02-01" });
  assert.match(r.lines.at(-1).en, /after the expected delivery/);
});
