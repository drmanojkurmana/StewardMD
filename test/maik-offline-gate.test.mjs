/* test/maik-offline-gate.test.mjs — the owner's iPhone story (2026-09-20).
 *
 * "downloaded maik offline models where one download got broken and when restarted it got shown as
 *  completed rather than resume, then i tried using that model it came generation failure, then i
 *  restarted app it failed to show offline models at all saying gated under pro even after the
 *  account is pro ... maik cloud is also not working, restart logout login nothing fixes"
 *
 * Three defects, pinned here:
 *   1. The native downloader preallocates the final file at full size, and its start() declared any
 *      full-size file "done" - so an interrupted download read as complete after a relaunch and the
 *      model loaded with holes ("generation failure"). Size is not completion; the sidecar is.
 *   2. /billing/status decides Pro from Firebase custom claims, which never carry an email, so the
 *      owner check on that path was dead code. The day the owner's verified free week ended, status
 *      said "not Pro"; the client cached it, hid the on-device models and blocked every Pro gate,
 *      while the hot AI gate (which reads the signed token) still said Pro.
 *   3. The client cached ANY boolean verdict, including the guest verdict a signed-in device gets
 *      when its token is not ready or fails to verify - filed under the real uid once the response
 *      landed. Logout/login re-synced into the same trap.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { entitlementState } from "../functions/_entitlement.js";

const R = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const ENT = R("functions/_entitlement.js");
const BILL = R("functions/api/billing/[[path]].js");
const ACCT = R("account.js");
const MODELS = R("maik-models.js");
const SWIFT = R("local-plugins/capacitor-llama/ios/Sources/LlamaPlugin/ModelDownloader.swift");

const DAY = 86400000;
const ENV = { VERIFY_REQUIRED_FOR_PRO: "1", OWNER_EMAILS: "owner@stewardmd.test" };
const now = Date.parse("2026-09-20T12:00:00Z");

// ── 2. the owner on the status path ─────────────────────────────────────────────────────────
test("an owner whose verified free week has ended is still Pro, but ONLY if the email is on the claims", () => {
  const expired = { verified: true, verifiedAt: now - 60 * DAY };
  const noEmail = entitlementState(ENV, expired, now);
  assert.equal(noEmail.pro, false, "custom claims alone: the week is over and nobody knows this is the owner");
  assert.equal(noEmail.reason, "verified-week-expired");
  const withEmail = entitlementState(ENV, { ...expired, email: "owner@stewardmd.test" }, now);
  assert.equal(withEmail.pro, true);
  assert.equal(withEmail.source, "owner");
});

test("entitlementFor merges the token email into the claims it evaluates, and /billing/status passes it", () => {
  assert.match(ENT, /export async function entitlementFor\(env, uid, email\)/);
  assert.match(ENT, /if \(email && typeof email === "string" && !claims\.email\) claims\.email = email;/);
  assert.match(BILL, /const state = await entitlementFor\(env, uid, _em\);/);
  assert.match(BILL, /_em = \(w0 && !w0\.guest && w0\.email\) \|\| ""/, "only a verified, non-guest email is trusted");
});

// ── 3. the client cache ─────────────────────────────────────────────────────────────────────
test("a signed-in client ignores the guest verdict (signedIn:false) and files a real one under the uid it asked for", () => {
  assert.match(ACCT, /var u0 = uid\(\), hadUser = !!fbUser\(\);/, "identity pinned at request time");
  assert.match(ACCT, /var _foreign = !!\(d && hadUser && d\.signedIn === false\);/);
  assert.match(ACCT, /if \(d && typeof d\.pro === "boolean" && !_foreign\) \{/);
  assert.match(ACCT, /saveProCache\(_pro, u0\);/);
  assert.match(ACCT, /function saveProCache\(v, u\) \{ try \{ localStorage\.setItem\(proCacheKey\(u \|\| uid\(\)\)/);
});

// ── 1. the download that was never finished ─────────────────────────────────────────────────
function loadModels({ partialSeq, deleteOK = true }) {
  const calls = { start: 0, del: 0, status: 0 };
  const ls = (() => { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, _s: s }; })();
  let total = 0;
  const Llama = {
    downloadStart: async ({ total: t }) => { calls.start++; total = t; return { id: "job" + calls.start }; },
    downloadStatus: async () => { calls.status++; return { state: "done", onDisk: total, bytes: total, total: total, live: false }; },
    modelPath: async () => ({ path: "/m.gguf", bytes: total, partial: partialSeq.length > 1 ? partialSeq.shift() : partialSeq[0], freeBytes: 1e12 }),
    modelDelete: async () => { calls.del++; if (!deleteOK) throw new Error("nope"); return { ok: true }; },
    downloadCancel: async () => ({}),
    excludeFromBackup: async () => ({ ok: true }),
  };
  const Filesystem = { stat: async () => { throw new Error("not found"); }, mkdir: async () => ({}), getUri: async ({ path }) => ({ uri: "file:///d/" + path }) };
  const win = { Capacitor: { isNativePlatform: () => true, Plugins: { Filesystem, Llama } } };
  new Function("window", "localStorage", MODELS)(win, ls);
  return { M: win.SMD_MAIK_MODELS, calls, ls };
}

test("a 'done' status with parts still missing is NOT installed: the file is restarted once, then trusted", async () => {
  // first modelPath (the pre-flight) says partial, poll's check says partial, after the restart: complete
  const { M, calls, ls } = loadModels({ partialSeq: [true, true, false, false] });
  const id = M.DEFAULT_PACK || M.packIds()[0];
  const r = await M.ensure(id, null);
  assert.equal(r && r.installed, true);
  assert.equal(calls.del, 1, "the incomplete preallocated file was deleted once");
  assert.equal(calls.start, 2, "and the download started again from nothing");
  assert.equal(M.installedCached(id), true);
});

test("if the restart is still partial, it is an error and the pack is never marked installed", async () => {
  const { M, ls } = loadModels({ partialSeq: [true] });
  const id = M.DEFAULT_PACK || M.packIds()[0];
  await assert.rejects(M.ensure(id, null), /PARTIAL/);
  assert.equal(M.installedCached(id), false);
  assert.equal(M.state(id).done, false);
});

test("installed() also refuses a full-size file that the sidecar says is incomplete", () => {
  assert.match(MODELS, /return L\.modelPath\(\{ name: files\[0\]\.name \}\)\.then\(function \(mp\) \{ return !\(mp && mp\.partial\); \}/);
});

test("native: a full-size file WITH a sidecar is resumable, not finished", () => {
  assert.match(SWIFT, /if total > 0 && Self\.sizeOf\(name\) == total && !Self\.isPartial\(name\) \{/);
});
