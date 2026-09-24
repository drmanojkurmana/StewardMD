/* Item 16: MaiK Scribe wired into the WardSynQ ward round / progress note (ward.js, wTlNote).
 * OFF by default (smd_ward_scribe); the pure append/refine logic and the on/off flag gate are
 * Node-testable without a device. The ambient capture loop itself (SMD_AMBIENT) is exercised
 * elsewhere (voice-ambient-scribe.test.mjs) -- this file only checks how ward.js drives it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard(opts) {
  opts = opts || {};
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const box = { value: "" };
  const toasts = [];
  const sandbox = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: {
      getElementById: (id) => (id === "wTlNote" ? box : null),
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} },
      querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: (k) => (opts.store || {})[k] || "", setItem() {}, removeItem() {} },
    fetch: () => { throw new Error("must not hit the network directly"); },
    setTimeout, clearTimeout, console, Promise, Date,
    SMD_AMBIENT: opts.ambient,
    SMD_AI: opts.ai,
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  sandbox.G = sandbox.window.G || sandbox;
  sandbox.G.toast = (m) => toasts.push(m);
  return { W: sandbox.window.WARD, box, toasts };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("smd_ward_scribe is OFF unless a device explicitly turns it on", () => {
  const { W } = loadWard();
  assert.equal(W._wardScribeOn(), false);
  const on = loadWard({ store: { smd_ward_scribe: "on" } });
  assert.equal(on.W._wardScribeOn(), true);
  const other = loadWard({ store: { smd_ward_scribe: "yes" } });
  assert.equal(other.W._wardScribeOn(), false, "only the literal 'on' enables it");
});

test("_wardScribeAppend only appends, never replaces what was already typed", () => {
  const { W } = loadWard();
  assert.equal(W._wardScribeAppend("", "Chest clear, no crackles."), "Chest clear, no crackles.");
  assert.equal(
    W._wardScribeAppend("Afebrile overnight.", "Chest clear, no crackles."),
    "Afebrile overnight.\nChest clear, no crackles."
  );
  // trailing whitespace on the existing text is tidied, never the draft's own wording
  assert.equal(
    W._wardScribeAppend("Afebrile overnight.   \n", "Chest clear."),
    "Afebrile overnight.\nChest clear."
  );
});

test("_wardScribeAppend is a no-op on an empty or already-present draft", () => {
  const { W } = loadWard();
  assert.equal(W._wardScribeAppend("Afebrile.", ""), "Afebrile.");
  assert.equal(W._wardScribeAppend("Afebrile.", "   "), "Afebrile.");
  assert.equal(W._wardScribeAppend("Afebrile. Chest clear.", "Chest clear."), "Afebrile. Chest clear.");
});

test("starting the scribe with no SMD_AMBIENT on the build says so and does not turn it on", () => {
  const { W, toasts } = loadWard({ ambient: undefined });
  W._startWardScribe();
  assert.equal(W._st.wardScribeOn, false);
  assert.match(toasts.join(" "), /not available/);
});

test("refine with no server extractor stages the raw transcript as the draft", () => {
  const { W } = loadWard({ ai: undefined });
  W._wardScribeRefine("chest clear no crackles bilateral air entry");
  assert.equal(W._st.wardScribeDraft, "chest clear no crackles bilateral air entry");
});

test("refine with the SAME server extract opd-emr.js uses takes the faithful English translation", async () => {
  const calls = [];
  const ai = { extract: (transcript, kind) => { calls.push({ transcript, kind }); return Promise.resolve({ en: "Chest clear, no crackles. Afebrile." }); } };
  const { W } = loadWard({ ai });
  W._wardScribeRefine("chest ki clear hai, koi crackles nahi");
  await tick();
  assert.deepEqual(calls, [{ transcript: "chest ki clear hai, koi crackles nahi", kind: "opd-scribe" }]);
  assert.equal(W._st.wardScribeDraft, "Chest clear, no crackles. Afebrile.");
});

test("refine falls back to the raw transcript when the extract errors or refuses", async () => {
  const refused = { extract: () => Promise.resolve({ error: "quota" }) };
  const a = loadWard({ ai: refused });
  a.W._wardScribeRefine("raw words");
  await tick();
  assert.equal(a.W._st.wardScribeDraft, "raw words");

  const dropped = { extract: () => Promise.reject(new Error("network down")) };
  const b = loadWard({ ai: dropped });
  b.W._wardScribeRefine("raw words 2");
  await tick();
  assert.equal(b.W._st.wardScribeDraft, "raw words 2");
});

test("accepting the draft lands it in the note box and clears the draft -- Save is a separate step", () => {
  const { W, box } = loadWard();
  box.value = "Afebrile overnight.";
  W._st.wardScribeDraft = "Chest clear, no crackles.";
  W._wardScribeInsert();
  assert.equal(box.value, "Afebrile overnight.\nChest clear, no crackles.");
  assert.equal(W._st.noteDraft, "Afebrile overnight.\nChest clear, no crackles.");
  assert.equal(W._st.wardScribeDraft, "", "the draft is consumed, not left to be added twice");
});
