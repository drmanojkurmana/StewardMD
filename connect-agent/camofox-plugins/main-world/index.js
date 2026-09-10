/**
 * main-world plugin for camofox-browser (jo-inc/camofox-browser >= 1.14.0).
 *
 * BROWSER-PROVIDER PREREQUISITE for StewardMD Connect discovery. Install by copying this directory
 * to `plugins/main-world/` inside the camofox-browser checkout and enabling it in camofox.config.json:
 *   { "plugins": { "main-world": { "enabled": true } } }
 *
 * What it does: enables Camoufox's main-world evaluation so `POST /tabs/:id/evaluate` accepts the
 * `mw:` prefix and runs that script in the PAGE's own JS realm instead of the isolated automation
 * realm. connect-agent/discovery.mjs depends on this.
 *
 * Why it is required (verified live, not assumed): by design Camoufox runs evaluate() in an isolated
 * world - that isolation is part of what makes it undetectable - so anything set on `window` from
 * there, including a monkey-patched `fetch`/`XMLHttpRequest`, is invisible to page scripts. Without
 * this, the discovery observer only ever sees requests the agent itself issues from evaluate(),
 * never the page's own. With it, page-initiated requests are captured.
 *
 * Mechanism: camoufox-js serializes the Camoufox config into CAMOU_CONFIG_<n> env chunks on the
 * launch options; its `main_world_eval: true` option simply sets `allowMainWorld: true` in that
 * config. camofox-browser does not pass that flag, but it emits `browser:launching` with the mutable
 * launch options before `firefox.launch`, so the chunks are rewritten here. No server fork needed.
 */

const CHUNK = process.platform === 'win32' ? 2047 : 32767; // mirrors camoufox-js getEnvVars()

function readConfig(env) {
  const keys = Object.keys(env).filter((k) => /^CAMOU_CONFIG_\d+$/.test(k)).sort((a, b) => Number(a.slice(13)) - Number(b.slice(13)));
  if (!keys.length) return { keys, config: null };
  return { keys, config: JSON.parse(keys.map((k) => env[k]).join('')) };
}

function writeConfig(env, keys, config) {
  for (const k of keys) delete env[k];
  const str = JSON.stringify(config);
  for (let i = 0; i < str.length; i += CHUNK) env[`CAMOU_CONFIG_${Math.floor(i / CHUNK) + 1}`] = str.slice(i, i + CHUNK);
}

export async function register(app, ctx) {
  const { events, log } = ctx;
  events.on('browser:launching', ({ options }) => {
    const env = options.env || (options.env = {});
    const { keys, config } = readConfig(env);
    if (!config) { log('warn', 'main-world plugin: no CAMOU_CONFIG chunks on launch options; not enabling'); return; }
    config.allowMainWorld = true;
    writeConfig(env, keys, config);
    log('info', 'main-world plugin: allowMainWorld enabled (evaluate accepts the "mw:" prefix)');
  });
}
