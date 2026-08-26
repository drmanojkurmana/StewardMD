/* SURGX notes: encrypted Google Drive backup and restore.
 *
 * WHY THIS EXISTS. SURGX notes were the only clinical data in the app with no copy anywhere:
 * encrypted on the device with a PER-DEVICE RANDOM SECRET, no server record. Two consequences the
 * team hit for real:
 *   - reinstalling the app creates a new container and destroys them (CLAUDE.md: "Cost this
 *     session: a linked note, twice");
 *   - once sign-out actually started wiping (2026-08-26), signing out destroyed them too.
 *
 * The device secret is why the local ciphertext CANNOT simply be uploaded: the key exists nowhere
 * else, so a new phone could never read it back. The backup therefore re-encrypts under a
 * PASSWORD-derived key (PBKDF2-SHA256 200k -> AES-GCM), which is exactly what personal-clinic.js
 * already does for My Clinic - so this reuses SMD_CLINIC.encryptBackup rather than inventing a
 * second crypto scheme to get wrong.
 *
 * The rules pinned below are the ones that can lose or mix up a patient's operative note:
 *   1. restore MERGES and never overwrites a note the device has a NEWER version of;
 *   2. a My Clinic backup must never restore as surgical notes (both use the same envelope);
 *   3. a wrong password changes nothing at all;
 *   4. the backup is OFF until the surgeon turns it on - no silent PHI upload on upgrade.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

const SYNC = (await import("../surgx-sync.js")).default;

/* ── pure payload rules ───────────────────────────────────────────────────── */

test("a payload declares itself as SURGX notes", () => {
  const p = SYNC.buildPayload([{ id: "n1", label: "Lap chole", updatedAt: 5 }]);
  const o = JSON.parse(p);
  assert.equal(o.surgx, 1, "the payload must be self-identifying");
  assert.equal(o.notes.length, 1);
});

test("a My Clinic backup is REFUSED, not silently imported as surgical notes", () => {
  /* Both use SMD_CLINIC.encryptBackup, so both produce an {smd_enc:1} envelope and decryptBackup
   * happily decrypts either. Only the payload can tell them apart - and restoring a clinic export
   * into the notes list would be a silent, confusing data mix-up. */
  const clinic = JSON.stringify({ v: 1, patients: [{ id: "p1" }] });
  assert.throws(() => SYNC.parsePayload(clinic), /not_surgx_backup/);
});

test("garbage is refused rather than producing an empty note list", () => {
  assert.throws(() => SYNC.parsePayload("}{ not json"), /unreadable|bad/i);
  // An empty-but-valid backup is legitimate (a surgeon with no notes yet).
  assert.deepEqual(SYNC.parsePayload(SYNC.buildPayload([])), []);
});

/* ── the merge rule: a restore must never lose newer work ─────────────────── */

test("restore never overwrites a note the device has a NEWER version of", () => {
  const local = [{ id: "n1", label: "local newer", updatedAt: 900 }];
  const backup = [{ id: "n1", label: "drive older", updatedAt: 100 }];
  const merged = SYNC.mergeNotes(local, backup);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, "local newer",
    "an older Drive copy must never clobber newer work on the phone");
});

test("a newer backup DOES replace an older local note", () => {
  const merged = SYNC.mergeNotes(
    [{ id: "n1", label: "local older", updatedAt: 100 }],
    [{ id: "n1", label: "drive newer", updatedAt: 900 }]);
  assert.equal(merged[0].label, "drive newer");
});

test("notes only in the backup are restored, and notes only on the phone are kept", () => {
  const merged = SYNC.mergeNotes(
    [{ id: "keep", updatedAt: 1 }],
    [{ id: "restored", updatedAt: 1 }]);
  const ids = merged.map((n) => n.id).sort();
  assert.deepEqual(ids, ["keep", "restored"], "a restore is a union, never a replacement");
});

test("a note with no timestamp is treated as older, never as newer", () => {
  /* Missing metadata must fail towards keeping what is on the device. */
  const merged = SYNC.mergeNotes(
    [{ id: "n1", label: "local", updatedAt: 50 }],
    [{ id: "n1", label: "undated drive copy" }]);
  assert.equal(merged[0].label, "local");
});

/* ── round trip through the REAL crypto ───────────────────────────────────── */

/* personal-clinic.js is a browser IIFE; run it in a context with WebCrypto so the round trip uses
 * the shipped encryptBackup/decryptBackup rather than a stand-in. */
function clinicCrypto() {
  const win = { crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob, console,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {} }), body: { appendChild() {} }, addEventListener() {} },
    addEventListener() {}, setTimeout, clearTimeout, location: { href: "" }, navigator: { userAgent: "node" } };
  win.window = win; win.globalThis = win; win.self = win;
  vm.runInContext(read("personal-clinic.js"), vm.createContext(win), { filename: "personal-clinic.js" });
  assert.ok(win.SMD_CLINIC && win.SMD_CLINIC.encryptBackup, "SMD_CLINIC.encryptBackup is the scheme being reused");
  return win.SMD_CLINIC;
}

test("a backup round-trips through the real password crypto", async () => {
  const C = clinicCrypto();
  const notes = [{ id: "n1", label: "Lap chole", patient: { name: "REDACTED" }, updatedAt: 7 }];
  const env = await C.encryptBackup(SYNC.buildPayload(notes), "correct horse");
  assert.ok(!env.includes("Lap chole"), "the envelope must not carry plaintext");
  const back = SYNC.parsePayload(await C.decryptBackup(env, "correct horse"));
  assert.equal(back[0].label, "Lap chole");
});

test("the wrong password fails and changes nothing", async () => {
  const C = clinicCrypto();
  const env = await C.encryptBackup(SYNC.buildPayload([{ id: "n1", updatedAt: 1 }]), "right");
  await assert.rejects(() => C.decryptBackup(env, "wrong"),
    "a wrong password must reject, never return partial data");
});

/* ── it must not start uploading PHI on its own ───────────────────────────── */

test("the Drive backup is OFF until the surgeon turns it on", () => {
  const flags = read("surgx-flags.js");
  const m = /smd_surgx_drive_backup:\s*\{[^}]*def:\s*(true|false)/.exec(flags);
  assert.ok(m, "smd_surgx_drive_backup must be a declared flag");
  assert.equal(m[1], "false",
    "an upgrade must never silently begin uploading operative notes to Drive");
});

test("nothing uploads without a password AND a token", async () => {
  const r1 = await SYNC.syncNow({ password: null, token: "t", notes: async () => [] });
  assert.equal(r1.error, "no_password");
  const r2 = await SYNC.syncNow({ password: "p", token: null, notes: async () => [] });
  assert.equal(r2.error, "no_token");
});

test("sync is skipped when there is nothing to back up", async () => {
  let uploaded = false;
  const r = await SYNC.syncNow({
    password: "p", token: "t", notes: async () => [],
    encrypt: async (t) => t, upload: async () => { uploaded = true; return { ok: true }; }
  });
  assert.ok(!uploaded, "an empty note list must not create a Drive file");
  assert.equal(r.ok, true);
});

test("the note body is encrypted BEFORE it reaches the uploader", async () => {
  /* The one thing that must never regress: no readable PHI on the wire. */
  let sent = "";
  await SYNC.syncNow({
    password: "pw", token: "t",
    notes: async () => [{ id: "n1", label: "Whipple", patient: { name: "Ramesh" }, updatedAt: 1 }],
    encrypt: async () => JSON.stringify({ smd_enc: 1, ct: "OPAQUE" }),
    upload: async (env) => { sent = env; return { ok: true }; }
  });
  assert.ok(sent.includes("OPAQUE"));
  assert.ok(!/Whipple|Ramesh/.test(sent), "plaintext note content must never reach the uploader");
});

test("a failed upload is reported, not swallowed", async () => {
  const r = await SYNC.syncNow({
    password: "p", token: "t",
    notes: async () => [{ id: "n1", updatedAt: 1 }],
    encrypt: async (t) => t,
    upload: async () => ({ ok: false, error: "http_403" })
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "http_403");
});

/* ── restore ──────────────────────────────────────────────────────────────── */

test("restore with no backup in Drive says so instead of wiping anything", async () => {
  const r = await SYNC.restore({ password: "p", token: "t", download: async () => null });
  assert.equal(r.ok, false);
  assert.equal(r.error, "no_backup");
});

test("restore writes the merged result back through the store", async () => {
  const written = [];
  const r = await SYNC.restore({
    password: "p", token: "t",
    download: async () => "envelope",
    decrypt: async () => SYNC.buildPayload([{ id: "fromDrive", label: "restored", updatedAt: 500 }]),
    notes: async () => [{ id: "local", label: "kept", updatedAt: 10 }],
    saveNote: async (n) => { written.push(n); return { ok: true }; }
  });
  assert.equal(r.ok, true);
  assert.equal(r.restored, 1, "only the note that was actually missing is written");
  assert.deepEqual(written.map((n) => n.id), ["fromDrive"]);
});

test("restore does NOT rewrite notes the device already has newer", async () => {
  const written = [];
  await SYNC.restore({
    password: "p", token: "t",
    download: async () => "e",
    decrypt: async () => SYNC.buildPayload([{ id: "n1", label: "old", updatedAt: 1 }]),
    notes: async () => [{ id: "n1", label: "new", updatedAt: 999 }],
    saveNote: async (n) => { written.push(n); return { ok: true }; }
  });
  assert.deepEqual(written, [], "nothing to do means nothing written");
});

test("a clinic backup pointed at restore is refused before anything is written", async () => {
  const written = [];
  const r = await SYNC.restore({
    password: "p", token: "t",
    download: async () => "e",
    decrypt: async () => JSON.stringify({ v: 1, patients: [] }),
    notes: async () => [],
    saveNote: async (n) => { written.push(n); return { ok: true }; }
  });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /not_surgx|wrong_backup/);
  assert.deepEqual(written, []);
});

test("a wrong password on restore reports it and writes nothing", async () => {
  const written = [];
  const r = await SYNC.restore({
    password: "nope", token: "t",
    download: async () => "e",
    decrypt: async () => { throw new Error("bad"); },
    notes: async () => [],
    saveNote: async (n) => { written.push(n); return { ok: true }; }
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "wrong_password");
  assert.deepEqual(written, []);
});


/* ── the two features must tell ONE story ─────────────────────────────────── */

test("the notes banner stops claiming 'never uploaded' once backup is on", () => {
  /* The old banner said "Encrypted on this device and never uploaded ... Sign out wipes them"
   * unconditionally. Left as-is it would be a flat lie to anyone using the backup - the same class
   * of stale-claim bug as the DEFAULT OFF comment in index.html. */
  const src = read("surgx-screens.js");
  const fn = src.slice(src.indexOf("function notesBanner"), src.indexOf("function backupSection"));
  assert.match(fn, /autoSyncOn\(\)/, "the banner must branch on whether backup is actually on");
  assert.match(fn, /survive a reinstall|Google\s+cannot read/i, "the backed-up wording must exist");
  assert.match(fn, /DELETES these notes permanently|deletes these notes/i,
    "and the unprotected wording must still warn plainly");
});

test("the sign-out warning softens when a backup exists", () => {
  const src = read("signout-fix.js");
  const fn = src.slice(src.indexOf("function confirmNoteLoss"), src.indexOf("var signingOut"));
  assert.match(fn, /SMD_SURGX_SYNC/, "it must check whether a backup exists");
  assert.match(fn, /restore them/i, "a surgeon with a backup must be told they can restore");
  assert.match(fn, /permanently delete/i, "and one without must still get the hard warning");
});

test("saving a note schedules a backup", () => {
  const src = read("surgx-store.js");
  const fn = src.slice(src.indexOf("function saveNote"), src.indexOf("function loadNote"));
  assert.match(fn, /SMD_SURGX_SYNC[\s\S]{0,60}scheduleSync/,
    "an unbacked-up note is the whole problem; the save path must trigger the debounced backup");
});


test("the backup opt-in and the backup stamp are PER ACCOUNT", () => {
  /* A shared ward phone is the whole reason the sign-out wipe exists. If these two keys were
   * global, the next person to sign in would inherit the previous surgeon's "backup on" - and
   * their operative notes would start uploading to their Drive without them ever agreeing - and
   * would be told they have a backup to restore when they have nothing. */
  const src = read("surgx-sync.js");
  assert.match(src, /function uid\(\)/, "it must resolve the signed-in account like surgx-store does");
  assert.match(src, /stewardmd_account/, "using the same account key the rest of the app uses");
  for (const fn of ["lastKey", "autoKey"]) {
    const m = new RegExp(`function ${fn}\\(\\)[^\\n]*uid\\(\\)`).exec(src);
    assert.ok(m, `${fn}() must be scoped by uid()`);
  }
  assert.ok(!/getItem\("smd_surgx_autosync"\)|getItem\("stewardmd\.surgx\.lastbackup"\)/.test(src),
    "no unscoped global key may remain");
});

test("auto-sync is opt-IN: absent means off, not on", () => {
  /* Personal clinic treats a missing key as ON (opt-out). For operative notes leaving the device
   * that default is the wrong way round - silence must never mean consent to upload PHI. */
  const src = read("surgx-sync.js");
  const fn = src.slice(src.indexOf("function autoSyncOn"), src.indexOf("function setAutoSync"));
  assert.match(fn, /=== "1"/, "only an explicit opt-in counts as on");
  assert.ok(!/!== "0"/.test(fn), "a missing setting must not read as enabled");
});
