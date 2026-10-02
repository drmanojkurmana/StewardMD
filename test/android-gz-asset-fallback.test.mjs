/* Android's asset packaging un-gzips bundled files and drops ".gz". Measured on a Pixel 9 (2026-10-02,
 * live WebView over adb CDP): /dose-rules.json.gz, /offline-clinical.json.gz and
 * /clinical-supplement.json.gz all 404, the same names without ".gz" return plain JSON, and
 * SMD_DOSECALC.load() failed with "rules 404": the dose calculator and the offline monographs never
 * loaded on Android. Both loaders now retry the stripped name and accept plain JSON. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url));
// What the APK holds: the files inflated, under the names without ".gz".
const ASSETS = {
  "/dose-rules.json": gunzipSync(read("data/dose-rules.json.gz")),
  "/offline-clinical.json": gunzipSync(read("data/offline-clinical.json.gz")),
  "/clinical-supplement.json": gunzipSync(read("data/clinical-supplement.json.gz")),
};
const seen = [];
function androidFetch(url) {
  const path = String(url).split("?")[0];
  seen.push(path);
  const body = ASSETS[path];
  return Promise.resolve(body ? new Response(body, { status: 200 }) : new Response("Not found", { status: 404 }));
}

test("dose calculator: a .gz 404 falls back to the inflated asset", async () => {
  const realFetch = globalThis.fetch; globalThis.fetch = androidFetch;
  try {
    const win = { document: { addEventListener() {}, createElement: () => ({ style: {} }), head: { appendChild() {} }, body: { appendChild() {} } } };
    new Function("module", "window", read("dose-calc.js").toString("utf8"))(undefined, win);   // browser path (module set = pure engine only)
    const d = await win.SMD_DOSECALC.load();
    assert.ok(d.drugs.length > 1000, "rules loaded: " + d.drugs.length);
    assert.ok(seen.includes("/dose-rules.json.gz") && seen.includes("/dose-rules.json"));
  } finally { globalThis.fetch = realFetch; }
});

test("offline monographs: a .gz 404 falls back to the inflated assets", async () => {
  const realFetch = globalThis.fetch; globalThis.fetch = androidFetch;
  try {
    const store = {};
    const win = { localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); } }, navigator: { onLine: false } };
    win.window = win;
    new Function("window", "localStorage", "navigator", read("offline-clinical.js").toString("utf8"))(win, win.localStorage, win.navigator);
    await win.SMD_OFFLINE_CLINICAL.preload();
    const s = win.SMD_OFFLINE_CLINICAL.stats();
    assert.ok(s && s.struct > 100, JSON.stringify(s));
    assert.ok(seen.includes("/offline-clinical.json"));
  } finally { globalThis.fetch = realFetch; }
});
