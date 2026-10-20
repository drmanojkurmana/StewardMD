// Finished question search (prep.js runFind/paintQ): no skeleton after completion,
// clear partial/all failure state with a retry that invalidates the old query.
// node --test --experimental-test-module-mocks --experimental-sqlite test/prep-find-status.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../prep.js");
const src = readFileSync(new URL("../prep.js", import.meta.url), "utf8");

test("findQStatus: still searching while subjects are outstanding", () => {
  assert.deepEqual(P.findQStatus(0, false, 0, 1, 4), { text: "Searching the questions… 1 of 4 subjects", finished: false, retry: false });
  assert.deepEqual(P.findQStatus(9, false, 0, 3, 4).finished, false);
});

test("findQStatus: clean finish keeps hits and offers no retry", () => {
  assert.deepEqual(P.findQStatus(7, false, 0, 4, 4), { text: "7 found", finished: true, retry: false });
  assert.deepEqual(P.findQStatus(41, true, 0, 4, 4), { text: "41+ found", finished: true, retry: false });
  assert.deepEqual(P.findQStatus(0, false, 0, 4, 4), { text: "No question matches. Try fewer or other words.", finished: true, retry: false });
});

test("findQStatus: all subjects failed asks for a connection and offers retry", () => {
  assert.deepEqual(P.findQStatus(0, false, 3, 3, 3), { text: "Question search needs a connection the first time for each subject.", finished: true, retry: true });
});

test("findQStatus: partial failure shows hits plus availability and offers retry", () => {
  assert.deepEqual(P.findQStatus(12, false, 1, 5, 5), { text: "12 found · 1 subject need a connection", finished: true, retry: true });
  assert.deepEqual(P.findQStatus(45, true, 2, 5, 5), { text: "45+ found · 2 subjects need a connection", finished: true, retry: true });
});

test("paintQ completion drops the skeleton class and wires a retry, never a bare reload", () => {
  const i = src.indexOf("function paintQ()");
  assert.ok(i > 0, "paintQ found");
  const body = src.slice(i, src.indexOf("function next()", i));
  assert.match(body, /findQStatus\(got\.length/, "completion text comes from findQStatus");
  assert.match(body, /classList\) st2\.classList\.remove\("pn-load"\)/, "finished state removes pn-load");
  assert.ok(!/removeAttribute\("role"\)/.test(body), "finished status stays announced");
  assert.match(body, /data-act="find-retry"/, "retry button rendered on failure");
  assert.match(src, /if \(a === "find-retry"\) return runFind\(\);/, "retry reruns the current query");
  assert.match(src.slice(src.indexOf("function runFind()"), src.indexOf("function runFind()") + 400), /var box = root && root\.querySelector\("#pnFound"\), q = fnd\.q\.trim\(\), seq = \+\+fnd\.seq;/, "rerun bumps the sequence so stale answers are ignored");
});
