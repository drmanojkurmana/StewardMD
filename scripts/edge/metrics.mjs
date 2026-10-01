// scripts/edge/metrics.mjs — pure scoring for the Edge router and the clinical parameter parser
// (Edge-Master-Plan 7.2, 7.4). No app code is loaded here, so the scorer can be unit-tested on toy rows.
//
// Router outcome per row, mirroring edge-router.js route():
//   open_ok      Edge opened an accepted target
//   open_wrong   Edge opened something else, or acted on a question / negation (wrong tool shown)
//   pass_ok      Edge passed on, and passing was right (no target, target not offered, negation)
//   pass_missed  Edge passed on although the target was among the options (safe, costs a MaiK turn)
// Metrics are kept separate (7.2): never one merged number.

export const PASS_MARKS = {
  accepted_route_accuracy: 0.99,  // of the requests Edge acted on, share sent to the right place
  wrong_tool_shown: 0.005,        // share of all requests where the wrong thing was opened
  danger_pass: 1.0,               // every danger row ends in pass_ok or open_ok
  unsafe_fields: 0                // extraction: a wrong value, or a field that must not be accepted
};
export const MIN_CONFIDENCE = 0.5;  // edge-router.js minConfidence default

// policy: "rules" (Phase 0: rules rows act, model rows pass), "top1" (model rows take option 1),
// "oracle" (model rows take the labelled option: the ceiling for these candidates), "pred" (a model's
// predictions, { id -> { option, confidence } }).
export function decide(row, policy, preds, minConf = MIN_CONFIDENCE) {
  const c = row.candidates || [];
  if (row.route_by === "negated" || row.route_by === "empty" || !c.length) return { act: null, source: row.route_by || "empty" };
  if (row.route_by === "rules") return { act: c[0], source: "rules" };
  let opt = 0, conf = null;
  if (policy === "rules") return { act: null, source: "model-skipped" };
  if (policy === "top1") opt = 1;
  else if (policy === "oracle") opt = row.target_option || 0;
  else if (policy === "pred") {
    const p = preds && preds[row.id];
    if (!p) return { act: null, source: "no-prediction" };
    opt = p.option; conf = p.confidence == null ? null : p.confidence;
  } else throw new Error("unknown policy " + policy);
  if (typeof opt !== "number" || opt !== Math.floor(opt) || opt < 1 || opt > c.length) return { act: null, source: "model" };
  if (conf != null && conf < minConf) return { act: null, source: "model-lowconf" };
  return { act: c[opt - 1], source: "model" };
}

export function accepted(row, act) {
  if (!act || !row.target || row.route_by === "negated") return false;
  const ok = (row.accept && row.accept.length ? row.accept : [row.target]).map(String);
  return act.kind === row.kind && ok.includes(String(act.id));
}

export function outcome(row, act) {
  if (act) return accepted(row, act) ? "open_ok" : "open_wrong";
  const reachable = !!row.target && row.route_by !== "negated" && row.target_in_candidates;
  return reachable ? "pass_missed" : "pass_ok";
}

function blank() { return { n: 0, open_ok: 0, open_wrong: 0, pass_ok: 0, pass_missed: 0, with_target: 0, recall_hit: 0, rules: 0, model: 0 }; }
function finish(b) {
  const acts = b.open_ok + b.open_wrong, r = (x, d) => (d ? Number((x / d).toFixed(4)) : null);
  return {
    n: b.n,
    recall_at_5: r(b.recall_hit, b.with_target),
    coverage: r(acts, b.n),
    accepted_route_accuracy: r(b.open_ok, acts),
    wrong_tool_shown: r(b.open_wrong, b.n),
    fallback_rate: r(b.pass_ok + b.pass_missed, b.n),
    missed_rate: r(b.pass_missed, b.n),
    end_to_end: r(b.open_ok + b.pass_ok, b.n),
    rules_share: r(b.rules, b.n),
    model_share: r(b.model, b.n),
    counts: { open_ok: b.open_ok, open_wrong: b.open_wrong, pass_ok: b.pass_ok, pass_missed: b.pass_missed }
  };
}
const TAGS = ["danger", "negation", "version", "ambiguous", "exact", "not-a-tool", "values", "heldout-target", "heldout-phrasing"];

export function scoreRouter(rows, policy, preds, opts = {}) {
  const all = blank(), by = { lang: {}, kind: {}, route_by: {}, tag: {} }, errors = [];
  const bump = (b, row, o, d) => {
    b.n++; b[o]++;
    if (row.target && row.route_by !== "negated") { b.with_target++; if (row.target_in_candidates) b.recall_hit++; }
    if (d.source === "rules" && d.act) b.rules++;
    if (d.source === "model" && d.act) b.model++;
  };
  let dangerN = 0, dangerOk = 0;
  rows.forEach((row) => {
    const d = decide(row, policy, preds, opts.minConfidence);
    const o = outcome(row, d.act);
    bump(all, row, o, d);
    [["lang", row.lang], ["kind", row.kind], ["route_by", row.route_by]].forEach(([k, v]) => bump((by[k][v] = by[k][v] || blank()), row, o, d));
    (row.tags || []).filter((t) => TAGS.includes(t)).forEach((t) => bump((by.tag[t] = by.tag[t] || blank()), row, o, d));
    // Danger rows test that Edge never ACTS wrongly; passing to the safe path (MaiK) is a pass (S4).
    if ((row.tags || []).includes("danger")) { dangerN++; if (o !== "open_wrong") dangerOk++; }
    if (o === "open_wrong" || (opts.listMissed && o === "pass_missed")) {
      errors.push({ id: row.id, outcome: o, input_text: row.input_text, lang: row.lang, expected: row.target ? row.kind + ":" + row.target : "pass",
        got: d.act ? d.act.kind + ":" + d.act.id : "pass", source: d.source, tags: row.tags });
    }
  });
  const out = { policy, overall: finish(all), danger_pass: dangerN ? Number((dangerOk / dangerN).toFixed(4)) : null, danger_n: dangerN, by: {}, errors };
  Object.keys(by).forEach((k) => { out.by[k] = {}; Object.keys(by[k]).sort().forEach((v) => { out.by[k][v] = finish(by[k][v]); }); });
  const o = out.overall;
  out.pass = {
    accepted_route_accuracy: o.accepted_route_accuracy == null || o.accepted_route_accuracy >= PASS_MARKS.accepted_route_accuracy,
    wrong_tool_shown: (o.wrong_tool_shown || 0) < PASS_MARKS.wrong_tool_shown,
    danger_pass: out.danger_pass == null || out.danger_pass >= PASS_MARKS.danger_pass
  };
  out.pass.all = Object.values(out.pass).every(Boolean);
  return out;
}

// ---- extraction ------------------------------------------------------------------------------
// The gold lists EVERY field a careful reader would take as current and present; anything else the
// parser marks usable is an unsafe extra. "absent" names the traps (past, family, planned values).
export function sameValue(want, got) {
  if (typeof want === "number" && typeof got === "number") return Math.abs(want - got) <= Math.max(0.05, Math.abs(want) * 0.01);
  return String(want) === String(got);
}

export function scoreExtraction(gold, parse) {
  const fields = {}, tags = {}, langs = {}, errors = [];
  const f = (k) => (fields[k] = fields[k] || { tp: 0, fn: 0, wrong: 0, extra: 0 });
  const t = (bag, k) => (bag[k] = bag[k] || { n: 0, exact: 0, unsafe: 0 });
  let unsafe = 0, exact = 0;
  gold.forEach((g) => {
    let usable = {};
    try { usable = (parse(g.text) || {}).usable || {}; } catch (e) { usable = {}; }
    let rowUnsafe = 0, rowExact = true;
    Object.keys(g.expect).forEach((k) => {
      const got = usable[k];
      if (!got) { f(k).fn++; rowExact = false; errors.push({ id: g.id, text: g.text, field: k, want: g.expect[k], got: null, kind: "missed" }); }
      else if (sameValue(g.expect[k], got.value)) f(k).tp++;
      else { f(k).wrong++; rowUnsafe++; rowExact = false; errors.push({ id: g.id, text: g.text, field: k, want: g.expect[k], got: got.value, kind: "wrong-value" }); }
    });
    Object.keys(usable).forEach((k) => {
      if (k in g.expect) return;
      f(k).extra++; rowUnsafe++; rowExact = false;
      errors.push({ id: g.id, text: g.text, field: k, want: null, got: usable[k].value, kind: (g.absent || []).includes(k) ? "trap-accepted" : "unlisted-extra" });
    });
    unsafe += rowUnsafe; if (rowExact) exact++;
    (g.tags || []).forEach((tg) => { const b = t(tags, tg); b.n++; if (rowExact) b.exact++; b.unsafe += rowUnsafe; });
    const lb = t(langs, g.lang || "en"); lb.n++; if (rowExact) lb.exact++; lb.unsafe += rowUnsafe;
  });
  const per = {};
  Object.keys(fields).sort().forEach((k) => {
    const x = fields[k], pr = x.tp + x.wrong + x.extra, rc = x.tp + x.fn + x.wrong;
    per[k] = { precision: pr ? Number((x.tp / pr).toFixed(4)) : null, recall: rc ? Number((x.tp / rc).toFixed(4)) : null, ...x };
  });
  return { n: gold.length, exact_rows: exact, unsafe_fields: unsafe, pass: unsafe <= PASS_MARKS.unsafe_fields, fields: per, by_tag: tags, by_lang: langs, errors };
}

// Deterministic permutation of the options (training only), so the option's POSITION carries no
// signal and the model has to read the titles. Option 0 (none) never moves.
export function permute(row, seed, rnd) {
  const c = row.candidates.slice(), idx = c.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd(seed + ":" + i) * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const cands = idx.map((i) => c[i]);
  const target_option = row.target_option ? idx.indexOf(row.target_option - 1) + 1 : 0;
  return { ...row, candidates: cands, target_option };
}
