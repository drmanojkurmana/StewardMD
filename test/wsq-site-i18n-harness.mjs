/* test/wsq-site-i18n-harness.mjs - shared by the staff-language tests (ui-i18n-site, owner decision
 * 2026-09-15: a staff language translates the whole staff interface).
 *
 *   extractKeys()                 every T(c, "site.x", "English") / TS(...) call in the staff sources -> [{key, en, file}]
 *   loadSite({ lang, pages })     shell.js + i18n.js + the named pages in a minimal DOM double; lang "xx"
 *                                 registers a FAKE catalog in which every key reads "⟦English⟧", so a
 *                                 translated string is visibly marked and an untranslated one is not
 *   leftovers(html, data)         the visible text in html that is neither inside ⟦⟧ nor one of the
 *                                 data values given (names, codes, numbers the fixture supplied)
 */
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
export const SOURCES = ["wardsynq/site/shell.js", ...readdirSync(new URL("../wardsynq/site/pages/", import.meta.url)).filter((f) => f.endsWith(".js")).sort().map((f) => "wardsynq/site/pages/" + f), "wardsynq/ui/wardsynq-app.js", "wardsynq/site/bug-reporter.js"];

const CALL = /\b(?:T|TS)\(\s*[\w.]+\s*,\s*"((?:site|order)\.[\w.-]+)"\s*,\s*("(?:[^"\\\n]|\\.)*")/g;

export function extractKeys(files) {
  const out = [];
  for (const file of files || SOURCES) {
    const src = read(file);
    for (const m of src.matchAll(CALL)) out.push({ key: m[1], en: JSON.parse(m[2]), file });
  }
  return out;
}

export function fakeCatalog(keys) {
  const cat = {};
  for (const k of keys || extractKeys()) cat[k.key] = "⟦" + k.en + "⟧";
  return cat;
}

function makeEl(id) {
  const el = {
    id, innerHTML: "", textContent: "", className: "", value: "", hidden: false, disabled: false, style: {}, dataset: {},
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute: () => null, appendChild() {}, removeChild() {}, focus() {}, closest: () => null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
  return el;
}

/** The site in a fake DOM. opts.api(path, body) answers ctx.api; opts.pages is a list of page file names. */
export function loadSite(opts) {
  opts = opts || {};
  const win = { addEventListener() {}, location: { hash: "", search: "" }, setTimeout, clearTimeout };
  const elements = {};
  const doc = {
    readyState: "loading", documentElement: { lang: "en" }, head: { appendChild() {} },
    getElementById: (id) => (elements[id] = elements[id] || makeEl(id)),
    createElement: () => makeEl(), body: { appendChild() {} }, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
  };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, win.location, ls);
  run(read("wardsynq/site/i18n.js"));
  run(read("wardsynq/site/print-lang.js"));
  if (opts.lang && opts.lang !== "en") win.WSQI18n.register(opts.lang, "Fake", fakeCatalog(), { reviewed: false });
  run(read("wardsynq/site/shell.js"));
  for (const p of opts.pages || []) run(read("wardsynq/site/pages/" + p));
  const st = win.WSQ.state;
  st.navLang = opts.lang || "en";
  return { win, doc, st, elements };
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Visible text fragments of html that are not translated (outside ⟦⟧) and not a supplied data value. */
export function leftovers(html, data) {
  let text = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<span class="ms"[^>]*>[^<]*<\/span>/g, " ")          // Material Symbols ligature names are icons, not words
    .replace(/<[^>]+>/g, "\n")
    .replace(/&[a-z]+;|&#\d+;/g, (e) => ENTITIES[e] || " ");
  text = text.replace(/⟦[^⟧]*⟧/g, "\n");
  for (const d of (data || []).map(String).filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(d).join("\n");
  return text.split("\n").map((s) => s.trim()).filter((s) => s && /[A-Za-z]{2,}/.test(s));
}
