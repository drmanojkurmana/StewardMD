/* Study notebook Apple Pencil hardware (study-pencil): the pure mapping from native
 * UIPencilInteraction actions (ios/App/App/PencilPlugin.swift) to STUDY method names.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/study-pencil.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const S = createRequire(import.meta.url)("../study.js");

test("pencilActionFor maps every UIPencilInteraction preferredTapAction", () => {
  assert.equal(S.pencilActionFor("switchEraser"), "pencilDoubleTap");
  assert.equal(S.pencilActionFor("switchPrevious"), "pencilSwitchPrevious");
  assert.equal(S.pencilActionFor("showColorPalette"), "openPenSettings");
  assert.equal(S.pencilActionFor("showInkAttributes"), "openPenSettings");
  assert.equal(S.pencilActionFor("ignore"), null);
});

test("pencilActionFor maps Pencil Pro squeeze to the same toggle as double-tap", () => {
  assert.equal(S.pencilActionFor("squeeze"), "pencilDoubleTap");
  assert.equal(S.pencilActionFor("squeeze"), S.pencilActionFor("switchEraser"));
});

test("pencilActionFor ignores unknown and missing actions", () => {
  assert.equal(S.pencilActionFor("unknown"), null);
  assert.equal(S.pencilActionFor(""), null);
  assert.equal(S.pencilActionFor(null), null);
  assert.equal(S.pencilActionFor(undefined), null);
  assert.equal(S.pencilActionFor(42), null);
});
