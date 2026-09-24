/* test/opd-profile-sheet.test.mjs - the OPD doctor-profile sheet (Clinic & staff) can always be
 * closed and always scrolls.
 *
 * Owner screenshot, 2026-09-21: with nine staff rows the card grew past the screen, the Close
 * button and the tappable backdrop were both below the fold, and the card itself did not scroll.
 * There was no way out. The card is now capped to the viewport and scrolls inside itself, and a
 * sticky X sits in its header.
 *
 * node --test test/opd-profile-sheet.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadQueue() {
  const src = readFileSync(fileURLToPath(new URL("../queue.js", import.meta.url)), "utf8");
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null });
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "", search: "" },
    document: { getElementById: () => null, createElement: el, addEventListener() {}, body: el(), documentElement: el(), querySelector: () => null, querySelectorAll: () => [], activeElement: null },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, setInterval, clearInterval, console, Promise, Date, JSON, Math,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return sb.window.QUEUE;
}
const CSS = readFileSync(fileURLToPath(new URL("../queue.css", import.meta.url)), "utf8");
const rule = (sel) => { const m = CSS.match(new RegExp("#smdQueue \\" + sel.replace(".", ".") + " \\{([^}]*)\\}")); return m ? m[1] : ""; };

const members = ["front1", "admin", "cash", "did", "doc1", "hr", "pharm", "stage", "test"].map((id, i) =>
  ({ identity: id, role: ["reception", "supervisor", "cashier", "nurse", "doctor", "hr", "pharmacy", "doctor", "nurse"][i], hasPin: id !== "admin", active: i < 6 ? false : true }));
const Q = loadQueue();
const state = { ...Q._st, view: "dashboard", session: { id: "s1", status: "active" }, tickets: [], profileOpen: true, orgId: "org1", ghisToken: null, clinicAdmin: { code: "SMD-E6HDTF", members } };

test("the sheet has a sticky X in its header, before the content, that also closes it", () => {
  const html = Q._render(state);
  const card = html.slice(html.indexOf('<div class="q-profile"'));
  assert.match(card, /^<div class="q-profile" data-q-act="profile-stop" role="dialog"/);
  const head = card.indexOf('class="q-profile-head"'), top = card.indexOf('class="q-profile-top"');
  assert.ok(head > 0 && head < top, "the header with the X comes before the avatar row");
  assert.match(card.slice(head, top), /data-q-act="profile-close" aria-label="Close"/, "the X closes the sheet and is a Close control swipe-back.js recognises");
  assert.ok(card.indexOf('class="q-pbtn ghost" data-q-act="profile-close"') > card.indexOf("q-staff-add"), "the bottom Close button is still there after the staff form");
  // all nine staff render, so the card really is taller than a phone screen
  for (const m of members) assert.ok(card.includes("<b>" + m.identity + "</b>"), m.identity);
});

test("the card is capped to the visible viewport and scrolls inside itself", () => {
  const p = rule(".q-profile");
  assert.match(p, /max-height: calc\(100dvh - 32px - env\(safe-area-inset-top, 0px\) - env\(safe-area-inset-bottom, 0px\)\)/, "capped to the dynamic viewport, safe-area aware");
  assert.match(p, /max-height: calc\(100vh - 32px/, "with a vh fallback for older WebViews");
  assert.match(p, /overflow-y: auto/);
  assert.match(p, /overscroll-behavior: contain/, "scrolling the card never scrolls the queue behind it");
  const h = rule(".q-profile-head");
  assert.match(h, /position: sticky; top: 0/, "the X stays in reach while the card scrolls");
  const sheet = rule(".q-sheet");
  assert.match(sheet, /env\(safe-area-inset-top, 0px\)/, "the sheet's padding clears the notch");
});

test("the bundle tokens moved with the fix", () => {
  const idx = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
  assert.match(idx, /queue\.css\?v=q13-profilescroll/);
  assert.match(idx, /queue\.js\?v=[^"]*profilex1/);
  assert.match(readFileSync(fileURLToPath(new URL("../sw.js", import.meta.url)), "utf8"), /var CACHE = "[^"]*opdprofile1/);
});
