/* test/queue-q2-render.test.mjs - the doctor queue's two screens, rendered by the REAL queue.js (_render is
 * pure: state -> HTML). The 2026-11 screen (flag smd_opd_q2) and the text corrections that apply to both.
 * The click-through is test/run-opd-q2-ui.mjs; this is the part that runs with every `npm test`.
 * node --test test/queue-q2-render.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../queue.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../queue.css", import.meta.url), "utf8");
const FLAGS = readFileSync(new URL("../queue-flags.js", import.meta.url), "utf8");

function load(ls, clinic) {
  const mem = Object.assign({}, ls || {});
  const localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const win = { localStorage, addEventListener: () => {}, toast: () => {} };
  if (clinic) win.SMD_CLINIC = clinic;
  const doc = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ classList: { add() {}, remove() {} }, style: {} }), body: { appendChild() {} }, addEventListener: () => {} };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, localStorage);
  return win.QUEUE;
}
const NOW = Date.now(), M = 60000;
const state = (over) => Object.assign({
  session: { id: "s1", doctorName: "Dr Asha", status: "active", doctorStatus: "consulting", currentTicketId: "c" }, me: { name: "Room 1", dept: "General Medicine" },
  view: "dashboard", orgId: "org1", ghisToken: null, search: "",
  tickets: [
    { id: "c", token: "A1", name: "Arjun Rao", status: "in_consultation", registeredAt: NOW - 30 * M, consultStartAt: NOW - 5 * M, visitType: "new" },
    { id: "n", token: "A2", name: "Sita Devi", status: "waiting", position: 1, registeredAt: NOW - 44 * M, priority: 1, priorityReason: "senior" },
    { id: "w", token: "A3", name: "Ramesh <b>Kumar</b>", status: "waiting", position: 2, registeredAt: NOW - 4 * M, etaStart: NOW + 18 * M, confidence: 45 }
  ]
}, over || {});
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("flag off (the default): the earlier screen, with its three corrected texts", () => {
  const Q = load();
  assert.equal(Q._q2(), false);
  const h = Q._render(state());
  assert.match(h, /class="q-kpis"/);
  assert.ok(!/AI Insights/.test(h), "a fixed 30-minute rule is not labelled AI");
  assert.ok(!/>Next \d/.test(h), "no 'Next 3' over the whole list");
  const empty = Q._render(state({ tickets: [] }));
  assert.ok(!/Finish/.test(empty), "the empty consult card names no control that is not on the screen");
});

test("the flag is registered, off by default, with its kill switch for the record key on", () => {
  const w = { location: { search: "" }, localStorage: { getItem: () => null, setItem() {} } };
  new Function("window", "module", FLAGS)(w, undefined);
  const d = w.SMD_QUEUE_FLAGS.defs();
  assert.equal(d.smd_opd_q2.def, false);
  assert.equal(d.smd_opd_patient_key.def, true);
});

test("flag on: a status sentence, Now, Next with worded buttons, plain rows", () => {
  const Q = load({ smd_opd_q2: "1" });
  const h = Q._render(state()), t = text(h);
  assert.ok(!/class="q-kpis"/.test(h) && !/class="q-ai/.test(h), "no stat cards, no insight card");
  assert.match(t, /2 waiting\. Longest 44 min\./);
  assert.match(t, /Running late/);
  assert.match(t, /With you now .*Arjun Rao.*In consult 5 min/);
  assert.match(h, /<section class="q2-next"[\s\S]*Sita Devi[\s\S]*data-q-act="call:n"[\s\S]*Call in[\s\S]*data-q-act="start:n"[\s\S]*Start consult/);
  assert.match(h, /<button type="button" class="q2-row" data-q-act="row:w"/);
  assert.match(t, /About 18 min, rough estimate/, "an estimate under 60% confidence says so");
  assert.ok(!/<button class="q-ic"[^>]*data-q-act="(call|start|remove|prio)/.test(h), "no icon-only action buttons");
});

test("flag on: patient names are escaped everywhere they are drawn", () => {
  const Q = load({ smd_opd_q2: "1" });
  const s = state(); s.rowSheet = { ticketId: "w" };
  const h = Q._render(s);
  assert.ok(!/Ramesh <b>Kumar/.test(h));
  assert.match(h, /Ramesh &lt;b&gt;Kumar/);
});

test("flag on: the row sheet writes every action out, Remove last", () => {
  const Q = load({ smd_opd_q2: "1" });
  const s = state(); s.rowSheet = { ticketId: "w" };
  const sheet = Q._render(s).split('role="dialog" aria-label="Actions for this patient"')[1];
  const acts = [...sheet.matchAll(/class="q2-item[^"]*" data-q-act="([a-z]+):w"/g)].map((m) => m[1]);
  assert.deepEqual(acts, ["start", "call", "prio", "assess", "remove"]);
  assert.match(sheet, /q2-item danger" data-q-act="remove:w"/);
});

test("flag on: the end control is a button a screen reader can press", () => {
  const Q = load({ smd_opd_q2: "1" });
  assert.match(Q._render(state()), /<button type="button" class="q-swipe q2-swipe" id="qSwipe" data-q-act="endask" aria-label="End consultation">/);
});

test("flag on: an empty day gives the one action that fills it", () => {
  const Q = load({ smd_opd_q2: "1" });
  const h = Q._render(state({ tickets: [] }));
  assert.match(text(h), /No patients yet Add your first patient/);
  assert.match(h, /q2-empty[\s\S]*data-q-act="add"/);
});

test("settings: every number field has a label tied to it, and a clinic is not told about GHIS", () => {
  // The storage card's own states (not set up / never run / last backup) need the app's flags and clinic
  // store, so test/run-opd-q2-ui.mjs covers them on the real page.
  const Q = load();
  const html = Q._render(state({ view: "settings", config: { early: 5, prep: 2, noShowTimeoutMin: 10, defaultConsultMin: 12 } }));
  assert.ok(!/save to GHIS/.test(html));
  assert.match(html, /<label for="qCfg_early">/);
  assert.match(html, /data-q-act="q2toggle"/, "the layout switch is in Settings on both screens");
});

test("no app-facing text in the queue has an em dash, and the new styles use tokens, not raw colours", () => {
  const strings = SRC.match(/'[^'\n]*'|"[^"\n]*"/g) || [];
  assert.equal(strings.filter((x) => x.includes("—")).length, 0);
  const q2 = CSS.slice(CSS.indexOf("The 2026-11 queue screen"));
  const hex = (q2.match(/#[0-9a-fA-F]{3,8}\b/g) || []);
  assert.deepEqual(hex, [], "q2 rules reference var(--token), never a hex");
});

test("the queue path no longer opens a browser tab for clinic set-up", () => {
  assert.ok(!/stewardmd\.in\/opd/.test(SRC));
  assert.match(SRC, /apiPost\("\/onboard\/clinic"/);
});
