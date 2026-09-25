/* test/scribe-transcript-clip.test.mjs — the end of a long consultation must reach the extractor.
 *
 * `SMD_AI.extract` (reasoning.js) clips the transcript before sending, silently. At the old fixed
 * 8000 characters a consult longer than roughly eleven minutes had its tail dropped on the way out,
 * and the tail of a consultation is where the diagnosis, the plan and the prescription are spoken.
 * Two defences, tested here:
 *   1. a caller may raise the clip to the server's own MAX_IN_CHARS (16000), and cannot exceed it;
 *   2. past that, the final refine sends the delta plus the accumulated draft instead of a "full"
 *      send that would be truncated - so nothing spoken is dropped at any consult length.
 *
 * node --test test/scribe-transcript-clip.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const REAS = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const OPD = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");

/* ---- 1. the clip itself, driven through the real SMD_AI.extract ---------------------------- */

function loadAI() {
  const sent = [];
  const win = {
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { onLine: true, userAgent: "node" },
    location: { origin: "https://stewardmd.in", href: "https://stewardmd.in/", search: "" },
    fetch: (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(init.body) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ emrFields: {} }) });
    },
    addEventListener() {}, setTimeout, clearTimeout, console
  };
  const doc = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    addEventListener() {}, body: { appendChild() {}, classList: { add() {}, remove() {} } },
    head: { appendChild() {} },
    documentElement: { style: {}, classList: { add() {}, remove() {} } } };
  win.document = doc;
  new Function("window", "document", "location", "localStorage", "navigator", "fetch", REAS)(
    win, doc, win.location, win.localStorage, win.navigator, win.fetch);
  // No skip guards below: a harness that quietly fails to load would turn these into tests that
  // always pass, which is worse than having none.
  assert.ok(win.SMD_AI && typeof win.SMD_AI.extract === "function", "SMD_AI.extract must really load");
  return { AI: win.SMD_AI, sent, win };
}

test("a caller can raise the clip to the server's limit, and the whole tail is sent", async () => {
  const { AI, sent } = loadAI();
  const transcript = "A".repeat(15990) + "THE-PLAN-AND-PRESCRIPTION";
  await AI.extract(transcript, "opd-scribe", { maxChars: 16000, sec: 30 });
  assert.equal(sent.length, 1, "the call must really have been made");
  const body = sent[sent.length - 1].body;
  assert.equal(body.transcript.length, 16000, "must send up to the server's 16000, not 8000");
  assert.ok(!("maxChars" in body), "maxChars is a client instruction, it must not ride in the body");
  assert.equal(body.sec, 30, "the other options still ride along");
});

test("the clip can never exceed what the server accepts", async () => {
  const { AI, sent } = loadAI();
  await AI.extract("B".repeat(40000), "opd-scribe", { maxChars: 999999 });
  assert.equal(sent.length, 1, "the call must really have been made");
  assert.equal(sent[0].body.transcript.length, 16000, "must be capped at the server limit");
});

test("the default is unchanged for every other caller", async () => {
  const { AI, sent } = loadAI();
  await AI.extract("C".repeat(20000), "assessment");
  assert.equal(sent.length, 1, "the call must really have been made");
  assert.equal(sent[0].body.transcript.length, 8000, "no caller gets a new default by accident");
});

/* ---- 2. past the ceiling, the final pass must not be a truncated "full" send ---------------- */

function makeDoc() {
  const el = () => ({ id: "", classList: { add() {}, remove() {} }, querySelector: () => null,
    appendChild() {}, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ""; },
    textContent: "", style: {} });
  return { getElementById: () => null, createElement: el, body: { appendChild() {} }, activeElement: null };
}
function loadOPD() {
  const win = {}; const store = {};
  const ls = { getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
               setItem: (k, v) => { store[k] = String(v); } };
  new Function("window", "document", "location", "localStorage", OPD)(win, makeDoc(), { search: "" }, ls);
  win.localStorage = ls;
  return win.OPDEMR;
}

test("a SHORT final refine still sends the whole transcript, exactly as before", () => {
  const OE = loadOPD();
  const text = "short consult";
  const plan = OE._deltaPlan(text, text.slice(0, 5), 5, { flagOn: true, isFinal: true, hasDraft: true, maxChars: 16000 });
  assert.equal(plan.delta, false, "the authoritative final pass must stay a full send");
  assert.equal(plan.text, text);
});

test("a LONG final refine sends the delta plus the draft, so the end of the consult is not dropped", () => {
  const OE = loadOPD();
  const covered = "X".repeat(16500);
  const text = covered + " and the plan is amoxicillin for five days";
  const plan = OE._deltaPlan(text, covered, covered.length, { flagOn: true, isFinal: true, hasDraft: true, maxChars: 16000 });
  assert.equal(plan.delta, true, "a truncated full send would lose the tail; the delta carries it");
  assert.ok(/amoxicillin for five days/.test(plan.text), "the newest speech must be what is sent");
  assert.equal(plan.to, text.length);
});

test("with no draft to lean on, a long final still sends everything it can", () => {
  const OE = loadOPD();
  const text = "Y".repeat(20000);
  const plan = OE._deltaPlan(text, "", 0, { flagOn: true, isFinal: true, hasDraft: false, maxChars: 16000 });
  assert.equal(plan.delta, false, "without a draft there is nothing to merge into, so send the transcript");
});

test("the delta flag off restores the previous behaviour at every length", () => {
  const OE = loadOPD();
  const covered = "Z".repeat(16500);
  const text = covered + " tail";
  const plan = OE._deltaPlan(text, covered, covered.length, { flagOn: false, isFinal: true, hasDraft: true, maxChars: 16000 });
  assert.equal(plan.delta, false);
  assert.equal(plan.text, text);
});
