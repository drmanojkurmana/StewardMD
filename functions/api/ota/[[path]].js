/* StewardMD — OTA live-update control (owner-only), driven from the admin console.
 *
 *   GET  /api/ota/status   -> { ok, live }   current OTA version the updater backend serves
 *   POST /api/ota/release   { channel, minNative }  -> fires the ota-release GitHub Action (build
 *                            the LATEST main web bundle + publish to R2). Returns the Actions URL.
 *
 * The heavy lifting (build:www + upload 68MB to R2) can't run in a Pages Function — it runs in CI.
 * This endpoint just dispatches the workflow. Needs a GitHub token (Actions: read/write on the repo)
 * stored as the Pages secret GITHUB_OTA_TOKEN; the repo defaults to drmanojkurmana/StewardMD (env
 * GITHUB_REPO overrides). Auth: owner Google login OR X-Admin-Token, via ownerOK.
 */
import { ownerOK } from "../../_adminauth.js";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const OTA_BACKEND = "https://api.stewardmd.in/ota/check";

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);

  // Current live OTA version (what the updater backend hands to devices right now).
  if (request.method === "GET" && seg === "status") {
    try {
      const r = await fetch(OTA_BACKEND, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "ios", version_name: "0.0.0", version_build: "0", version_code: "0", channel: "production", app_id: "in.stewardmd.app" }),
      });
      const live = await r.json().catch(() => ({}));
      return json({ ok: true, live });   // live.version === "builtin" + message "no_channel" => nothing published yet
    } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
  }

  // Trigger the OTA release GitHub Action against the latest main.
  if (request.method === "POST" && seg === "release") {
    const tok = env.GITHUB_OTA_TOKEN;
    if (!tok) return json({ error: "github-token-not-configured", hint: "wrangler pages secret put GITHUB_OTA_TOKEN --project-name stewardmd" }, 501);
    let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
    const channel = (String(b.channel || "production").match(/^(production|beta)$/) || ["production"])[0];
    const minNative = String(Math.max(1, parseInt(b.minNative, 10) || 3));
    const repo = env.GITHUB_REPO || "drmanojkurmana/StewardMD";
    let r;
    try {
      r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/ota-release.yml/dispatches`, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "StewardMD-admin", "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main", inputs: { channel, min_native: minNative } }),
      });
    } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }, 502); }
    if (r.status === 204) return json({ ok: true, dispatched: true, channel, minNative, actions: `https://github.com/${repo}/actions/workflows/ota-release.yml` });
    const detail = await r.text().catch(() => "");
    return json({ ok: false, status: r.status, error: (detail || "dispatch-failed").slice(0, 300) }, 502);
  }

  return json({ error: "not-found", seg }, 404);
}
