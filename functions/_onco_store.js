/* StewardMD - Oncology treatment-plan store.
 * PHASE 0: pure id/scoping helpers only, import-safe for Node tests (no env, no Firestore at import).
 * Firestore read/write for q_onco_plans / q_onco_cycles / q_onco_admin lands in Phase 2, added here
 * behind functions that take (env, ...) so importing this file stays side-effect-free.
 * Mirrors functions/_opd_org_store.js conventions (newId/sanitize/memberId). */
"use strict";

function sanitize(x) { return String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80); }
function newId() { return crypto.randomUUID().replace(/-/g, ""); }

// Deterministic cycle-instance id so a plan's cycle is idempotent to write/read.
// Mirrors memberId(): sanitize(planId) + "__" + cycleNo. Non-doc-id chars (e.g. "/") become "-".
function _cycleId(planId, cycleNo) { return sanitize(planId) + "__" + String(cycleNo); }

module.exports = { sanitize: sanitize, newId: newId, _cycleId: _cycleId };
