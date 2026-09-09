/* surgx-backup.js — SURGX notes to the doctor's own Google Drive, and back.
 *
 * The loss this prevents: SURGX notes are encrypted device-local with no note server, and every
 * native install creates a NEW container, so a reinstall destroys them. Notes have been lost that
 * way already. The shipped Drive destination writes a READABLE .txt per note - an export for a
 * human, not something the app can read back.
 *
 * The safety properties that must hold, and are asserted here:
 *   - nothing is sent without confirmed:true (there is still no silent upload path)
 *   - a restore is ADDITIVE: it never rolls back work that is newer on the device
 *   - restoring twice writes nothing the second time
 *   - a backup REPLACES the previous file rather than piling copies in the surgeon's Drive
 *   - the patient reference never reaches the Drive filename
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const BK = require("../surgx-backup.js");
const CRYPTO = require("../clinic-crypto.js");   // the real PBKDF2 -> AES-GCM adapter, not a stub

const PW = "operative-notes-2026";

const note = (id, updatedAt, extra) => Object.assign({
  id, type: "operative", templateId: "", label: "Note " + id, values: {}, provenance: {},
  finalized: false, createdAt: 1, updatedAt
}, extra || {});

/* ── pure: the backup document ─────────────────────────────────────────────── */

test("a backup carries the note bodies, because ciphertext could never be restored", () => {
  // surgx-store encrypts with a per-DEVICE secret in localStorage; a reinstall wipes it, so a
  // backup of the encrypted rows would be permanently unreadable. This is the reasoning, pinned.
  const doc = BK.buildBackup([note("a", 10), note("b", 20)], { uid: "u1", now: 999 });
  assert.equal(doc.format, BK.FORMAT);
  assert.equal(doc.count, 2);
  assert.equal(doc.uid, "u1");
  assert.equal(doc.exportedAt, 999);
  assert.deepEqual(doc.notes.map((n) => n.id), ["a", "b"]);
  assert.equal(typeof doc.notes[0].values, "object", "the body must round-trip, not a rendered string");
});

test("buildBackup drops nothing silently and tolerates holes", () => {
  const doc = BK.buildBackup([note("a", 1), null, undefined], {});
  assert.equal(doc.count, 1, "count reflects what is actually in the file");
});

test("parseBackup refuses anything it cannot faithfully restore", () => {
  assert.equal(BK.parseBackup("not json").error, "not_json");
  assert.equal(BK.parseBackup("null").error, "not_json");
  assert.equal(BK.parseBackup(JSON.stringify({ format: 99, notes: [] })).error, "unsupported_format",
    "a newer format must be refused, never half-read");
  assert.equal(BK.parseBackup(JSON.stringify({ format: 1 })).error, "no_notes");
  const ok = BK.parseBackup(JSON.stringify(BK.buildBackup([note("a", 1), { id: "x" }], {})));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.notes.map((n) => n.id), ["a"], "a row without a type is not a note");
});

/* ── pure: the merge rules ─────────────────────────────────────────────────── */

test("restore ADDS what is missing and leaves newer local work alone", () => {
  const local = [{ id: "a", updatedAt: 100 }, { id: "b", updatedAt: 50 }];
  const plan = BK.mergePlan(local, [note("a", 40), note("b", 80), note("c", 10)]);
  assert.deepEqual(plan.add, ["c"], "a note absent from the device is restored");
  assert.deepEqual(plan.replace, ["b"], "the backup copy is newer, so it wins");
  assert.deepEqual(plan.skip, ["a"], "the DEVICE copy is newer - restoring must not roll it back");
});

test("restoring twice is a no-op the second time", () => {
  const backup = [note("a", 10), note("b", 20)];
  const first = BK.mergePlan([], backup);
  assert.deepEqual(first.add.sort(), ["a", "b"]);
  // After the first restore the device holds them at the same timestamps.
  const after = backup.map((n) => ({ id: n.id, updatedAt: n.updatedAt }));
  const second = BK.mergePlan(after, backup);
  assert.deepEqual(second.add, []);
  assert.deepEqual(second.replace, [], "equal timestamps must SKIP, not rewrite");
  assert.deepEqual(second.skip.sort(), ["a", "b"]);
});

test("an empty or absent local index is handled, not assumed", () => {
  assert.deepEqual(BK.mergePlan(null, [note("a", 1)]).add, ["a"]);
  assert.deepEqual(BK.mergePlan([], null).add, []);
  assert.deepEqual(BK.mergePlan([{ id: "a" }], [note("a", 1)]).replace, ["a"],
    "a local row with no updatedAt counts as oldest, so the backup restores it");
});

/* ── the confirmation contract ─────────────────────────────────────────────── */

test("neither direction moves data without an explicit confirmation", async () => {
  assert.equal((await BK.backupNow({})).error, "not_confirmed");
  assert.equal((await BK.backupNow({ confirmed: "yes" })).error, "not_confirmed", "truthy is not true");
  assert.equal((await BK.restoreNow({})).error, "not_confirmed");
  assert.equal((await BK.restoreNow({ confirmed: 1 })).error, "not_confirmed");
});

/* ── the Drive round trip, with Drive stubbed ──────────────────────────────── */

function withDrive(run) {
  const store = new Map();          // id -> note body
  const drive = { files: [], uploads: [], patches: [] };
  const prevFetch = globalThis.fetch;
  const prevWin = globalThis.window;

  const st = {
    cryptoAvailable: () => true,
    uid: () => "u1",
    listNotes: () => [...store.values()].map((n) => ({ id: n.id, updatedAt: n.updatedAt })),
    loadNote: (id) => Promise.resolve(store.get(id) || null),
    saveNote: (n) => { store.set(n.id, JSON.parse(JSON.stringify(n))); return Promise.resolve({ ok: true, id: n.id }); },
  };
  globalThis.window = {
    SMD_SURGX_STORE: st,
    SMD_getDriveToken: () => "tok",
    SMD_CLINIC_CRYPTO: CRYPTO,        // real crypto: these tests encrypt and decrypt for real
    SMD_SURGX_DEST: { driveToken: () => Promise.resolve("tok"), driveFolderId: () => Promise.resolve("folder1") },
  };
  globalThis.fetch = async (url, init) => {
    const u = String(url), m = (init && init.method) || "GET";
    if (u.includes("/drive/v3/files?q=")) {
      const hit = drive.files[0];
      return { ok: true, json: async () => ({ files: hit ? [{ id: hit.id, modifiedTime: "t" }] : [] }) };
    }
    if (u.includes("/upload/drive/v3/files") && m === "POST") {
      drive.files.push({ id: "f1", body: init.body }); drive.uploads.push(init.body);
      return { ok: true, json: async () => ({ id: "f1" }) };
    }
    if (u.includes("/upload/drive/v3/files/") && m === "PATCH") {
      drive.files[0].body = init.body; drive.patches.push(init.body);
      return { ok: true, json: async () => ({ id: "f1" }) };
    }
    if (u.includes("alt=media")) {
      const f = drive.files[0];
      if (!f) return { ok: false };
      const body = String(f.body);
      // the envelope is the LAST JSON object in the multipart body
      const i = body.lastIndexOf('{"format"');
      return { ok: true, text: async () => body.slice(i, body.lastIndexOf("}") + 1) };
    }
    return { ok: false, status: 404 };
  };
  return Promise.resolve(run({ store, drive, st })).finally(() => {
    globalThis.fetch = prevFetch;
    if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
  });
}

test("back up, wipe the device, restore: the notes come back", async () => {
  await withDrive(async ({ store }) => {
    store.set("n1", note("n1", 10, { label: "Appendicectomy", values: { surgeon: "Dr M" } }));
    store.set("n2", note("n2", 20));

    const up = await BK.backupNow({ confirmed: true, password: PW });
    assert.equal(up.ok, true);
    assert.equal(up.count, 2);

    store.clear();                                   // the reinstall
    assert.equal((await BK.restoreNow({ confirmed: true, password: PW })).added, 2);
    assert.equal(store.size, 2, "both notes are readable on the device again");
    assert.equal(store.get("n1").values.surgeon, "Dr M", "the body survived, not just a rendered summary");
  });
});

test("a second backup REPLACES the file instead of piling copies in the surgeon's Drive", async () => {
  await withDrive(async ({ store, drive }) => {
    store.set("n1", note("n1", 10));
    await BK.backupNow({ confirmed: true, password: PW });
    await BK.backupNow({ confirmed: true, password: PW });
    assert.equal(drive.files.length, 1, "one backup file, not two");
    assert.equal(drive.uploads.length, 1, "created once");
    assert.equal(drive.patches.length, 1, "updated in place thereafter");
  });
});

test("restoring never rolls back a note edited more recently on the device", async () => {
  await withDrive(async ({ store }) => {
    store.set("n1", note("n1", 10, { label: "old" }));
    await BK.backupNow({ confirmed: true, password: PW });
    store.set("n1", note("n1", 99, { label: "edited today" }));   // newer local work
    const res = await BK.restoreNow({ confirmed: true, password: PW });
    assert.equal(res.skipped, 1);
    assert.equal(store.get("n1").label, "edited today", "the newer device copy must survive a restore");
  });
});

test("with nothing to back up, and with no backup to restore, it says so plainly", async () => {
  await withDrive(async () => {
    assert.equal((await BK.backupNow({ confirmed: true, password: PW })).error, "nothing_to_back_up");
    assert.match(BK.describe(await BK.restoreNow({ confirmed: true, password: PW })), /No SURGX backup was found/);
  });
});

test("the backup filename carries no patient identifier", () => {
  // Drive filenames surface in search, "shared with me" and notification mail - a wider audience
  // than the file. Same rule surgx-destinations.js applies to the per-note .txt export.
  assert.equal(/[0-9]{4,}/.test(BK.BACKUP_NAME), false, "no ids or numbers that could be a UHID");
  assert.match(BK.BACKUP_NAME, /^StewardMD-SURGX-notes-backup\.smdbk$/,
    "not .json: the file is ciphertext, and the name should not invite a text editor");
});

/* ── encryption: the property the whole feature rests on ───────────────────── */

test("what lands in Drive is CIPHERTEXT - no note text, no label, no patient reference", async () => {
  await withDrive(async ({ store, drive }) => {
    // A LONG id on purpose: a two-character id appears inside random base64 ciphertext by chance,
    // and the assertion below would then fail for a reason that has nothing to do with leakage.
    const id = "note-9f3c1a7b2e";
    store.set(id, note(id, 10, {
      label: "Appendicectomy for Mr Ramesh",
      values: { surgeon: "Dr Manoj", findings: "gangrenous appendix", patientRef: "UHID-99887" },
    }));
    assert.equal((await BK.backupNow({ confirmed: true, password: PW })).ok, true);

    const uploaded = String(drive.files[0].body);
    for (const secret of ["Appendicectomy", "Ramesh", "Dr Manoj", "gangrenous", "UHID-99887", id]) {
      assert.equal(uploaded.includes(secret), false, "'" + secret + "' must never appear in the uploaded bytes");
    }
    // Only what a restore needs before it can derive a key may be in the clear.
    const env = JSON.parse(uploaded.slice(uploaded.lastIndexOf('{"format"'), uploaded.lastIndexOf("}") + 1));
    assert.deepEqual(Object.keys(env).sort(), ["app", "enc", "exportedAt", "format", "kdf", "payload", "salt"]);
    assert.equal(env.count, undefined, "not even the NUMBER of notes leaks");
    assert.equal(env.uid, undefined, "nor the account it belongs to");
    assert.equal(env.kdf.iterations, 200000);
  });
});

test("the wrong password unlocks nothing and changes nothing", async () => {
  await withDrive(async ({ store }) => {
    store.set("n1", note("n1", 10));
    await BK.backupNow({ confirmed: true, password: PW });
    store.clear();                                        // the reinstall
    const bad = await BK.restoreNow({ confirmed: true, password: "not-the-password" });
    assert.equal(bad.ok, undefined === bad.ok ? undefined : false);
  assert.equal(bad.error, "wrong_pass");
    assert.equal(store.size, 0, "a failed unlock must not half-restore anything");
    // ...and the right one still works afterwards.
    assert.equal((await BK.restoreNow({ confirmed: true, password: PW })).added, 1);
  });
});

test("each backup uses a FRESH salt, so two backups are never the same bytes", async () => {
  await withDrive(async ({ store, drive }) => {
    store.set("n1", note("n1", 10));
    await BK.backupNow({ confirmed: true, password: PW });
    const first = String(drive.files[0].body);
    await BK.backupNow({ confirmed: true, password: PW });
    const second = String(drive.files[0].body);
    const saltOf = (b) => JSON.parse(b.slice(b.lastIndexOf('{"format"'), b.lastIndexOf("}") + 1)).salt;
    assert.notEqual(saltOf(first), saltOf(second), "a reused salt would make two backups comparable");
  });
});

test("a password is required in BOTH directions, and a typo-prone one is refused up front", async () => {
  // A lost password is unrecoverable by design, so the weak cases are refused before anything is
  // written, not discovered months later at restore time.
  assert.equal((await BK.backupNow({ confirmed: true })).error, "pass_required");
  assert.equal((await BK.backupNow({ confirmed: true, password: "short" })).error, "weak_pass");
  assert.equal((await BK.backupNow({ confirmed: true, password: " padded123 " })).error, "pass_padded");
  assert.equal((await BK.restoreNow({ confirmed: true })).error, "pass_required");

  assert.equal(BK.checkPassword("").error, "pass_required");
  assert.equal(BK.checkPassword("abcdefg").error, "weak_pass", "7 is below the floor");
  assert.equal(BK.checkPassword("abcdefgh").ok, true, "8 is the floor");
  assert.equal(BK.MIN_PASSWORD, 8);
});

test("an unencrypted or foreign file is REFUSED, never imported", () => {
  // The app must not be handed a hand-written note dump and asked to import it.
  const plaintext = JSON.stringify(BK.buildBackup([note("a", 1)], {}));
  assert.equal(BK.parseEnvelope(plaintext).error, "plaintext_refused");
  assert.equal(BK.parseEnvelope("{}").error, "malformed_backup", "no version at all is not a StewardMD backup");
  assert.equal(BK.parseEnvelope("garbage").error, "not_json");
  assert.equal(BK.parseEnvelope(JSON.stringify({ format: 99 })).error, "unsupported_format");
  assert.equal(BK.parseEnvelope(JSON.stringify({ format: 2, enc: "password" })).error, "malformed_backup");
});

test("a backup asking to be opened with WEAKER key stretching is refused", () => {
  // Otherwise an attacker who can write to the Drive folder could downgrade the KDF and hand it back.
  const weak = BK.wrapEnvelope("c2FsdA==", "blob", {});
  weak.kdf.iterations = 1000;
  assert.equal(BK.parseEnvelope(JSON.stringify(weak)).error, "weak_kdf_refused");
  const good = BK.wrapEnvelope("c2FsdA==", "blob", {});
  assert.equal(BK.parseEnvelope(JSON.stringify(good)).ok, true);
});


/* ── status(): the accessor other modules integrate against ────────────────── */

/* signout-fix.js and the Notes banner both decide how alarming to be from this. They used to call
 * describe(), which renders a RESULT into a SENTENCE and returns a string — so `d.hasBackup` was
 * always undefined and the softer message could never appear. It failed safe, so nothing was
 * harmed, but the feature never worked. This pins the shape those callers rely on. */
test("describe() returns a SENTENCE and status() returns FACTS — they are not interchangeable", () => {
  assert.equal(typeof BK.describe({ error: "no_backup_found" }), "string");
  assert.equal(BK.describe().hasBackup, undefined, "a string has no fields — this is the old bug");
  assert.equal(typeof BK.status, "function", "status() is what an integrator should call");
});

test("status() reports no backup on a device that has never made one", () => {
  const prevWin = globalThis.window;
  const mem = {};
  globalThis.window = {
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } },
    SMD_SURGX_STORE: { uid: () => "surgeon-a" },
  };
  try {
    const st = BK.status();
    assert.equal(st.hasBackup, false);
    assert.equal(st.lastBackupAt, 0);
    assert.equal(st.lastBackupAtText, "", "nothing to show, so nothing is shown");
  } finally { if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin; }
});

test("the backup record is PER ACCOUNT — a shared ward phone must not mislead the next surgeon", async () => {
  // A global key would tell surgeon B their notes are backed up, when what exists is surgeon A's
  // backup in surgeon A's Drive. That is a lie told at the exact moment it costs notes.
  await withDrive(async ({ store }) => {
    store.set("n1", note("n1", 10));
    const w = globalThis.window;
    const mem = {};
    w.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };

    w.SMD_SURGX_STORE.uid = () => "surgeon-a";
    assert.equal((await BK.backupNow({ confirmed: true, password: PW })).ok, true);
    assert.equal(BK.status().hasBackup, true, "surgeon A backed up, so surgeon A is told so");

    w.SMD_SURGX_STORE.uid = () => "surgeon-b";
    assert.equal(BK.status().hasBackup, false,
      "surgeon B, on the same phone, must NOT inherit surgeon A's backup state");

    w.SMD_SURGX_STORE.uid = () => "surgeon-a";
    assert.equal(BK.status().hasBackup, true, "and surgeon A still has theirs");
  });
});

test("a successful RESTORE also records that a backup exists", async () => {
  // The new device has no local record of the backup the old one made, so without this the banner
  // would keep threatening permanent loss on a phone that just proved it can recover.
  await withDrive(async ({ store }) => {
    const mem = {};
    globalThis.window.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
    store.set("n1", note("n1", 10));
    await BK.backupNow({ confirmed: true, password: PW });

    // the reinstall: notes gone, and the local record with them
    store.clear();
    for (const k of Object.keys(mem)) delete mem[k];
    assert.equal(BK.status().hasBackup, false, "a wiped device knows nothing yet");

    assert.equal((await BK.restoreNow({ confirmed: true, password: PW })).added, 1);
    assert.equal(BK.status().hasBackup, true, "having restored, it now knows a backup exists");
  });
});
