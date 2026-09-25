/* test/energy-timers.test.mjs — static pins for the branch `energy-timers` battery fixes.
 *
 * Each pin below guards a change that ONLY affects battery draw while the tab/app is backgrounded
 * — no visible behaviour, speed, or function is supposed to move. If a pin here breaks, either the
 * fix regressed back to a forever-poll, or the source moved and the pin needs updating — check which.
 *
 * node --test test/energy-timers.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => readFileSync(join(ROOT, f), "utf8");

test("workspaces.js: #dxOverlay attach uses a body MutationObserver, not a 400ms forever-poll", () => {
  const s = src("workspaces.js");
  assert.match(s, /new MutationObserver\(function \(\) \{ if \(attach\(\)\) bodyObs\.disconnect\(\); \}\)/,
    "watchDx() should observe document.body and disconnect once #dxOverlay is found");
  assert.doesNotMatch(s, /var ov = document\.getElementById\("dxOverlay"\); if \(!ov\) return setTimeout\(attach, 400\);/,
    "the old unconditional setTimeout(attach, 400) poll should be gone");
  assert.match(s, /bodyObs\.observe\(document\.body, \{ childList: true \}\);/, "observer must be childList-only, no subtree");
});

test("swipe-back.js: the 900ms handle-sync poll skips while the tab is hidden", () => {
  const s = src("swipe-back.js");
  assert.match(s, /setInterval\(function \(\) \{ if \(document\.hidden\) return; syncHandle\(\); \}, 900\);/);
});

test("onboarding.js: the 700ms ICU-tip poll skips while the tab is hidden", () => {
  const s = src("onboarding.js");
  assert.match(s, /setInterval\(function \(\) \{\s*if \(document\.hidden\) return;\s*if \(!flagOn\(\)\) return;/);
});

test("rxchoice-autopilot.js: the 1s readiness poll skips while the tab is hidden", () => {
  const s = src("rxchoice-autopilot.js");
  assert.match(s, /setInterval\(function \(\) \{ if \(document\.hidden\) return; schedule\(\); \}, 1000\);/);
});

test("guest-timer.js: the 1s countdown poll skips while hidden, and stops entirely once not a guest", () => {
  const s = src("guest-timer.js");
  assert.match(s, /timer = setInterval\(function \(\) \{ if \(document\.hidden\) return; tick\(\); \}, 1000\);/);
  assert.match(s, /function stop\(\) \{ if \(timer\) \{ clearInterval\(timer\); timer = null; \} \}/);
  assert.match(s, /if \(ms === null\) \{ if \(bar\(\)\) \{ unmount\(\); lastAnnounced = null; \} stop\(\); return; \}/,
    "tick() must stop the interval once msLeft() goes null (signed in / no guest)");
  assert.match(s, /closest\("#guestBtn"\)\) start\(\);/, "a #guestBtn click must re-arm the timer for a fresh guest session");
});

test("icu-collab.js: the 20s presence heartbeat is a no-op while the tab is hidden", () => {
  const s = src("icu-collab.js");
  assert.match(s, /function writePresence\(\) \{\s*if \(!_presence\.gid \|\| !_presence\.pid\) return;\s*if \(document\.hidden\) return;/);
  // The wake-up side was already there: re-beat immediately on becoming visible.
  assert.match(s, /if \(!document\.hidden && _presence\.gid && _presence\.pid\) writePresence\(\);/);
});

test("account.js: the guest-gate MutationObserver disconnects once #guestBlock/#guestBtn is found", () => {
  const s = src("account.js");
  assert.match(s, /guestGateObs\.disconnect\(\);/);
  assert.doesNotMatch(s, /new MutationObserver\(enforceGuestGate\)\.observe\(document\.documentElement/,
    "the old bare forever-observer should be gone");
});

test("verify.js: the auth-wait MutationObserver disconnects once wire() has run", () => {
  const s = src("verify.js");
  assert.match(s, /if \(fbUser\(\)\) \{ wire\(\); wireObs\.disconnect\(\); \}/);
});

test("email-auth.js: the accountGate-button MutationObserver disconnects once the button exists", () => {
  const s = src("email-auth.js");
  assert.match(s, /function gateButtonWired\(\) \{ return !!document\.querySelector\("#accountGate \.account-card #smdEmailBtn"\); \}/);
  assert.match(s, /if \(gateButtonWired\(\)\) mo\.disconnect\(\);/);
});

test("native-auth.js: left untouched — GIS renders/re-renders its Google button asynchronously, so the observer's job is never provably finished", () => {
  const s = src("native-auth.js");
  assert.match(s, /new MutationObserver\(tickUI\)\.observe\(document\.documentElement, \{ childList: true, subtree: true \}\);/);
});

test("index.html: ?v= cache-bust tokens were bumped for every changed script", () => {
  const html = src("index.html");
  const bumped = ["workspaces.js", "swipe-back.js", "onboarding.js", "guest-timer.js", "verify.js", "email-auth.js", "account.js", "icu-collab.js"];
  for (const f of bumped) {
    const m = html.match(new RegExp('src="/' + f.replace(".", "\\.") + '\\?v=([^"]+)"'));
    assert.ok(m, f + " should still be referenced with a ?v= token");
    assert.match(m[1], /energy1/, f + "'s ?v= token should carry the energy-timers bump");
  }
});

test("rxchoice-flags.js: the dynamically-loaded rxchoice-autopilot.js ?v= token was bumped", () => {
  const s = src("rxchoice-flags.js");
  assert.match(s, /rxchoice-autopilot\.js\?v=rxc3-energy1/);
});
