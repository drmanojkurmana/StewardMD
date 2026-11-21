/* test/maik-book-extras-ui.test.mjs - the two offline-book switches in the MaiK model card
 * (owner 2026-11-21: "give on button just like knowledge base has"). Same control as the
 * Knowledge Base switch; meaning search is disabled, with its reason, until cancer knowledge is
 * on and the On-phone search pack is installed; turning cancer knowledge off also turns meaning
 * search off (its vectors belong to that book). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ENGINE = readFileSync(new URL("../maik-engine.js", import.meta.url), "utf8");

function load(keys = {}, pack = false) {
  const m = new Map(Object.entries(keys));
  const ls = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const win = { localStorage: ls, addEventListener() {}, document: { querySelector: () => null },
    SMD_EMBED_LOCAL: { packReady: () => pack } };
  const mod = { exports: {} };
  new Function("window", "localStorage", "module", ENGINE)(win, ls, mod);
  return { E: win.SMD_MAIK_ENGINE || mod.exports, m };
}
const sw = (html, key) => html.match(new RegExp('<button[^>]*data-me-book="' + key + '"[^>]*>'))[0];

test("both off by default; same switch control as the Knowledge Base row", () => {
  const { E } = load();
  const h = E.bookExtrasHTML();
  assert.match(sw(h, "smd_maik_kb_onco"), /class="smd-nav-sw"[^>]*role="switch" aria-checked="false"/);
  assert.match(sw(h, "smd_maik_book_vec"), /aria-checked="false"[^>]*disabled/);
  assert.match(h, /Turn on cancer knowledge first\./);
  assert.doesNotMatch(h, /—/, "no em-dash in app text");
});

test("meaning search waits for the search pack, then can be turned on", () => {
  assert.match(load({ smd_maik_kb_onco: "1" }, false).E.bookExtrasHTML(), /Needs the On-phone search pack/);
  const on = load({ smd_maik_kb_onco: "1", smd_maik_book_vec: "1" }, true).E.bookExtrasHTML();
  assert.match(sw(on, "smd_maik_kb_onco"), /smd-nav-sw on/);
  assert.match(sw(on, "smd_maik_book_vec"), /smd-nav-sw on/);
  assert.doesNotMatch(sw(on, "smd_maik_book_vec"), /disabled/);
});

test("setters write the exact keys the book store and vector module read", () => {
  const { E, m } = load({}, true);
  E.setOncoBook(true); assert.equal(m.get("smd_maik_kb_onco"), "1");
  E.setBookVec(true); assert.equal(m.get("smd_maik_book_vec"), "1");
  E.setOncoBook(false); assert.equal(m.has("smd_maik_kb_onco"), false);
  E.setBookVec(false); assert.equal(m.has("smd_maik_book_vec"), false);
});
