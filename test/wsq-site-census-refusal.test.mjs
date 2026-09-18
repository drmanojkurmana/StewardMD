/* test/wsq-site-census-refusal.test.mjs - R4-5 follow-up: the staff site pages that read the ward list or the ED list
 * (shell.js home tiles, support.js, maik.js, inbasket.js) show the same translated "too many open stays" sentence as
 * ward.js when GET /api/queue/ward/list or /ward/ed-list answers 503 too_many_open, never a generic "unavailable".
 *
 * node --test --test-concurrency=1 test/wsq-site-census-refusal.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSite } from "./wsq-site-i18n-harness.mjs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const EN_SENTENCE = "Too many open stays to show safely. Close visits that are finished (discharge or end them), or contact support.";
const REFUSAL = { ok: false, error: "too_many_open", message: "Too many open encounters to read whole." };

test("WSQ.tooManyOpen: the ward.js sentence for a too_many_open answer, in the staff language; empty for any other failure", () => {
  const en = loadSite({ lang: "en", pages: ["maik.js", "inbasket.js", "support.js"] });
  assert.equal(en.win.WSQ.tooManyOpen(REFUSAL), EN_SENTENCE);
  assert.equal(read("ward.js").includes('"ward.too-many-open-stays", "' + EN_SENTENCE + '"'), true, "the same key and English as ward.js");
  for (const other of [null, undefined, { ok: false }, { ok: false, error: "network" }, { ok: true, patients: [] }]) assert.equal(en.win.WSQ.tooManyOpen(other), "");
  en.win.WSQI18n.register("yy", "Test", { "ward.too-many-open-stays": "TRANSLATED-SENTENCE" }, { reviewed: false });
  en.st.navLang = "yy";
  assert.equal(en.win.WSQ.tooManyOpen(REFUSAL), "TRANSLATED-SENTENCE");
});

test("shell transport: a 503 too_many_open answer carries the translated sentence as message and detail", async () => {
  const en = loadSite({ lang: "en" });
  en.st.tokType = "staff"; en.st.tok = "t";
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 503, json: async () => ({ ok: false, error: "too_many_open", message: "server words" }) });
  try {
    const r = await en.win.WSQ.api("/ward/ed-list?orgId=o");
    assert.deepEqual([r.error, r.message, r.detail], ["too_many_open", EN_SENTENCE, EN_SENTENCE]);
    globalThis.fetch = async () => ({ status: 500, json: async () => ({ ok: false, error: "boom", message: "server words" }) });
    assert.equal((await en.win.WSQ.api("/ward/list?orgId=o")).message, "server words", "other failures are untouched");
  } finally { globalThis.fetch = orig; }
});

test("screens: every /ward/list and /ward/ed-list failure branch says the census sentence before its own fallback", () => {
  const shell = read("wardsynq/site/shell.js");
  assert.match(shell, /r && r\.error === "too_many_open" \? \{ text: tooManyOpenText\(\), stop: true \} : f\(r\)/, "home tiles (ward, ED) show the sentence, not 'unavailable'");
  const maik = read("wardsynq/site/pages/maik.js");
  assert.match(maik, /census = WSQ\.tooManyOpen\(w\) \|\| WSQ\.tooManyOpen\(e\)/);
  assert.match(maik, /\(census \? esc\(census\) :/);
  const inbasket = read("wardsynq/site/pages/inbasket.js");
  assert.match(inbasket, /WSQ\.tooManyOpen\(w\) \? c\.esc\(WSQ\.tooManyOpen\(w\)\) : TS\(c, "site\.inbasket\.patientsFailed"/);
  const support = read("wardsynq/site/pages/support.js");
  assert.equal((support.match(/c\.esc\(WSQ\.tooManyOpen\(r\) \|\| T\(c, "site\.support\.patientsFailed"/g) || []).length, 2, "diet and transport patient pickers");
  for (const [name, src] of [["maik", maik], ["inbasket", inbasket], ["support", support]]) {
    const calls = (src.match(/c\.api\("\/ward\/(?:ed-)?list"/g) || []).length;
    const guarded = (src.match(/WSQ\.tooManyOpen\(/g) || []).length;
    assert.ok(calls > 0 && guarded >= calls, name + ": " + calls + " census reads, " + guarded + " refusal checks");
  }
});
