// PrepNucleus links rematch (tools/prep-links-rematch.mjs): per-module LLM map+verify over the deterministic
// pass's residue. Prompts, parsers, and resolvers are pure ($0); the universe fns read the real worktree fixtures
// read-only. All items synthetic except the read-only universe assertions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPrompt, verifyPrompt, parseMapResponse, resolveTargets, parseVerifyResponse, lessonCatalog,
  kbAliasMap, unlinkedByModule } from "../tools/prep-links-rematch.mjs";
import { applyRematch, SHOW } from "../tools/prep-links.mjs";

const ROOT = "/tmp/links100-wt", CACHE = "/tmp/links100-cache", OUT = "/tmp/links100-final";
const BANK = "/Users/diwakarkumar/prep-work/StewardMD-prep/prep/bank/v5";
const ITEMS = [
  { id: "a", q: "Tibial mass, small round cells. Which translocation?", key: "22q translocation", exp: "Ewings sarcoma t(11;22)." },
  { id: "b", q: "Beaded renal artery in a young woman?", key: "Fibromuscular dysplasia", exp: "String of beads." },
];
const CAT = [{ key: "son-bone-sarcoma", title: "Bone sarcoma", module: "son-bone-sarcoma" }];
const DICTS = {
  lessonKeys: ["son-bone-sarcoma"], lessonTitles: new Map([["son-bone-sarcoma", "Bone sarcoma"]]),
  kbAliases: new Map([["ewing_sarcoma", "ewing_sarcoma"], ["fibromuscular_dysplasia", "fibromuscular_dysplasia"]]),
  kbTitles: new Map([["ewing_sarcoma", "Ewing sarcoma"]]),
  drugIds: new Map([["metformin", "Metformin"]]), protoIds: new Map([["accidental-hypothermia", "Accidental hypothermia"]]),
};

test("mapPrompt names every item id and catalog key; verifyPrompt names proposals", () => {
  const p = mapPrompt({ mid: "pat-mixed", sid: "pathology" }, ITEMS, CAT);
  assert.match(p.user, /\[a\]/); assert.match(p.user, /\[b\]/); assert.match(p.user, /son-bone-sarcoma/);
  const v = verifyPrompt({ mid: "pat-mixed", sid: "pathology" },
    [{ id: "a", q: "Q?", key: "K", kind: "kb", title: "Ewing sarcoma", c: 88 }]);
  assert.match(v.user, /Ewing sarcoma/); assert.match(v.user, /"keep"/);
});

test("parseMapResponse keeps well-formed votes, drops bad numbers/kinds/targets", () => {
  const got = parseMapResponse({ links: [
    { n: 1, kind: "kb", target: "Ewing sarcoma", c: 88 },
    { n: 9, kind: "kb", target: "Nope", c: 90 },
    { n: 2, kind: "planet", target: "Mars", c: 99 },
    { n: 2, kind: "drug", target: "  ", c: 80 },
    { n: 2, kind: "lesson", target: "son-bone-sarcoma", c: "high" },
  ] }, ITEMS);
  assert.deepEqual(got, [{ n: 1, id: "a", kind: "kb", target: "Ewing sarcoma", c: 88 }]);
  assert.equal(parseMapResponse({ links: "x" }, ITEMS), null);
  assert.equal(parseMapResponse(null, ITEMS), null);
});

test("resolveTargets resolves real ids, drops unknown names and anything below the floor", () => {
  const got = resolveTargets([
    { id: "a", kind: "kb", target: "Ewing sarcoma", c: 88 },
    { id: "a", kind: "kb", target: "Madeup disease", c: 95 },
    { id: "b", kind: "lesson", target: "SON-BONE-SARCOMA", c: 78 },
    { id: "b", kind: "lesson", target: "no-such-lesson", c: 99 },
    { id: "a", kind: "drug", target: "Metformin", c: 80 },
    { id: "a", kind: "protocol", target: "Accidental Hypothermia", c: 90 },
    { id: "b", kind: "kb", target: "Fibromuscular dysplasia", c: 74 },
  ], DICTS);
  assert.ok(got.some((g) => g.id === "a" && g.k === "kb" && g.targetId === "ewing_sarcoma" && g.c === 88));
  assert.ok(!got.some((g) => g.targetId === "Madeup disease" || g.targetId === "no-such-lesson"));
  assert.ok(got.some((g) => g.k === "ls" && g.targetId === "son-bone-sarcoma"), "lesson keys match case-insensitively");
  assert.ok(got.some((g) => g.k === "dr" && g.targetId === "metformin"));
  assert.ok(!got.some((g) => g.k === "pr"), "protocol titles match exactly or not at all");
  assert.ok(!got.some((g) => g.c < SHOW), "nothing below the confidence floor survives");
});

test("chunkItems splits big modules into fittable slices", async () => {
  const { chunkItems } = await import("../tools/prep-links-rematch.mjs");
  const items = Array.from({ length: 250 }, (_, i) => ({ id: String(i) }));
  const chunks = chunkItems(items);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((c) => c.length <= 100));
  assert.equal(chunks.flat().length, 250);
});

test("parseVerifyResponse keeps valid numbers only", () => {
  const jobs = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(Array.from(parseVerifyResponse({ keep: [2, 7, "x"] }, jobs)), [2]);
  assert.equal(parseVerifyResponse({ keep: "all" }, jobs), null);
});

test("applyRematch caps at 80, respects MAX slots, never duplicates", () => {
  const links = [{ k: "kb", id: "ewing_sarcoma", title: "Ewing sarcoma", c: 92, v: "k" }];
  applyRematch(links, [
    { k: "kb", id: "ewing_sarcoma", title: "dup", c: 99 },
    { k: "ls", id: "son-bone-sarcoma", title: "Bone sarcoma", c: 95 },
    { k: "zz", id: "nope", title: "nope", c: 99 },
  ]);
  assert.equal(links.filter((l) => l.id === "ewing_sarcoma").length, 1, "no duplicate k:id");
  const rm = links.find((l) => l.v === "rm");
  assert.ok(rm && rm.c === 80, "self-reported confidence caps at 80");
  assert.ok(!links.some((l) => l.id === "nope"), "unknown kinds are dropped");
  const full = [{ k: "kb", id: "x1", c: 90, v: "k" }, { k: "kb", id: "x2", c: 90, v: "k" }];
  applyRematch(full, [{ k: "kb", id: "x3", title: "x3", c: 90 }]);
  assert.ok(!full.some((l) => l.id === "x3"), "MAX slots per kind are respected");
});

test("universe (read-only): catalog has the bundled lessons; residue is sorted, biggest first", () => {
  const cat = lessonCatalog(ROOT, CACHE);
  assert.ok(cat.length >= 555 && new Set(cat.map((c) => c.key)).size === cat.length);
  const kb = kbAliasMap(ROOT);
  assert.equal(kb.get("ewing_sarcoma"), "ewing_sarcoma");
  const mods = unlinkedByModule({ root: ROOT, cache: CACHE, bank: BANK, out: OUT });
  assert.ok(mods.length > 0, "residue modules listed");
  assert.ok(mods[0].items.length >= mods[mods.length - 1].items.length, "sorted biggest first");
  const pm = mods.find((m) => m.mid === "pat-mixed");
  assert.ok(pm && pm.items.length > 0 && pm.items.every((it) => it.id && it.q && it.key !== undefined));
});
