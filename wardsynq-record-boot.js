/* wardsynq-record-boot.js — connects StewardMD Mobile to the WardSynQ Clinical Record Service.
 *
 * The mobile app and the hospital workstation are two interfaces to ONE record. This file is the
 * mobile half of that sentence. It builds the same ClinicalStore the workstation uses, over the
 * same RemoteBackend, signed with the doctor's own Firebase session, and exposes it as
 * window.SMD_WARDSYNQ_RECORD for the rest of the app.
 *
 * INERT UNLESS CONFIGURED. It does nothing at all unless a tenant is named, by ?wardsynq_record=
 * <tenantId> or by localStorage smd_wardsynq_record_tenant. Nothing in the shipped app reads the
 * exposed object yet; no existing screen changes. Not loading this file removes it completely.
 *
 * It writes ONLY through a GovernedStore session bound to the actor the SERVER says the doctor is
 * (the descriptor's actor id), so a signature the mobile app produces is the same identity the
 * server will verify. The client-side governance is the UI's first line; the server's is the one
 * that counts, and it re-runs every check on the verified token.
 */

import { ClinicalStore } from "./wardsynq/wardsynq-store.js";
import { RemoteBackend } from "./wardsynq/wardsynq-store-remote.js";
import { GovernedStore, makeActor, KIND, TIER } from "./wardsynq/wardsynq-actors.js";
import { ClinicalEventBus } from "./wardsynq/wardsynq-events.js";

const TENANT_KEY = "smd_wardsynq_record_tenant";

function tenantFromEnvironment() {
  try {
    const m = (location.search || "").match(/[?&]wardsynq_record=([^&]+)/);
    if (m) {
      const t = decodeURIComponent(m[1]);
      if (t === "0" || t === "off") { localStorage.removeItem(TENANT_KEY); return null; }
      localStorage.setItem(TENANT_KEY, t);
      return t;
    }
    return localStorage.getItem(TENANT_KEY);
  } catch { return null; }
}

function idToken() {
  try {
    const u = window.SMD_AUTH && window.SMD_AUTH.currentUser;
    return u && u.getIdToken ? u.getIdToken() : Promise.resolve(null);
  } catch { return Promise.resolve(null); }
}

/**
 * Opens the shared record for one tenant. Returns the handle or throws with the server's reason.
 * Exported so a screen can open a tenant on demand rather than only at boot.
 */
async function openRecord(tenantId) {
  const backend = new RemoteBackend({ tenantId, token: idToken, baseUrl: window.SMD_API_BASE || "" });
  const bus = new ClinicalEventBus({ nodeId: "mobile" });
  const store = new ClinicalStore({ backend, bus });
  await store.open();                       // learns the server-side actor, or refuses
  const d = backend.descriptor;
  // The actor the SERVER derived, mirrored client-side so the local governance and the signature
  // identity agree with what the door will verify. The credential is never sent down; canSign says
  // whether the server holds one, and a local placeholder lets the client-side checks run.
  const actor = makeActor({
    id: d.actor.id, kind: KIND.HUMAN, tier: d.actor.tier === TIER.EXECUTE ? TIER.EXECUTE : TIER.READ,
    display: d.actor.display, credential: d.actor.canSign ? "held-by-server" : null,
  });
  const governed = new GovernedStore({ store, bus });
  return Object.freeze({
    tenantId: d.tenantId, mode: d.mode, role: d.role, actor, descriptor: d, bus,
    backend, governed,
    session: (patientId) => governed.session(actor, patientId),
    chart: (patientId) => backend.chart(patientId),
    changes: (since, limit) => backend.changes(since, limit),
  });
}

async function boot() {
  const tenantId = tenantFromEnvironment();
  if (!tenantId) return;
  try {
    const handle = await openRecord(tenantId);
    window.SMD_WARDSYNQ_RECORD = handle;
    try { console.info("[wardsynq-record] connected", { tenant: handle.tenantId, mode: handle.mode, role: handle.role, actor: handle.actor.id, tier: handle.actor.tier }); } catch {}
  } catch (err) {
    // Say so, and expose why. A record that silently failed to connect would leave a doctor
    // charting into nothing, which is the failure this whole service exists to end.
    window.SMD_WARDSYNQ_RECORD = Object.freeze({ tenantId, error: String((err && err.message) || err), code: err && err.code });
    try { console.warn("[wardsynq-record] not connected", window.SMD_WARDSYNQ_RECORD); } catch {}
  }
}

window.SMD_wardsynqOpenRecord = openRecord;
boot();

export { openRecord, TENANT_KEY };
