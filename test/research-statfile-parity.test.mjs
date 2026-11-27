/* ResearchMD parity for the on-device SPSS and Stata reader
 * (research-statfile.js) against pyreadstat.
 *
 * Compares every file in test/fixtures/research/statfiles/ with
 * test/fixtures/research/parity-statfile.json, which CI makes with
 * scripts/research-statfile-parity.py (Python + pyreadstat). That JSON is
 * never committed and never faked: when it is absent this file SKIPS with a
 * message saying how to make it.
 *
 * Checked per file: column names, variable labels, value labels, SPSS
 * missing-value codes and ranges, file label, and every cell (numbers within
 * 1e-6 relative, so float32 Stata values written as their short decimal
 * pass; text, dates and blanks exactly).
 *
 * One known, deliberate difference: Stata files before release 118 have no
 * encoding field. pyreadstat always reads them as Latin-1; the app reads text
 * that is valid UTF-8 as UTF-8 (other programs, pyreadstat itself included,
 * write UTF-8 there). Those cells are checked after repairing pyreadstat's
 * Latin-1 reading, and listed.
 *
 * Run: python3 scripts/research-statfile-parity.py && node --test test/research-statfile-parity.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const SF = require("../research-statfile.js");
const PARITY = new URL("./fixtures/research/parity-statfile.json", import.meta.url);
const DIR = new URL("./fixtures/research/statfiles/", import.meta.url);

const have = existsSync(PARITY);
const P = have ? JSON.parse(readFileSync(PARITY, "utf8")) : { files: {} };
const skip = have ? false : "parity-statfile.json missing: run python3 scripts/research-statfile-parity.py (needs pip install pyreadstat pandas)";

function repairLatin1(s) {
  const fixed = Buffer.from(s, "latin1").toString("utf8");
  return fixed.includes("�") ? s : fixed;
}

const repaired = [];

test("every test file has a pyreadstat reading", { skip }, () => {
  const files = readdirSync(DIR).filter((f) => /\.(z?sav|dta)$/.test(f)).sort();
  assert.deepEqual(Object.keys(P.files).sort(), files);
});

for (const [file, exp] of Object.entries(P.files)) {
  test(`${file} matches pyreadstat`, { skip }, () => {
    const res = SF.read(readFileSync(new URL(file, DIR)), { name: file });
    const oldDta = res.format === "dta" && res.version < 118;
    assert.deepEqual(res.columns, exp.columns, "column names");
    assert.equal(res.fileLabel, exp.fileLabel, "file label");
    res.variables.forEach((v, i) => {
      assert.equal(v.label, exp.labels[i], `${v.name} variable label`);
      assert.deepEqual(v.valueLabels, exp.valueLabels[v.name] || {}, `${v.name} value labels`);
      if (exp.missing[v.name]) {
        const em = exp.missing[v.name];
        assert.deepEqual(v.missing.values, em.values, `${v.name} missing codes`);
        assert.deepEqual(v.missing.range, em.range, `${v.name} missing range`);
      }
    });
    assert.equal(res.data.length, exp.rows.length, "row count");
    exp.rows.forEach((row, i) => {
      row.forEach((e, j) => {
        const a = res.data[i][j];
        const where = `${file} row ${i + 1} ${exp.columns[j]}`;
        if (typeof e === "number") {
          assert.equal(typeof a, "number", `${where}: got ${JSON.stringify(a)}, want ${e}`);
          assert.ok(Math.abs(a - e) <= 1e-6 * Math.max(1, Math.abs(e)), `${where}: got ${a}, want ${e}`);
        } else if (typeof e === "string" && oldDta && a !== e && a === repairLatin1(e)) {
          repaired.push(where);
        } else {
          assert.equal(a, e, where);
        }
      });
    });
  });
}

test("report", { skip }, () => {
  console.log(`# pyreadstat: ${P.generator}; files: ${Object.keys(P.files).length}`);
  if (repaired.length) console.log("# read as UTF-8 where pyreadstat used Latin-1: " + repaired.join("; "));
});
