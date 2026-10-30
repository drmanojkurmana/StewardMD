import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

// Owner 2026-10-30, on a screen recording of Dx My Patient > Select this diagnosis: "where did this old page come from,
// that is unaligned, delete it permanently". That page was the classic #outputArea behind Home, revealed with
// .shell{display:block}. A chosen diagnosis now opens in the Start Case wizard; nothing reveals the classic shell.
test("Select this diagnosis, a live pick and a recent decision open the wizard, never the classic shell", () => {
  const dx = read("reasoning.js"), rc = read("recent.js"), wz = read("abx-wizard.js");
  const sel = dx.slice(dx.indexOf("function selectDx(id)"), dx.indexOf("// non-infectious -> open the management"));
  assert.match(sel, /ABX_WIZARD\.openCase\(S\.f, id, true\)/);
  assert.doesNotMatch(sel, /SMD_hideHome|\.shell|SMD_restoreCase/);
  assert.doesNotMatch(dx, /\.shell"\); if \(_sh\) _sh\.style\.display = "block"/);
  assert.doesNotMatch(rc, /shell\.style\.display = "block"/);
  assert.match(rc, /ABX_WIZARD\.openCase\(findings, null, false\)/);
  assert.match(wz, /openCase: openCase/);
  assert.match(wz, /function backToDx\(\)/, "Back returns to Clinical Reasoning");
});
