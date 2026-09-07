/* wardsynq/wardsynq-lineage.js — where did that number come from.
 *
 * The spec asks for one thing plainly: a clinician can click any derived value, an eGFR, a NEWS2
 * score, a bundle compliance figure, and inspect the exact raw observations that produced it. This
 * file is that, and it exists because the build now has several derived values and no shared way to
 * trace any of them.
 *
 * WHY IT MATTERS MORE THAN IT SOUNDS. An unexplainable number in a clinical system is acted on or
 * ignored, and both are bad. A clinician who cannot see that a NEWS2 of 7 rests on a respiratory
 * rate charted four hours ago has no way to weigh it, and a clinician who has been surprised twice
 * by a number they could not check stops believing the sixth one, which is the one that mattered.
 *
 *   1. THE GRAPH IS BUILT FROM WHAT ACTUALLY HAPPENED, not from a declaration. A node records its
 *      inputs at the moment it was computed. A lineage assembled afterwards by re-running the
 *      calculation is a plausible story about the past, not the past.
 *   2. AN INPUT THAT WAS REJECTED IS PART OF THE LINEAGE. A score built from five observations after
 *      discarding a stale sixth is not the same as a score built from five: what was thrown away and
 *      why is often the whole explanation, and it is the first thing an investigation asks for.
 *   3. STALENESS PROPAGATES. A derived value is no fresher than its oldest input, however recently
 *      the arithmetic ran. A NEWS2 recomputed thirty seconds ago on a four-hour-old blood pressure
 *      is a four-hour-old assessment wearing a new timestamp, and the display will say "30 seconds
 *      ago" unless something computes this.
 *   4. A BROKEN CHAIN IS REPORTED, NEVER PATCHED. If a node names an input that is not in the graph,
 *      the explanation says so rather than quietly showing the part it can reach. A partial
 *      provenance presented as a complete one is worse than none.
 *
 * NOT MODELLED: persistence (the graph is in memory and a real deployment writes nodes to the
 * append-only store as they are created), cross-system lineage into a source hospital's own
 * calculations, and column-level lineage for bulk transforms.
 *
 * STATUS: IMPLEMENTED and TESTED.
 *
 * node --test test/wardsynq-lineage.test.mjs
 */

const NODE_KIND = Object.freeze({
  RAW: "raw",             // an observation or record as it arrived
  DERIVED: "derived",     // computed from other nodes
  EXTERNAL: "external",   // asserted by another system, with no visible working
});

class LineageError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "LineageError";
    this.code = code || "LINEAGE_VIOLATION";
  }
}

class LineageGraph {
  constructor({ now } = {}) {
    this.now = now || (() => new Date().toISOString());
    this.nodes = new Map();
  }

  /**
   * Records a raw input: an observation, an administration, a scanned value.
   *
   * `at` is the clinical time the fact was true, not the time it was recorded here. Staleness is
   * measured against the former, because that is what makes a number old.
   */
  raw({ id, label, value, unit, at, source, patientId }) {
    if (!id) throw new LineageError("a node needs an id", "NO_ID");
    const node = {
      id, kind: NODE_KIND.RAW, label: label || id, value, unit: unit || null,
      at: at || this.now(), recordedAt: this.now(), source: source || null,
      patientId: patientId || null, inputs: [], rejected: [],
    };
    this.nodes.set(id, node);
    return node;
  }

  /** A value another system asserted, whose working we cannot see. Distinct from raw on purpose. */
  external({ id, label, value, unit, at, source, patientId }) {
    const node = this.raw({ id, label, value, unit, at, source, patientId });
    node.kind = NODE_KIND.EXTERNAL;
    node.note = `asserted by ${source || "another system"}; its own inputs are not visible to this graph, so any explanation stops here`;
    return node;
  }

  /**
   * Records a derived value and the inputs it was actually computed from.
   *
   * `rejected` is not optional decoration. A score built from five observations after discarding a
   * stale sixth is a different fact from a score built from five, and the discarded one is usually
   * the first thing an investigation asks about.
   */
  derived({ id, label, value, unit, inputs, rejected, method, at, patientId }) {
    if (!id) throw new LineageError("a node needs an id", "NO_ID");
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new LineageError(
        `${id} is derived but names no inputs. A derived value with no recorded provenance cannot be explained to the clinician who has to act on it`,
        "NO_INPUTS");
    }
    const node = {
      id, kind: NODE_KIND.DERIVED, label: label || id, value, unit: unit || null,
      at: at || this.now(), recordedAt: this.now(),
      method: method || null, patientId: patientId || null,
      inputs: inputs.slice(),
      // [{id, reason}] — what was considered and not used.
      rejected: (rejected || []).slice(),
    };
    this.nodes.set(id, node);
    return node;
  }

  get(id) { return this.nodes.get(id) || null; }

  /**
   * The full explanation of one value: its tree, its effective age, and any break in the chain.
   *
   * @returns {{found: boolean, node, tree, rawInputs, rejected, oldestInputAt, effectiveAgeMinutes,
   *   complete: boolean, missing: string[], explanation: string}}
   */
  explain(id, nowIso) {
    const node = this.get(id);
    if (!node) return { found: false, explanation: `nothing in this graph produced ${id}` };

    const now = nowIso || this.now();
    const missing = [];
    const rawInputs = [];
    const allRejected = [];
    const seen = new Set();

    const walk = (nodeId, depth) => {
      if (seen.has(nodeId)) {
        // A cycle is a bug in whatever built the graph, and is reported rather than hung on.
        return { id: nodeId, cycle: true, label: (this.get(nodeId) || {}).label || nodeId };
      }
      seen.add(nodeId);
      const n = this.get(nodeId);
      if (!n) { missing.push(nodeId); return { id: nodeId, missing: true }; }

      for (const r of n.rejected) allRejected.push({ ...r, rejectedBy: n.id });
      if (n.kind !== NODE_KIND.DERIVED) rawInputs.push(n);

      return {
        id: n.id, kind: n.kind, label: n.label, value: n.value, unit: n.unit, at: n.at,
        method: n.method || null, note: n.note || null,
        rejected: n.rejected,
        inputs: n.inputs.map((i) => walk(i, depth + 1)),
      };
    };

    const tree = walk(id, 0);

    // Staleness propagates. The arithmetic running a second ago says nothing about how old the
    // patient information underneath it is.
    const times = rawInputs.map((n) => Date.parse(n.at)).filter(Number.isFinite);
    const oldest = times.length ? Math.min(...times) : null;
    const effectiveAgeMinutes = oldest === null ? null : Math.round((Date.parse(now) - oldest) / 60000);
    const ownAgeMinutes = Math.round((Date.parse(now) - Date.parse(node.at)) / 60000);

    const complete = missing.length === 0;
    return {
      found: true, node, tree,
      rawInputs,
      rejected: allRejected,
      oldestInputAt: oldest === null ? null : new Date(oldest).toISOString(),
      effectiveAgeMinutes,
      ownAgeMinutes,
      complete,
      missing,
      // The sentence a clinician should see under the number.
      explanation: !complete
        ? `INCOMPLETE PROVENANCE: ${missing.length} input${missing.length > 1 ? "s are" : " is"} not in this graph (${missing.join(", ")}). What is shown is a partial explanation and must not be read as the whole one.`
        : node.kind !== NODE_KIND.DERIVED
          ? `${node.label} is a ${node.kind} value from ${node.source || "an unrecorded source"}.`
          : `${node.label} was computed from ${rawInputs.length} value${rawInputs.length > 1 ? "s" : ""}${node.method ? ` by ${node.method}` : ""}. The oldest is ${effectiveAgeMinutes} minutes old, so this assessment is ${effectiveAgeMinutes} minutes old even though it was calculated ${ownAgeMinutes} minute${ownAgeMinutes === 1 ? "" : "s"} ago.${allRejected.length ? ` ${allRejected.length} value${allRejected.length > 1 ? "s were" : " was"} considered and not used.` : ""}`,
    };
  }

  /**
   * Everything downstream of a value: what would be wrong if this input turns out to be wrong.
   *
   * The question asked after a mislabelled sample, a wrong-patient reading or a corrected result: not
   * "what fed this", but "what did this feed", which is how a correction finds the decisions it needs
   * to reach.
   */
  impactOf(id) {
    const affected = [];
    const direct = [];
    for (const n of this.nodes.values()) {
      if (n.inputs.includes(id)) direct.push(n.id);
    }
    const queue = [...direct];
    const seen = new Set(direct);
    while (queue.length) {
      const current = queue.shift();
      affected.push(this.get(current));
      for (const n of this.nodes.values()) {
        if (n.inputs.includes(current) && !seen.has(n.id)) { seen.add(n.id); queue.push(n.id); }
      }
    }
    return {
      id,
      exists: this.nodes.has(id),
      directlyAffected: direct,
      allAffected: affected.map((n) => n.id),
      values: affected,
      reading: affected.length
        ? `If ${id} is wrong, ${affected.length} derived value${affected.length > 1 ? "s are" : " is"} wrong: ${affected.map((n) => n.label).join(", ")}. Each needs recomputing and anyone who acted on it needs telling.`
        : `Nothing in this graph was derived from ${id}.`,
    };
  }

  /** Nodes whose inputs are not all present, i.e. explanations that would be partial. */
  brokenChains() {
    const broken = [];
    for (const n of this.nodes.values()) {
      const absent = n.inputs.filter((i) => !this.nodes.has(i));
      if (absent.length) broken.push({ id: n.id, label: n.label, missing: absent });
    }
    return broken;
  }
}

/**
 * Builds a lineage node from a NEWS2 result, since it already carries its own sources and rejects.
 *
 * A convenience, but the shape is the point: any module producing a derived value should be able to
 * hand it straight to the graph, and if it cannot, it is not recording enough to be explainable.
 */
function fromNews2(graph, score, { id, patientId } = {}) {
  const sources = score.sources || {};
  const inputIds = [];

  for (const [param, src] of Object.entries(sources)) {
    if (!graph.get(src.id)) {
      graph.raw({ id: src.id, label: param, value: (score.parameters[param] || {}).value, at: src.atIso, source: "observation", patientId });
    }
    inputIds.push(src.id);
  }

  return graph.derived({
    id: id || `news2-${patientId}-${score.computedAt}`,
    label: "NEWS2",
    value: score.total,
    inputs: inputIds,
    rejected: (score.rejected || []).map((r) => ({ id: r.id, reason: r.reason })),
    method: `NEWS2 scale ${score.scale}`,
    at: score.computedAt,
    patientId,
  });
}

export { NODE_KIND, LineageError, LineageGraph, fromNews2 };
