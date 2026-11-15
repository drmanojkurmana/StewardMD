/* Study Studio pure helpers (study.js): flag rule, page-relative maths, eraser hit test, undo/redo stacks, pressure.
 * The IndexedDB stroke store is covered end to end by test/run-study-ui.mjs (no fake-indexeddb dependency here).
 * node --test --experimental-test-module-mocks --experimental-sqlite test/study.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const S = createRequire(import.meta.url)("../study.js");

test("flag: default off, needs prep, ?study overrides storage", () => {
  const ls = (v) => (k) => (k === "smd_study" ? v : null);
  assert.equal(S.enabled("", ls(null), true), true);   // default ON
  assert.equal(S.enabled("", ls("0"), true), false);
  assert.equal(S.enabled("", ls("1"), true), true);
  assert.equal(S.enabled("", ls("1"), false), false);
  assert.equal(S.enabled("?study=1", ls(null), true), true);
  assert.equal(S.enabled("?prep=1&study=0", ls("1"), true), false);
});

test("page-relative transform round trips at any zoom", () => {
  const r = { left: 10, top: 20, width: 200, height: 400 };
  const [x, y] = S.toRel(110, 220, r);
  assert.deepEqual([x, y], [0.5, 0.5]);
  assert.deepEqual(S.toAbs(x, y, 400, 800), [200, 400]);
});

test("eraser hit: near a segment hits, far misses, single point works", () => {
  const s = { w: 0.004, pts: [[0.1, 0.1, 0.5], [0.9, 0.1, 0.5]] };
  assert.equal(S.hit(s, 0.5, 0.1, 12, 500, 500), true);
  assert.equal(S.hit(s, 0.5, 0.2, 12, 500, 500), false);   // 50 px away
  assert.equal(S.hit(s, 0.5, 0.1 + 10 / 500, 12, 500, 500), true);   // 10 px away, radius 12
  assert.equal(S.hit(s, 0.95, 0.1, 12, 500, 500), false);   // past the end
  assert.equal(S.hit({ w: 0.004, pts: [[0.5, 0.5, 0.5]] }, 0.5, 0.5, 5, 100, 100), true);
  assert.equal(S.hit({ w: 0.004, pts: [] }, 0.5, 0.5, 5, 100, 100), false);
});

test("undo and redo: add, erase, redo cleared by a new op, empty stack", () => {
  const st = S.newStack();
  assert.equal(S.undo(st), null);
  S.push(st, { t: "add", id: "a" }); S.push(st, { t: "del", ids: ["a"] });
  let u = S.undo(st);   // undo the erase: stroke comes back
  assert.deepEqual([S.opIds(u.op), u.gone], [["a"], false]);
  u = S.undo(st);       // undo the add: stroke goes
  assert.deepEqual([S.opIds(u.op), u.gone], [["a"], true]);
  let r = S.redo(st);   // redo the add
  assert.equal(r.gone, false);
  S.push(st, { t: "add", id: "b" });
  assert.equal(st.r.length, 0);
  assert.equal(S.redo(st), null);
  assert.equal(st.u.length, 2);
});

test("stack is capped at 200 and survives a JSON round trip", () => {
  const st = S.newStack();
  for (let i = 0; i < 250; i++) S.push(st, { t: "add", id: "s" + i });
  assert.equal(st.u.length, 200);
  const back = S.newStack(JSON.parse(JSON.stringify(st)));
  assert.equal(S.undo(back).op.id, "s249");
});

test("pressure: pen value kept, 0 or other pointer types fall back to 0.5", () => {
  assert.equal(S.pressure({ pointerType: "pen", pressure: 0.8 }), 0.8);
  assert.equal(S.pressure({ pointerType: "pen", pressure: 0 }), 0.5);
  assert.equal(S.pressure({ pointerType: "touch", pressure: 1 }), 0.5);
  assert.equal(S.pressure({ pointerType: "mouse", pressure: 0.5 }), 0.5);
  assert.equal(S.pressure({}), 0.5);
});

test("page order: move up and down, ends stay put, input not mutated", () => {
  const a = [1, 2, 3];
  assert.deepEqual(S.moveItem(a, 1, -1), [2, 1, 3]);
  assert.deepEqual(S.moveItem(a, 1, 1), [1, 3, 2]);
  assert.deepEqual(S.moveItem(a, 0, -1), [1, 2, 3]);
  assert.deepEqual(S.moveItem(a, 2, 1), [1, 2, 3]);
  assert.deepEqual(a, [1, 2, 3]);
});

test("page backgrounds: blank empty, ruled rows, grid squares, Cornell margin and summary", () => {
  assert.equal(S.bgLines("blank", 1.414).length, 0);
  const ruled = S.bgLines("ruled", 1.414);
  assert.ok(ruled.length > 20 && ruled.every((l) => l[1] === l[3] && l[3] < 1.414 && l[0] === 0 && l[2] === 1));
  const grid = S.bgLines("grid", 2), cols = grid.filter((l) => l[0] === l[2]), rows = grid.filter((l) => l[1] === l[3]);
  assert.ok(cols.length === 19 && rows.length > 30 && cols.every((l) => l[3] === 2));
  const c = S.bgLines("cornell", 1.414);
  assert.ok(c.some((l) => l[0] === 0.3 && l[2] === 0.3) && c.some((l) => l[1] === 1.414 * 0.8 && l[3] === 1.414 * 0.8));
  assert.ok(c.every((l) => l[1] <= 1.414 * 0.8 + 1e-9));
});

test("snippet: case-insensitive, highlight split, ellipsis at cut ends, no match is null", () => {
  assert.deepEqual(S.snip("Page two body text", "TWO", 40), { pre: "Page ", hit: "two", post: " body text" });
  const long = "a".repeat(100) + "needle" + "b".repeat(100), r = S.snip(long, "needle", 10);
  assert.deepEqual([r.pre, r.hit, r.post], ["..." + "a".repeat(10), "needle", "b".repeat(10) + "..."]);
  assert.equal(S.snip("abc", "zz", 5), null);
  assert.equal(S.snip("abc", "", 5), null);
});

test("indexing label: shown until every page is done", () => {
  assert.equal(S.ixLabel(3, 20), "Indexing, 3 of 20 pages");
  assert.equal(S.ixLabel(0, 2), "Indexing, 0 of 2 pages");
  assert.equal(S.ixLabel(20, 20), "");
});

const req = createRequire(import.meta.url);
test("A7 page range: empty is the page on screen, typed ranges use Layer C's parser and cap", () => {
  const SR = req("../prep-source.js");
  assert.deepEqual(S.pageSel("", 7, 20, SR), { pages: [7] });
  assert.deepEqual(S.pageSel("  ", 3, 20, SR), { pages: [3] });
  assert.deepEqual(S.pageSel("3-5, 9", 1, 20, SR), { pages: [3, 4, 5, 9] });
  assert.match(S.pageSel("abc", 1, 20, SR).error, /Write pages like/);
  assert.match(S.pageSel("30", 1, 20, SR).error, /has 20 pages/);
  assert.match(S.pageSel("1-61", 1, 100, SR).error, /60 pages/);
});

test("A7 source ref: items and cards made from a Study Studio document carry std, others are unchanged", () => {
  const C = req("../prep-create.js");
  const it = { q: "Q?", o: ["a", "b", "c", "d"], a: 1, exp: "e", prov: "AI" }, f = { id: "f1", sec: "sec-0", p: [4], h: "H", sn: [2] };
  const withStd = C.toStored(it, f, "deck1", { doc: "abc", name: "N", std: "doc-id", exam: "neet-pg" });
  assert.deepEqual(withStd.src, { doc: "abc", name: "N", p: [4], h: "H", sn: [2], std: "doc-id" });
  assert.deepEqual(C.toStored(it, f, "deck1", { doc: "abc", name: "N", exam: "neet-pg" }).src, { doc: "abc", name: "N", p: [4], h: "H", sn: [2] });
  assert.equal(C.toCard({ id: "f1", cq: "c", ft: "t", p: [4], h: "H", sn: [2] }, "deck1", { doc: "abc", name: "N", std: "doc-id" }).src.std, "doc-id");
});

/* ---- A8: backup file (fflate, stored not compressed), verify before restore, restore plan ---- */
import { createHash } from "node:crypto";
const F = req("../fflate.min.js");
const shaN = async (b) => createHash("sha256").update(b).digest("hex");
const enc = (o) => F.strToU8(JSON.stringify(o));
async function makeBackup(mut) {
  const pdf = new Uint8Array(3000).map((_, i) => (i * 7 + 3) & 255), h = await shaN(pdf), ent = {};
  const d1 = { doc: { id: "d1", title: "A", sha256: h, kind: undefined }, strokes: [{ id: "s1" }, { id: "s2" }], undo: null, ptext: [{ id: "d1:1:pdf" }], index: null };
  const n1 = { doc: { id: "n1", title: "N", kind: "nb" }, strokes: [{ id: "s3" }], undo: null, ptext: [], index: null };
  ent["folders.json"] = enc([{ id: "f1", name: "F" }]); ent["docs/d1.json"] = enc(d1); ent["docs/n1.json"] = enc(n1); ent["files/d1.pdf"] = pdf;
  const man = { format: "stewardmd-study-backup", v: 1, created: 1, counts: { docs: 2, folders: 1, strokes: 3, ptext: 1, files: 1 }, files: [] };
  for (const n of Object.keys(ent)) man.files.push({ name: n, sha256: await shaN(ent[n]), bytes: ent[n].length });
  ent["manifest.json"] = enc(man);
  if (mut) await mut(ent, man);
  return { ent, pdf };
}
function zipOf(ent) {   // the streaming writer the app uses: ZipPassThrough = stored, no compression
  const chunks = []; let done = false;
  const z = new F.Zip((e, c, fin) => { if (e) throw e; chunks.push(c); if (fin) done = true; });
  for (const n of Object.keys(ent)) { const f = new F.ZipPassThrough(n); z.add(f); f.push(ent[n], true); }
  z.end();
  assert.equal(done, true);
  return Buffer.concat(chunks);
}
test("A8 zip: the streaming writer round trips every file, stored without compression", async () => {
  const { ent } = await makeBackup(), zip = zipOf(ent), back = F.unzipSync(new Uint8Array(zip));
  assert.deepEqual(Object.keys(back).sort(), Object.keys(ent).sort());
  for (const n of Object.keys(ent)) assert.deepEqual(Buffer.from(back[n]), Buffer.from(ent[n]));
  assert.ok(zip.length >= Object.values(ent).reduce((a, b) => a + b.length, 0), "stored: never smaller than the data");
});
test("A8 backup verify: a good backup passes with its records", async () => {
  const { ent } = await makeBackup(), v = await S.verifyBackup(F.unzipSync(new Uint8Array(zipOf(ent))), shaN);
  assert.equal(v.ok, true); assert.equal(v.recs.length, 2); assert.equal(v.folders.length, 1);
});
test("A8 backup verify: a tampered byte inside the zip is refused (sha256 mismatch)", async () => {
  const { ent, pdf } = await makeBackup(), zip = zipOf(ent), at = zip.indexOf(Buffer.from(pdf.slice(0, 64)));
  assert.ok(at > 0); zip[at + 10] ^= 1;
  const v = await S.verifyBackup(F.unzipSync(new Uint8Array(zip)), shaN);
  assert.equal(v.ok, false); assert.match(v.error, /checksum/);
});
test("A8 backup verify: wrong record count, wrong size, extra file, missing manifest, record vs file sha", async () => {
  let v = await S.verifyBackup((await makeBackup((e, m) => { m.counts.strokes = 4; e["manifest.json"] = enc(m); })).ent, shaN);
  assert.equal(v.ok, false); assert.match(v.error, /record counts/);
  v = await S.verifyBackup((await makeBackup((e, m) => { m.files[3].bytes = 5; e["manifest.json"] = enc(m); })).ent, shaN);
  assert.match(v.error, /wrong size/);
  v = await S.verifyBackup((await makeBackup((e) => { e["files/x.pdf"] = new Uint8Array(3); })).ent, shaN);
  assert.match(v.error, /file list/);
  v = await S.verifyBackup((await makeBackup((e) => { delete e["manifest.json"]; })).ent, shaN);
  assert.match(v.error, /not a Study Studio backup/);
  v = await S.verifyBackup((await makeBackup(async (e, m) => { const r = JSON.parse(new TextDecoder().decode(e["docs/d1.json"])); r.doc.sha256 = "0".repeat(64); e["docs/d1.json"] = enc(r); m.files.find((f) => f.name === "docs/d1.json").sha256 = await shaN(e["docs/d1.json"]); m.files.find((f) => f.name === "docs/d1.json").bytes = e["docs/d1.json"].length; e["manifest.json"] = enc(m); })).ent, shaN);
  assert.match(v.error, /does not match its file/);
});
test("A8 restore plan: skip by id or sha256, add the rest, never touch what exists", () => {
  const have = [{ id: "d1", sha256: "aa" }, { id: "n1" }, { id: "x", sha256: "bb" }];
  const recs = [{ doc: { id: "d1", sha256: "aa" } }, { doc: { id: "d2", sha256: "bb" } }, { doc: { id: "d3", sha256: "cc" } }, { doc: { id: "n1", kind: "nb" } }, { doc: { id: "n2", kind: "nb" } }];
  const p = S.restorePlan(have, recs);
  assert.deepEqual(p.add.map((r) => r.doc.id), ["d3", "n2"]);
  assert.deepEqual(p.skip.map((r) => r.doc.id), ["d1", "d2", "n1"]);
  assert.deepEqual(have.map((d) => d.id), ["d1", "n1", "x"]);
});
