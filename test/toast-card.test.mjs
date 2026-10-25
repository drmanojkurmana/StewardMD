import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const T = require("../toast.js");

test("kindOf marks failures as error, cautions as warning, the rest as info", () => {
  assert.equal(T.kindOf("Couldn't save the note"), "error");
  assert.equal(T.kindOf("Too fast. Wait a few seconds and try again."), "error");
  assert.equal(T.kindOf("Network error"), "error");
  assert.equal(T.kindOf("Upload failed"), "error");
  assert.equal(T.kindOf("Low potassium limit reached"), "warning");
  assert.equal(T.kindOf("Saved"), "info");
  assert.equal(T.kindOf("Copied to clipboard"), "info");
});

test("splitText: newline, em dash, then first sentence; never changes the words", () => {
  assert.deepEqual(T.splitText("Antibiogram removed — From this device"), { title: "Antibiogram removed", message: "From this device" });
  assert.deepEqual(T.splitText("Saved\nTo your notes"), { title: "Saved", message: "To your notes" });
  assert.deepEqual(T.splitText("Too fast. Wait a few seconds and try again."), { title: "Too fast", message: "Wait a few seconds and try again." });
  assert.deepEqual(T.splitText("Saved"), { title: "Saved", message: "" });
});

test("splitText leaves abbreviations, decimals and lowercase continuations alone", () => {
  assert.deepEqual(T.splitText("Ask Dr. Rao about the dose"), { title: "Ask Dr. Rao about the dose", message: "" });
  assert.deepEqual(T.splitText("Dose set to 2.5 mg. Check renal function."), { title: "Dose set to 2.5 mg", message: "Check renal function." });
  assert.deepEqual(T.splitText("Saved. then closed"), { title: "Saved. then closed", message: "" });
});

test("errors stay on screen longer than confirmations", () => {
  assert.ok(T.duration("Couldn't save", "error") >= 5500);
  assert.ok(T.duration("Couldn't save", "error") > T.duration("Saved", "info"));
  assert.equal(T.duration("hi"), 2400);
});

test("no Dynamic Island takeover and no icon glyphs in the toast", () => {
  const src = fs.readFileSync(new URL("../toast.js", import.meta.url), "utf8");
  assert.ok(!/SMD_dynNotify/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "toast.js must not hand toasts to the Island");
  assert.ok(!/<svg|material-symbols/.test(src), "toast draws no icons");
});
