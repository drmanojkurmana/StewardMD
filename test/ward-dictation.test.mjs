/* P2.8 voice typing: on-device only, clear failures, text lands in an editable box and nothing else. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard(SpeechRecognition, store) {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const box = { value: "Chest clear.", dispatchEvent() {} };
  const toasts = [];
  const sandbox = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: {
      getElementById: (id) => (id === "wTlNote" ? box : null),
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} },
      querySelector: () => ({ classList: { add() {}, remove() {} } }), querySelectorAll: () => [],
    },
    localStorage: { getItem: (k) => (store || {})[k] || "", setItem() {}, removeItem() {} },
    fetch: () => { throw new Error("dictation must not call the network"); },
    Event: class { constructor(t) { this.type = t; } },
    setTimeout, clearTimeout, console, Promise, Date,
    SpeechRecognition,
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  sandbox.G = sandbox.window.G || sandbox;
  sandbox.toast = (m) => toasts.push(m);
  sandbox.G.toast = sandbox.toast;
  return { W: sandbox.window.WARD, box, toasts };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeEngine(status) {
  const made = [];
  class Rec {
    constructor() { made.push(this); }
    start() { this.started = true; }
    stop() {}
  }
  Rec.available = (opts) => { Rec.asked = opts; return Promise.resolve(status); };
  Rec.install = () => Promise.resolve(true);
  Rec.made = made;
  return Rec;
}

test("A BROWSER THAT CANNOT PROMISE ON-DEVICE SPEECH IS REFUSED, not used quietly", () => {
  class OldRec { start() { throw new Error("must not start"); } }
  const { W, box, toasts } = loadWard(OldRec);
  W._startDictation("wTlNote");
  assert.equal(box.value, "Chest clear.");
  assert.match(toasts.join(" "), /on this device/);
});

test("speech runs locally, in Indian English by default, and the transcript is appended for editing", async () => {
  const Rec = fakeEngine("available");
  const { W, box, toasts } = loadWard(Rec);
  W._startDictation("wTlNote");
  await tick();
  assert.deepEqual({ ...Rec.asked, langs: [...Rec.asked.langs] }, { langs: ["en-IN"], processLocally: true, quality: "dictation" });
  const rec = Rec.made[0];
  assert.equal(rec.processLocally, true, "the recogniser itself must be told to stay on the device");
  assert.equal(rec.lang, "en-IN");
  assert.ok(rec.started);
  rec.onresult({ resultIndex: 0, results: [[{ transcript: "no crackles" }]] });
  assert.equal(box.value, "Chest clear. no crackles");
  assert.match(toasts.join(" "), /nothing is saved or signed until you do/);
});

test("Hindi is used when chosen", async () => {
  const Rec = fakeEngine("available");
  const { W } = loadWard(Rec, { wsqDictLang: "hi-IN" });
  W._startDictation("wTlNote");
  await tick();
  assert.deepEqual([...Rec.asked.langs], ["hi-IN"]);
  assert.equal(Rec.made[0].lang, "hi-IN");
});

test("a missing language pack is downloaded, and nothing listens meanwhile", async () => {
  const Rec = fakeEngine("downloadable");
  const { W, toasts } = loadWard(Rec);
  W._startDictation("wTlNote");
  await tick(); await tick();
  assert.equal(Rec.made.length, 0);
  assert.match(toasts.join(" "), /Downloading the speech pack/);
  assert.match(toasts.join(" "), /Speech pack ready/);
});

test("A BLOCKED MICROPHONE SAYS SO instead of failing silently", async () => {
  const Rec = fakeEngine("available");
  const { W, box, toasts } = loadWard(Rec);
  W._startDictation("wTlNote");
  await tick();
  Rec.made[0].onerror({ error: "not-allowed" });
  assert.equal(box.value, "Chest clear.");
  assert.match(toasts.join(" "), /microphone is blocked/);
});
