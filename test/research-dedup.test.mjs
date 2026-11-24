/* ResearchMD Phase 2.4 deterministic dedup: the plan section-12 gate
 * (F1 >= 0.98 on a known set), canonical = earliest record, groups kept,
 * nothing deleted, idempotent and input-order invariant.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-dedup.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupRecords, normaliseDoi, normaliseTitle, firstAuthorKey, recordKeys } from "../functions/api/research/_dedup.js";

let seq = 0;
function rec(id, fields) {
  seq++;
  return Object.assign({
    id, source: "import:csv", externalId: "ext-" + id, title: "", authors: [], year: null, doi: "",
    createdTs: 1000 + seq,
  }, fields);
}

/* The known set. True duplicate clusters are listed explicitly; every other
 * pair is a true negative. Near-misses (same title but different year or first
 * author, similar DOIs) must NOT merge. */
function knownSet() {
  seq = 0;
  const records = [
    /* G1: DOI exact across resolver prefix, case and trailing punctuation. */
    rec("a1", { title: "Trial One", authors: ["Smith JA"], year: 2020, doi: "10.1000/ABC" }),
    rec("a2", { title: "Completely different title", authors: ["Lee C"], year: 2019, doi: "https://doi.org/10.1000/abc" }),
    rec("a3", { title: "Another title", authors: ["Kim D"], year: 2021, doi: "doi: 10.1000/ABC." }),
    /* G2: PMID exact (PubMed records), titles differ. */
    rec("b1", { source: "pubmed", externalId: "12345678", title: "PMID paper", authors: ["Brown B"], year: 2018 }),
    rec("b2", { source: "pubmed", externalId: "12345678", title: "PMID paper reindexed", authors: ["Brown B"], year: 2018 }),
    /* G3: normalised title + year + first author, no identifiers. */
    rec("c1", { title: "Effects of X on Y: a randomised trial!", authors: ["Smith JA", "Jones A"], year: 2020 }),
    rec("c2", { title: "effects of x on y a randomised trial", authors: ["Smith J"], year: 2020 }),
    /* G4: the same DOI across two databases. */
    rec("d1", { source: "pubmed", externalId: "99990001", title: "Shared DOI", authors: ["Park E"], year: 2022, doi: "10.1000/shared" }),
    rec("d2", { source: "crossref", externalId: "10.1000/shared", title: "Shared DOI (Crossref)", authors: ["Park E"], year: 2022, doi: "10.1000/shared" }),
    /* G5: title case/punctuation variants, same first author and year. */
    rec("e1", { title: "Beta-Blockers after MI: a cohort study", authors: ["Choi F"], year: 2019 }),
    rec("e2", { title: "Beta blockers after MI - a cohort study.", authors: ["Choi F", "Han G"], year: 2019 }),
    /* Near-misses: true negatives. */
    rec("n1", { title: "Same Title Different Year", authors: ["Smith JA"], year: 2020 }),
    rec("n2", { title: "Same Title Different Year", authors: ["Smith JA"], year: 2021 }),
    rec("n3", { title: "Same Title Different Author", authors: ["Smith JA"], year: 2020 }),
    rec("n4", { title: "Same Title Different Author", authors: ["Jones B"], year: 2020 }),
    rec("n5", { title: "Missing Year Study", authors: ["Smith JA"], year: null }),
    rec("n6", { title: "Missing Year Study", authors: ["Smith JA"], year: 2020 }),
    rec("n7", { title: "Aspirin for prevention", authors: ["White C"], year: 2020, doi: "10.1000/near" }),
    rec("n8", { title: "Aspirin for prevention extended", authors: ["White C"], year: 2020, doi: "10.1000/nearx" }),
    rec("n9", { source: "pubmed", externalId: "123", title: "Short PMID", authors: ["Black D"], year: 2020 }),
    rec("n10", { source: "pubmed", externalId: "1234", title: "Short PMID other", authors: ["Black D"], year: 2020 }),
  ];
  /* 20 distinct singletons. */
  for (let i = 0; i < 20; i++)
    records.push(rec("s" + i, { title: "Distinct study number " + i, authors: ["Author" + i + " A"], year: 2000 + i, doi: "10.1000/s" + i }));
  const truthClusters = [["a1", "a2", "a3"], ["b1", "b2"], ["c1", "c2"], ["d1", "d2"], ["e1", "e2"]];
  return { records, truthClusters };
}

function pairSet(clusters) {
  const pairs = new Set();
  for (const cluster of clusters)
    for (let i = 0; i < cluster.length; i++)
      for (let j = i + 1; j < cluster.length; j++)
        pairs.add([cluster[i], cluster[j]].sort().join("|"));
  return pairs;
}

test("dedup: F1 >= 0.98 on the known set (plan section-12 gate)", () => {
  const { records, truthClusters } = knownSet();
  const { groups, duplicatesRemoved } = dedupRecords(records);
  const predicted = pairSet(groups.map((g) => g.memberIds));
  const truth = pairSet(truthClusters);
  let tp = 0;
  for (const p of predicted) if (truth.has(p)) tp++;
  const precision = predicted.size ? tp / predicted.size : 1;
  const recall = truth.size ? tp / truth.size : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  assert.ok(f1 >= 0.98, "F1 " + f1.toFixed(4) + " (precision " + precision + ", recall " + recall + ")");
  assert.equal(f1, 1, "the deterministic keys should be exact on this set");
  assert.equal(groups.length, 5);
  assert.equal(duplicatesRemoved, 6, "6 non-canonical members across the 5 clusters (3+2+2+2+2 minus 5 canonicals)");
  /* Nothing deleted: every input record still exists, grouped or singleton. */
  const grouped = new Set(groups.flatMap((g) => g.memberIds));
  assert.equal(grouped.size, 11, "11 records live in groups");
  assert.equal(records.length, 41, "21 named records + 20 singletons");
});

test("dedup: canonical is the earliest record; groups are deterministic and order-invariant", () => {
  const { records } = knownSet();
  const first = dedupRecords(records);
  const g1 = first.groups.find((g) => g.memberIds.includes("a1"));
  assert.equal(g1.canonicalRecordId, "a1", "a1 has the earliest createdTs in its cluster");
  assert.ok(g1.memberIds.includes("a2") && g1.memberIds.includes("a3"));

  const again = dedupRecords(records);
  assert.deepEqual(again, first, "idempotent: same groups on re-run");

  const shuffled = records.slice().reverse();
  const reordered = dedupRecords(shuffled);
  assert.deepEqual(reordered.groups, first.groups, "input order cannot change the groups");

  /* Explicit createdTs ordering beats id order. */
  const late = rec("z-late", { title: "Ordered", authors: ["Smith JA"], year: 2020, createdTs: 5000 });
  const early = rec("a-early", { title: "Ordered", authors: ["Smith J"], year: 2020, createdTs: 100 });
  const out = dedupRecords([late, early]);
  assert.equal(out.groups[0].canonicalRecordId, "a-early");
});

test("dedup: key normalisation helpers", () => {
  assert.equal(normaliseDoi("https://doi.org/10.1000/ABC."), "10.1000/abc");
  assert.equal(normaliseDoi("http://dx.doi.org/10.1000/x"), "10.1000/x");
  assert.equal(normaliseDoi("doi: 10.1000/y"), "10.1000/y");
  assert.equal(normaliseDoi("not-a-doi"), "");
  assert.equal(normaliseDoi(""), "");
  assert.equal(normaliseTitle("Effects of X on Y: a randomised trial!"), "effects of x on y a randomised trial");
  assert.equal(firstAuthorKey(["Smith JA", "Jones B"]), "smith");
  assert.equal(firstAuthorKey(["Smith, JA"]), "smith");
  assert.equal(firstAuthorKey(["Smith J"]), "smith", "initials do not change the family key");
  assert.equal(firstAuthorKey([]), "");
  /* A title key needs title AND year AND first author. */
  assert.equal(recordKeys({ title: "T", authors: [], year: 2020 }).title, "");
  assert.equal(recordKeys({ title: "T", authors: ["Smith J"], year: null }).title, "");
  assert.ok(recordKeys({ title: "T", authors: ["Smith J"], year: 2020 }).title);
});

test("dedup: empty and singleton inputs produce no groups", () => {
  assert.deepEqual(dedupRecords([]), { groups: [], duplicatesRemoved: 0 });
  const one = dedupRecords([rec("only", { title: "Solo", authors: ["A B"], year: 2020 })]);
  assert.deepEqual(one, { groups: [], duplicatesRemoved: 0 });
});