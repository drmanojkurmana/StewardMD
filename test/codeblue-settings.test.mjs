import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Prefs = require("../codeblue-prefs.js");

test("settings registry: search matches label, group and keywords", () => {
  assert.ok(Prefs.searchSettings("compression").some((s) => s.id === "compressionRate"));
  assert.ok(Prefs.searchSettings("epinephrine").some((s) => s.id === "epiIntervalMin"));
  assert.ok(Prefs.searchSettings("voice").length >= 2);
  assert.equal(Prefs.searchSettings("zzz-no-match").length, 0);
  assert.equal(Prefs.searchSettings("").length, Prefs.SETTINGS.length);
});

test("settings defaults match the brief", () => {
  const d = Prefs._defaults();
  assert.equal(d.compressionRate, 110);
  assert.equal(d.cycleMin, 2);
  assert.equal(d.headsUpSec, 30);
  assert.equal(d.autoResumeSec, 6);
  assert.equal(d.epiIntervalMin, 4);
  assert.equal(d.shockWaveform, "biphasic");
  assert.equal(d.voice, true);
  assert.equal(d.metronome, true);
});

test("settings persist and clamp, old prefs still load", () => {
  Prefs.reset();
  Prefs.set({ compressionRate: 999 });
  assert.equal(Prefs.get().compressionRate, 120);
  Prefs.set({ compressionRate: 105, favCards: ["hsts"] });
  assert.equal(Prefs.get().compressionRate, 105);
  assert.deepEqual(Prefs.get().favCards, ["hsts"]);
  // old stored shape without new fields keeps defaults for them
  const n = Prefs._normalise({ theme: "ward-light", textScale: 110 });
  assert.equal(n.theme, "ward-light");
  assert.equal(n.compressionRate, 110);
});

test("reset restores settings defaults", () => {
  Prefs.set({ compressionRate: 120, voice: false });
  Prefs.reset();
  assert.equal(Prefs.get().compressionRate, 110);
  assert.equal(Prefs.get().voice, true);
  assert.deepEqual(Prefs.get(), Prefs._defaults());
});

const Live = require("../codeblue-live.js");
const Audio = require("../codeblue-audio.js");
const E = Live._engine;

test("cycle length setting changes cycleInfo, neonatal stays mode default in UI opts", () => {
  assert.equal(E.cycleInfo("adult", 119, 0, { intervalSec: 180 }).due, false);
  assert.equal(E.cycleInfo("adult", 180, 0, { intervalSec: 180 }).due, true);
  assert.equal(E.cycleInfo("adult", 120, 0).due, true);
});

test("epinephrine interval setting shifts due and overdue, default unchanged", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  E.logEvent(s, "drug", "Epinephrine", 0);
  assert.equal(E.epiStatus(s, 180).state, "due");
  assert.equal(E.epiStatus(s, 300).state, "overdue");
  assert.equal(E.epiStatus(s, 179, { epiIntervalMin: 5 }).state, "countdown");
  assert.equal(E.epiStatus(s, 240, { epiIntervalMin: 5 }).state, "due");
  assert.equal(E.epiStatus(s, 360, { epiIntervalMin: 5 }).state, "overdue");
  assert.equal(E.epiStatus(s, 120, { epiIntervalMin: 3 }).state, "due");
});

test("audio settings setters clamp and report", () => {
  Audio._reset();
  assert.equal(Audio.setMetronomeBpm(999), 120);
  assert.equal(Audio.metronomeBpm(), 120);
  assert.equal(Audio.setMetronomeBpm(105), 105);
  assert.equal(Audio.setVoiceRate(2), 1.5);
  assert.equal(Audio.voiceRate(), 1.5);
  assert.equal(Audio.setLowAlert(false), false);
  assert.equal(Audio.lowAlert(), false);
  Audio._reset();
  assert.equal(Audio.metronomeBpm(), 110);
});
