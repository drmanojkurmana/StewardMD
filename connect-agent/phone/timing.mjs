// connect-agent/phone/timing.mjs - where does a discovery run actually spend its time?
//
// Asked 2026-09-24 before swapping the AI provider for a faster one: a faster model only helps if the
// run is waiting on the model. Nobody had timed it. This wraps the two things a run waits on - the
// AI ("brain") and the hospital browser (page loads, in-page replay, clicks) - and reports how much
// of the run's wall clock each one was busy.
//
// BUSY TIME, NOT SUMMED TIME. Calls overlap: verification replays views four at a time and several
// brain questions can be in flight together. Adding up each call's duration would report 8 seconds
// for four 2-second calls that took 2 seconds of the doctor's life. Each bucket counts the time at
// least one of its calls was in flight - the union of the intervals - which is the number that says
// whether a faster provider would shorten the run. Per-method totals ARE summed: they rank which
// question is expensive, not how long the doctor waited.

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

export function createRunTimer() {
  const t0 = now();
  const buckets = {};
  const bucket = (name) => (buckets[name] = buckets[name] || { busyMs: 0, inflight: 0, since: 0, calls: 0, methods: {} });

  function start(b) {
    if (b.inflight === 0) b.since = now();
    b.inflight += 1;
    b.calls += 1;
  }
  function stop(b, method, t) {
    b.inflight -= 1;
    const end = now();
    if (b.inflight === 0) b.busyMs += end - b.since;
    const m = (b.methods[method] = b.methods[method] || { calls: 0, ms: 0 });
    m.calls += 1;
    m.ms += end - t;
  }

  /** Same object, every method timed into `name`. Non-function properties (e.g. `platform`) pass through,
   *  and methods run against the ORIGINAL object so nothing that relies on `this` notices the wrapper. */
  /* THE PROXY TARGET IS A STAND-IN, NOT THE OBJECT. A Proxy's `get` may not substitute a value for a
   * non-writable, non-configurable property of its own target, and the plugin clients and fakes are
   * Object.freeze()d - so proxying them directly threw "'evaluate' is a read-only and non-configurable
   * data property" on the first call and would have killed every run. Reading through to `obj` from an
   * empty target keeps every invariant; `has` keeps `'drainRequests' in plugin` feature checks true. */
  function wrap(obj, name) {
    if (!obj || typeof obj !== 'object') return obj;
    const b = bucket(name);
    const target = obj;
    return new Proxy({}, {
      has(_, prop) { return prop in target; },
      get(_, prop) {
        const v = target[prop];
        if (typeof v !== 'function') return v;
        return function timed(...args) {
          const t = now();
          start(b);
          let out;
          try { out = v.apply(target, args); } catch (e) { stop(b, String(prop), t); throw e; }
          if (out && typeof out.then === 'function') {
            return out.then((r) => { stop(b, String(prop), t); return r; }, (e) => { stop(b, String(prop), t); throw e; });
          }
          stop(b, String(prop), t);
          return out;
        };
      },
    });
  }

  /** Seconds, rounded, PHI-free (method names and counts only). */
  function report() {
    const totalMs = now() - t0;
    const r = (ms) => Math.round(ms / 100) / 10;
    const out = { totalSec: r(totalMs), buckets: {} };
    for (const [name, b] of Object.entries(buckets)) {
      out.buckets[name] = {
        busySec: r(b.busyMs),
        share: totalMs > 0 ? Math.round((b.busyMs / totalMs) * 100) : 0,
        calls: b.calls,
        slowest: Object.entries(b.methods).sort((x, y) => y[1].ms - x[1].ms).slice(0, 6)
          .map(([k, m]) => ({ method: k, calls: m.calls, sec: r(m.ms) })),
      };
    }
    return out;
  }

  return { wrap, report };
}
