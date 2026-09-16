/* The staff language reaches the whole ward (owner decision 2026-09-15), not just the rail.
 *
 * ward.js writes every string through wT/wTH/wTA/wTD with the English inline, keys "ward.*" in
 * wardsynq/site/i18n.js. Proven here with a fake catalog (every English string wrapped as TE[...]):
 * - English is unchanged: English picked, or i18n.js absent, renders the same bytes;
 * - every visible static string on the main ward screens is translated, and no recorded value is;
 * - a safety text (a refusal, a failure) shows the translation AND the English under it.
 * The real-browser half is test/run-ward-staff-i18n-ui.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const read = (p) => readFileSync(fileURLToPath(new URL("../" + p, import.meta.url)), "utf8");
const WARD_SRC = read("ward.js"), I18N_SRC = read("wardsynq/site/i18n.js");

/** ward.js in a sandbox; lang: undefined = no i18n.js on the page, "en"/"te" = the staff picker's value. */
function load(lang) {
  const store = new Map();
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [], documentElement: {} },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb);
  if (lang) {
    vm.runInContext(I18N_SRC, sb);
    const en = sb.WSQI18n._catalogs.en, te = {};
    for (const k of Object.keys(en)) if (k.indexOf("ward.") === 0) te[k] = "TE[" + en[k] + "]";
    sb.WSQI18n.register("te", "Test", te, { reviewed: false });
    sb.WSQ = { state: { navLang: lang } };
  }
  vm.runInContext(WARD_SRC, sb);
  return sb.window.WARD;
}

// ---- fixtures: what a clinician recorded, which must come back exactly as recorded --------------------------------
const RECORDED = ["Ramesh Kumar", "MRN-7731", "pat-1", "Medical A", "Ceftriaxone", "Potassium", "6.9", "mmol/L", "Chest pain since morning", "TDS", "Patient settled overnight"];
const SEL = { encounterId: "enc-1", patientId: "pat-1", ward: "Medical A", bed: "12", admittedAt: "2026-09-15T04:00:00.000Z", name: "Ramesh Kumar", mrn: "MRN-7731" };
const SCREENS = {
  "ward list": { view: "list", ward: "Medical A", patients: [{ encounterId: "enc-1", patientId: "pat-1", name: "Ramesh Kumar", mrn: "MRN-7731", ward: "Medical A", bed: "12", admittedAt: "2026-09-15T04:00:00.000Z" }] },
  "ward list, empty": { view: "list", patients: [] },
  "bed board": { view: "board", board: { ok: true, bedsConfigured: true, wards: [{ ward: "Medical A", bedsKnown: true, occupied: [{ encounterId: "enc-1", patientId: "pat-1", name: "Ramesh Kumar", bed: "12" }], free: ["14"], unplaced: [] }] }, admitTarget: { ward: "Medical A", bed: "14" } },
  "chart (header, tabs, vitals, MAR, orders, criticals)": { view: "chart", sel: SEL,
    due: [{ orderId: "rx-1", drug: "Ceftriaxone", dose: { value: 1, unit: "g" }, frequency: "TDS", route: "IV", dueAt: "2026-09-15T08:00:00.000Z", status: "verified" }],
    criticals: [{ loopId: "l1", code: "K", display: "Potassium", value: 6.9, unit: "mmol/L", state: "open" }],
    problems: [{ id: "c1", code: "R07.9", display: "Chest pain since morning", status: "active" }] },
  "notes and timeline": { view: "timeline", sel: SEL, timeline: [{ kind: "note", at: "2026-09-15T06:00:00.000Z", label: "Patient settled overnight", text: "Patient settled overnight" }], activeMeds: [] },
  "critical results board": { view: "critsboard", critsBoard: [{ loopId: "l1", patientId: "pat-1", encounterId: "enc-1", name: "Ramesh Kumar", display: "Potassium", value: "6.9", unit: "mmol/L", state: "open", escalation: {} }] },
  "ED board": { view: "ed", ed: { patients: [{ encounterId: "enc-2", patientId: "pat-2", name: "Ramesh Kumar", mrn: "MRN-7731", sex: "male", complaint: "Chest pain since morning" }] } },
};
const stateFor = (W, s) => JSON.parse(JSON.stringify({ ...W._st, orgId: "org-1", loaded: true, ...s }));

/* Text nodes with the lang of their nearest ancestor that has one. A small tokenizer: ward.js's markup is its own. */
const VOID = new Set(["input", "br", "hr", "img", "meta", "link", "col", "source", "wbr"]);
function textNodes(html) {
  const out = [], stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] != null) {
      const lang = [...stack].reverse().find((e) => e.lang)?.lang || "";
      const icon = stack.some((e) => e.icon), hidden = stack.some((e) => e.tag === "textarea" || e.tag === "script" || e.tag === "style");
      out.push({ text: m[4], lang, icon, hidden, at: m.index });
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) { const i = stack.map((e) => e.tag).lastIndexOf(tag); if (i >= 0) stack.length = i; continue; }
    if (VOID.has(tag) || /\/\s*$/.test(m[3])) continue;
    stack.push({ tag, lang: (/\blang="([^"]*)"/.exec(m[3]) || [])[1], icon: /material-symbols/.test(m[3]) });
  }
  return out;
}
const decode = (s) => s.replace(/&middot;/g, "·").replace(/&hellip;/g, "…").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&[a-z]+;/g, " ");
/** Depth of TE[ ... ] at every offset: text inside a translation (its {placeholders} included) counts as translated. */
function translatedAt(html) {
  const depth = new Uint16Array(html.length + 1);
  let d = 0;
  for (let i = 0; i < html.length; i++) {
    if (html.startsWith("TE[", i)) { d++; depth[i] = d; depth[i + 1] = d; depth[i + 2] = d; i += 2; continue; }
    depth[i] = d;
    if (html[i] === "]" && d > 0) d--;
  }
  return depth;
}
/* What may stay untranslated outside a lang="en" element: no letters, a recorded value, an abbreviation, a unit or a
 * route (never translated, by rule), a fixed fluid or dose (clinical-shaped), a product name, a date and time from
 * the browser's own formatter. */
function untranslated(html) {
  const words = new Set(RECORDED.join(" ").split(/\s+/));
  const depth = translatedAt(html);
  return textNodes(html).filter((n) => !n.icon && !n.hidden && n.lang !== "en" && !depth[n.at]).map((n) => decode(n.text).trim())
    .map((t) => RECORDED.reduce((x, r) => x.split(r).join(" "), t))
    .filter((t) => /[A-Za-z]{2}/.test(t) && !t.includes("TE["))
    .filter((t) => !/\b\d+(\.\d+)?\s?(mg|mcg|ml|mL|g|%)\b/.test(t))
    .filter((t) => !/^\d{1,2} [A-Z][a-z]{2,4},? \d{1,2}:\d{2}( ?[ap]m)?$/i.test(t))
    .filter((t) => !t.split(/[\s,·:()\/\-]+/).filter(Boolean).every((w) => words.has(w) || /^[A-Z0-9.%]+$/.test(w) ||
      /^(WardSynQ|MaiK|NEWS2|mmol|mmHg|min|kg|Oral|Sept?|am|pm)$/.test(w) || !/[A-Za-z]/.test(w)));
}

test("English is unchanged: English picked renders exactly what ward.js without i18n.js renders", () => {
  const plain = load(), en = load("en");
  for (const [name, s] of Object.entries(SCREENS)) {
    assert.equal(en._render(stateFor(en, s)), plain._render(stateFor(plain, s)), name);
  }
  // and the failure/refusal banners
  const bad = { view: "list", err: "Request failed.", refusal: null };
  assert.equal(en._render(stateFor(en, bad)), plain._render(stateFor(plain, bad)));
});

test("every key ward.js calls is in the EN catalog with the same English, in one contiguous block of EN", () => {
  const sb = {}; vm.runInNewContext(I18N_SRC, { window: sb });
  const en = sb.WSQI18n._catalogs.en;
  let n = 0;
  for (const m of WARD_SRC.matchAll(/\bwT[HADS]?\(("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")/g)) {
    const k = JSON.parse(m[1]), v = JSON.parse(m[2]);
    assert.equal(en[k], v, k);
    n++;
  }
  assert.ok(n > 2000, "the whole ward is converted, not a handful of strings (" + n + ")");
  const start = I18N_SRC.indexOf("/* ward.js keys (ui-i18n-ward) */"), end = I18N_SRC.indexOf("/* end ward.js keys */");
  assert.ok(start > 0 && end > start, "the block is delimited");
  const inside = I18N_SRC.slice(start, end);
  for (const k of Object.keys(en).filter((x) => x.indexOf("ward.") === 0)) assert.ok(inside.includes(JSON.stringify(k) + ":"), k + " sits inside the block");
  // The site pages block (ui-i18n-site) follows it; both end EN.
  assert.match(I18N_SRC.slice(end), /^\/\* end ward\.js keys \*\/\n\s*(\/\* site pages keys \(ui-i18n-site\) \*\/|\};)/, "the block closes EN or is followed by the site pages block");
});

test("no recorded value is a catalog entry: nothing clinical can be looked up and translated", () => {
  const sb = {}; vm.runInNewContext(I18N_SRC, { window: sb });
  const values = new Set(Object.entries(sb.WSQI18n._catalogs.en).filter(([k]) => k.indexOf("ward.") === 0).map(([, v]) => v));
  for (const r of ["Ceftriaxone", "Paracetamol", "Potassium", "mg", "mL", "mmol/L", "TDS", "BD", "OD", "PRN", "STAT", "IV", "Oral", "Left", "Right", "Bilateral"]) {
    assert.ok(!values.has(r), r + " is not a key's English");
  }
});

for (const [name, s] of Object.entries(SCREENS)) {
  test("translated: " + name + " - every visible static string, and no recorded value", () => {
    const W = load("te");
    const html = W._render(stateFor(W, s));
    assert.ok(html.includes("TE["), "the screen is translated at all");
    assert.deepEqual(untranslated(html), [], "static text left in English");
    // Recorded values are verbatim, and never inside a translation unless marked lang="en".
    const depth = translatedAt(html);
    for (const r of RECORDED) {
      for (const n of textNodes(html)) {
        for (let i = n.text.indexOf(r); i >= 0; i = n.text.indexOf(r, i + 1)) {
          assert.ok(n.lang === "en" || !depth[n.at + i], name + ": " + r + " sits inside translated text without lang=\"en\": " + n.text);
        }
      }
    }
    assert.ok(!/TE\[(Ramesh Kumar|Ceftriaxone|Potassium|MRN-7731)\]/.test(html), "a recorded value is never a translation");
  });
}

test("a recorded value inside a translated sentence is marked lang=\"en\"", () => {
  const W = load("te");
  const html = W._render(stateFor(W, { view: "board", board: { ok: true, bedsConfigured: true, wards: [{ ward: "Medical A", bedsKnown: true, occupied: [], free: ["14"], unplaced: [] }] }, admitTarget: { ward: "Medical A", bed: "14" } }));
  assert.match(html, /<span lang="en">Medical A<\/span>/);
});

test("SAFETY: a refusal and a failure show the translation AND the English original under it", () => {
  const W = load("te");
  const refused = W._render(stateFor(W, { view: "list", refusal: { action: "administer", reasons: ["ALLERGY_CONTRAINDICATION"], detail: "" } }));
  assert.match(refused, /TE\[Refused\]<small class="w-en" lang="en">Refused<\/small>/);
  assert.match(refused, /ALLERGY_CONTRAINDICATION/, "the server's reason codes stay verbatim");
  // A failure kept as plain text in st.err: the banner finds its English.
  const p = W._problem(null);
  assert.equal(p.err, "TE[No response from the server.]");
  const failed = W._render(stateFor(W, { view: "list", err: p.err }));
  assert.match(failed, /TE\[No response from the server\.\]<small class="w-en" lang="en">No response from the server\.<\/small>/);
  // English picked: no second line.
  const E = load("en");
  const enFailed = E._render(stateFor(E, { view: "list", err: E._problem(null).err }));
  assert.ok(!enFailed.includes('class="w-en"'));
});

test("ward-offline.js: English without a lookup, and a refusal's reason stays verbatim through one", async () => {
  const sb = {}; vm.runInNewContext(read("ward-offline.js"), { window: sb, globalThis: sb, self: sb });
  const WO = sb.WARD_OFFLINE;
  const refused = { state: "refused", kind: "mar", reason: "DOSE_CEILING_EXCEEDED" };
  assert.equal(WO.itemText(refused), "Not recorded - the dose record was refused: DOSE_CEILING_EXCEEDED");
  assert.equal(WO.label({ online: false, waiting: 2 }).text, "Offline (2 waiting)");
  const tr = (k, en, v) => "TE[" + en.replace(/\{(\w+)\}/g, (m, x) => (v && x in v ? v[x] : m)) + "]";
  assert.equal(WO.itemText(refused, tr), "TE[Not recorded - the dose record was refused: DOSE_CEILING_EXCEEDED]");
  assert.equal(WO.itemText({ state: "refused", kind: "vitals", reason: "R1" }, tr), "TE[Not recorded - the TE[vitals] was refused: R1]");
  const en = {}; vm.runInNewContext(I18N_SRC, { window: en });
  for (const m of read("ward-offline.js").matchAll(/\btr\(("ward\.[^"]*"), ("(?:[^"\\]|\\.)*")/g)) assert.equal(en.WSQI18n._catalogs.en[JSON.parse(m[1])], JSON.parse(m[2]));
  for (const k of Object.keys(WO.WORDS).concat(["write", "record"])) assert.ok(en.WSQI18n._catalogs.en["ward.offline-word-" + k], k);
});

test("a server message that was never translated gets no invented English line", () => {
  const W = load("te");
  const html = W._render(stateFor(W, { view: "list", err: "The inpatient ward is only available for a WardSynQ-native hospital." }));
  assert.ok(!html.includes('class="w-en"'));
});
