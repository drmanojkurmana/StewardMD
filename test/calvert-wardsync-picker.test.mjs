/* "Fetch Patient Labs from WardSync EMR" in the Calvert calculator only read a patient that was
 * ALREADY selected in an EMR session. With no active session it toasted "No active WardSync
 * patient" and stopped, leaving the clinician no route to one. It now opens the ward patient list
 * (which asks for the hospital first when none is remembered) so a patient can be picked. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "oncotree.js"), "utf8");
const HANDLER = SRC.slice(SRC.indexOf("function openWardPatientPicker"), SRC.indexOf('if (act === "retry")'));

test("the dead-end toast is gone", () => {
  assert.ok(!/No active WardSync patient in EMR session\./.test(SRC), "old dead-end message removed");
});

test("both no-patient paths open the ward patient list", () => {
  assert.equal((HANDLER.match(/openWardPatientPicker\(\);/g) || []).length, 2,
    "called when the provider returns nothing AND when the provider is absent");
});

test("the picker opens WARD, which prompts for the hospital when needed", () => {
  const fn = SRC.slice(SRC.indexOf("function openWardPatientPicker"), SRC.indexOf('if (act === "calc-wardsync-fetch")'));
  assert.match(fn, /G\.WARD && G\.WARD\.open/, "uses the real ward list opener");
  assert.match(fn, /G\.WARD\.open\(\)/, "opens it (WARD.open resolves the remembered hospital itself)");
  assert.match(fn, /then tap Fetch again/, "tells the clinician what to do after picking");
});

test("it still degrades safely when WardSync is unavailable", () => {
  const fn = SRC.slice(SRC.indexOf("function openWardPatientPicker"), SRC.indexOf('if (act === "calc-wardsync-fetch")'));
  assert.match(fn, /try \{ G\.WARD\.open\(\); return; \} catch/, "a throwing opener falls through");
  assert.match(fn, /Open a patient in WardSync first/, "fallback message when there is no ward module");
});

test("a successful fetch still fills the calculator", () => {
  assert.match(SRC, /Imported patient labs & vitals from WardSync EMR\./, "happy path untouched");
  assert.match(SRC, /updateCalvertCalc\(\)/, "still recomputes after import");
});
