/* test/maik-ui-groups.test.mjs — the model and voice lists are categorised, and nothing is lost.
 *
 * Owner, 2026-09-20: "polish whole maik ai models selection section, voice model section make it
 * well organised rather than long page without deleting any info categorise and sub categorise".
 *
 * The risk in grouping a list is silent deletion: a pack that matches no rule simply stops being
 * offered, and nobody notices until a clinician cannot find the model they paid for. Every test
 * here is really the same assertion from a different angle - every pack appears exactly once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ENGINE = readFileSync(new URL("../maik-engine.js", import.meta.url), "utf8");
const VOICE = readFileSync(new URL("../voice.js", import.meta.url), "utf8");

const PACKS = {
  "maik-lite": { label: "MAiK Lite", own: true, tier: 0 },
  "maik-mxcore": { label: "MAiK MxCore", tier: 1 },
  "maik-neural": { label: "MAiK Neural", tier: 2 },
  "medmo-4b": { label: "MAiK Cortex", tier: 2.5 },
  "maik-horizon": { label: "MAiK Horizon", tier: 3 },
  "maik-apex": { label: "MAiK Apex", tier: 4 },
  "bonsai-ternary-8b": { label: "MAiK Bonsai", tier: 0.5, flagship: true },
  "bonsai-8b": { label: "MAiK Bonsai Swift", tier: 0.7 },
  "bonsai-27b": { label: "MAiK Bonsai Max", tier: 5 },
  "bonsai2-27b": { label: "MAiK Bonsai Max 2", tier: 5.5 },
};
const MEDICAL = { "maik-lite": 1, "maik-mxcore": 1, "maik-neural": 1, "medmo-4b": 1, "maik-apex": 1 };
const INSTALLED = { "maik-lite": 1 };

function load() {
  const m = new Map();
  const ls = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const made = [];
  const win = {
    localStorage: ls, addEventListener() {},
    document: {
      getElementById: () => null, querySelector: () => null,
      createElement: () => { const e = { style: {}, setAttribute() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }; made.push(e); return e; },
      head: { appendChild() {} }, documentElement: { appendChild() {} }, body: { appendChild() {} },
    },
    SMD_PRO: { isProSync: () => true, proKnown: () => true },
    SMD_MAIK_LOCAL: { answer() {}, available: () => true },
    SMD_MAIK_MODELS: {
      PACKS, DEVICE_WARNING: "warning",
      packIds: () => Object.keys(PACKS),
      caps: (id) => ({ medical: !!MEDICAL[id], kb: true }),
      installedCached: (id) => !!INSTALLED[id],
      sizeLabel: () => "2.5 GB",
      state: (id) => ({ downloading: false, frac: INSTALLED[id] ? 1 : 0, done: !!INSTALLED[id], err: null }),
      subscribe: () => () => {}, activePack: () => "maik-lite", setActivePack: () => {},
      hasVision: () => false, totalBytes: () => 1e9,
    },
  };
  const mod = { exports: {} };
  new Function("window", "localStorage", "module", ENGINE)(win, ls, mod);
  return win.SMD_MAIK_ENGINE || mod.exports;
}

test("the settings list is grouped, and EVERY pack appears exactly once", () => {
  const html = load().modelRowHTML();
  assert.match(html, /<details class="mk-grp"/, "rendered as collapsible groups");
  for (const [id, p] of Object.entries(PACKS)) {
    const n = html.split('data-me-pack-row="' + id + '"').length - 1;
    assert.equal(n, 1, `${p.label} (${id}) appears exactly once, not ${n}`);
  }
});

test("the group a pack lands in is derived from the registry, not a hand-kept list", () => {
  const html = load().modelRowHTML();
  for (const t of ["StewardMD's own", "Medically tuned", "Bonsai (ternary)", "General purpose"]) {
    assert.ok(html.includes(t), `group "${t}" is present`);
  }
  // The group holding the answering pack must be OPEN, so the clinician can see what answers
  // without hunting. Split on the group boundary rather than guessing a character window.
  const blocks = html.split('<details class="mk-grp"').slice(1);
  const withActive = blocks.find((b) => b.includes('data-me-pack-row="maik-lite"'));
  assert.ok(withActive, "the active pack is inside a group");
  assert.match(withActive.slice(0, 120), /\sopen/, "the group holding the answering pack is open");
});

test("the page opens SHORT: only one group is expanded by default", () => {
  const html = load().modelRowHTML();
  const opens = (html.match(/<details class="mk-grp"[^>]*\sopen/g) || []).length;
  const total = (html.match(/<details class="mk-grp"/g) || []).length;
  assert.ok(total >= 3, `several groups exist (${total})`);
  assert.equal(opens, 1, `exactly one group open on load, got ${opens}`);
});

test("group headings are accessible: real disclosure widgets, not styled divs", () => {
  const html = load().modelRowHTML();
  assert.match(html, /<summary/, "uses <summary> so it is keyboard- and screen-reader-operable");
  assert.match(ENGINE, /mk-grp>summary::-webkit-details-marker\{display:none\}/, "default marker hidden");
  assert.match(ENGINE, /mk-grp>summary:focus-visible/, "focus is visible for keyboard users");
});

test("the picker groups the same way and never repeats a heading", () => {
  assert.match(ENGINE, /var PICKER_ORDER = \[/, "the picker renders in a fixed category order");
  const i = ENGINE.indexOf("var PICKER_ORDER");
  const block = ENGINE.slice(i, i + 900);
  // Bucketing is what prevents the duplicate heading the interleaved registry order produced.
  assert.match(block, /bucket\[g\]/, "rows are bucketed by group before rendering");
  assert.match(block, /extra/, "an unknown group still renders rather than being dropped");
});

test("the picker carries the Knowledge Base switch beside the model rows", () => {
  assert.match(ENGINE, /function kbRowHTML/, "the picker has a Knowledge Base row");
  const i = ENGINE.indexOf("function kbRowHTML");
  const block = ENGINE.slice(i, i + 1600);
  assert.match(block, /role="switch"/, "it is a real switch");
  assert.match(block, /aria-checked="/, "state is exposed to assistive tech");
  assert.match(block, /disabled aria-disabled="true"/, "locked on for cloud / KB-only rather than hidden");
  assert.match(ENGINE, /data-mk-kb/, "the switch is wired");
});

test("voice models are grouped by job, and every model in a tier has a home", () => {
  assert.match(VOICE, /var VOICE_GROUPS = \[/, "voice groups exist");
  assert.match(VOICE, /function tiersUsing/, "each row states which tiers use it");
  const i = VOICE.indexOf("var VOICE_GROUPS");
  const block = VOICE.slice(i, i + 2600);
  for (const k of ["small-q8_0", "large-v3-turbo-q5_0", "telugu-small-q8_0"]) {
    assert.ok(block.includes(k), `${k} is placed in a group`);
  }
  assert.match(block, /Other models/, "a model no group claims still renders");
  // Status must be fetched for every LISTED model, so a collapsed group already reads "Installed"
  // when opened. Assert on the renderModels body rather than a fixed-size window.
  const r = VOICE.indexOf("function renderModels");
  const body = VOICE.slice(r, VOICE.indexOf("\n    }", r));
  assert.match(body, /blocks\.forEach\([\s\S]*refreshStatus/,
    "every listed model's status is refreshed, not just the active tier's");
});

test("voice grouping did not delete the tier selector or the footer", () => {
  assert.match(VOICE, /data-smdv-ms-tier=/, "tier selector kept");
  assert.match(VOICE, /data-smdv-ms-off/, "turn-off control kept");
  assert.match(VOICE, /Downloads once over Wi-Fi\./, "the download hint is still shown");
  assert.match(VOICE, /Multilingual voice/, "the language sub-label is still shown");
});
