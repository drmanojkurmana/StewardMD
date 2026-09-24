/* test/llama-native-safety.test.mjs - native invariants of the capacitor-llama plugin that no JS test
 * can exercise (audit 2026-09-25). CI has no Xcode or NDK, so these pin the SOURCE; the behaviour
 * still needs the device checks listed in each commit.
 *
 *   T12  iOS: load and release run on the engine's serial work queue, so a release can never free
 *        the model under a running generation; isGenerating is read under the lock.
 *   T54  UTF-8 split across tokens is buffered, never decoded half a character at a time.
 *   T55  repetition penalty 1.05 on both platforms, still present. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const P = "../local-plugins/capacitor-llama/";
const ENG = readFileSync(new URL(P + "ios/Sources/LlamaPlugin/LlamaEngine.swift", import.meta.url), "utf8");
const PLUG = readFileSync(new URL(P + "ios/Sources/LlamaPlugin/LlamaPlugin.swift", import.meta.url), "utf8");
const JNI = readFileSync(new URL(P + "android/src/main/cpp/llama_jni.cpp", import.meta.url), "utf8");
const AJ = readFileSync(new URL(P + "android/src/main/java/in/stewardmd/llama/LlamaPlugin.java", import.meta.url), "utf8");

test("T12 iOS: release is an async barrier on the work queue; load waits on it; isGenerating is locked", () => {
  const rel = ENG.slice(ENG.indexOf("func release(completion:"), ENG.indexOf("private func releaseLocked"));
  assert.match(rel, /work\.async/);
  assert.doesNotMatch(ENG, /func release\(\) \{ lock\.lock\(\); releaseLocked\(\)/, "the old main-thread free is gone");
  const load = ENG.slice(ENG.indexOf("func load(path:"), ENG.indexOf("private func loadOnWork"));
  assert.match(load, /try work\.sync \{/);
  assert.match(load, /dispatchPrecondition\(condition: \.notOnQueue\(work\)\)/);
  assert.match(ENG, /var isGenerating: Bool \{ lock\.lock\(\); defer \{ lock\.unlock\(\) \}; return generating \}/);
  assert.match(ENG, /defer \{ lock\.lock\(\); generating = false; lock\.unlock\(\) \}/);
  assert.match(PLUG, /engine\.release \{ call\.resolve\(\["released": true\]\) \}/, "the JS release() resolves once the model is really freed");
});

test("T12 Android already serialises load, generate and release on ONE single-thread executor", () => {
  assert.match(AJ, /Executors\.newSingleThreadExecutor\(\)/);
  const rel = AJ.slice(AJ.indexOf("public void release(PluginCall call)"), AJ.indexOf("public void release(PluginCall call)") + 300);
  assert.match(rel, /worker\.execute/);
});

test("T54: tokens are buffered as bytes until a character boundary, on both platforms", () => {
  assert.match(ENG, /pendingUtf8 \+= Self\.pieceBytes\(vocab: vocab, token: id\)/);
  assert.match(ENG, /static func completeUtf8Prefix/);
  assert.doesNotMatch(ENG, /String\(decoding: buf\.prefix/, "no per-token decode left");
  assert.match(JNI, /static size_t utf8_complete_prefix/);
  assert.match(JNI, /pend \+= piece;/);
  assert.equal((JNI.match(/full\.resize\(utf8_complete_prefix\(full\)\)/g) || []).length >= 2, true, "returned text never ends in half a character");
});

test("T59: backgrounding lets an in-flight answer finish (iOS 25 s background task, Android 20 s), then releases", () => {
  assert.match(PLUG, /beginBackgroundTask\(withName: "maik-answer"\)/);
  assert.match(PLUG, /bgGraceSeconds: TimeInterval = 25/);
  assert.match(PLUG, /applicationState == \.background/, "an answer that finishes in the background still releases the model");
  assert.match(AJ, /PAUSE_GRACE_SECONDS = 20/);
  assert.match(AJ, /protected void handleOnResume\(\)/);
  assert.match(AJ, /pauseScheduler\.schedule\(this::cancelAndRelease, PAUSE_GRACE_SECONDS, TimeUnit\.SECONDS\)/);
  assert.match(AJ, /\.put\("totalMemory", totalMem\)/, "T61: Android reports total RAM too");
});

test("T55: repetition penalty is 1.05 on both platforms and still in every chain", () => {
  assert.match(ENG, /static let repeatPenalty: Float = 1\.05/);
  assert.match(ENG, /llama_sampler_init_penalties\(\s*llama_vocab_n_tokens\(vocab\), 128, Self\.repeatPenalty/);
  assert.match(JNI, /static const float kRepeatPenalty = 1\.05f;/);
  assert.equal((JNI.match(/llama_sampler_init_penalties\(/g) || []).length, 2);
  assert.equal((JNI.match(/kRepeatPenalty, 0\.0f|penalty_repeat=\*\/kRepeatPenalty/g) || []).length, 2);
  assert.doesNotMatch(ENG + JNI, /1\.15f?, 0\.0/);
});
