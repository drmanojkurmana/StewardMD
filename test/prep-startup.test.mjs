// PrepNucleus startup logo reveal (prep-startup.js): orientation selection, stills/MP4s shipped, kill switches, deep-link bypass, hooks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import vm from "node:vm";

const R = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const PS = R("prep-startup.js");

function bootWin(opts = {}) {
  const store = Object.assign({}, opts.store || {});
  const win = {
    innerWidth: opts.w || 390,
    innerHeight: opts.h || 844,
    location: { search: opts.search || "" },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    SMD_PREP_ONBOARD: opts.onboard,
    SMD_PREP_STARTUP: opts.startup,
    document: { createElement: () => ({ style: {}, setAttribute: () => {} }) }
  };
  vm.runInNewContext(PS, { window: win });
  return win;
}

test("vertical and horizontal clips and start/end stills exist and build-www ships them", () => {
  for (const k of ["v", "h"]) {
    const mp4 = statSync(new URL(`../prep/startup/prep-startup-${k}.mp4`, import.meta.url));
    assert.ok(mp4.size > 500_000 && mp4.size < 12_000_000, `${k} mp4 reasonable size: ${mp4.size}`);
    for (const s of ["start", "end"]) {
      const wp = statSync(new URL(`../prep/startup/prep-startup-${k}-${s}.webp`, import.meta.url));
      assert.ok(wp.size > 5_000, `${k}-${s} webp exists`);
    }
  }
  assert.match(R("scripts/build-www.sh"), /cp prep\/startup\/\* "\$WWW\/prep\/startup\/"/);
  assert.match(R("index.html"), /<script src="\/prep-startup\.js\?v=[^"]+" defer><\/script>/);
});

test("orientation picks vertical on portrait and horizontal on landscape", () => {
  assert.equal(bootWin({ w: 390, h: 844 }).PREP_STARTUP.orientKey(), "v");
  assert.equal(bootWin({ w: 820, h: 1180 }).PREP_STARTUP.orientKey(), "v");
  assert.equal(bootWin({ w: 1180, h: 820 }).PREP_STARTUP.orientKey(), "h");
  assert.equal(bootWin({ w: 844, h: 390 }).PREP_STARTUP.orientKey(), "h");
});

test("willPlay enables plain opens, skips deep links and honors kill switches", () => {
  const on = bootWin({ w: 390, h: 844 }).PREP_STARTUP;
  assert.equal(on.willPlay(), true);
  assert.equal(on.willPlay({}), true);
  for (const deep of [{ id: "PN-1" }, { subject: "anatomy" }, { lesson: { s: "anatomy", m: "x" } }, { query: "stroke" }, { mode: "mistakes" }, { play: "feed" }, { social: "friends" }]) {
    assert.equal(on.willPlay(deep), false, "skip deep link " + JSON.stringify(deep));
  }
  assert.equal(bootWin({ store: { smd_prep_startup: "0" } }).PREP_STARTUP.willPlay(), false);
  assert.equal(bootWin({ search: "?prepstartup=0" }).PREP_STARTUP.willPlay(), false);
  assert.equal(bootWin({ store: { smd_prep_startup: "0" }, search: "?prepstartup=1" }).PREP_STARTUP.willPlay(), true);
  assert.equal(bootWin({ startup: false }).PREP_STARTUP.willPlay(), false);
  assert.equal(bootWin({ onboard: false }).PREP_STARTUP.willPlay(), false);
  assert.equal(bootWin({ onboard: false, startup: true }).PREP_STARTUP.willPlay(), true);
});

test("due() helper throttles repeated opens on same calendar day under 3 hours", () => {
  const { due } = bootWin().PREP_STARTUP;
  const now = new Date(2026, 10, 26, 14, 0, 0).getTime();

  // due() for no history
  assert.equal(due(null, now), true);
  assert.equal(due(0, now), true);
  assert.equal(due(undefined, now), true);

  // 10 min ago same day (false)
  assert.equal(due(now - 10 * 60 * 1000, now), false);

  // 2 h 59 min (false)
  assert.equal(due(now - (2 * 60 + 59) * 60 * 1000, now), false);

  // 3 h (true)
  assert.equal(due(now - 3 * 60 * 60 * 1000, now), true);

  // yesterday 23:50 opened at 00:10 (true)
  const yest = new Date(2026, 10, 25, 23, 50, 0).getTime();
  const todayEarly = new Date(2026, 10, 26, 0, 10, 0).getTime();
  assert.equal(due(yest, todayEarly), true);
});

test("willPlay false right after noteOpen(), and ?prepstartup=1 forces true", () => {
  const win = bootWin({ w: 390, h: 844 });
  assert.equal(win.PREP_STARTUP.willPlay(), true);
  win.PREP_STARTUP.noteOpen();
  assert.equal(win.PREP_STARTUP.willPlay(), false);

  const winForced = bootWin({ w: 390, h: 844, search: "?prepstartup=1" });
  winForced.PREP_STARTUP.noteOpen();
  assert.equal(winForced.PREP_STARTUP.willPlay(), true);

  // Storage failure keeps today's behaviour: play
  const winThrow = bootWin({ w: 390, h: 844 });
  winThrow.localStorage.getItem = () => { throw new Error("SecurityError"); };
  assert.equal(winThrow.PREP_STARTUP.willPlay(), true);
});

test("blending, motion opt-outs, PiP opt-out, and loader/home/prep hooks are wired", () => {
  assert.match(PS, /data-own-motion/);
  assert.match(PS, /data-no-motion/);
  assert.match(PS, /disablepictureinpicture/);
  assert.match(PS, /playsinline webkit-playsinline/);
  assert.match(PS, /object-fit:cover/);
  assert.doesNotMatch(PS, /radial-gradient|blur\(/, "no glow or blur layers");
  assert.match(R("prep-loader.js"), /p\.opened \? p\.opened\(\)/, "app opens under the clip");
  assert.match(R("prep.js"), /opened: function \(\) \{ return st\.openP/);
  assert.match(PS, /<video muted /);
  assert.doesNotMatch(PS, /psv-skip|psv-snd/);
  assert.doesNotMatch(PS, /[–—]/);
  assert.match(R("prep-loader.js"), /PREP_STARTUP\.play/);
  assert.match(R("home.js"), /PREP_STARTUP\.willPlay/);
  assert.match(R("prep.js"), /PREP_STARTUP\.play/);
  assert.match(R("prep.js"), /PREP_STARTUP\.abort/);
  assert.match(R("prep.js"), /PREP_STARTUP\.skip/);
});
