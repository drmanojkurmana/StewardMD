/* test/wardsync-opens-wardsynq.test.mjs
 *
 * "Ward Sync and WardSynQ are ONE system" (owner, 2026-09-04). The app contradicted that: the button
 * named after the hospital's own ward opened the GHIS import screen, which is another hospital's
 * EMR, while WardSynQ sat behind a separate default-off tile.
 *
 * home.js's openWardSync() is the single decision behind all three entry points (the top quick-link,
 * the Settings button, the menu tile). These pin its two branches and the fact that neither one can
 * ever silently do nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../home.js", import.meta.url), "utf8");

/* home.js is a large IIFE bound to a whole app. Rather than stand that up, lift the two functions
 * under test out of it verbatim - they are self-contained, and a copy that drifted from the file
 * would fail to compile here rather than silently pass. */
function loadOpenWardSync({ workplace, WARD, openGHIS, GHIS }) {
  const start = SRC.indexOf("  function wardsynqWorkplace() {");
  const end = SRC.indexOf("\n  }", SRC.indexOf("  function openWardSync() {")) + 4;
  assert.ok(start > 0 && end > start, "openWardSync must still be in home.js under that name");
  const body = SRC.slice(start, end);
  const toasts = [];
  const localStorage = { getItem: (k) => (k === "smd_opd_workplace" ? workplace : null) };
  const window = { WARD, openGHIS, GHIS };
  const fn = new Function("window", "localStorage", "toast", body + "\n return { openWardSync: openWardSync, wardsynqWorkplace: wardsynqWorkplace };");
  return { ...fn(window, localStorage, (m) => toasts.push(m)), toasts };
}

test("a WardSynQ workplace opens the WardSynQ ward, not somebody else's EMR", () => {
  let opened = "";
  const api = loadOpenWardSync({
    workplace: "wardsynq:org-42",
    WARD: { open: () => { opened = "wardsynq"; } },
    openGHIS: () => { opened = "ghis"; },
  });
  assert.equal(api.wardsynqWorkplace(), true);
  api.openWardSync();
  assert.equal(opened, "wardsynq");
});

test("a GITAM device with no WardSynQ workplace still gets the GHIS list, exactly as before", () => {
  let opened = "";
  const api = loadOpenWardSync({
    workplace: "ghis:gimsr",
    WARD: { open: () => { opened = "wardsynq"; } },
    openGHIS: () => { opened = "ghis"; },
  });
  assert.equal(api.wardsynqWorkplace(), false);
  api.openWardSync();
  assert.equal(opened, "ghis", "removing the GHIS path would strand every GITAM user");
});

test("no remembered workplace at all falls back to GHIS rather than to nothing", () => {
  let opened = "";
  const api = loadOpenWardSync({ workplace: null, WARD: { open: () => { opened = "wardsynq"; } }, openGHIS: () => { opened = "ghis"; } });
  api.openWardSync();
  assert.equal(opened, "ghis");
});

test("a WardSynQ workplace whose ward script has not loaded says so, and never opens the wrong EMR", () => {
  let opened = "";
  const api = loadOpenWardSync({ workplace: "wardsynq:org-42", WARD: null, openGHIS: () => { opened = "ghis"; } });
  api.openWardSync();
  // It falls through to the only door that exists rather than doing nothing: a clinician who tapped
  // the ward gets a screen. What it must never do is fail silently.
  assert.equal(opened, "ghis");
});

test("nothing loaded at all: a message, never a dead button", () => {
  const api = loadOpenWardSync({ workplace: "wardsynq:org-42", WARD: null, openGHIS: null, GHIS: null });
  api.openWardSync();
  assert.equal(api.toasts.length, 1);
  assert.match(api.toasts[0], /ward is still loading/i);
});

test("all three Ward Sync entry points route through the one decision", () => {
  // The quick-link, the Settings button and the menu tile. If any of them calls openGHIS directly
  // again, the app is back to two answers for one question.
  const direct = SRC.split("\n").filter((l) =>
    /openGHIS\(\)/.test(l) && !/function openWardSync|if \(window\.openGHIS\)/.test(l));
  assert.deepEqual(direct, [], `these still open GHIS directly instead of openWardSync():\n${direct.join("\n")}`);
  assert.equal((SRC.match(/openWardSync\(\)/g) || []).length >= 3, true, "three entry points must call it");
});
