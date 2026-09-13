/* The "Sign-in security" page and the second step on every staff sign-in screen. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function statusHtml() {
  const sb = { window: {} };
  sb.window.WSQ = { page() {} };
  vm.createContext(sb); vm.runInContext(read("wardsynq/site/pages/security.js"), sb);
  return (s) => sb.window.WSQ._securityStatusHtml({ esc }, s);
}

test("checking, could not check, off and on are four different sentences", () => {
  const h = statusHtml();
  assert.match(h(null), /Checking your sign-in settings/);
  const failed = h({ failed: true });
  assert.match(failed, /Could not check whether two-step sign-in is on/);
  assert.ok(!/Two-step sign-in is (off|on)\./.test(failed), "a failed check must not claim either state");
  assert.match(h({ ok: true, enabled: false }), /Two-step sign-in is off/);
  assert.ok(h({ ok: true, enabled: false }).includes('id="secStart"'));
  const on = h({ ok: true, enabled: true, recoveryLeft: 2 });
  assert.match(on, /Two-step sign-in is on/);
  assert.match(on, /2 backup codes left.*fresh set/);
  assert.ok(on.includes('id="secOff"'));
});

test("setting up shows the key and the app link; backup codes are shown once with a clear warning", () => {
  const h = statusHtml();
  const e = h({ enrolling: { secret: "ABCDEFGHIJKLMNOP", uri: "otpauth://totp/WardSynQ%3Anurse1?secret=ABCDEFGHIJKLMNOP" } });
  assert.match(e, /ABCD EFGH IJKL MNOP/);
  assert.ok(e.includes('href="otpauth://totp/'));
  assert.ok(e.includes('id="secConfirm"'));
  const codes = h({ recovery: ["AAAA1BBBB2", "CCCC3DDDD4"] });
  assert.match(codes, /They will not be shown again/);
  assert.match(codes, /AAAA1BBBB2\nCCCC3DDDD4/);
});

test("recent sign-ins: loading, failed, partial and empty read differently; failures stand out", () => {
  const sb = { window: {} };
  sb.window.WSQ = { page() {} };
  vm.createContext(sb); vm.runInContext(read("wardsynq/site/pages/security.js"), sb);
  const h = (r) => sb.window.WSQ._securitySigninsHtml({ esc, when: (t) => "T" + t }, r);
  assert.match(h(null), /Loading recent sign-ins/);
  assert.match(h({ failed: true }), /not the same as there being none/);
  assert.ok(!h({ failed: true }).includes("No sign-ins recorded"));
  assert.match(h({ ok: true, events: [], partial: false }), /No sign-ins recorded for this account yet/);
  const partial = h({ ok: true, events: [], partial: true });
  assert.match(partial, /older sign-ins may be missing/);
  assert.ok(!partial.includes("No sign-ins recorded"));
  const rows = h({ ok: true, partial: false, events: [{ ts: 2, action: "login:pin_failed", detail: "attempt 1 · Chrome on Android" }, { ts: 1, action: "login:pin_ok", detail: "Chrome on Android" }] });
  assert.match(rows, /<tr class="warn"><td>T2<\/td><td>Wrong PIN/);
  assert.match(rows, /Signed in with PIN/);
  assert.ok(rows.includes('id="secSignOutAll"'));
});

test("every staff sign-in screen asks for the code instead of reporting a wrong PIN", () => {
  for (const f of ["wardsynq/site/shell.js", "opd.html", "queue.js"]) {
    const src = read(f);
    assert.match(src, /mfa_required/, f + " must recognise the second step");
    assert.match(src, /auth\/mfa/, f + " must send the code");
    assert.match(src, /That code did not match/, f + " must say a wrong code is a wrong code");
  }
  assert.match(read("wardsynq/site/index.html"), /pages\/security\.js\?v=\d+/);
  assert.match(read("wardsynq/site/shell.js"), /item\("security", "Sign-in security"\)/);
});
