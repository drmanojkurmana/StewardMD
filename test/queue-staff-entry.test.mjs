/* Adding clinic staff was impossible whenever the owner typed faster than the network: the add-staff
 * fields sit inside the profile sheet, and loadClinicAdmin() repainted that sheet when GET /org and
 * GET /members resolved, clearing the half-typed login name and PIN. The repaint now restores the
 * in-progress entry and the caret. Source-level wiring checks (queue.js is a browser IIFE). */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "queue.js"), "utf8");

test("clinic-admin responses no longer call the clobbering paint()", () => {
  const lines = SRC.split("\n").filter((l) => l.includes("st.clinicAdmin.code =") || l.includes("st.clinicAdmin.members ="));
  assert.equal(lines.length, 2, "both clinic-admin fetches found");
  for (const l of lines) {
    assert.match(l, /paintKeepingStaffEntry\(\)/, "repaints through the preserving wrapper");
    assert.ok(!/profileOpen\) paint\(\)/.test(l), "no bare paint() left on this path");
  }
});

test("the wrapper preserves all three add-staff fields", () => {
  const fields = SRC.match(/var STAFF_FIELDS = \[([^\]]*)\]/);
  assert.ok(fields, "STAFF_FIELDS declared");
  for (const id of ["qStaffName", "qStaffRole", "qStaffPin"]) assert.match(fields[1], new RegExp(`"${id}"`), `${id} preserved`);
});

test("the wrapper restores values and caret after painting", () => {
  const fn = SRC.slice(SRC.indexOf("function paintKeepingStaffEntry"), SRC.indexOf("function loadClinicAdmin"));
  assert.match(fn, /paint\(\);/, "still repaints (the member list must refresh)");
  assert.ok(fn.indexOf("el.value = vals[id]") > fn.indexOf("paint();"), "values restored AFTER the repaint");
  assert.match(fn, /setSelectionRange/, "caret position restored so typing is not interrupted");
  assert.match(fn, /again\.focus\(\)/, "focus returns to the field being typed in");
});

test("every field id the wrapper preserves is one addStaff actually reads", () => {
  const reader = SRC.split("\n").find((l) => l.includes('getElementById("qStaffName")'));
  assert.ok(reader, "addStaff reads the fields");
  for (const id of ["qStaffName", "qStaffRole", "qStaffPin"]) assert.ok(reader.includes(id), `${id} is read by addStaff`);
});
