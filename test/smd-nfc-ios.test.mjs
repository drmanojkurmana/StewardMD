/* iPhone Ni-Key NFC: the CoreNFC NfcPlugin (ios/App/App/NfcPlugin.swift), its signing/plist wiring,
 * and the on-demand behaviour smd-nfc.js gives it (one system sheet per tap, never at app launch). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SWIFT = read("ios/App/App/NfcPlugin.swift");
const MAIN_VC = read("ios/App/App/MainViewController.swift");
const PBX = read("ios/App/App.xcodeproj/project.pbxproj");
const ENT = read("ios/App/App/App.entitlements");
const PLIST = read("ios/App/App/Info.plist");
const REG = read("patient-register.js");

import SMD_NFC from "../smd-nfc.js";

/* ── 1. Native plugin + wiring ─────────────────────────────────────────────── */
test("NfcPlugin.swift is a bridged Capacitor plugin named NfcPlugin with the Android method set", () => {
  assert.match(SWIFT, /@objc\(NfcPlugin\)/);
  assert.match(SWIFT, /class NfcPlugin: CAPPlugin, CAPBridgedPlugin, NFCTagReaderSessionDelegate/);
  assert.match(SWIFT, /jsName = "NfcPlugin"/);
  for (const m of ["isAvailable", "startScan", "stopScan", "writeTag", "cancelWrite", "openSettings"]) {
    assert.match(SWIFT, new RegExp(`CAPPluginMethod\\(name: "${m}"`), m);
    assert.match(SWIFT, new RegExp(`@objc func ${m}\\(_ call: CAPPluginCall\\)`), m);
  }
});

test("NfcPlugin.swift reads the serial + NDEF, writes Text+URI and reads back before resolving", () => {
  assert.match(SWIFT, /NFCTagReaderSession\(pollingOption: \[\.iso14443, \.iso15693\]/);
  assert.match(SWIFT, /notifyListeners\("tagDiscovered"/);
  for (const k of ['"uid"', '"formattedUid"', '"text"', '"url"']) assert.ok(SWIFT.includes(k), k);
  assert.match(SWIFT, /wellKnownTypeTextPayload\(string: writeText/);
  assert.match(SWIFT, /wellKnownTypeURIPayload\(url: u\)/);
  assert.match(SWIFT, /ndef\.writeNDEF\(message\)[\s\S]*ndef\.readNDEF \{ back/, "read-back follows the write");
  assert.match(SWIFT, /"verified": verified/);
  assert.match(SWIFT, /"readBack": \["text": rb\.text, "url": rb\.url\]/);
  assert.match(SWIFT, /notifyListeners\("scanEnded"/);
  assert.match(SWIFT, /case \.readOnly:/);
  assert.match(SWIFT, /message\.length > capacity/);
});

test("MainViewController registers NfcPlugin and the App target compiles NfcPlugin.swift", () => {
  assert.match(MAIN_VC, /bridge\?\.registerPluginInstance\(NfcPlugin\(\)\)/);
  assert.match(PBX, /\/\* NfcPlugin\.swift \*\/ = \{isa = PBXFileReference;[^}]*path = NfcPlugin\.swift;/);
  assert.match(PBX, /\/\* NfcPlugin\.swift in Sources \*\/,/);
});

test("App.entitlements asks for TAG reader sessions only (NDEF is rejected by App Store Connect)", () => {
  assert.match(ENT, /<key>com\.apple\.developer\.nfc\.readersession\.formats<\/key>\s*<array>\s*<string>TAG<\/string>\s*<\/array>/);
  assert.doesNotMatch(ENT, /<string>NDEF<\/string>/);
});

test("Info.plist explains NFC use and lists the NDEF Type 4 application id", () => {
  assert.match(PLIST, /<key>NFCReaderUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/);
  assert.match(PLIST, /<key>com\.apple\.developer\.nfc\.readersession\.iso7816\.select-identifiers<\/key>\s*<array>\s*<string>D2760000850101<\/string>/);
  assert.doesNotMatch(PLIST.match(/NFCReaderUsageDescription<\/key>\s*<string>([^<]*)/)[1], /—/, "no em-dash");
});

test("the New patient sheet's NFC read opts in as a tap and resets on a closed sheet", () => {
  assert.match(REG, /userInitiated: true,\s*onEnd: function \(info\) \{\s*resetScan\(\);/);
});

/* ── 2. smd-nfc.js on an iPhone ────────────────────────────────────────────── */
function iosPlugin(over) {
  const calls = { start: 0, stop: 0, write: [] };
  const listeners = {};
  const plugin = {
    isAvailable: async () => ({ available: true, enabled: true, onDemand: true }),
    startScan: async () => { calls.start++; return { status: "listening" }; },
    stopScan: async () => { calls.stop++; return { status: "stopped" }; },
    writeTag: async (o) => { calls.write.push(o); return { success: true, uid: "04A1B2", text: o.text, url: o.url, verified: true, readBack: { text: o.text, url: o.url } }; },
    addListener: async (evt, cb) => { listeners[evt] = cb; return { remove: () => { if (listeners[evt] === cb) delete listeners[evt]; } }; },
    ...over,
  };
  globalThis.window = { Capacitor: { getPlatform: () => "ios", Plugins: { NfcPlugin: plugin } } };
  return { calls, listeners };
}
function setActivation(isActive) {
  Object.defineProperty(globalThis, "navigator", { value: { userActivation: { isActive } }, configurable: true, writable: true });
}
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
function restore() {
  delete globalThis.window;
  if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
}

test("iPhone: a scan with no tap never opens the NFC sheet", async () => {
  const { calls } = iosPlugin();
  setActivation(false);
  await assert.rejects(SMD_NFC.startScan(() => {}), (e) => e.code === "NEEDS_USER_TAP");
  assert.equal(calls.start, 0);
  await SMD_NFC.stopScan();
  restore();
});

test("iPhone: initAppListener does not start a launch-time scan", async () => {
  const { calls } = iosPlugin();
  setActivation(true);
  const res = await SMD_NFC.initAppListener({ onUhid() {} });
  assert.deepEqual(res, { listening: false, mode: "native", onDemand: true });
  assert.equal(calls.start, 0);
  restore();
});

test("iPhone: every tap re-arms the sheet, the tag is delivered and a cancel reaches onEnd", async () => {
  const { calls, listeners } = iosPlugin();
  setActivation(false);
  const ends = [];
  let got = null;
  const r1 = await SMD_NFC.startScan((t) => { got = t; }, { userInitiated: true, onEnd: (i) => ends.push(i) });
  assert.deepEqual(r1, { listening: true, mode: "native", onDemand: true });
  assert.equal(calls.start, 1);

  // Cancel on the system sheet: onEnd fires; a second tap opens the sheet again (no isListening latch).
  listeners.scanEnded({ reason: "cancelled", message: "NFC scan cancelled." });
  assert.deepEqual(ends, [{ reason: "cancelled", message: "NFC scan cancelled." }]);
  await SMD_NFC.startScan((t) => { got = t; }, { userInitiated: true, onEnd: (i) => ends.push(i) });
  assert.equal(calls.start, 2);

  // Even without a fresh scanEnded, a further tap re-arms.
  await SMD_NFC.startScan((t) => { got = t; }, { userInitiated: true, onEnd: (i) => ends.push(i) });
  assert.equal(calls.start, 3);

  listeners.tagDiscovered({ uid: "04A1B2", formattedUid: "04:A1:B2", text: "SMD-AB12CD-0007", url: "https://stewardmd.in/opd?uid=SMD-AB12CD-0007" });
  assert.equal(got.text, "SMD-AB12CD-0007");
  assert.equal(SMD_NFC.parseTagUhid(got), "SMD-AB12CD-0007");
  listeners.scanEnded({ reason: "tag", message: "" });
  assert.equal(ends.length, 1, "a successful read is not an onEnd");

  // A blank tag: the serial echo routes as empty, exactly as on Android.
  await SMD_NFC.startScan((t) => { got = t; }, { userInitiated: true });
  listeners.tagDiscovered({ uid: "04A1B2", formattedUid: "04:A1:B2", text: "04A1B2", url: "" });
  assert.equal(SMD_NFC.isEmptyTag(got), true);
  await SMD_NFC.stopScan();
  assert.equal(listeners.scanEnded, undefined, "stopScan drops the end listener");
  restore();
});

test("iPhone: a live tap (userActivation.isActive) needs no opt-in", async () => {
  const { calls } = iosPlugin();
  setActivation(true);
  await SMD_NFC.startScan(() => {});
  assert.equal(calls.start, 1);
  await SMD_NFC.stopScan();
  restore();
});

test("iPhone: writeTag passes the native read-back and rejects a mismatch", async () => {
  const { calls } = iosPlugin();
  setActivation(true);
  const url = "https://stewardmd.in/opd?uid=SMD-AB12CD-0007";
  const res = await SMD_NFC.writeTag({ text: "SMD-AB12CD-0007", url }, { verifyReadBack: true });
  assert.equal(res.success, true);
  assert.equal(res.verified, true);
  assert.deepEqual(calls.write[0], { text: "SMD-AB12CD-0007", url });
  restore();

  iosPlugin({ writeTag: async (o) => ({ success: true, text: o.text, url: o.url, verified: false, readBack: { text: "junk", url: "" } }) });
  await assert.rejects(SMD_NFC.writeTag({ text: "SMD-AB12CD-0007", url }), (e) => e.code === "WRITE_VERIFICATION_FAILED");
  restore();
});

test("iPhone without the plugin (older store build) still gets the honest message", async () => {
  globalThis.window = { Capacitor: { getPlatform: () => "ios", Plugins: {} } };
  await assert.rejects(SMD_NFC.startScan(() => {}), /NFC is not available in the iPhone app yet/);
  await assert.rejects(SMD_NFC.writeTag("SMD-1"), /NFC is not available in the iPhone app yet/);
  restore();
});

test("Android is unchanged: no gesture gate, a second startScan does not re-arm", async () => {
  const { calls } = iosPlugin();
  globalThis.window.Capacitor.getPlatform = () => "android";
  setActivation(false);
  await SMD_NFC.startScan(() => {});
  await SMD_NFC.startScan(() => {});
  assert.equal(calls.start, 1);
  await SMD_NFC.stopScan();
  restore();
});
