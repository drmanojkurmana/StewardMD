/* tools/prep-fill-missing.mjs: every served question without an explanation gets one from claude-haiku-5-5 (Batch).
 * Fake R2 + fake Batch API: only served files are read, only questions with nothing are sent, checks drop a key line
 * that names the wrong answer, a failure is retried once, apply writes x/r/ax and nothing else, uploads files before the
 * manifest and bumps only touched subjects.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-fill-missing.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as F from "../tools/prep-fill-missing.mjs";

const PREP_JS = 'var VER = G.SMD_PREP_BANK_VER || "v5";\n  var OVERLAYS = G.SMD_PREP_OVERLAYS || { radiology: ["radmax7"], "ss-pulmonology": ["medcov4"] };\n';
const TAX = { branches: [{ subjects: [{ id: "pathology" }, { id: "ss-radiology", bv: "v16" }] }] };
const q = (id, extra) => ({ id, q: "Stem of question " + id + " about anaemia?", o: ["Iron", "Folate", "B12", "Copper"], a: 2, ...extra });

function fakeR2() {
  const files = {
    "prep-bank/v5/manifest.json": { subjects: [{ id: "pathology", bytes: 1000, items: 3 }, { id: "anatomy", bytes: 500, items: 1 }] },
    "prep-bank/v5/pathology/mcq/blood.json": { topic: "Blood", items: [q("p1"), q("p2", { exp: "Stored." }), q("p3", { flags: ["key-disputed"] }), q("p4", { flags: ["exp-pending"] })] },
    "prep-bank/v4/pathology/mcq/blood.json": { items: [q("old")] },
    "prep-bank/v16/ss-radiology/mcq/chest.json": { items: [q("r1", { x: { key: "B12 deficiency." } }), q("r2")] },
    "prep-bank/overlay/radmax7/radiology/x.json": { items: [q("o1"), q("o2", { r: ["", "", "Because", ""] })] },
    "prep-bank/overlay/radmax1/radiology/x.json": { items: [q("gone")] },
    "prep-bank/overlay/maik/index.json": { sets: {} },
    "prep-bank/v5/pyq/index.json": { file: "items-abc.json" },
    "prep-bank/v5/pyq/items-abc.json": { items: [q("y1")] },
  };
  const store = new Map(Object.entries(files).map(([k, v]) => [k, Buffer.from(JSON.stringify(v))]));
  const puts = [];
  return {
    store, puts,
    listR2: async (p) => [...store.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key, size: store.get(key).length })),
    getR2Object: async (k) => store.get(k) || null,
    putR2Object: async (k, file) => { puts.push(k); store.set(k, fs.readFileSync(file)); },
  };
}
const reply = (key, others) => ({ key, notes: "- **B12** deficiency", others: others || { A: "Iron is microcytic.", B: "Folate lacks neuropathy.", C: "", D: "Copper is rare." }, pearl: "Neuro signs point to B12." });
function fakeBatch(replyFor) {
  const jobs = new Map(); let n = 0; const sent = [];
  return {
    sent,
    batchCreate: async (env, requests) => { const id = "msgbatch_" + ++n; jobs.set(id, requests); sent.push(requests); return { id }; },
    batchGet: async (env, id) => ({ id, processing_status: "ended" }),
    batchResults: async (env, b) => jobs.get(b.id).map((r) => ({ custom_id: r.custom_id, ok: true, message: { content: [{ type: "text", text: JSON.stringify(replyFor(r, b.id)) }], stop_reason: "end_turn", usage: { input_tokens: 600, output_tokens: 500 } } })),
  };
}

test("served(): live bank version per subject, listed overlay sets, PYQ index; nothing else", () => {
  const live = F.liveSets(PREP_JS, TAX, { anatomy: ["maiknuc1"] });
  assert.equal(F.served("prep-bank/v5/pathology/mcq/a.json", live), "bank");
  assert.equal(F.served("prep-bank/v4/pathology/mcq/a.json", live), null);
  assert.equal(F.served("prep-bank/v16/ss-radiology/mcq/a.json", live), "bank");
  assert.equal(F.served("prep-bank/v5/ss-radiology/mcq/a.json", live), null);
  assert.equal(F.served("prep-bank/overlay/maiknuc1/anatomy/a.json", live), "overlay");
  assert.equal(F.served("prep-bank/overlay/radmax1/radiology/a.json", live), null);
  assert.equal(F.served("prep-bank/v5/pathology/search.json", live), null);
});

test("missing(): no exp, no x.key, no reason for the key; flagged-hidden skipped, exp-pending included", () => {
  assert.equal(F.missing(q("a")), true);
  assert.equal(F.missing(q("a", { exp: " x " })), false);
  assert.equal(F.missing(q("a", { x: { key: "k" } })), false);
  assert.equal(F.missing(q("a", { r: ["", "", "why", ""] })), false);
  assert.equal(F.missing(q("a", { r: { C: "why" } })), false);
  assert.equal(F.missing(q("a", { flags: ["key-disputed"] })), false);
  assert.equal(F.missing(q("a", { flags: ["exp-pending"] })), true);
  assert.equal(F.missing({ q: "x", o: ["a"], a: 0 }), false);
});

test("scan -> run -> apply: only served questions with nothing, one retry, x/r/ax written, manifest last", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "fill-missing-")), r2 = fakeR2(), log = () => {};
  const s = await F.scan(work, {}, { ...r2, prepJs: PREP_JS, taxonomy: TAX, log });
  assert.deepEqual(s.todo.map((t) => t.id).sort(), ["o1", "p1", "p4", "r2", "y1"]);
  // first pass: r2's key line names the wrong answer (fails the check); retried and accepted on pass 2
  let tries = 0;
  const B = fakeBatch((r, id) => { const t = s.todo.find((x) => r.params.messages[0].content[0].text.includes(x.q)); if (t.id === "r2" && id === "msgbatch_1") { tries++; return reply("Iron deficiency is the answer here."); } return reply("B12 deficiency is the answer: neuropathy points to it."); });
  const r = await F.run(work, { maxUsd: 5 }, { ...B, env: { ANTHROPIC_API_KEY: "k" }, log, sleep: async () => {} });
  assert.equal(r.accepted, 5); assert.equal(tries, 1);
  assert.equal(B.sent.length, 2); assert.equal(B.sent[1].length, 1, "only the failure is retried");
  assert.equal(B.sent[0][0].params.model, "claude-haiku-5-5");
  // resume: nothing is sent again
  await F.run(work, { maxUsd: 5 }, { ...B, env: { ANTHROPIC_API_KEY: "k" }, log, sleep: async () => {} });
  assert.equal(B.sent.length, 2);
  const dry = await F.apply(work, {}, { ...r2, log });
  assert.equal(dry.uploaded, 0); assert.equal(r2.puts.length, 0);
  const a = await F.apply(work, { yes: true }, { ...r2, log });
  assert.equal(a.items, 5);
  assert.equal(r2.puts[r2.puts.length - 1], "prep-bank/v5/manifest.json", "manifest last");
  assert.ok(!r2.puts.includes("prep-bank/v16/manifest.json"), "no manifest in the bucket for v16: skipped");
  const blood = JSON.parse(String(r2.store.get("prep-bank/v5/pathology/mcq/blood.json")));
  const p1 = blood.items[0];
  assert.equal(p1.ax, 1); assert.match(p1.x.key, /B12/); assert.equal(p1.r.length, 4); assert.equal(p1.r[2], p1.x.key);
  assert.equal(blood.items[1].exp, "Stored."); assert.ok(!blood.items[1].x, "stored explanation untouched");
  assert.ok(!blood.items[2].x, "flagged question untouched");
  const man = JSON.parse(String(r2.store.get("prep-bank/v5/manifest.json")));
  assert.ok(man.subjects[0].bytes > 1000); assert.equal(man.subjects[1].bytes, 500, "untouched subject keeps its stamp");
  assert.ok(!r2.puts.some((k) => k.includes("/v4/") || k.includes("radmax1")), "unserved files never written");
});

test("run: the spend cap stops before a batch is sent", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "fill-missing-")), r2 = fakeR2(), log = () => {};
  await F.scan(work, {}, { ...r2, prepJs: PREP_JS, taxonomy: TAX, log });
  const B = fakeBatch(() => reply("B12 deficiency is the answer."));
  await assert.rejects(F.run(work, { maxUsd: 0.000001 }, { ...B, env: { ANTHROPIC_API_KEY: "k" }, log, sleep: async () => {} }), /max-usd/);
  assert.equal(B.sent.length, 0);
});
