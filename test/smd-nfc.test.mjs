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
