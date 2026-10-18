/* codeblue-native.test.mjs: native audio delegation, cue schedule, watch link.
 * Fake Capacitor.Plugins.WatchBridge injected before load. */
import { test } from "node:test";
import assert from "node:assert/strict";
import Live from "../codeblue-live.js";

const E = Live._engine;
let seq = 0;

function fakePlugin(opts = {}) {
  const calls = [];
  const listeners = {};
  const plugin = {
    calls, listeners,
    audioBegin: async () => { calls.push(["audioBegin"]); if (opts.beginReject) throw new Error("no"); return { active: opts.active !== false }; },
    audioEnd: async () => { calls.push(["audioEnd"]); },
    audioConfigure: async (a) => { calls.push(["audioConfigure", a]); },
    audioMutes: async (a) => { calls.push(["audioMutes", a]); },
    audioMetronome: async (a) => { calls.push(["audioMetronome", a]); },
    audioBreaths: async (a) => { calls.push(["audioBreaths", a]); },
    audioTone: async (a) => { calls.push(["audioTone", a]); },
    audioSpeak: async (a) => { calls.push(["audioSpeak", a]); },
    audioSetCues: async (a) => { calls.push(["audioSetCues", a]); },
    codeBlueGetState: async () => { calls.push(["codeBlueGetState"]); return opts.state || { running: false, rosc: false, elapsed: 0, receivedAtMs: Date.now(), mode: "adult", events: [] }; },
    codeBlueLog: async (a) => { calls.push(["codeBlueLog", a]); },
    openCodeBlue: async () => { calls.push(["openCodeBlue"]); },
    addListener: (name, cb) => { (listeners[name] ||= []).push(cb); return Promise.resolve({ remove: async () => {} }); },
    emit: (name, data) => { (listeners[name] || []).forEach((cb) => cb(data)); },
  };
  return plugin;
}

async function freshAudio(plugin) {
  seq += 1;
  globalThis.window = globalThis;
  globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: { WatchBridge: plugin } };
  const mod = await import(`../codeblue-audio.js?v=${seq}`);
  const A = mod.default || mod;
  return A;
}
function clearNative() { delete globalThis.Capacitor; }

test("audio delegation: each function calls right native method, no Web Audio", async () => {
  const plugin = fakePlugin();
  let acCreated = 0;
  globalThis.AudioContext = class { constructor() { acCreated++; this.state = "running"; } createGain() { return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} }, connect() {} }; } createOscillator() { return { type: "", frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; } resume() {} };
  const A = await freshAudio(plugin);
  const ok = await A.unlock();
  assert.equal(ok, true); assert.equal(A.nativeActive(), true);
  plugin.calls.length = 0;
  A.startMetronome(); assert.deepEqual(plugin.calls.at(-1), ["audioMetronome", { on: true }]);
  A.stopMetronome(); assert.deepEqual(plugin.calls.at(-1), ["audioMetronome", { on: false }]);
  A.startBreathTicks(); assert.deepEqual(plugin.calls.at(-1), ["audioBreaths", { on: true, intervalSeconds: 6 }]);
  A.stopBreathTicks(); assert.deepEqual(plugin.calls.at(-1), ["audioBreaths", { on: false, intervalSeconds: 6 }]);
  A.breathTick(); assert.deepEqual(plugin.calls.at(-1), ["audioTone", { kind: "breath" }]);
  A.threeCount(); assert.deepEqual(plugin.calls.at(-1), ["audioTone", { kind: "threeCount" }]);
  A.overdueTone(); assert.deepEqual(plugin.calls.at(-1), ["audioTone", { kind: "overdue" }]);
  A.resetOverdueTone(); assert.deepEqual(plugin.calls.at(-1), ["audioTone", { kind: "resetOverdue" }]);
  assert.equal(A.speak("epiDue"), true); assert.deepEqual(plugin.calls.at(-1), ["audioSpeak", { text: "Epinephrine due" }]);
  A.setMuted("voice", true); assert.deepEqual(plugin.calls.at(-1), ["audioMutes", { voice: true, metronome: false, breaths: false }]);
  A.setMuted("voice", false);
  A.setMetronomeBpm(115); assert.deepEqual(plugin.calls.at(-1), ["audioConfigure", { bpm: 115, voiceRate: 1, lowAlert: true }]);
  A.setVoiceRate(1.2); assert.equal(plugin.calls.at(-1)[1].voiceRate, 1.2);
  A.setLowAlert(false); assert.equal(plugin.calls.at(-1)[1].lowAlert, false); A.setLowAlert(true);
  assert.equal(A.setCues([{ atMs: 123, speak: "Epinephrine due" }]), true);
  assert.deepEqual(plugin.calls.at(-1), ["audioSetCues", { cues: [{ atMs: 123, speak: "Epinephrine due" }] }]);
  assert.equal(acCreated, 0, "Web Audio context must not be created while native");
  A.shutdown();
  assert.ok(plugin.calls.some((c) => c[0] === "audioEnd"));
  assert.deepEqual(plugin.calls.filter((c) => c[0] === "audioSetCues").at(-1), ["audioSetCues", { cues: [] }]);
  delete globalThis.AudioContext; clearNative();
});

test("audio fallback when audioBegin returns active:false", async () => {
  const plugin = fakePlugin({ active: false });
  const A = await freshAudio(plugin);
  await A.unlock();
  assert.equal(A.nativeActive(), false);
  assert.equal(A.setCues([{ atMs: 1 }]), false);
  clearNative();
});

test("audio fallback when audioBegin rejects", async () => {
  const plugin = fakePlugin({ beginReject: true });
  const A = await freshAudio(plugin);
  await A.unlock();
  assert.equal(A.nativeActive(), false);
  assert.equal(A.setCues([]), false);
  clearNative();
});

test("cue schedule: rhythm soon/due from cycleStart with headsUp", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  const cues = E.nativeCueSchedule(s, 0, { nowMs: 1000000, intervalSec: 120, headsUpSec: 30, epiIntervalMin: 4 });
  assert.ok(cues.some((c) => c.atMs === 1000000 + 90000 && c.speak === "Rhythm check in ten seconds"));
  assert.ok(cues.some((c) => c.atMs === 1000000 + 120000 && c.speak === "Rhythm check. Switch compressor"));
});

test("cue schedule: epinephrine due 180 and overdue 300 from logged dose", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  E.logEvent(s, "drug", "Epinephrine", 60);
  const cues = E.nativeCueSchedule(s, 60, { nowMs: 5000, intervalSec: 120, headsUpSec: 30, epiIntervalMin: 4 });
  assert.ok(cues.some((c) => c.atMs === 5000 + 180000 && c.speak === "Epinephrine due"));
  const od = cues.find((c) => c.tone === "overdue");
  assert.ok(od && od.atMs === 5000 + 300000 && od.speak === "Epinephrine overdue");
});

test("cue schedule: empty on pause, ROSC, end state and none in training", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  assert.deepEqual(E.nativeCueSchedule(s, 0, { nowMs: 0, paused: true }), []);
  assert.deepEqual(E.nativeCueSchedule(s, 0, { nowMs: 0, rosc: true }), []);
  const t = E.newSession("adult", { wallNow: 0, training: true });
  assert.deepEqual(E.nativeCueSchedule(t, 0, { nowMs: 0 }), []);
  s.rosc = true; assert.deepEqual(E.nativeCueSchedule(s, 0, { nowMs: 0 }), []);
});

test("cue schedule: headsUp off removes soon cue, rhythm after logged rhythm restarts", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  E.logEvent(s, "rhythm", "VF", 120);
  const cues = E.nativeCueSchedule(s, 120, { nowMs: 0, intervalSec: 120, headsUpSec: 0 });
  assert.ok(!cues.some((c) => c.speak === "Rhythm check in ten seconds"));
  assert.ok(cues.some((c) => c.atMs === 120000 && c.speak === "Rhythm check. Switch compressor"));
});

test("watch mapping: kinds, w- prefix, source, unknown skipped", () => {
  assert.equal(E.mapWatchEvent({ id: "1", elapsed: 5, kind: "bogus", label: "X" }), null);
  const ev = E.mapWatchEvent({ id: "42", elapsed: 65.9, kind: "shock", label: "Shock delivered" });
  assert.deepEqual(ev, { id: "w-42", elapsed: 65, kind: "shock", label: "Shock delivered", source: "watch", edited: false });
  assert.equal(E.mapWatchEvent({ id: "w-7", elapsed: 1, kind: "cprStart" }).id, "w-7");
  assert.equal(E.mapWatchEvent({ id: "9", elapsed: 1, kind: "switchCompressor" }).kind, "switchCompressor");
});

test("watch merge by id: no duplicates, out-of-order sorted", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  const a = E.mergeWatchEvents(s, [
    { id: "2", elapsed: 120, kind: "drug", label: "Epinephrine" },
    { id: "1", elapsed: 10, kind: "shock", label: "Shock delivered" },
  ]);
  assert.equal(a.length, 2);
  assert.deepEqual(s.events.map((e) => e.id), ["w-1", "w-2"]);
  const b = E.mergeWatchEvents(s, [
    { id: "1", elapsed: 10, kind: "shock", label: "Shock delivered" },
    { id: "3", elapsed: 60, kind: "rhythm", label: "VF" },
  ]);
  assert.equal(b.length, 1); assert.equal(s.events.length, 3);
  assert.deepEqual(E.computeCounts(s.events), { epi: 1, shocks: 1 });
});

test("watch elapsed uses receivedAtMs", () => {
  assert.equal(E.watchElapsed({ elapsed: 252, receivedAtMs: 10000 }, 15000), 257);
  assert.equal(E.watchElapsed({ elapsed: 10, receivedAtMs: 20000 }, 15000), 10);
});

test("join seed: back-dated start, mode, counts from events", () => {
  const now = 100000;
  const built = E.buildWatchSession({ running: true, rosc: false, elapsed: 252, receivedAtMs: now, mode: "paediatric", events: [
    { id: "1", elapsed: 5, kind: "cprStart", label: "CPR started" },
    { id: "2", elapsed: 30, kind: "shock", label: "Shock delivered" },
    { id: "3", elapsed: 60, kind: "drug", label: "Epinephrine" },
  ] }, now);
  assert.equal(built.elapsed, 252);
  assert.equal(built.session.mode, "paediatric");
  assert.equal(built.session.createdWall, now - 252000);
  assert.deepEqual(E.computeCounts(built.session.events), { epi: 1, shocks: 1 });
  assert.ok(built.session.events.every((e) => e.source === "watch" && e.id.startsWith("w-")));
});

test("drift rule data: over 2s differs, under does not (watchElapsed basis)", () => {
  const st = { elapsed: 100, receivedAtMs: 0 };
  assert.ok(Math.abs(E.watchElapsed(st, 5000) - 102) > 2);
  assert.ok(Math.abs(E.watchElapsed(st, 5000) - 104) <= 2);
});
