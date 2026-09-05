/* wardsynq/ui/record-deployment.js — one way for a WardSynQ surface to open the shared record.
 *
 * The workstation (wardsynq-app.js) and the bedside surface (opd-boot.js) both need the same three
 * things before they can chart: a store that is the hospital's record rather than this browser's, an
 * actor the server will recognise, and the patient. This builds them, once, the same way, so the
 * hospital PC and the doctor's phone (wardsynq-record-boot.js does the identical thing for mobile)
 * are provably two interfaces to one record and not two implementations of the idea.
 *
 * The store returned is GOVERNED. The raw ClinicalStore is not handed out, for the reason stated in
 * wardsynq-actors.js: an enforcement point off the path enforces nothing.
 */

import { ClinicalStore } from "../wardsynq-store.js";
import { RemoteBackend } from "../wardsynq-store-remote.js";
import { GovernedStore, makeActor, KIND, TIER } from "../wardsynq-actors.js";
import { ClinicalEventBus } from "../wardsynq-events.js";

/**
 * @param {{tenantId: string, token?: () => Promise<string|null>, baseUrl?: string, bus?: object,
 *   nodeId?: string, onDenied?: Function}} opts
 * @returns {Promise<{tenantId, mode, role, descriptor, actor, bus, backend, store, governed, session}>}
 */
async function openRecordDeployment(opts) {
  opts = opts || {};
  const backend = new RemoteBackend({ tenantId: opts.tenantId, token: opts.token, baseUrl: opts.baseUrl || "" });
  const bus = opts.bus || new ClinicalEventBus({ nodeId: opts.nodeId || "workstation" });
  const store = new ClinicalStore({ backend, bus });
  await store.open();                                 // the server decides whether this client may open
  const d = backend.descriptor;
  // Mirror the SERVER-derived actor so client-side governance and the signature identity agree
  // with what the door verifies. The credential itself never travels; canSign says the server holds one.
  const actor = makeActor({
    id: d.actor.id, kind: KIND.HUMAN,
    tier: d.actor.tier === TIER.EXECUTE ? TIER.EXECUTE : TIER.READ,
    display: d.actor.display, credential: d.actor.canSign ? "held-by-server" : null,
  });
  const governed = new GovernedStore({ store, bus, onDenied: opts.onDenied || null });
  return {
    tenantId: d.tenantId, mode: d.mode, role: d.role, descriptor: d,
    actor, bus, backend, store: governed, governed,
    session: (patientId) => governed.session(actor, patientId),
  };
}

/** Reads `?record=<tenantId>` (and `&patient=<id>`), the opt-in every WardSynQ page shares. */
function recordParams(search) {
  const q = new URLSearchParams(search || (typeof location !== "undefined" ? location.search : ""));
  const tenantId = q.get("record");
  return tenantId ? { tenantId, patientId: q.get("patient") || null } : null;
}

/** The bearer the StewardMD shell exposes, when this page runs inside it. Null on a bare hospital PC with Access. */
function shellToken() {
  try {
    const u = typeof window !== "undefined" && window.SMD_AUTH && window.SMD_AUTH.currentUser;
    return u && u.getIdToken ? u.getIdToken() : Promise.resolve(null);
  } catch { return Promise.resolve(null); }
}

export { openRecordDeployment, recordParams, shellToken };
