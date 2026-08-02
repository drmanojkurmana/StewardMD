// functions/api/connect/maik/[[path]].js — Track D MaiK patient-attachment surface (spec §4, default #5).
// This is the NEW Connect surface that binds a patient to a clinician's MaiK session and serves the
// DETERMINISTIC lane to the clinician's own (authorized) device. It does NOT touch the live home/MaiK
// experience. Flag-gated (smd_connect); server-derived identity; no-store. The LLM-egress lane is never
// returned here — it is applied server-side at the AI endpoint only when the R7 gate passes.
import { flagOn, jsonResponse } from "../../../_connect/testkit.js";
import { AuthError, PermissionError, SandboxViolation } from "../../../_connect/permission.js";
import { identify } from "../../../_usage.js";
import { fhirR4Connector } from "../../../_connect/connectors/fhir-r4/connector.js";
import { attach, detach, readBinding } from "../../../_connect/maik-bridge/attach.js";
import { pullLanes } from "../../../_connect/maik-bridge/bridge.js";
import { requireCan } from "../../../_connect/enterprise/guard.js";
import { enforce, RateLimited } from "../../../_connect/enterprise/ratelimit.js";
import { resolveActor } from "../../../_connect/identity.js";

const STATUS = (e) => (e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : e instanceof SandboxViolation ? 403 : e instanceof RateLimited ? 429 : 400);
const CODE = (e) => (e && e.constructor && e.constructor.name ? e.constructor.name.replace(/Error$/, "").toLowerCase() || "error" : "error");

export async function onRequest(context) {
  const { request, env } = context;
  if (!flagOn(env)) return jsonResponse({ error: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/connect\/maik\/?/, "").replace(/\/+$/, "");
  const deps = { db: env.CONNECT_DB, kv: env.MAIK_KV, identifyFn: identify, connectors: { "fhir-r4": fhirR4Connector } };
  let body = {}; if (request.method === "POST") { try { body = await request.json(); } catch {} }

  try {
    if (request.method === "POST" && seg === "attach") return jsonResponse(await attach(deps, request, env, body));
    if (request.method === "POST" && seg === "detach") return jsonResponse(await detach(deps, request, env));

    // Serve the DETERMINISTIC lane to the authorized clinician's device (no LLM egress here).
    if (request.method === "POST" && seg === "context") {
      const actor = await resolveActor(deps.identifyFn, request, env);
      const binding = await readBinding(env, deps.kv, actor.id);
      if (!binding) return jsonResponse({ ok: true, deterministic: null });
      const gate = await requireCan(deps, request, env, binding.tenantId, "context:load");    // defense-in-depth RBAC
      await enforce(deps, env, binding.tenantId, "context:load", gate.actor.id);              // explicit surface (429 on abuse)
      const lanes = await pullLanes(env, deps, request, { fetch });
      return jsonResponse({ ok: true, deterministic: lanes ? lanes.deterministic : null, egressAvailable: !!(lanes && lanes.egress), notice: lanes ? lanes.notice : null });
    }

    return jsonResponse({ error: "not_found" }, { status: 404 });
  } catch (e) {
    return jsonResponse({ error: CODE(e) }, { status: STATUS(e) });
  }
}
