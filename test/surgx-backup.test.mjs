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
      // pull the JSON payload back out of the multipart body
      const i = body.indexOf('{"format"');
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

    const up = await BK.backupNow({ confirmed: true });
    assert.equal(up.ok, true);
    assert.equal(up.count, 2);

    store.clear();                                   // the reinstall
    assert.equal((await BK.restoreNow({ confirmed: true })).added, 2);
    assert.equal(store.size, 2, "both notes are readable on the device again");
    assert.equal(store.get("n1").values.surgeon, "Dr M", "the body survived, not just a rendered summary");
  });
});

test("a second backup REPLACES the file instead of piling copies in the surgeon's Drive", async () => {
  await withDrive(async ({ store, drive }) => {
    store.set("n1", note("n1", 10));
    await BK.backupNow({ confirmed: true });
    await BK.backupNow({ confirmed: true });
    assert.equal(drive.files.length, 1, "one backup file, not two");
    assert.equal(drive.uploads.length, 1, "created once");
    assert.equal(drive.patches.length, 1, "updated in place thereafter");
  });
});

test("restoring never rolls back a note edited more recently on the device", async () => {
  await withDrive(async ({ store }) => {
    store.set("n1", note("n1", 10, { label: "old" }));
    await BK.backupNow({ confirmed: true });
    store.set("n1", note("n1", 99, { label: "edited today" }));   // newer local work
    const res = await BK.restoreNow({ confirmed: true });
    assert.equal(res.skipped, 1);
    assert.equal(store.get("n1").label, "edited today", "the newer device copy must survive a restore");
  });
});

test("with nothing to back up, and with no backup to restore, it says so plainly", async () => {
  await withDrive(async () => {
    assert.equal((await BK.backupNow({ confirmed: true })).error, "nothing_to_back_up");
    assert.match(BK.describe(await BK.restoreNow({ confirmed: true })), /No SURGX backup was found/);
  });
});

test("the backup filename carries no patient identifier", () => {
  // Drive filenames surface in search, "shared with me" and notification mail - a wider audience
  // than the file. Same rule surgx-destinations.js applies to the per-note .txt export.
  assert.equal(/[0-9]{4,}/.test(BK.BACKUP_NAME), false, "no ids or numbers that could be a UHID");
  assert.match(BK.BACKUP_NAME, /^StewardMD-SURGX-notes-backup\.json$/);
});
