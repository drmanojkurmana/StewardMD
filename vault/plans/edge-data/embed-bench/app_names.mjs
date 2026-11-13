// What the app ALREADY resolves offline, with no embedding: MaiKKB.resolveTarget(question) (exact/canonical
// name, alias and abbreviation match, then the name index), as MaiK's KB path calls it. One disease or none.
//   node vault/plans/edge-data/embed-bench/app_names.mjs vault/plans/edge-data/embed-bench/queries.jsonl
import fs from "node:fs";
import { loadKB } from "../../../../scripts/edge/lib.mjs";
loadKB();
const K = globalThis.MaiKKB;
const Q = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map(JSON.parse);
let hit = 0, wrong = 0; const by = {};
for (const q of Q) {
  let r = null; try { r = K.resolveTarget(q.q, null); } catch (e) {}
  const ok = !!(r && new RegExp(q.accept).test(r.id));
  if (ok) hit++; else if (r) wrong++;
  by[q.cat] = by[q.cat] || [0, 0]; by[q.cat][0] += ok ? 1 : 0; by[q.cat][1]++;
  console.log(JSON.stringify({ q: q.q, cat: q.cat, id: r && r.id, match: r && r.match, ok }));
}
console.error("app name match: " + hit + "/" + Q.length + " right, " + wrong + " wrong disease, " + (Q.length - hit - wrong) + " none; by cat " + JSON.stringify(by));
