/* The web console's copy of the OPD pulse (stewardmd.in/opd, opd.html).
 *
 * opd.html is a standalone console: one file, its own inline script, no shared bundle with queue.js.
 * That is a deliberate deployment choice and it has one cost - the pulse card exists twice, so the two
 * can drift, and the realistic way they drift is a mistyped field (over60, abandonedPct, longestMin):
 * the card then renders with a hole in it and nothing fails anywhere.
 *
 * So this runs the SHIPPED SOURCE of the web console's own renderer - lifted out of opd.html as text,
 * never re-typed here - against the same fixture the app's card is tested with, and checks the same
 * three things a clinic would otherwise read wrongly: a failed read is not a quiet OPD, "not yet" is
 * not 0%, and an hour in the hall is visibly different.
 *
 * node --test test/opd-web-pulse-render.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HTML = readFileSync(fileURLToPath(new URL("../opd.html", import.meta.url)), "utf8");

/** The console's own pnum + pulseInner, exactly as they ship, with only esc and st supplied. */
function loadWebPulse(pulse) {
  const from = HTML.indexOf("function pnum(");
  const end = HTML.indexOf("\n  function ", HTML.indexOf("function pulseInner()"));
  assert.ok(from > -1 && end > from, "the pulse renderer is still in opd.html");
  const sandbox = { st: { pulse }, esc: (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])) };
  vm.createContext(sandbox);
  vm.runInContext(HTML.slice(from, end), sandbox);
  return sandbox.pulseInner();
}

const PULSE = {
  ok: true,
  pulse: {
    registered: 34, waiting: 6, inConsultation: 1, completed: 25, noShow: 2, held: 3, recalls: 1,
    doorToDoctor: { medianMin: 22, p90Min: 74, n: 26 },
    deskWait: { medianMin: 6, p90Min: 20, n: 26 },
    doctorWait: { medianMin: 16, p90Min: 58, n: 26 },
    waitingNow: { longestMin: 68, medianMin: 24, over30: 3, over60: 1 },
    abandonedPct: 7,
  },
};

test("the desk sees the same day the doctor does: every figure reaches the web console too", () => {
  const html = loadWebPulse(PULSE);
  assert.match(html, /In the hall/);
  assert.match(html, />6</, "six in the hall");
  assert.match(html, /longest 68m/);
  assert.match(html, /3 over 30m/);
  assert.match(html, /9 in 10 within 74m/);
  assert.match(html, /2 no-shows/);
  assert.match(html, /Awaiting result/);
  assert.match(html, /Desk 6<u>m<\/u>, doctor 16<u>m<\/u>/);
  assert.match(html, /the wait is for the doctor/);
});

test("a failed read says so on the desk's screen as well", () => {
  const html = loadWebPulse({ failed: true });
  assert.match(html, /Could not read the OPD figures/);
  assert.ok(!/In the hall/.test(html));
});

test("before anybody finishes it reads not yet, and an hour waiting takes the warning colour", () => {
  const morning = { ok: true, pulse: { ...PULSE.pulse, completed: 0, noShow: 0, abandonedPct: null, doorToDoctor: { medianMin: null, p90Min: null, n: 0 }, waitingNow: { longestMin: 9, medianMin: 5, over30: 0, over60: 0 } } };
  const calm = loadWebPulse(morning);
  assert.match(calm, /not yet/);
  assert.ok(!/0<u>%<\/u>/.test(calm));
  assert.ok(!/p-t warn/.test(calm), "a clinic running well carries no warning colour");
  assert.match(loadWebPulse(PULSE), /p-t warn/, "an hour in the hall does");
});

test("rooms that could not be read are named, so a light-looking day is never taken at face value", () => {
  assert.match(loadWebPulse({ ...PULSE, unread: ["Room 3"] }), /Room 3/);
});
