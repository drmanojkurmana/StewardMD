/* functions/_ota.js — OTA update system, PHASE 1 (server-only; no device consumes any of this yet).
 *
 * Deliberately built against the failure that killed the last version of this system (1 Aug 2026):
 * a stale bundle silently downgraded installed apps because the retire/kill mechanism itself needed
 * a redeploy to re-arm, and there was no separation between "a build exists" and "a build is live."
 * So here:
 *   - staging a build (CI, on every push to main) NEVER touches the live channel. It only writes a
 *     `candidate` pointer. Nothing a device would ever see changes just because someone pushed code.
 *   - going live (`publish`) is the ONE place the channel pointer moves, and it is owner-gated.
 *   - the kill switch is a single R2 object read on every device check — flipping it needs no
 *     redeploy, no rebuild, no code change. It is the FIRST thing built here, not an afterthought.
 *   - versions are monotonically increasing integers. A rollback PUBLISHES the old manifest again
 *     under a NEW, higher version number — it never moves the counter backward — so a device that
 *     only trusts "is this newer than what I have" still takes the rollback instead of ignoring it.
 *
 * All Cloudflare R2 access is passed in as `r2` (an object with .get/.put/.head, matching the real
 * R2Bucket binding shape) so every function here is a pure-ish, unit-testable module — no Workers
 * runtime, no network, no auth. functions/api/ota/[[path]].js is the only caller that knows about
 * env/auth/HTTP; this file is where the actual rules live.
 */

const K = {
  candidate: "ota/candidate.json",
  channel: "ota/channels/stable.json",
  history: "ota/history.json",
  kill: "ota/kill.json",
  manifest: (commit) => `ota/manifests/${commit}.json`,
  file: (hash) => `ota/files/${hash}`,
};
const HISTORY_MAX = 200;   // bounded — this is an audit trail, not a growth-without-limit log

async function readJSON(r2, key, fallback) {
  try {
    const obj = await r2.get(key);
    if (!obj) return fallback;
    const text = typeof obj.text === "function" ? await obj.text() : String(obj.body || "");
    return JSON.parse(text);
  } catch (e) { return fallback; }
}
function writeJSON(r2, key, val) {
  return r2.put(key, JSON.stringify(val), { httpMetadata: { contentType: "application/json" } });
}

// ---- read-side (admin console) --------------------------------------------------------------

export async function getCandidate(r2) { return readJSON(r2, K.candidate, null); }
export async function getChannel(r2) { return readJSON(r2, K.channel, null); }
export async function getKillState(r2) { return readJSON(r2, K.kill, { on: false }); }
export async function getHistory(r2) { return readJSON(r2, K.history, []); }
export async function getManifest(r2, commit) { return readJSON(r2, K.manifest(commit), null); }

// ---- write-side (admin console; caller has already checked ownerOK) -------------------------

// Publish the CURRENT candidate (whatever the last push to main staged) to the live channel.
// Returns the new channel record, or { error } if there is nothing staged to publish.
export async function publish(r2, { by, minNativeBuild } = {}) {
  const candidate = await getCandidate(r2);
  if (!candidate || !candidate.manifestKey) return { error: "no-candidate" };
  const manifest = await readJSON(r2, candidate.manifestKey, null);
  if (!manifest) return { error: "manifest-missing" };
  return publishManifest(r2, {
    commit: candidate.commit, manifestKey: candidate.manifestKey, message: candidate.message,
    by, minNativeBuild, action: "publish",
  });
}

// Republish an OLD manifest from history under a NEW version number (see file header — this is
// deliberately not "move the pointer backward").
export async function rollback(r2, { toVersion, by } = {}) {
  const history = await getHistory(r2);
  const target = history.find((h) => h.version === toVersion && h.manifestKey);
  if (!target) return { error: "version-not-found" };
  return publishManifest(r2, {
    commit: target.commit, manifestKey: target.manifestKey, message: target.message,
    by, minNativeBuild: target.minNativeBuild, action: "rollback", rollbackOf: toVersion,
  });
}

async function publishManifest(r2, { commit, manifestKey, message, by, minNativeBuild, action, rollbackOf }) {
  const prevChannel = await getChannel(r2);
  const version = (prevChannel && Number.isFinite(prevChannel.version) ? prevChannel.version : 0) + 1;
  const publishedAt = new Date().toISOString();
  const channel = {
    version, commit, manifestKey, message: message || "",
    minNativeBuild: Number.isFinite(minNativeBuild) ? minNativeBuild : (prevChannel ? prevChannel.minNativeBuild || 0 : 0),
    rollout: 100, publishedAt, publishedBy: by || "unknown",
  };
  await writeJSON(r2, K.channel, channel);
  await appendHistory(r2, { ...channel, action: action || "publish", rollbackOf: rollbackOf || null });
  return channel;
}

export async function setKill(r2, { on, by } = {}) {
  const state = { on: !!on, at: new Date().toISOString(), by: by || "unknown" };
  await writeJSON(r2, K.kill, state);
  const channel = await getChannel(r2);
  await appendHistory(r2, {
    version: channel ? channel.version : 0, action: on ? "kill" : "unkill", by: state.by, at: state.at,
  });
  return state;
}

async function appendHistory(r2, entry) {
  const history = await getHistory(r2);
  history.unshift(entry);
  await writeJSON(r2, K.history, history.slice(0, HISTORY_MAX));
}

// ---- device-facing (public; called by the client in a LATER phase — nothing calls this yet) ---

// checkForDevice: does this device need an update? `state` = whatever the client reports today
// ({ version, nativeBuild }); both optional so a first-ever check ({})  is handled the same as any
// other. Fails CLOSED on the kill switch (explicit `ota:false`), and never offers a channel whose
// minNativeBuild exceeds what the device is running — a device can't apply a bundle written for
// native capabilities (plugins/permissions) it doesn't have.
export async function checkForDevice(r2, state = {}) {
  const kill = await getKillState(r2);
  if (kill && kill.on) return { ota: false, reason: "disabled" };
  const channel = await getChannel(r2);
  if (!channel) return { ota: false, reason: "no-channel" };
  const deviceVersion = Number.isFinite(state.version) ? state.version : 0;
  const nativeBuild = Number.isFinite(state.nativeBuild) ? state.nativeBuild : 0;
  if (channel.minNativeBuild && nativeBuild < channel.minNativeBuild) {
    return { ota: false, reason: "native-build-too-old" };
  }
  if (channel.version <= deviceVersion) return { ota: false, reason: "up-to-date" };
  const manifest = await getManifest(r2, channel.commit);
  if (!manifest) return { ota: false, reason: "manifest-missing" };   // fail closed, never half-answer
  return {
    ota: true, version: channel.version, commit: channel.commit,
    files: (manifest.files || []).map((f) => ({ path: f.path, hash: f.hash, size: f.size })),
  };
}

// One content-addressed file. `hash` is caller-validated (see the router) before this is called.
export async function getFile(r2, hash) { return r2.get(K.file(hash)); }

export const KEYS = K;
