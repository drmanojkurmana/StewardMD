/* test/rx-verify-entrypoints.test.mjs — you can actually GET to the verifier.
 *
 * The verification stack was built and tested, but a feature nobody can reach does not exist. Asked
 * for as: "create verify prescription button in app and website stewardmd.in for app inside
 * Prescription tile (create and another button verify)".
 *
 * So there are three doors, and each one is pinned here:
 *   1. The app's Prescription tile carries TWO controls - Create and Verify.
 *   2. Verify opens the in-app checker, and is NOT gated on being a verified prescriber (the person
 *      checking is usually a pharmacist, who is not a prescriber at all).
 *   3. stewardmd.in links to /verify from both the desktop nav and the mobile menu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const HOME = read("home.js");
const RX = read("prescription.js");
const SITE = read("_site/index.html");

/* ---------------- 1. the tile has two buttons ---------------- */

test("the Prescription tile offers Create AND Verify", () => {
  const m = /tile2\("note", "Prescription"[\s\S]{0,300}?\]\)/.exec(HOME);
  assert.ok(m, "the Prescription entry must be a two-action tile");
  assert.match(m[0], /label: "Create", act: "rx"/, "Create opens the pad");
  assert.match(m[0], /label: "Verify", act: "rxverify"/, "Verify opens the checker");
});

test("both controls are real buttons with their own tap target", () => {
  // A <button> cannot nest buttons, so the two-action tile must be a div carrying its own controls -
  // otherwise the markup is invalid and only one of the two is reliably clickable.
  assert.match(HOME, /function tile2\(icon, title, cap, actions\)/);
  assert.match(HOME, /'<div class="hv-tile hv-tile2"/, "the container is a div, not a button");
  assert.match(HOME, /class="hv-t2b/, "each action is its own button");
  assert.match(HOME, /\.hv-t2b\{[^"]*min-height:40px/, "each control keeps a real tap target");
});

/* ---------------- 2. Verify is wired, and open to non-prescribers ---------------- */

test("the Verify button routes to the in-app checker", () => {
  assert.match(HOME, /if \(a === "rxverify"\) \{ ACT\.prescriptionVerify\(\); return; \}/);
  assert.match(HOME, /prescriptionVerify: function \(\)[\s\S]{0,240}SMD_RX\.openVerify/);
});

test("openVerify is exported and NOT gated on canPrescribe", () => {
  assert.match(RX, /window\.SMD_RX = \{[^}]*openVerify: openVerify/, "exported on the module's API");
  const fn = /function openVerify\(prefill\) \{[\s\S]*?\n  \}/.exec(RX);
  assert.ok(fn, "openVerify exists");
  assert.equal(/canPrescribe\(\)/.test(fn[0]), false,
    "checking someone else's prescription is not prescribing - a pharmacist must not be blocked");
});

test("the in-app checker reads the SAME public endpoint the web page does", () => {
  // Two lookups that could disagree is the failure mode worth preventing: one definition of what a
  // verification says lives on the server (_rx_public.resolve).
  assert.match(RX, /fetch\("\/api\/rx\/v\/" \+ encodeURIComponent\(code\)\)/);
  assert.match(RX, /SMD_RX_VALIDITY\.normalizeCode\(raw\)/,
    "a code typed off paper is normalised the same way the server normalises it");
});

test("the checker states the verified/not-verified answer in words, never colour alone", () => {
  assert.match(RX, /Verified by StewardMD/);
  assert.match(RX, /NOT verified/);
  for (const state of ["ACTIVE", "EXPIRED", "REVOKED", "not_found"]) {
    assert.ok(new RegExp(state + "\\s*:").test(RX), `the checker must handle ${state}`);
  }
});

test("a failed lookup says so rather than looking like a valid prescription", () => {
  assert.match(RX, /status: "error"/, "a network failure has its own state");
  assert.match(RX, /Could not check/, "and says so in plain words");
});

/* ---------------- 2b. the native QR scanner ----------------
 * The phone's own scanner (@capacitor/barcode-scanner: Google Play Services' code scanner on
 * Android, AVFoundation on iOS). Two things are easy to get wrong and impossible to see in a diff:
 * the plugin is reached through Capacitor.Plugins (this app is buildless ES5, so the package's ESM
 * wrapper is unreachable) - and that wrapper is where the option defaults live, so calling the raw
 * plugin without them sends undefined to the native layer. */

test("the scanner is a declared dependency, not an assumed one", async () => {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const pkg = req("../package.json");
  assert.ok(pkg.dependencies["@capacitor/barcode-scanner"],
    "@capacitor/barcode-scanner must be in dependencies, or the native build has no scanner");
});

test("the plugin is reached through Capacitor.Plugins, not an ESM import", () => {
  // The global may be aliased first (var C = window.Capacitor), so match the access, not one spelling.
  assert.match(RX, /window\.Capacitor/, "it reads the Capacitor global");
  assert.match(RX, /\.Plugins && \w+\.Plugins\.CapacitorBarcodeScanner/,
    "buildless ES5 cannot import the package wrapper - it must go through Capacitor.Plugins");
  assert.ok(!/^import .*barcode-scanner/m.test(RX), "no ESM import of the plugin in this file");
});

test("every option the ESM wrapper would default is passed explicitly", () => {
  // The wrapper fills these in; calling the plugin directly does not, and undefined reaches native.
  const call = /scanBarcode\(\{[\s\S]*?\}\)/.exec(RX);
  assert.ok(call, "the scan call exists");
  for (const opt of ["hint", "scanInstructions", "scanButton", "scanText", "cameraDirection", "scanOrientation"]) {
    assert.ok(new RegExp("\\b" + opt + ":").test(call[0]), `${opt} must be passed explicitly`);
  }
  assert.match(RX, /RXV_HINT_QR = 0/, "QR_CODE is 0 (Html5QrcodeSupportedFormats.QR_CODE)");
  assert.match(RX, /RXV_CAM_BACK = 1/, "BACK camera is 1");
  assert.match(RX, /RXV_ORIENT_ADAPTIVE = 3/, "ADAPTIVE orientation is 3");
});

test("the scan button only appears where the plugin actually exists", () => {
  // The package's web fallback is a lazily-imported ESM module that cannot load here, so a button
  // shown off-device would simply do nothing. Native-only, with the typed code as the way in.
  assert.match(RX, /isNativePlatform\(\)/, "gated on running natively");
  assert.match(RX, /rxvScanner\(\) \? '<button class="rxv-scan"/, "the button is conditional on the plugin");
});

test("a scanned QR URL and a pasted bare code both resolve", () => {
  const m = /function rxvCodeFrom\(text\) \{[\s\S]*?\n  \}/.exec(RX);
  assert.ok(m, "rxvCodeFrom exists");
  const fn = new Function("return " + m[0].replace(/^function/, "function"))();
  assert.equal(fn("https://stewardmd.in/verify/1234-5678-90AB-CDEF"), "1234-5678-90AB-CDEF");
  assert.equal(fn("1234-5678-90AB-CDEF"), "1234-5678-90AB-CDEF", "a pasted bare code still works");
  assert.equal(fn("https://stewardmd.in/verify/ABCD-1234?src=qr"), "ABCD-1234", "a query string is ignored");
});

test("a cancelled or denied scan says so instead of failing silently", () => {
  // Cancelling is the common case and must not look like an error; a denied camera would otherwise
  // be completely silent. One neutral line covers both and names the way that still works.
  assert.match(RX, /Scan cancelled, or the camera is unavailable/);
});

/* ---------------- 3. the website ---------------- */

test("stewardmd.in links to the verifier from the nav and the mobile menu", () => {
  const links = SITE.match(/https:\/\/stewardmd\.in\/verify/g) || [];
  assert.ok(links.length >= 2, `expected a desktop nav link AND a mobile menu link, found ${links.length}`);
  assert.match(SITE, /id="navVerify"[^>]*href="https:\/\/stewardmd\.in\/verify"/, "desktop nav entry");
  assert.match(SITE, /href="https:\/\/stewardmd\.in\/verify" data-act="closeMenu"/, "mobile menu entry");
});

test("the site link is absolute - the same address is printed on paper", () => {
  // The address under the QR is what someone types when the scan fails, so a relative href would be
  // wrong the moment anyone reads it off the sheet.
  assert.ok(!/href="\/verify"/.test(SITE), "use the absolute public URL, as printed");
  assert.match(RX, /stewardmd\.in\/verify/, "and the printed sheet shows that same address");
});
