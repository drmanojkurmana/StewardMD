/* Regression guard for the ICU group-connect resilience fixes (2026-07-29).
 *
 * Each of these invariants was silently re-broken by unrelated changes at least once, and every
 * time it wedged the ICU shared-units board on "Connecting to your shared units…" forever (or
 * showed a scary false error). This guard fails `npm test` if any of them regresses, so future
 * bug fixes can't quietly undo them:
 *
 *   1. native-bridge.js must route Firestore (firestore.googleapis.com) OFF the CapacitorHttp patch
 *      for BOTH transports — fetch (#563) AND XMLHttpRequest. Firestore's realtime "Listen" channel
 *      uses XHR (WebChannel long-poll); CapacitorHttp's patched XHR mangles it → HTTP 400 →
 *      "transport errored" → retry storm → shared units never load.
 *   2. icu.js must keep a watchdog on the group subscription, so a silent connect hang surfaces the
 *      "Couldn't reach the unit — Retry" card instead of an endless spinner.
 *   3. The "nudge" (task-remind) must render "no residents on the unit yet" as a CALM info note,
 *      never an alarming "push service unreachable" error (that state is normal for a solo head).
 *
 * USAGE: node test/icu-connect-resilience.test.mjs   (also runs under `npm test`).
 */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const nb = fs.readFileSync(join(ROOT, "native-bridge.js"), "utf8");
const icu = fs.readFileSync(join(ROOT, "icu.js"), "utf8");

// ── 1. Firestore transport bypasses the CapacitorHttp patch on native (both fetch AND XHR) ──
ok(/firestore\.googleapis\.com/.test(nb) && /_nativeFetch\s*\(/.test(nb),
  "native-bridge routes Firestore FETCH through the pristine native fetch (#563)");
ok(/createElement\((["'])iframe\1\)/.test(nb) && /contentWindow(\s*&&|\.)/.test(nb) && /XMLHttpRequest/.test(nb),
  "native-bridge routes Firestore XHR through a pristine (un-patched) XMLHttpRequest from an iframe");
ok(/getPlatform|_platX/.test(nb) && /"android"|'android'/.test(nb) && /"ios"|'ios'/.test(nb),
  "the native transport diversions are gated to android/ios (web keeps the platform transport)");

// ── 2. ICU group-connect watchdog (no infinite 'Connecting…' spinner) ──
ok(/_grpConnTO/.test(icu), "icu.js declares the group-connect watchdog (_grpConnTO)");
ok(/_grpConnTO\s*=\s*setTimeout/.test(icu), "the watchdog is armed with setTimeout before subscribeGroups");
ok(/_grpConnTO[\s\S]{0,500}_grpErr\s*=/.test(icu),
  "on timeout the watchdog sets _grpErr → the existing Retry error card shows (not an endless spinner)");

// ── 3. Nudge 'no residents' is a calm info note, not a false error ──
ok(/No residents on this unit to remind yet/.test(icu),
  "the no-residents nudge result shows a calm, accurate note");
ok(!/no resident is on this unit yet, or the push service is unreachable/.test(icu),
  "the misleading 'push service is unreachable' copy for the no-residents case is gone");
ok(/note\(\s*(["'])none\1\s*,\s*(["'])No residents on this unit to remind yet/.test(icu),
  "the no-residents note is emitted as kind 'none' (calm), never kind 'error'");

console.log(fails ? `\n❌ ${fails} check(s) failed` : "\n✅ All ICU connect-resilience guards passed");
process.exit(fails ? 1 : 0);
