// connect-agent/phone/plugin-client.mjs — adapts the native ConnectBrowser plugin (see
// local-plugins/capacitor-connect-browser/README.md) to the six-method client contract that
// connect-agent/discovery.mjs's createCollector()/exploreReadWorkflows() expect (createTab, navigate,
// evaluate, wait, snapshot, click, closeTab), plus the passthroughs explore.mjs/index.mjs need
// (setMode, currentUrl, drainRequests).
//
// There is only ever ONE tab: the plugin presents a single full-screen modal web view. tabId is
// always the literal "phone" so callers that thread tabId through (createCollector, exploreReadWorkflows)
// work unmodified against a one-tab transport.
import { OBSERVER_SOURCE } from '../discovery.mjs';
import { SNAPSHOT_SOURCE } from './snapshot.mjs';

const TAB_ID = 'phone';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function installExpression(config) {
  return `(${OBSERVER_SOURCE})(${JSON.stringify(config)})`;
}

/* Resolves true as soon as the page has finished arriving: the document is complete and nothing has
 * changed in it (or in any same-origin frame) for `quiet` milliseconds. Never answers before `floor`,
 * so a click that has not started its work yet is not mistaken for a settled page, and never later
 * than `budget`, so a page that never stops moving - a clock, a ticker, a poll - cannot hold the walk
 * up. Page realm; the whole wait happens here rather than as a series of round trips. */
function SETTLE_SOURCE(budget, quiet, floor) {
  return new Promise(function (resolve) {
    var start = Date.now();
    var last = start;
    var obs = [];
    var timer = null;
    var done = function (v) {
      for (var i = 0; i < obs.length; i++) { try { obs[i].disconnect(); } catch (e) { /* gone */ } }
      if (timer) clearInterval(timer);
      resolve(v);
    };
    var watch = function (doc) {
      try {
        if (typeof MutationObserver !== 'function' || !doc || !doc.documentElement) return;
        var mo = new MutationObserver(function () { last = Date.now(); });
        mo.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
        obs.push(mo);
      } catch (e) { /* not observable */ }
    };
    watch(document);
    try {
      for (var f = 0; f < window.frames.length && f < 8; f++) {
        try { watch(window.frames[f].document); } catch (e) { /* cross-origin */ }
      }
    } catch (e) { /* no frames */ }
    timer = setInterval(function () {
      var now = Date.now();
      if (now - start >= budget) return done(true);
      if (now - start < floor) return;
      var ready = true;
      try { ready = document.readyState === 'complete'; } catch (e) { ready = true; }
      if (ready && now - last >= quiet) done(true);
    }, 40);
  });
}

/**
 * createPluginClient({ plugin, storeId, origins, userAgent, title }) -> client
 *
 * `plugin` is the Capacitor ConnectBrowser plugin instance (open/navigate/evaluate/currentUrl/setMode/
 * drainRequests/close). `origins` is the allowlist passed to `open`/`setMode`. The observer install
 * script is built once from a fixed, no-enforcement config (the phone engine never enforces the
 * in-page guard — that is the plugin's native `agent` mode allowlist's job) and handed to `open` as
 * `initScript`, so the observer exists at document start on every navigation, including ones the
 * doctor drives before the agent ever calls evaluate.
 */
export function createPluginClient({ plugin, storeId, origins, userAgent, title } = {}) {
  if (!plugin) throw new Error('createPluginClient requires a plugin');
  if (!storeId) throw new Error('createPluginClient requires a storeId');
  if (!Array.isArray(origins) || origins.length === 0) throw new Error('createPluginClient requires at least one origin');

  // No enforcement here: config.enforce=false means the observer only records, never blocks. Policy
  // enforcement for the phone runner lives in the native plugin's `agent` mode origin allowlist.
  const observerConfig = { phase: 'agent-read', enforce: false, origins: [...origins], allow: [], sensitive: 'password|passwd|token|secret|cookie|authorization|session|csrf|jwt|mrn|patient.?name|phone|email|dob|address|ssn|national.?id', limits: { maxEvents: 200, maxDepth: 3, maxKeys: 40, maxNodes: 400, maxStringLen: 100 } };

  return Object.freeze({
    async createTab({ url }) {
      await plugin.open({ url, origins: [...origins], storeId, title, userAgent, initScript: installExpression(observerConfig) });
      return { tabId: TAB_ID };
    },

    async navigate({ url }) {
      return plugin.navigate({ url });
    },

    // `mw:` is the Camofox transport's own prefix (main-world evaluate). The plugin's evaluate() is
    // always page-realm, so a leading `mw:` (from createCollector's installExpression/drainExpression,
    // which are shared with the Camofox path) is stripped before it ever reaches the plugin.
    async evaluate({ expression }) {
      const expr = String(expression).startsWith('mw:') ? String(expression).slice(3) : String(expression);
      /* NO PLATFORM MAY HANG THE ENGINE. The native evaluate is expected to time out on its own
       * (Android 30s; iOS since 2026-09-14), but the engine guards itself too: an orphaned
       * evaluate (WKWebView drops a pending call when the page navigates) once froze the whole
       * discovery on "Starting a new discovery" with no way out. */
      const result = await Promise.race([
        plugin.evaluate({ expression: expr }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('evaluate timed out')), 35000)),
      ]);
      return { result: result?.result ?? null };
    },

    /* WAIT FOR THE PAGE, NOT FOR THE CLOCK.
     *
     * Every pause in the walk used to be a flat sleep - a click, then 1.5 seconds whether the screen
     * arrived in 80 milliseconds or was still loading at two seconds. Onboarding an unknown hospital
     * spent most of its wall clock asleep, and the doctor waited through all of it.
     *
     * This asks the PAGE to say when it is done: one round trip that comes back as soon as the
     * document is complete and nothing has changed in it for a moment, and no later than the caller's
     * own budget. On a phone a round trip is not free, so it is one call, not a poll - the waiting
     * happens inside the page. A browser that cannot answer (an evaluate that throws, a page mid
     * navigation, an older build) falls back to exactly the sleep this replaced, so a wait is never
     * shorter than it was safe to be. */
    async wait({ ms }) {
      const budget = Math.min(Math.max(Number(ms) || 0, 0), 60000);
      if (budget < 200) { await sleep(budget); return { ok: true }; }
      const quiet = Math.min(150, Math.max(60, Math.round(budget / 6)));
      const floor = Math.min(120, Math.round(budget / 8));
      const expr = `(${SETTLE_SOURCE})(${budget},${quiet},${floor})`;
      const started = Date.now();
      try {
        const res = await Promise.race([
          plugin.evaluate({ expression: expr }),
          new Promise((resolve) => setTimeout(() => resolve(null), budget + 250)),
        ]);
        if (res && res.result) return { ok: true, settled: true };
      } catch { /* the page could not answer: fall through to the sleep it replaced */ }
      const left = budget - (Date.now() - started);
      if (left > 0) await sleep(left);
      return { ok: true };
    },

    async snapshot() {
      const res = await plugin.evaluate({ expression: `(${SNAPSHOT_SOURCE})()` });
      return { snapshot: res?.result ?? '' };
    },

    async click({ ref }) {
      const expr = `(function(){var el=window.__smd_refs&&window.__smd_refs[${JSON.stringify(String(ref))}];if(!el)return 'no-ref';el.click();return 'ok';})()`;
      const res = await plugin.evaluate({ expression: expr });
      return { result: res?.result ?? null };
    },

    async closeTab() {
      return plugin.close();
    },

    async setMode({ mode, banner, origins: newOrigins, compact } = {}) {
      return plugin.setMode({ mode, banner, origins: newOrigins, compact: !!compact });
    },

    async currentUrl() {
      return plugin.currentUrl();
    },

    async drainRequests() {
      return plugin.drainRequests();
    },
  });
}
