import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const NFC_PLUGIN = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/in/stewardmd/app/NfcPlugin.java"), "utf8");
const MAIN_ACT = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/in/stewardmd/app/MainActivity.java"), "utf8");
const MANIFEST = fs.readFileSync(path.join(ROOT, "android/app/src/main/AndroidManifest.xml"), "utf8");
const MIDDLEWARE = fs.readFileSync(path.join(ROOT, "functions/_middleware.js"), "utf8");
const OPD_HTML = fs.readFileSync(path.join(ROOT, "opd.html"), "utf8");
const BILL_HTML = fs.readFileSync(path.join(ROOT, "clinic-billing.html"), "utf8");

import SMD_NFC from "../smd-nfc.js";

/* ── 1. Native Android Plugin Verification ─────────────────────────────────── */
test("NfcPlugin.java has correct package and Capacitor annotation", () => {
  assert.match(NFC_PLUGIN, /package in\.stewardmd\.app;/);
  assert.match(NFC_PLUGIN, /@CapacitorPlugin\(name = "NfcPlugin"\)/);
  assert.match(NFC_PLUGIN, /public class NfcPlugin extends Plugin/);
});

test("NfcPlugin exposes required plugin methods", () => {
  assert.match(NFC_PLUGIN, /@PluginMethod\s+public void isAvailable\(PluginCall call\)/);
  assert.match(NFC_PLUGIN, /@PluginMethod\s+public void startScan\(PluginCall call\)/);
  assert.match(NFC_PLUGIN, /@PluginMethod\s+public void stopScan\(PluginCall call\)/);
  assert.match(NFC_PLUGIN, /@PluginMethod\s+public void writeTag\(PluginCall call\)/);
  assert.match(NFC_PLUGIN, /@PluginMethod\s+public void cancelWrite\(PluginCall call\)/);
  assert.match(NFC_PLUGIN, /@PluginMethod\s+public void openSettings\(PluginCall call\)/);
});

test("NfcPlugin implements foreground reader mode and NDEF read/write logic", () => {
  assert.match(NFC_PLUGIN, /nfcAdapter\.enableReaderMode/);
  assert.match(NFC_PLUGIN, /nfcAdapter\.disableReaderMode/);
  assert.match(NFC_PLUGIN, /FLAG_READER_NFC_A/);
  assert.match(NFC_PLUGIN, /Ndef\.get\(tag\)/);
  assert.match(NFC_PLUGIN, /NdefFormatable\.get\(tag\)/);
  assert.match(NFC_PLUGIN, /NdefRecord\.createTextRecord/);
  assert.match(NFC_PLUGIN, /NdefRecord\.createUri/);
  assert.match(NFC_PLUGIN, /notifyListeners\("tagDiscovered",/);
  assert.match(NFC_PLUGIN, /notifyListeners\("tagWritten",/);
});

test("NfcPlugin implements safe activity lifecycle hooks", () => {
  assert.match(NFC_PLUGIN, /protected void handleOnResume\(\)/);
  assert.match(NFC_PLUGIN, /protected void handleOnPause\(\)/);
  assert.match(NFC_PLUGIN, /protected void handleOnDestroy\(\)/);
  assert.match(NFC_PLUGIN, /protected void handleOnNewIntent\(Intent intent\)/);
});

test("MainActivity registers NfcPlugin", () => {
  assert.match(MAIN_ACT, /registerPlugin\(NfcPlugin\.class\);/);
});

test("AndroidManifest declares NFC permission and optional hardware feature", () => {
  assert.match(MANIFEST, /<uses-permission android:name="android\.permission\.NFC" \/>/);
  assert.match(MANIFEST, /<uses-feature android:name="android\.hardware\.nfc" android:required="false" \/>/);
});

/* ── 2. Middleware & HTML Integration ──────────────────────────────────────── */
test("functions/_middleware.js pass-through covers smd-nfc.js", () => {
  assert.match(MIDDLEWARE, /url\.pathname === "\/smd-nfc\.js"/);
});

test("opd.html and clinic-billing.html include smd-nfc.js", () => {
  assert.match(OPD_HTML, /<script src="\/smd-nfc\.js\?v=[^"]+"><\/script>/);
  assert.match(BILL_HTML, /<script src="\/smd-nfc\.js\?v=[^"]+"><\/script>/);
});

/* ── 3. Unified JS Bridge (smd-nfc.js) Contract ───────────────────────────── */
test("smd-nfc.js exports API surface", () => {
  assert.equal(typeof SMD_NFC.isSupportedSync, "function");
  assert.equal(typeof SMD_NFC.isSupported, "function");
  assert.equal(typeof SMD_NFC.startScan, "function");
  assert.equal(typeof SMD_NFC.stopScan, "function");
  assert.equal(typeof SMD_NFC.writeTag, "function");
  assert.equal(typeof SMD_NFC.openSettings, "function");
  assert.equal(typeof SMD_NFC.parseRecordText, "function");
});

test("smd-nfc.js reports unsupported when neither native nor web NFC is present", async () => {
  delete globalThis.window;
  const status = await SMD_NFC.isSupported();
  assert.equal(status.supported, false);
  assert.equal(status.native, false);
  assert.equal(status.web, false);
  assert.equal(SMD_NFC.isSupportedSync(), false);

  await assert.rejects(
    async () => { await SMD_NFC.writeTag("SMD-1234"); },
    /NFC writing is not available/
  );
});

test("smd-nfc.js interacts seamlessly with mock Native Capacitor NfcPlugin", async () => {
  let scanStarted = false;
  let scanStopped = false;
  let writtenPayload = null;
  let listenerCb = null;

  globalThis.window = {
    Capacitor: {
      Plugins: {
        NfcPlugin: {
          isAvailable: async () => ({ available: true, enabled: true }),
          startScan: async () => { scanStarted = true; return { status: "listening" }; },
          stopScan: async () => { scanStopped = true; return { status: "stopped" }; },
          writeTag: async (opts) => { writtenPayload = opts; return { success: true, uid: "04A1B2C3", ...opts }; },
          openSettings: async () => ({ success: true }),
          addListener: async (evt, cb) => {
            if (evt === "tagDiscovered") listenerCb = cb;
            return { remove: () => { listenerCb = null; } };
          }
        }
      }
    }
  };

  assert.equal(SMD_NFC.isSupportedSync(), true);

  const status = await SMD_NFC.isSupported();
  assert.equal(status.supported, true);
  assert.equal(status.native, true);
  assert.equal(status.enabled, true);

  let scannedTag = null;
  const scanRes = await SMD_NFC.startScan((tag) => { scannedTag = tag; });
  assert.equal(scanRes.mode, "native");
  assert.equal(scanStarted, true);

  // Simulate tag discovered event
  assert.ok(listenerCb);
  listenerCb({ uid: "04A1B2C3", text: "SMD-2026-PAT-99", url: "https://stewardmd.in/opd?uid=SMD-2026-PAT-99" });
  assert.equal(scannedTag.text, "SMD-2026-PAT-99");
  assert.equal(scannedTag.uid, "04A1B2C3");

  // Write tag
  const writeRes = await SMD_NFC.writeTag("SMD-2026-PAT-99");
  assert.equal(writeRes.success, true);
  assert.equal(writtenPayload.text, "SMD-2026-PAT-99");

  // Stop scan
  await SMD_NFC.stopScan();
  assert.equal(scanStopped, true);

  delete globalThis.window;
});

/* ── 4. UHID extraction, empty-tag routing, app listener ─────────────────────── */
test("smd-nfc.js exports the walk-in / follow-up / empty-tag surface", () => {
  assert.equal(typeof SMD_NFC.parseTagUhid, "function");
  assert.equal(typeof SMD_NFC.isEmptyTag, "function");
  assert.equal(typeof SMD_NFC.showEmptyTagPrompt, "function");
  assert.equal(typeof SMD_NFC.initAppListener, "function");
});

test("parseTagUhid reads plain text, deep links, records, events and tag objects", () => {
  assert.equal(SMD_NFC.parseTagUhid("SMD-AB12CD-0007"), "SMD-AB12CD-0007");
  assert.equal(SMD_NFC.parseTagUhid("  MR26100001  "), "MR26100001");
  assert.equal(SMD_NFC.parseTagUhid("https://stewardmd.in/opd?uid=SMD-X1"), "SMD-X1");
  assert.equal(SMD_NFC.parseTagUhid("https://stewardmd.in/opd?patientId=P2"), "P2");
  assert.equal(SMD_NFC.parseTagUhid("https://stewardmd.in/?scan=S3"), "S3");
  assert.equal(SMD_NFC.parseTagUhid("https://stewardmd.in/opd?mrn=M4"), "M4");
  assert.equal(SMD_NFC.parseTagUhid("https://stewardmd.in/opd?uid=SMD%20X5"), "SMD X5");
  assert.equal(SMD_NFC.parseTagUhid("https://example.com/x"), "", "a URL with no patient param is not a UHID");
  assert.equal(SMD_NFC.parseTagUhid({ text: "SMD-T1", url: "", uid: "04A1" }), "SMD-T1");
  assert.equal(SMD_NFC.parseTagUhid({ text: "", url: "https://stewardmd.in/opd?uid=SMD-U1" }), "SMD-U1");
  assert.equal(SMD_NFC.parseTagUhid({ message: { records: [{ recordType: "text", data: "SMD-R1" }] } }), "SMD-R1");
  assert.equal(SMD_NFC.parseTagUhid([{ recordType: "text", data: "SMD-RL1" }]), "SMD-RL1");
  assert.equal(SMD_NFC.parseTagUhid({ raw: { text: "SMD-RAW1" } }), "SMD-RAW1");
  assert.equal(SMD_NFC.parseTagUhid(""), "");
  assert.equal(SMD_NFC.parseTagUhid(null), "");
  assert.equal(SMD_NFC.parseTagUhid({}), "");
});

test("isEmptyTag tells a blank tag (and the serial echo) from a real payload", () => {
  assert.equal(SMD_NFC.isEmptyTag(null), true);
  assert.equal(SMD_NFC.isEmptyTag(""), true);
  assert.equal(SMD_NFC.isEmptyTag({ uid: "04A1B2C3", formattedUid: "04A1B2C3", text: "", url: "" }), true);
  assert.equal(SMD_NFC.isEmptyTag({ uid: "04A1B2C3", formattedUid: "04A1B2C3", text: "04A1B2C3", url: "" }), true, "chip-serial echo is not a UHID");
  assert.equal(SMD_NFC.isEmptyTag({ uid: "04A1B2C3", formattedUid: "04:A1:B2:C3", text: "04A1B2C3", url: "" }), true, "native uid/formattedUid spellings both match the echo");
  assert.equal(SMD_NFC.isEmptyTag({ text: "SMD-1", uid: "04A1" }), false);
  assert.equal(SMD_NFC.isEmptyTag({ url: "https://stewardmd.in/opd?uid=X" }), false);
  assert.equal(SMD_NFC.isEmptyTag({ message: { records: [{ recordType: "text", data: "SMD-1" }] } }), false);
});

test("showEmptyTagPrompt no-ops without a DOM", () => {
  assert.equal(SMD_NFC.showEmptyTagPrompt({ uid: "04A1" }, {}), null);
});

test("initAppListener routes UHID tags to onUhid and blank tags to onEmpty", async () => {
  let listenerCb = null;
  globalThis.window = {
    Capacitor: {
      Plugins: {
        NfcPlugin: {
          isAvailable: async () => ({ available: true, enabled: true }),
          startScan: async () => ({ status: "listening" }),
          stopScan: async () => ({ status: "stopped" }),
          writeTag: async (opts) => ({ success: true, ...opts }),
          addListener: async (evt, cb) => {
            if (evt === "tagDiscovered") listenerCb = cb;
            return { remove: () => { listenerCb = null; } };
          }
        }
      }
    }
  };

  try {
    const uhids = [];
    const empties = [];
    await SMD_NFC.initAppListener({
      onUhid: (u) => { uhids.push(u); },
      onEmpty: (t) => { empties.push(t); }
    });
    assert.ok(listenerCb, "the listener registered with the native plugin");

    listenerCb({ uid: "04A1", text: "SMD-FOLLOWUP-7", url: "https://stewardmd.in/opd?uid=SMD-FOLLOWUP-7" });
    assert.deepEqual(uhids, ["SMD-FOLLOWUP-7"]);
    assert.equal(empties.length, 0);

    listenerCb({ uid: "04B2", formattedUid: "04B2", text: "", url: "" });
    assert.equal(uhids.length, 1);
    assert.equal(empties.length, 1, "a blank tag routes to onEmpty");

    listenerCb({ uid: "04C3D4", formattedUid: "04C3D4", text: "04C3D4", url: "" });
    assert.equal(uhids.length, 1, "the serial echo never routes as a UHID");
    assert.equal(empties.length, 2);

    // Deep-link-only tag: UHID comes from the URL params.
    listenerCb({ uid: "04D5", text: "", url: "https://stewardmd.in/opd?patientId=SMD-URL-9" });
    assert.deepEqual(uhids, ["SMD-FOLLOWUP-7", "SMD-URL-9"]);
  } finally {
    await SMD_NFC.stopScan();
    delete globalThis.window;
  }
});

test("initAppListener falls back to the empty-tag sheet when onEmpty is absent", async () => {
  let listenerCb = null;
  globalThis.window = {
    Capacitor: {
      Plugins: {
        NfcPlugin: {
          startScan: async () => ({ status: "listening" }),
          stopScan: async () => ({ status: "stopped" }),
          addListener: async (evt, cb) => {
            if (evt === "tagDiscovered") listenerCb = cb;
            return { remove: () => { listenerCb = null; } };
          }
        }
      }
    }
  };
  try {
    let seen = "";
    await SMD_NFC.initAppListener({ onUhid: (u) => { seen = u; } });
    listenerCb({ uid: "04E6", text: "", url: "" }); // no document in Node: sheet no-ops, nothing throws
    assert.equal(seen, "");
    listenerCb({ uid: "04E6", text: "SMD-SEEN-1", url: "" });
    assert.equal(seen, "SMD-SEEN-1");
  } finally {
    await SMD_NFC.stopScan();
    delete globalThis.window;
  }
});

test("smd-nfc.js interacts seamlessly with mock Web NFC NDEFReader", async () => {
  let scanCalled = false;
  let writeCalledWith = null;

  class MockNDEFReader {
    async scan() {
      scanCalled = true;
      return Promise.resolve();
    }
    async write(payload) {
      writeCalledWith = payload;
      return Promise.resolve();
    }
  }

  globalThis.window = {
    NDEFReader: MockNDEFReader
  };

  assert.equal(SMD_NFC.isSupportedSync(), true);

  const status = await SMD_NFC.isSupported();
  assert.equal(status.supported, true);
  assert.equal(status.web, true);
  assert.equal(status.native, false);

  const writeRes = await SMD_NFC.writeTag("SMD-WEB-NFC-001");
  assert.equal(writeRes.success, true);
  assert.equal(writeCalledWith, "SMD-WEB-NFC-001");

  delete globalThis.window;
});
