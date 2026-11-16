/* Phase 5a pure helpers (study-library.js): sort, trash purge, dup title, when format, tabs parse, prefs.
 * Plus hang-fix guards (2026-11): needsCoverRegen, shouldRetryTabRestore, and the shared-connection
 * regression (the library must reuse STUDY.db, never open its own second IndexedDB connection). */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const L = createRequire(import.meta.url)("../study-library.js");
const HERE = dirname(fileURLToPath(import.meta.url));

test("isTrashed + shouldPurge: 30-day boundary", () => {
  assert.equal(L.isTrashed({ trashedAt: 1 }), true);
  assert.equal(L.isTrashed({}), false);
  assert.equal(L.isTrashed(null), false);
  const now = Date.now();
  const day = 86400000;
  assert.equal(L.shouldPurge({ trashedAt: now - 29 * day }, now), false);
  assert.equal(L.shouldPurge({ trashedAt: now - 30 * day }, now), false);
  assert.equal(L.shouldPurge({ trashedAt: now - 31 * day }, now), true);
  assert.equal(L.shouldPurge({ trashedAt: now - 60 * day }, now), true);
  assert.equal(L.shouldPurge({ trashedAt: null }, now), false);
  assert.equal(L.shouldPurge({}, now), false);
  assert.ok(L.daysOld(now - day, now) > 0.99 && L.daysOld(now - day, now) < 1.01);
});

test("sortDocs date: newest first, folders and docs mixed", () => {
  const items = [
    { title: "old", lastOpened: 100, created: 100 },
    { title: "new", lastOpened: 900, created: 900 },
    { title: "mid", lastOpened: 500, created: 500 },
  ];
  assert.deepEqual(L.sortDocs(items, "date").map((x) => x.title), ["new", "mid", "old"]);
  // input not mutated
  assert.deepEqual(items.map((x) => x.title), ["old", "new", "mid"]);
});

test("sortDocs name: case-insensitive alphabetical", () => {
  const items = [{ title: "banana" }, { title: "Apple" }, { title: "cherry" }];
  assert.deepEqual(L.sortDocs(items, "name").map((x) => x.title), ["Apple", "banana", "cherry"]);
  // folder keyed by name also sorts
  const mixed = [{ type: "folder", title: "zebra" }, { title: "apple" }];
  assert.deepEqual(L.sortDocs(mixed, "name").map((x) => x.title), ["apple", "zebra"]);
});

test("sortDocs type: folders first, then notebooks, then PDFs, alpha within", () => {
  const items = [
    { title: "b-pdf", kind: "pdf" },
    { title: "a-nb", kind: "nb" },
    { type: "folder", title: "z-folder", name: "z-folder" },
    { type: "folder", title: "a-folder", name: "a-folder" },
    { title: "a-pdf", kind: "pdf" },
  ];
  assert.deepEqual(L.sortDocs(items, "type").map((x) => x.title), ["a-folder", "z-folder", "a-nb", "a-pdf", "b-pdf"]);
  // unknown sort falls back to date order
  assert.deepEqual(L.sortDocs([{ title: "x", lastOpened: 1 }, { title: "y", lastOpened: 2 }], "bogus").map((x) => x.title), ["y", "x"]);
});

test("dupTitle appends copy and caps length", () => {
  assert.equal(L.dupTitle("Notes"), "Notes copy");
  assert.equal(L.dupTitle(""), "Untitled copy");
  assert.equal(L.dupTitle(null), "Untitled copy");
  const long = "a".repeat(200);
  assert.ok(L.dupTitle(long).length <= 120);
  assert.ok(L.dupTitle(long).endsWith(" copy"));
});

test("fmtWhen: today, yesterday, this year, older, empty", () => {
  assert.equal(L.fmtWhen(0), "");
  assert.equal(L.fmtWhen(null), "");
  const now = new Date();
  const today = now.getTime();
  assert.ok(L.fmtWhen(today).startsWith("Today "));
  assert.ok(L.fmtWhen(today - 86400000).startsWith("Yesterday "));
  const sameYear = new Date(now.getFullYear(), 0, 5, 9, 30).getTime();
  // either Today/Yesterday (if Jan 5 collides) or "5 Jan 09:30"
  assert.ok(/Jan/.test(L.fmtWhen(sameYear)) || /Today|Yesterday/.test(L.fmtWhen(sameYear)));
  const old = new Date(now.getFullYear() - 2, 6, 4, 12, 0).getTime();
  assert.equal(L.fmtWhen(old), "4 Jul " + (now.getFullYear() - 2));
});

test("parseTabs: keeps strings, caps at 12, bad JSON is empty", () => {
  assert.deepEqual(L.parseTabs(null), []);
  assert.deepEqual(L.parseTabs("not json"), []);
  assert.deepEqual(L.parseTabs('["a","b",123,"",null,"c"]'), ["a", "b", "c"]);
  const many = JSON.stringify(Array.from({ length: 30 }, (_, i) => "t" + i));
  assert.equal(L.parseTabs(many).length, 12);
  assert.deepEqual(L.parseTabs("[]"), []);
});

test("needsCoverRegen: clean covers skip, dirty or missing covers regen only", () => {
  assert.equal(L.needsCoverRegen({ thumb: "data:image/jpeg;base64,x" }), false);
  assert.equal(L.needsCoverRegen({ thumb: "data:image/jpeg;base64,x", _thumbDirty: false }), false);
  assert.equal(L.needsCoverRegen({ thumb: "data:image/jpeg;base64,x", _thumbDirty: true }), true);
  assert.equal(L.needsCoverRegen({ thumb: "" }), true);
  assert.equal(L.needsCoverRegen({}), true);
  assert.equal(L.needsCoverRegen(null), false);
  assert.equal(L.needsCoverRegen(undefined), false);
});

test("shouldRetryTabRestore: bounded polling, then gives up", () => {
  assert.equal(L.shouldRetryTabRestore(0), true);
  assert.equal(L.shouldRetryTabRestore(24), true);
  assert.equal(L.shouldRetryTabRestore(25), false);
  assert.equal(L.shouldRetryTabRestore(999), false);
  assert.equal(L.shouldRetryTabRestore(NaN), true);
  assert.equal(L.shouldRetryTabRestore("2"), true);
});

test("hang fix: library reuses STUDY.db, never opens its own second connection", () => {
  const libSrc = readFileSync(join(HERE, "..", "study-library.js"), "utf8");
  const studySrc = readFileSync(join(HERE, "..", "study.js"), "utf8");
  // study.js exposes its single connection
  assert.match(studySrc, /kick:\s*kick,\s*db:\s*db/);
  // the library delegates to it
  assert.match(libSrc, /S\.db\(\)|STUDY\.db/);
  // the library must not hold a second happy-path connection: the only
  // code-level open left is the STUDY-not-ready fallback with bounded onblocked retries
  // (comment text mentions indexedDB.open, so count the actual call site only)
  const codeOnly = libSrc.replace(/\/\*[\s\S]*?\*\//g, "");
  const opens = codeOnly.match(/G\.indexedDB\.open\(/g) || [];
  assert.equal(opens.length, 1, "expected exactly one fallback open, got " + opens.length);
  assert.match(libSrc, /r\.onblocked/);
  assert.match(libSrc, /onversionchange/);
  // no unbounded retry: the fallback gives up after 5 tries
  assert.match(libSrc, /dbTries\s*>=\s*5/);
  // and no per-render trash purge (init-only)
  assert.match(libSrc, /trash purge runs once at init only/);
  assert.ok(!/purgeExpiredTrash\(\);\s*\n\s+return Promise\.all\(\[idbAll\("docs"\)/.test(libSrc), "render path must not purge on every render");
});
