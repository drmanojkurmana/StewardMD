/* opd-live.js - the OPD boards' live connection (OPD plan item 16): window.SMD_OPD_LIVE.
 *
 * GET /api/queue/live streams the hospital's queue revision as Server-Sent Events. This reads it with fetch (so
 * the console's sign-in headers go with it; EventSource cannot send headers) and calls onChange() each time the
 * revision moves after the first. The server ends a stream after a few minutes; this reconnects at once, and
 * after a failure backs off (1s, 2s, 4s ... 30s). onState(true|false) says whether the board is live, so the
 * host polls slowly while live and at its old pace when not: a board never goes stale because a stream died.
 *
 * connect({ url, headers?() -> object|Promise<object>, onChange(rev), onState?(live), fetch? }) -> { stop() }
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SMD_OPD_LIVE = api;
})(typeof self !== "undefined" ? self : this, function () {
  // PURE: split a buffer into complete SSE frames; returns { revs: [...], rest }.
  function frames(buf) {
    var parts = buf.split("\n\n"), rest = parts.pop(), revs = [];
    parts.forEach(function (f) {
      f.split("\n").forEach(function (line) {
        if (line.indexOf("data:") !== 0) return;
        try { var j = JSON.parse(line.slice(5)); if (j && j.rev != null) revs.push(j.rev); } catch (e) {}
      });
    });
    return { revs: revs, rest: rest };
  }

  /* The transport that can stream. In the app, window.fetch is the CapacitorHttp bridge, which BUFFERS a stream
   * (nothing arrives until it ends); window.CapacitorWebFetch is the WebView's own fetch and streams cross-origin
   * (the queue API echoes CORS for the app's origin), the same path MaiK's answers stream by (reasoning.js). No
   * such fetch: null, and the host simply keeps polling. */
  function transport() {
    var w = typeof window !== "undefined" ? window : null;
    if (w && w.SMD_IS_NATIVE) return typeof w.CapacitorWebFetch === "function" ? w.CapacitorWebFetch.bind(w) : null;
    return typeof fetch === "function" ? fetch.bind(null) : null;
  }
  function apiUrl(path) { var w = typeof window !== "undefined" ? window : null; return ((w && w.SMD_API_BASE) || "") + path; }

  function connect(o) {
    var stopped = false, last = null, fails = 0, timer = null, live = false;
    var doFetch = o.fetch || transport();
    var dec = typeof TextDecoder === "function" ? new TextDecoder() : null;
    function state(v) { if (v !== live) { live = v; try { if (o.onState) o.onState(v); } catch (e) {} } }
    function later(ms) { if (!stopped) timer = setTimeout(open, ms); }
    function open() {
      if (stopped || !doFetch || !dec) return;
      Promise.resolve(o.headers ? o.headers() : {}).then(function (h) {
        return doFetch(o.url, { headers: Object.assign({ Accept: "text/event-stream" }, h || {}), cache: "no-store" });
      }).then(function (res) {
        if (!res || !res.ok || !res.body || !res.body.getReader) throw new Error("no stream");
        var reader = res.body.getReader(), buf = "";
        fails = 0; state(true);
        function pump() {
          return reader.read().then(function (r) {
            if (stopped) { try { reader.cancel(); } catch (e) {} return; }
            if (r.done) { later(250); return; }            // the server's normal end: straight back
            var f = frames(buf + dec.decode(r.value, { stream: true }));
            buf = f.rest;
            f.revs.forEach(function (rev) {
              var first = last === null;
              if (rev !== last) { last = rev; if (!first) { try { o.onChange(rev); } catch (e) {} } }
            });
            return pump();
          });
        }
        return pump();
      }).catch(function () {
        state(false);
        fails += 1;
        later(Math.min(30000, 1000 * Math.pow(2, fails - 1)));
      });
    }
    open();
    return { stop: function () { stopped = true; if (timer) clearTimeout(timer); state(false); }, isLive: function () { return live; } };
  }
  return { connect: connect, frames: frames, apiUrl: apiUrl };
});
