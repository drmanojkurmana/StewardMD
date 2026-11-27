/* Regression tests for review items 11 (iOS PdfOcrJob.swift) and 12 (Android PdfOcrJob.kt).
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite test/research-ondevice-native-plugin.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = new URL("..", import.meta.url);
const readSrc = (rel) => fs.readFileSync(new URL(rel, ROOT), "utf8");
const absPath = (rel) => fileURLToPath(new URL(rel, ROOT));

function extractSwiftMethod(src, sig) {
  const idx = src.indexOf(sig);
  assert.notEqual(idx, -1, "Missing method: " + sig);
  const start = src.indexOf("{", idx);
  assert.notEqual(start, -1);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(idx, i + 1);
    }
  }
  throw new Error("Unbalanced braces for " + sig);
}

describe("Item 11: iOS PdfOcrJob.swift synchronization, pending bgTask, and start/resume safety", () => {
  const swiftPath = "local-plugins/capacitor-vision-ocr/ios/Sources/VisionOcrPlugin/PdfOcrJob.swift";

  test("tracks pending BGContinuedProcessingTaskRequest and checks it in appDidEnterBackground", () => {
    const src = readSrc(swiftPath);
    assert.match(src, /var\s+bgTaskPending\b/, "Job must track pending BGContinuedProcessingTaskRequest");
    const bgMethod = extractSwiftMethod(src, "private func appDidEnterBackground()");
    assert.match(bgMethod, /lock\.lock\(\)/, "appDidEnterBackground must acquire lock");
    assert.match(bgMethod, /!\s*job\.bgTaskPending\b/, "appDidEnterBackground must skip pausing while bgTaskPending is true");
    const beginBg = extractSwiftMethod(src, "private func beginBackgroundTask(_ job: Job)");
    assert.match(beginBg, /job\.bgTaskPending\s*=\s*true/, "beginBackgroundTask must mark bgTaskPending before submit");
    assert.match(beginBg, /job\.bgTaskPending\s*=\s*false/, "beginBackgroundTask must clear bgTaskPending on completion/failure");
  });

  test("status(key:) snapshots Job fields inside lock before disk check", () => {
    const src = readSrc(swiftPath);
    const statusMethod = extractSwiftMethod(src, "func status(key: String) -> [String: Any]");
    const unlockIdx = statusMethod.indexOf("lock.unlock()");
    const diskIdx = statusMethod.indexOf("donePagesOnDisk");
    assert.notEqual(unlockIdx, -1, "status(key:) must lock/unlock");
    assert.ok(unlockIdx < diskIdx, "status(key:) must unlock before calling donePagesOnDisk");
    const afterUnlock = statusMethod.slice(unlockIdx);
    assert.equal(/\bjob\.(state|pages|error)\b/.test(afterUnlock), false,
      "status(key:) must not read job mutable fields after lock.unlock()");
  });

  test("cancel(key:), run(_:), emit(_:_:), pause(_:), finish(_:state:error:), appDidBecomeActive(), updateBackgroundProgress, endBackgroundTask synchronize Job fields with lock", () => {
    const src = readSrc(swiftPath);

    const cancelMethod = extractSwiftMethod(src, "func cancel(key: String)");
    const cancelUnlock = cancelMethod.indexOf("lock.unlock()");
    const cancelWrite = cancelMethod.indexOf("cancelled = true");
    assert.ok(cancelWrite !== -1 && cancelWrite < cancelUnlock, "cancel(key:) must mutate cancelled inside lock");

    const runMethod = extractSwiftMethod(src, "private func run(_ job: Job)");
    assert.match(runMethod, /lock\.lock\(\)/, "run(_:) must synchronize Job reads/writes with lock");
    assert.match(runMethod, /job\.done\.insert\(n\)/);
    // Ensure job.done.insert(n) happens while lock is held (preceded more recently by lock.lock than lock.unlock).
    const insertIdx = runMethod.indexOf("job.done.insert(n)");
    const beforeInsert = runMethod.slice(0, insertIdx);
    assert.ok(beforeInsert.lastIndexOf("lock.lock()") > beforeInsert.lastIndexOf("lock.unlock()"),
      "job.done.insert(n) must occur inside lock");

    const activeMethod = extractSwiftMethod(src, "private func appDidBecomeActive()");
    const activeUnlock = activeMethod.indexOf("lock.unlock()");
    const activeAfterUnlock = activeMethod.slice(activeUnlock);
    assert.equal(/\bjob\.(state|pauseRequested)\b/.test(activeAfterUnlock), false,
      "appDidBecomeActive() must not mutate job.state or job.pauseRequested outside lock");

    const emitMethod = extractSwiftMethod(src, "private func emit(_ job: Job, _ total: Int)");
    assert.match(emitMethod, /lock\.lock\(\)/, "emit must acquire lock before reading job.done");

    const pauseMethod = extractSwiftMethod(src, "private func pause(_ job: Job)");
    assert.match(pauseMethod, /lock\.lock\(\)/, "pause must acquire lock before mutating job.state");

    const finishMethod = extractSwiftMethod(src, "private func finish(_ job: Job, state: State, error: String?)");
    assert.match(finishMethod, /lock\.lock\(\)/, "finish must acquire lock before mutating job.state/job.error");

    const updMethod = extractSwiftMethod(src, "private func updateBackgroundProgress(_ job: Job, done: Int, total: Int)");
    assert.match(updMethod, /lock\.lock\(\)/, "updateBackgroundProgress must read job.bgTask inside lock");

    const endMethod = extractSwiftMethod(src, "private func endBackgroundTask(_ job: Job, success: Bool)");
    assert.match(endMethod, /lock\.lock\(\)/, "endBackgroundTask must read/clear job.bgTask inside lock");
  });

  test("start() handles paused/running jobs cleanly without concurrent Job mutation", () => {
    const src = readSrc(swiftPath);
    const startMethod = extractSwiftMethod(src, "func start(key: String, path: String, pages: [Int], dpi: CGFloat) throws");
    assert.match(startMethod, /existing\.state\s*==\s*\.paused/, "start() must explicitly handle existing .paused job");
    assert.match(startMethod, /existing\.pauseRequested\s*=\s*false/, "start() must clear pauseRequested when resuming");
  });

  test("public/plugin API names remain unchanged for VisionOcrPlugin.swift", () => {
    const src = readSrc(swiftPath);
    for (const sig of [
      "static let shared = PdfOcrJobManager()",
      "func start(key: String, path: String, pages: [Int], dpi: CGFloat) throws",
      "func status(key: String) -> [String: Any]",
      "func readPage(key: String, n: Int) throws -> [String: Any]",
      "func cancel(key: String)",
      "func clear(key: String)"
    ]) {
      assert.ok(src.includes(sig), "Missing expected API: " + sig);
    }
  });

  /* Needs Xcode: CI runs on Linux, so this only runs on a Mac with the iOS SDK. */
  const hasXcode = (() => { try { execFileSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], { stdio: "ignore" }); return true; } catch (e) { return false; } })();
  test("PdfOcrJob.swift passes swiftc -typecheck on iphonesimulator SDK (iOS 15 and iOS 26 targets)", { skip: hasXcode ? false : "Xcode iOS SDK not available" }, () => {
    const swiftFile = absPath(swiftPath);
    const env = { ...process.env, DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" };
    for (const target of ["arm64-apple-ios15.0-simulator", "arm64-apple-ios26.0-simulator"]) {
      execFileSync("xcrun", ["--sdk", "iphonesimulator", "swiftc", "-target", target, "-typecheck", swiftFile], {
        env,
        stdio: "pipe"
      });
    }
  });
});

describe("Item 12: Android PdfOcrJob.kt stopped worker status, ExistingWorkPolicy, and persistent cancel marker", () => {
  const ktPath = "local-plugins/capacitor-vision-ocr/android/src/main/java/com/stewardmd/visionocr/PdfOcrJob.kt";

  test("doWork() catch returns Result.success(fail(\"paused\")) when stopped, not Result.failure", () => {
    const src = readSrc(ktPath);
    assert.equal(src.includes('Result.failure(fail(if (isStopped) "paused"'), false,
      "doWork() catch must not return Result.failure when isStopped");
    assert.match(src, /if\s*\(\s*isStopped\s*\)\s*Result\.success\(fail\("paused"\)\)/,
      "doWork() catch must return Result.success(fail(\"paused\")) when stopped");
  });

  test("start() uses ExistingWorkPolicy.REPLACE or APPEND_OR_REPLACE instead of KEEP", () => {
    const src = readSrc(ktPath);
    assert.equal(src.includes("ExistingWorkPolicy.KEEP"), false,
      "start() must not use ExistingWorkPolicy.KEEP");
    assert.match(src, /ExistingWorkPolicy\.(REPLACE|APPEND_OR_REPLACE)/,
      "start() must use ExistingWorkPolicy.REPLACE or APPEND_OR_REPLACE");
  });

  test("cancellation is persisted as a marker file inside jobDir(ctx, key), not an in-memory Set", () => {
    const src = readSrc(ktPath);
    assert.equal(/val\s+cancelled\s*:\s*MutableSet<String>/.test(src), false,
      "cancelled must not be an in-memory MutableSet<String>");
    assert.match(src, /fun\s+cancelFile\s*\(\s*ctx:\s*Context,\s*key:\s*String\s*\).*File\(\s*jobDir\(\s*ctx,\s*key\s*\)/,
      "cancelFile must live inside jobDir(ctx, key)");
    assert.match(src, /fun\s+isCancelled\s*\(\s*ctx:\s*Context,\s*key:\s*String\s*\)/,
      "isCancelled helper must inspect persistent marker file");
    const startIdx = src.indexOf("fun start(ctx: Context");
    const statusIdx = src.indexOf("fun status(ctx: Context");
    const startBody = src.slice(startIdx, statusIdx);
    assert.match(startBody, /cancelFile\(ctx,\s*key\)\.delete\(\)/, "start() must clear the cancellation marker file");
  });

  test("public API signatures remain unchanged for VisionOcrPlugin.kt", () => {
    const src = readSrc(ktPath);
    for (const sig of [
      "fun isValidKey(key: String): Boolean",
      "fun start(ctx: Context, key: String, path: String, pages: List<Int>, dpi: Int)",
      "fun status(ctx: Context, key: String): JSONObject",
      "fun readPage(ctx: Context, key: String, n: Int): JSONObject",
      "fun cancel(ctx: Context, key: String)",
      "fun clear(ctx: Context, key: String)"
    ]) {
      assert.ok(src.includes(sig), "Missing expected Kotlin API: " + sig);
    }
  });
});
