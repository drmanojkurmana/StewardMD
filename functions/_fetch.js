/* Outbound fetch with a hard timeout.

   Why: Pages Functions run as serverless isolates, so there is NO shared thread/
   connection pool across requests to exhaust — a slow upstream can't stall unrelated
   requests the way it would on a threaded server. But a hung subrequest still burns
   THIS invocation's wall-clock + CPU budget until the platform kills it. A per-call
   timeout fast-fails instead, so the caller can fall back (notifications/payments are
   already fire-and-forget with try/catch).

   Native AbortSignal.timeout — no deps. Throws a TimeoutError (a DOMException) on
   expiry, which existing try/catch around these calls already handles.

   ponytail: the timeout is a per-call knob, NOT a global constant — the AI/LLM path
   legitimately streams for 20-30s, so it must pass a long ms (or skip this helper and
   rely on the cost circuit breaker in _usage.js). Short-lived notification/payment
   calls pass the default. One size does NOT fit all upstreams. */
export function fetchWithTimeout(url, opts = {}, ms = 8000) {
  return fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(ms) });
}
