/* Shared helpers for IR depth data files. */
export function step(tx, say, vis) { return vis ? { tx, say, vis } : { tx, say, vis: null }; }
export function flow(ids) {
  const nodes = ids.map((label, i) => ({ id: String.fromCharCode(97 + i), label }));
  const edges = ids.slice(1).map((_, i) => [String.fromCharCode(97 + i), String.fromCharCode(98 + i)]);
  return { kind: "flow", nodes, edges };
}
export function table(cols, rows) { return { kind: "table", cols, rows }; }
export function mcq(id, q, o, a, e, r, kp) { return { id, q, o, a, exp: e, r, kp }; }
/* E(answerBold, firstSentence, correctIdx, [3 wrong reasons in option order skipping correct], keyPoint) */
export function E(ans, first, ci, w, key) {
  const Ls = ["A", "B", "C", "D"].filter((_, i) => i !== ci);
  return `**Answer: ${ans}.** ${first}\n**Why the others are wrong**\n- ${Ls[0]}: ${w[0]}\n- ${Ls[1]}: ${w[1]}\n- ${Ls[2]}: ${w[2]}\n**Key point:** ${key}.`;
}
export function L(id, title, kb, kbName, aliases, scope, steps, pearls, patho, diffs, invs, mcqs) {
  return { id, title, kb, kbName, aliases, scope, steps, pearls, patho, diffs, invs, mcqs };
}
