/* StewardMD · FollowCare AI — RunPod GPU lifecycle control (server).
 *
 * The voice-fallback GPU must NOT run 24/7 (spec §11-12,15): it is resumed only when there are calls to place,
 * and stopped when the campaign drains. This is the Cloudflare side of that control — a thin fail-safe wrapper
 * over the RunPod GraphQL API. The voice scheduler calls startPod() when gpuWouldStart; the RunPod voice service
 * self-stops (or the owner calls stopPod) when done.
 *
 * RunPod ONLY — no Google Cloud GPU. Env (owner provisions): RUNPOD_API_KEY + RUNPOD_POD_ID. Fails SAFE:
 * when unconfigured every call is a no-op {ok:false, skipped:true}, so the feature never errors before setup.
 */
const RUNPOD_GQL = "https://api.runpod.io/graphql";

export function gpuConfigured(env) { return !!(env && env.RUNPOD_API_KEY && env.RUNPOD_POD_ID); }

async function gql(env, query) {
  const res = await fetch(RUNPOD_GQL + "?api_key=" + encodeURIComponent(env.RUNPOD_API_KEY), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body = {}; try { body = JSON.parse(text); } catch (e) {}
  if (!res.ok || (body && body.errors)) {
    const detail = (body && body.errors && body.errors[0] && body.errors[0].message) || text.slice(0, 200);
    return { ok: false, error: "runpod_api", status: res.status, detail };
  }
  return { ok: true, data: body.data || {} };
}

// Resume the on-demand GPU pod (idempotent — resuming a running pod is a no-op on RunPod's side).
export async function startPod(env) {
  if (!gpuConfigured(env)) return { ok: false, skipped: true, reason: "not_configured" };
  const gpuCount = Number(env.RUNPOD_GPU_COUNT) || 1;
  const q = 'mutation { podResume(input: { podId: "' + String(env.RUNPOD_POD_ID) + '", gpuCount: ' + gpuCount + ' }) { id desiredStatus } }';
  const r = await gql(env, q);
  if (!r.ok) return r;
  return { ok: true, desiredStatus: (r.data.podResume && r.data.podResume.desiredStatus) || "RUNNING" };
}

// Stop the pod (spec §15: never while a call is active — the caller guarantees the campaign has drained).
export async function stopPod(env) {
  if (!gpuConfigured(env)) return { ok: false, skipped: true, reason: "not_configured" };
  const q = 'mutation { podStop(input: { podId: "' + String(env.RUNPOD_POD_ID) + '" }) { id desiredStatus } }';
  const r = await gql(env, q);
  if (!r.ok) return r;
  return { ok: true, desiredStatus: (r.data.podStop && r.data.podStop.desiredStatus) || "EXITED" };
}

export async function podStatus(env) {
  if (!gpuConfigured(env)) return { ok: false, skipped: true, reason: "not_configured" };
  const q = 'query { pod(input: { podId: "' + String(env.RUNPOD_POD_ID) + '" }) { id desiredStatus runtime { uptimeInSeconds } } }';
  const r = await gql(env, q);
  if (!r.ok) return r;
  const p = r.data.pod || {};
  return { ok: true, desiredStatus: p.desiredStatus || "", uptimeSeconds: (p.runtime && p.runtime.uptimeInSeconds) || 0 };
}
