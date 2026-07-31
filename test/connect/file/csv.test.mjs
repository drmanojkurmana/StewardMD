// test/connect/file/csv.test.mjs — Task 5: hand-written CSV/delimited parser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDelimited, sniffDelimiter } from "../../../functions/_connect/connectors/file/csv.js";

test("quoted fields with embedded delimiter, newline, and escaped quotes", () => {
  const csv = 'a,b,c\r\n"x,1","line\n2","say ""hi"""\r\n';
  const p = parseDelimited(csv);
  assert.deepEqual(p.header, ["a", "b", "c"]);
  assert.equal(p.rows[0].a, "x,1");
  assert.equal(p.rows[0].b, "line\n2");
  assert.equal(p.rows[0].c, 'say "hi"');
});

test("BOM stripped; sniff picks the delimiter", () => {
  assert.equal(sniffDelimiter("a\tb\tc"), "\t");
  assert.equal(sniffDelimiter("a|b|c"), "|");
  const p = parseDelimited("﻿x;y\r\n1;2");
  assert.deepEqual(p.header, ["x", "y"]);
  assert.equal(p.rows[0].y, "2");
});

test("ragged rows warn; blank lines skipped", () => {
  const p = parseDelimited("a,b,c\n1,2\n\n4,5,6,7\n");
  assert.ok(p.warnings.some((w) => w.includes("ragged")));
  assert.equal(p.rows.length, 2);                             // blank line skipped
});

test("unterminated quote at EOF is closed with a warning", () => {
  const p = parseDelimited('a,b\n"open,still going');
  assert.ok(p.warnings.some((w) => w.includes("unterminated quote")));
  assert.equal(p.rows.length, 1);
});

test("duplicate header names are suffixed + warned", () => {
  const p = parseDelimited("id,val,val\n1,a,b");
  assert.ok(p.warnings.some((w) => w.includes("duplicate header")));
  assert.equal(Object.keys(p.rows[0]).length, 3);
});

test("maxRows budget truncates without hanging", () => {
  const big = "a\n" + Array.from({ length: 5000 }, (_, i) => String(i)).join("\n");
  const p = parseDelimited(big, { budget: { maxRows: 100 } });
  assert.ok(p.rows.length <= 100);
  assert.ok(p.warnings.some((w) => w.includes("rows truncated")));
});
