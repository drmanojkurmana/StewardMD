/* test/maik-kb-worker.test.mjs — audit T25 (2026-09-25): moving the BM25 index build off the
 * WebView main thread must not change a single search() result. This file proves the worker-shape
 * index (buildIndex()'s sorted term ids + binary-search tid) is bit-identical to the original Map
 * path, that buildBookAsync() degrades cleanly with no Worker (this is Node), and that
 * maik-lite-kb-store.js's loadBook() in-flight guard dedupes concurrent first calls and recovers
 * from a failed first call. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const R = require("../kb/ai/maik-lite-rag.js");

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };

// ── synthetic book: varied headings/text/pages, plus terms that sort adjacent to each other
// ("a1"/"a10"/"ab") to exercise the sorted-id remap and the binary search boundaries. ──
function makeRows() {
  const rows = [];
  const subjects = ["fever", "cough", "pneumonia", "anemia", "sepsis", "diabetes", "hypertension",
    "stroke", "asthma", "thrombosis", "a1", "a10", "ab", "ceftriaxone", "amoxicillin"];
  const headingsPool = [["Infection", "Treatment"], ["Cardiology", "Diagnosis"],
    ["Renal", "Pathogenesis"], ["Further Reading"], ["Endocrine", "Management"]];
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 300; i++) {
    let text = "";
    while (text.length < 300) {
      text += subjects[(rnd() * subjects.length) | 0] + " ";
      if (rnd() < 0.4) text += subjects[(rnd() * subjects.length) | 0] + " " + subjects[(rnd() * subjects.length) | 0] + " ";
    }
    rows.push({ i: i, text: text, headings: headingsPool[i % headingsPool.length], pages: [1 + (i >> 3)] });
  }
  return rows;
}

// ── (a) worker-shape index vs Map path: identical search() results on 20+ varied queries ──
{
  const rows = makeRows();
  const bkMap = new R.Book(rows);
  const idx = R.buildIndex(rows);
  const bkIdx = new R.Book(rows, idx);

  ok("buildIndex() terms dictionary is sorted", (function () {
    const terms = idx.terms.split("\n");
    for (let i = 1; i < terms.length; i++) if (terms[i - 1] >= terms[i]) return false;
    return true;
  })());
  ok("buildIndex() starts array has T+1 entries", idx.starts.length === idx.terms.split("\n").length + 1);

  const queries = [
    "treatment for fever and cough", "what causes sepsis", "diabetes management",
    "hypertension diagnosis workup", "stroke pathophysiology", "asthma treatment first line",
    "ceftriaxone dosing", "amoxicillin allergy", "a1 findings", "a10 report", "ab reference",
    "thrombosis complications", "pneumonia tx", "anemia dx", "cardiology further reading",
    "endocrine management plan", "renal pathogenesis mechanism", "fever cough pneumonia sepsis",
    "diabetes insulin therapy", "stroke thrombolysis window", "high blood pressure control",
    "zzzznotpresent term", "a1 a10 ab combined query"
  ];
  ok("20+ queries exercised", queries.length >= 20);

  for (const q of queries) {
    const rMap = bkMap.search(q, 5);
    const rIdx = bkIdx.search(q, 5);
    const same = rMap.length === rIdx.length &&
      rMap.every((pair, i) => pair[1] === rIdx[i][1] && pair[0] === rIdx[i][0]);
    ok("search('" + q + "') identical (Map path vs worker-shape index)", same);
  }

  // idfOf/us must agree between the two tid implementations (Map vs binary search).
  const probeWords = ["fever", "sepsis", "a1", "a10", "ab", "ceftriaxone", "notarealword", "thrombosis"];
  for (const w of probeWords) {
    ok("idfOf('" + w + "') agrees", bkMap.idfOf(w) === bkIdx.idfOf(w));
  }
  for (const w of ["Feverr", "Diabetees", "fever"]) {
    ok("us('" + w + "') agrees", bkMap.us(w) === bkIdx.us(w));
  }
}

// ── (b) buildBookAsync falls back to the Map path when Worker is undefined (Node) ──
{
  ok("no global Worker in this Node process (precondition for the fallback path)", typeof Worker === "undefined");
  const rows = makeRows();
  const jsonl = rows.map((r) => JSON.stringify(r)).join("\n");
  const book = await R.buildBookAsync(rows, jsonl);
  ok("buildBookAsync resolves a Book instance", book instanceof R.Book);
  const top = book.search("treatment for fever and cough", 3);
  ok("the fallback-built Book actually answers a search", Array.isArray(top));
  const bkMap = new R.Book(rows);
  const same = JSON.stringify(top) === JSON.stringify(bkMap.search("treatment for fever and cough", 3));
  ok("fallback book's search matches the plain Map-path book", same);
}

// ── (c)/(d) loadBook()'s in-flight guard: dedupe concurrent calls, recover after a failure ──
{
  const fs = require("node:fs");
  const kbSrc = fs.readFileSync(require.resolve("../kb/ai/maik-lite-kb-store.js"), "utf8");

  const ROWS = 42176;
  const fullRows = [];
  for (let i = 0; i < ROWS; i++) fullRows.push({ i, text: "chunk " + i + " " + "x".repeat(260), headings: [i === 0 ? "A" : "B"], pages: [i] });
  const goodJsonl = fullRows.map((r) => JSON.stringify(r)).join("\n");

  function makeKbStore(opts) {
    opts = opts || {};
    let readFileCalls = 0;
    let firstCallShouldFail = !!opts.firstCallFails;
    const Filesystem = {
      stat: async () => ({ size: 37976783 }),
      mkdir: async () => ({}),
      readFile: async (o) => {
        readFileCalls++;
        if (firstCallShouldFail && readFileCalls === 1) throw new Error("simulated read failure");
        return { data: o.encoding === "utf8" ? goodJsonl : Buffer.from(goodJsonl, "utf8").toString("base64") };
      },
      appendFile: async () => ({}), deleteFile: async () => ({})
    };
    const store = {
      smd_maik_kb_installed: "1",
      smd_maik_kb_sha: "96b4504ac62dfa50d672913aa7d52fbdb5f949de0b52dc9aed2fd73e74be480b"
    };
    const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    const win = { Capacitor: { isNativePlatform: () => true, Plugins: { Filesystem } }, localStorage: ls };
    win.window = win; win.self = win;
    const mod = { exports: {} };
    new Function("module", "self", "window", "localStorage", "btoa", "atob", kbSrc)(
      mod, win, win, ls,
      (s) => Buffer.from(s, "binary").toString("base64"),
      (s) => Buffer.from(s, "base64").toString("binary"));
    return { KB: mod.exports, getReadFileCalls: () => readFileCalls };
  }

  // (c) two concurrent first calls -> same resolved object, readFile called once.
  {
    const { KB, getReadFileCalls } = makeKbStore();
    const [b1, b2] = await Promise.all([KB.loadBook(R), KB.loadBook(R)]);
    ok("concurrent loadBook() calls resolve to the SAME Book object", b1 === b2);
    ok("concurrent loadBook() calls only read the file once", getReadFileCalls() === 1);
    ok("the resolved object actually works (rows loaded)", b1.rows.length === ROWS);
  }

  // (d) a failed first load does not poison later calls.
  {
    const { KB, getReadFileCalls } = makeKbStore({ firstCallFails: true });
    let rejected = null;
    await KB.loadBook(R).catch((e) => { rejected = e; });
    ok("the first (failing) call rejects", rejected && /simulated read failure/.test(rejected.message));
    const book = await KB.loadBook(R);
    ok("a later call after a failure succeeds instead of replaying the rejection", book && book.rows.length === ROWS);
    ok("the later call actually retried the read (2 total read attempts)", getReadFileCalls() === 2);
  }
}

console.log(`maik-kb-worker: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
