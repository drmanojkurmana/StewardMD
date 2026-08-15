/* functions/_remoteconfig.js — server-driven client config: force-upgrade floor, maintenance mode,
 * remote banners/announcements, and server feature flags. One KV doc the client polls on boot, so you
 * can gate a stale/dangerous build, take the app down for maintenance, or push a banner to 1000+ doctors
 * WITHOUT an app-store release. Pure + KV; unit-tested. Metadata only (no PHI ever lives here). */

export const REMOTE_CONFIG_KEY = "remote:config";
const TTL = 60 * 60 * 24 * 365;

function clip(s, n) { return s == null ? "" : String(s).slice(0, n); }
function num(x) { var n = Number(x); return Number.isFinite(n) ? n : null; }

// Bound + type-check whatever an admin submits so a bad payload can't brick the client.
export function sanitizeRemoteConfig(raw) {
  raw = (raw && typeof raw === "object") ? raw : {};
  var m = (raw.maintenance && typeof raw.maintenance === "object") ? raw.maintenance : {};
  var banners = Array.isArray(raw.banners) ? raw.banners.slice(0, 10).map(function (b, i) {
    b = b || {};
    var lvl = ["info", "success", "warning", "critical"].indexOf(String(b.level)) > -1 ? String(b.level) : "info";
    return { id: clip(b.id || ("b" + i), 40), text: clip(b.text, 300), level: lvl, url: clip(b.url, 300), dismissible: b.dismissible !== false };
  }).filter(function (b) { return b.text; }) : [];
  var flags = {};
  if (raw.flags && typeof raw.flags === "object") {
    var keys = Object.keys(raw.flags).slice(0, 60);
    keys.forEach(function (k) { var v = raw.flags[k]; if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") flags[clip(k, 60)] = (typeof v === "string" ? clip(v, 120) : v); });
  }
  return {
    minBuild: num(raw.minBuild),                       // native versionCode floor; null = no gate
    upgradeUrl: clip(raw.upgradeUrl, 300),             // where "Update" sends the user (store link)
    upgradeMessage: clip(raw.upgradeMessage, 300),
    maintenance: { on: !!m.on, message: clip(m.message, 300) },
    banners: banners,
    flags: flags,
    ts: Date.now(),
  };
}

export async function getRemoteConfig(store) {
  var def = sanitizeRemoteConfig({});
  if (!store) return def;
  try { var raw = await store.get(REMOTE_CONFIG_KEY); return raw ? sanitizeRemoteConfig(JSON.parse(raw)) : def; }
  catch (e) { return def; }
}

export async function setRemoteConfig(store, raw) {
  if (!store) return null;
  var cfg = sanitizeRemoteConfig(raw);
  try { await store.put(REMOTE_CONFIG_KEY, JSON.stringify(cfg), { expirationTtl: TTL }); } catch (e) { return null; }
  return cfg;
}

// Force-upgrade decision: is the running native build below the configured floor?
export function needsUpgrade(currentBuild, cfg) {
  var min = cfg && num(cfg.minBuild);
  if (min == null) return false;                                  // no floor set => never gate
  if (currentBuild == null || currentBuild === "") return false;  // web / unknown build => never gate (Number(null)===0 would wrongly gate)
  var cur = num(currentBuild);
  return cur != null && cur < min;
}
