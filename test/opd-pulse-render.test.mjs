/* The OPD pulse as the dashboard actually draws it (queue.js pulseCard).
 *
 * The figures are unit-tested in opd-pulse.test.mjs and the route in the walkthrough; this is the last
 * link in the chain - that what the server computed reaches the screen, and that the three states a
 * clinic reads WRONGLY if they look alike stay apart:
 *
 *   a read that FAILED must never draw as a quiet OPD,
 *   "nobody has finished yet" must never draw as 0% walking out,
 *   an hour in the waiting hall must be visibly different from a normal morning.
 *
 * node --test test/opd-pulse-render.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadQueue() {
  const src = readFileSync(fileURLToPath(new URL("../queue.js", import.meta.url)), "utf8");
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null });
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "", search: "" },
    document: { getElementById: () => null, createElement: el, addEventListener() {}, body: el(), documentElement: el(), querySelector: () => null, querySelectorAll: () => [], activeElement: null },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, setInterval, clearInterval, console, Promise, Date, JSON, Math,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return sb.window.QUEUE;
}

const PULSE = {
  ok: true,
  pulse: {
    registered: 34, waiting: 6, inConsultation: 1, completed: 25, noShow: 2, cancelled: 0, held: 3, recalls: 1, seen: 26,
    doorToDoctor: { medianMin: 22, p90Min: 74, n: 26 },
    deskWait: { medianMin: 6, p90Min: 20, n: 26 },
    doctorWait: { medianMin: 16, p90Min: 58, n: 26 },
    consult: { medianMin: 9, p90Min: 18, n: 25 },
    waitingNow: { longestMin: 68, medianMin: 24, over30: 3, over60: 1 },
    abandonedPct: 7,
  },
};
const dash = (Q, pulse, extra) => Q._render({ ...Q._st, view: "dashboard", orgId: "org-a", session: { id: "s1" }, tickets: [], pulse, ...(extra || {}) });

test("the figures reach the screen: the hall, the longest wait, the p90 and what the split means", () => {
  const Q = loadQueue();
  const html = dash(Q, PULSE);
  assert.match(html, /In the hall/);
  assert.match(html, /longest 68m/, "the person who has been there over an hour is on the screen");
  assert.match(html, /Waiting over 1h/);
  assert.match(html, /3 over 30m/);
  assert.match(html, /9 in 10 within 74m/, "the p90, in words a desk can read");
  assert.match(html, /2 no-shows/);
  assert.match(html, /Awaiting result/, "open work is shown when there is any");
  // The half of the building that is slow, said out loud rather than left as two numbers.
  assert.match(html, /Desk 6<u>m<\/u>, doctor 16<u>m<\/u>/);
  assert.match(html, /the wait is for the doctor/);
});

test("a failed read says so: it never draws as a quiet OPD", () => {
  const Q = loadQueue();
  const html = dash(Q, { failed: true });
  assert.match(html, /Could not read the OPD figures/);
  assert.match(html, /Do not read this as a quiet clinic/);
  assert.ok(!/In the hall/.test(html), "no figures are drawn from a read that did not happen");
  assert.ok(!/>0</.test(html.split("q-pulse")[1] || ""), "and certainly not zeroes");
});

test("before anybody finishes, 'did not wait' reads as not yet, never as 0%", () => {
  const Q = loadQueue();
  const morning = { ok: true, pulse: { ...PULSE.pulse, completed: 0, noShow: 0, waiting: 4, abandonedPct: null, doorToDoctor: { medianMin: null, p90Min: null, n: 0 }, waitingNow: { longestMin: 11, medianMin: 8, over30: 0, over60: 0 } } };
  const html = dash(Q, morning);
  assert.match(html, /not yet/, "nobody has finished yet is not nobody abandoned");
  assert.ok(!/0<u>%<\/u>/.test(html), "and it is not drawn as zero per cent");
  assert.match(html, /longest 11m/);
});

test("an hour in the hall and a tenth of the day walking out are drawn as warnings, a normal morning is not", () => {
  const Q = loadQueue();
  const bad = dash(Q, PULSE);
  assert.match(bad, /q-pulse-t warn/, "over an hour waiting is flagged");
  const calm = { ok: true, pulse: { ...PULSE.pulse, abandonedPct: 3, waitingNow: { longestMin: 12, medianMin: 7, over30: 0, over60: 0 } } };
  assert.ok(!/q-pulse-t warn/.test(dash(Q, calm)), "a clinic running well carries no warning colour");
});

test("a personal clinic with no hospital behind it shows no OPD card at all, and nothing breaks", () => {
  const Q = loadQueue();
  const html = Q._render({ ...Q._st, view: "dashboard", orgId: "", session: { id: "s1" }, tickets: [], pulse: PULSE });
  assert.ok(!/q-pulse/.test(html), "no hospital, no hospital-wide day");
  assert.match(html, /Patients Waiting/, "the doctor's own KPIs are still there");
});

test("visits missing from the clinical record are shown as a warning with a one-tap retry", () => {
  const Q = loadQueue();
  const html = dash(Q, { ok: true, pulse: { ...PULSE.pulse, syncFailed: 2 } });
  assert.match(html, /Not in record/);
  assert.ok(html.includes('data-q-act="reconcile"'), "the retry is right there");
  assert.ok(!/Not in record/.test(dash(Q, PULSE)), "and absent when every visit landed");
});

test("rooms that could not be read are flagged rather than quietly making the day look light", () => {
  const Q = loadQueue();
  const html = dash(Q, { ...PULSE, unread: ["Room 3"] });
  assert.match(html, /Room 3/);
});
