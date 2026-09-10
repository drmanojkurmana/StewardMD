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

function installExpression(config) {
  return `(${OBSERVER_SOURCE})(${JSON.stringify(config)})`;
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
      const result = await plugin.evaluate({ expression: expr });
      return { result: result?.result ?? null };
    },

    async wait({ ms }) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(Number(ms) || 0, 0), 60000)));
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

    async setMode({ mode, banner, origins: newOrigins } = {}) {
      return plugin.setMode({ mode, banner, origins: newOrigins });
    },

    async currentUrl() {
      return plugin.currentUrl();
    },

    async drainRequests() {
      return plugin.drainRequests();
    },
  });
}
