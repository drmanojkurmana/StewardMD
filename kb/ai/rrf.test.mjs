// Reciprocal Rank Fusion — pure, deterministic. Run: node kb/ai/rrf.test.mjs
import { rrf } from "./interface.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("✗ FAIL:", n); } };
const eq = (n, a, b) => ok(n + " → " + JSON.stringify(a), JSON.stringify(a) === JSON.stringify(b));

// empty vector arm → identical to lexical order (the no-regression guarantee)
eq("B empty = passthrough", rrf(["a", "b", "c"], []), ["a", "b", "c"]);
eq("both empty", rrf([], []), []);
eq("A empty = B order", rrf([], ["x", "y"]), ["x", "y"]);

// symmetric reversal → tie, stable by first appearance (A then B)
eq("symmetric tie stable", rrf(["a", "b"], ["b", "a"]), ["a", "b"]);

// shared top ranks higher; single-list ids fall by rank
eq("shared id wins, rank matters", rrf(["x", "y"], ["y", "z"]), ["y", "x", "z"]);

// id present in both at good ranks beats ids in one list
// b (both, ranks 1&0) > a (both, ranks 0&2) > d (B rank1) > c (A rank2)
eq("consensus beats singletons", rrf(["a", "b", "c"], ["b", "d", "a"]), ["b", "a", "d", "c"]);

// garbage-safe
eq("null args → []", rrf(null, undefined), []);

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
