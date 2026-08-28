/* test/ios-webkit-cdp.mjs — drive the iOS WebView from node, the way the Android CDP harnesses do.
 *
 * Android exposes the WebView over the Chrome DevTools Protocol, so `adb forward` + a plain
 * WebSocket is enough. iOS has no such thing. This is the missing half:
 *
 *   brew install ios-webkit-debug-proxy          # binary is ios_webkit_debug_proxy (underscores)
 *   ios_webkit_debug_proxy -c null:9221,:9222-9250
 *   curl localhost:9222/json                     # -> the page's webSocketDebuggerUrl
 *
 * Preconditions that will otherwise waste your afternoon (all learned the hard way, 2026-08-25):
 *   - USB ONLY. A Wi-Fi-paired iPhone installs fine but the proxy dies with "Could not connect to
 *     lockdownd". `idevice_id -l` must list the device; `-n` (network) is not enough.
 *   - The device must be UNLOCKED, Auto-Lock off, app foregrounded. A locked phone fails
 *     `devicectl ... process launch` with FBSOpenApplicationServiceErrorDomain error 1 and stops
 *     exposing the WebView at all (the /json page list goes empty).
 *
 * WHY THIS FILE EXISTS - two protocol differences that make plain CDP code fail silently:
 *
 *  1. iOS 26/27 is MULTI-TARGET. A bare `Runtime.evaluate` is rejected with
 *     "'Runtime' domain was not found". Every command must be wrapped in
 *     Target.sendMessageToTarget({targetId, message}) and every reply unwrapped from
 *     Target.dispatchMessageFromTarget. The targetId arrives only in `Target.targetCreated`, which
 *     fires for a FRESH page - so relaunch the app before attaching, or you will hang waiting.
 *
 *  2. `awaitPromise` IS IGNORED. An async expression resolves to "[object Object]" rather than its
 *     value, which reads as a broken app when it is really a broken harness. Use evaluateAsync()
 *     below, which assigns to a window global and polls.
 *
 * Usage:
 *   import { connect } from "./ios-webkit-cdp.mjs";
 *   const c = connect(wsUrl);
 *   await c.evaluate(`document.title`);
 *   await c.evaluateAsync(`fetch('/x').then(r => { window.__smdres = r.status; })`);
 */

export function connect(wsUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs || 20000;
  const ws = new WebSocket(wsUrl);
  let targetId = null;
  let outerId = 0, innerId = 0;
  const pending = new Map();
  const readyWaiters = [];

  ws.onmessage = (m) => {
    let msg;
    try { msg = JSON.parse(String(m.data)); } catch { return; }

    if (msg.method === "Target.targetCreated") {
      targetId = msg.params?.targetInfo?.targetId || targetId;
      rawSend("Runtime.enable", {});          // must be enabled INSIDE the target
      while (readyWaiters.length) readyWaiters.shift()();
      return;
    }
    if (msg.method === "Target.dispatchMessageFromTarget") {
      let inner;
      try { inner = JSON.parse(msg.params.message); } catch { return; }
      const p = pending.get(inner.id);
      if (!p) return;
      pending.delete(inner.id);
      if (inner.error) { p.resolve("PROTO_ERR: " + (inner.error.message || JSON.stringify(inner.error))); return; }
      const r = inner.result?.result;
      if (inner.result?.wasThrown || inner.result?.exceptionDetails) {
        p.resolve("EXC: " + (r?.description || inner.result?.exceptionDetails?.text || "threw"));
        return;
      }
      p.resolve(r && "value" in r ? r.value : (r?.description !== undefined ? r.description : undefined));
    }
  };

  function rawSend(method, params) {
    const iid = ++innerId;
    ws.send(JSON.stringify({
      id: ++outerId,
      method: "Target.sendMessageToTarget",
      params: { targetId, message: JSON.stringify({ id: iid, method, params: params || {} }) }
    }));
    return iid;
  }

  const ready = new Promise((res) => { readyWaiters.push(res); setTimeout(res, 4000); });
  const opened = new Promise((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = (e) => rej(new Error("ws: " + (e?.message || "error")));
  });

  async function evaluate(expression) {
    await opened; await ready;
    if (!targetId) throw new Error("no WebKit target - relaunch the app (targetCreated only fires for a fresh page)");
    return new Promise((resolve) => {
      const iid = rawSend("Runtime.evaluate", { expression, returnByValue: true, emulateUserGesture: true });
      pending.set(iid, { resolve });
      setTimeout(() => { if (pending.has(iid)) { pending.delete(iid); resolve("TIMEOUT"); } }, timeoutMs);
    });
  }

  /* Run an async snippet that assigns its result to window.__smdres, then poll for it.
   * Necessary because WebKit ignores awaitPromise (see the header). */
  async function evaluateAsync(setupExpr, tries = 30) {
    await evaluate(`(function(){ window.__smdres = "__PENDING__"; ${setupExpr} return 1; })()`);
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const v = await evaluate(`String(window.__smdres)`);
      if (v && v !== "__PENDING__") return v;
    }
    return "TIMEOUT";
  }

  return { evaluate, evaluateAsync, close: () => { try { ws.close(); } catch {} }, targetId: () => targetId };
}
