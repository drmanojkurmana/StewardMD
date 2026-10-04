/* edge-runtime.js — the StewardMD Edge runtime contract (vault/plans/Edge-Master-Plan.md section 4.2).
 * ---------------------------------------------------------------------------
 * Wraps ONE on-device engine (Needle via capacitor-needle, FunctionGemma via capacitor-llama, or a
 * test mock) behind the rules the engine itself cannot keep:
 *   - Queue: at most 1 running + 1 waiting. A new request replaces the waiting one (which resolves
 *     "superseded"); nothing queues behind it.
 *   - Deadline: a warm call that passes `deadlineMs` resolves "timeout" at once. If the engine can be
 *     hard-killed (Android :edge process) it is; otherwise (iOS) the call keeps running, its result is
 *     discarded, and the runtime refuses new work ("busy") until it returns. Cold load has its own
 *     budget (`coldMs`) and is never treated as a timeout of a call.
 *   - Patient/session binding: setSession(id) bumps a token; any result carrying an old token
 *     resolves "stale" and is never shown. The engine is reset before the next call.
 *   - Back-off: env.memoryOk() / env.thermalOk() / env.othersBusy() are asked before every call; a
 *     "no" resolves "skipped" so the caller uses the rules path.
 *   - Lost weights: an engine error tagged `notLoaded` (the engine process restarted empty) marks the
 *     runtime cold; that call reloads once and retries. No loop: a second notLoaded is an "error".
 *   - Offline: the runtime makes no network calls of its own; adapters must not either.
 * Every outcome is a resolved value, never a rejection, so a caller can always continue (rule S4).
 *
 * API: SMD_EDGE_RUNTIME.create({ engine, deadlineMs, coldMs, env, now }) ->
 *        { run(task) -> Promise<{ status, result?, ms }>, setSession(id), session(), status(), release() }
 *      task = { prompt, tools?, maxTokens? }   status: ok | timeout | superseded | stale | skipped | busy | unavailable | error
 * window.SMD_EDGE_RUNTIME + module.exports. ES5.
 */
(function (root) {
  "use strict";

  function create(opts) {
    opts = opts || {};
    var engine = opts.engine;
    var deadlineMs = opts.deadlineMs || 1200, coldMs = opts.coldMs || 8000;
    var env = opts.env || {};
    var now = opts.now || function () { return Date.now(); };
    var token = 0, sessionId = null;
    var running = null, waiting = null, stuck = false, loaded = false, loading = null, needsReset = false;
    var stats = { calls: 0, ok: 0, timeout: 0, superseded: 0, stale: 0, skipped: 0, busy: 0, error: 0 };

    function ask(fn) { try { return typeof fn === "function" ? fn() !== false : true; } catch (e) { return false; } }
    function done(resolve, status, extra) {
      stats[status] = (stats[status] || 0) + 1;
      var out = { status: status }; if (extra) for (var k in extra) out[k] = extra[k];
      resolve(out);
    }

    // budget: how long THIS caller waits (a request: coldMs; a background warm: longer). A request that
    // arrives while a warm is loading joins that load but still gives up after coldMs (rules answer).
    function ensureLoaded(budget) {
      budget = budget || coldMs;
      if (loaded) return Promise.resolve(true);
      if (!loading) {
        loading = new Promise(function (res) {
          var timer = setTimeout(function () { loading = null; res(false); }, budget);
          Promise.resolve().then(function () { return engine.load(); }).then(function () {
            clearTimeout(timer); loaded = true; loading = null; res(true);
          }, function () { clearTimeout(timer); loading = null; res(false); });
        });
      }
      var shared = loading;
      return new Promise(function (res) {
        var t = setTimeout(function () { res(false); }, budget);
        shared.then(function (ok) { clearTimeout(t); res(ok); });
      });
    }

    function start(job) {
      running = job;
      var myToken = job.token, t0 = now(), settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        if (engine.kill) {
          Promise.resolve().then(function () { return engine.kill(); }).catch(function () {});
          loaded = false;                          // process gone: next call is a cold load
        } else {
          stuck = true;                            // iOS: the call is still running
        }
        done(job.resolve, "timeout", { ms: now() - t0 });
        running = null; next();
      }, job.deadlineMs || deadlineMs);

      Promise.resolve().then(function () {
        return needsReset && engine.reset ? Promise.resolve(engine.reset()).then(function () { needsReset = false; }) : null;
      }).then(function () {
        return engine.complete(job.task);
      }).then(function (res) {
        if (stuck) { stuck = false; next(); }
        if (settled) return;                       // deadline already answered for this job
        settled = true; clearTimeout(timer); running = null;
        if (myToken !== token) done(job.resolve, "stale", { ms: now() - t0 });
        else done(job.resolve, "ok", { result: res, ms: now() - t0 });
        next();
      }, function (err) {
        if (stuck) { stuck = false; next(); }
        if (settled) return;
        settled = true; clearTimeout(timer);
        // The engine lost its weights behind the runtime's back (Android: the low-memory killer ended
        // :edge and the restarted process has no model). Mark cold, reload under coldMs, retry this job
        // once with a fresh deadline. `running` stays this job meanwhile, so new work waits.
        if (err && err.notLoaded && !job.reloaded) {
          job.reloaded = true; loaded = false;
          return ensureLoaded().then(function (ok) {
            if (ok && job.token === token) return start(job);
            running = null;
            done(job.resolve, ok ? "stale" : "unavailable", ok ? null : { reason: "load" });
            next();
          });
        }
        running = null;
        done(job.resolve, "error", { error: String((err && err.message) || err), ms: now() - t0 });
        next();
      });
    }

    function next() {
      if (running || stuck || !waiting) return;
      var job = waiting; waiting = null;
      if (job.token !== token) { done(job.resolve, "stale"); return next(); }
      start(job);
    }

    function run(task) {
      stats.calls++;
      return new Promise(function (resolve) {
        if (!engine || !engine.available || !engine.available()) return done(resolve, "unavailable");
        if (!ask(env.memoryOk) || !ask(env.thermalOk)) return done(resolve, "skipped", { reason: "device" });
        if (env.othersBusy && ask(function () { return !env.othersBusy(); }) === false) return done(resolve, "skipped", { reason: "busy-other" });
        if (stuck) return done(resolve, "busy");
        var job = { task: task || {}, token: token, resolve: resolve };
        ensureLoaded().then(function (ok) {
          if (!ok) return done(resolve, "unavailable", { reason: "load" });
          if (job.token !== token) return done(resolve, "stale");
          if (!running && !stuck) return start(job);
          if (waiting) done(waiting.resolve, "superseded");
          waiting = job;
        });
      });
    }

    /* warm(task, budgetMs): load and run one throwaway call OUTSIDE any request's budget, so the first
     * real request finds the engine warm (iOS Metal compiles its shaders on first use: 17 s for
     * FunctionGemma on an iPhone 15 Pro). Same back-off as run(). Never queues: busy -> false.
     * Resolves true when the throwaway call came back ok. */
    function warm(task, budgetMs) {
      var budget = budgetMs || 60000;
      if (!engine || !engine.available || !engine.available()) return Promise.resolve(false);
      if (!ask(env.memoryOk) || (env.othersBusy && ask(function () { return !env.othersBusy(); }) === false)) return Promise.resolve(false);
      if (running || waiting || stuck) return Promise.resolve(false);
      return ensureLoaded(budget).then(function (ok) {
        if (!ok || running || waiting || stuck) return false;
        return new Promise(function (resolve) {
          start({ task: task || {}, token: token, resolve: resolve, deadlineMs: budget });
        }).then(function (r) { return !!(r && r.status === "ok"); });
      });
    }

    function setSession(id) {
      if (id === sessionId) return;
      sessionId = id; token++; needsReset = true;
      if (waiting) { var w = waiting; waiting = null; done(w.resolve, "stale"); }
    }

    function release() {
      // Honest semantics: an in-process Needle cannot unload weights; release() only unbinds and
      // marks the runtime cold. A killable engine (Android :edge) frees its memory.
      if (waiting) { var w = waiting; waiting = null; done(w.resolve, "superseded"); }
      loaded = false;
      return Promise.resolve().then(function () { return engine && engine.release ? engine.release() : null; });
    }

    return {
      run: run, warm: warm, setSession: setSession, release: release,
      session: function () { return sessionId; },
      status: function () { return { loaded: loaded, running: !!running, waiting: !!waiting, stuck: stuck, token: token, stats: JSON.parse(JSON.stringify(stats)) }; }
    };
  }

  var API = { create: create, _version: "1.0" };
  if (root) root.SMD_EDGE_RUNTIME = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
