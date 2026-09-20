/* AT MOST THREE DRAFTS OF ONE CONNECTION, AND ONLY ONE SURVIVES APPROVAL.
 *
 * Re-running discovery is normal: a doctor signs in again, shows the agent a view it missed, and a
 * fresh candidate appears. Each one is a decision the owner would otherwise be asked to make, so
 * the deployment holds the three newest and discards the rest, and approving one discards every
 * other candidate for that deployment (owner rule, 2026-09-12). Discarded means REVOKED: nothing is
 * deleted and the audit trail stands.
 *
 *   node --test test/connect/agent/candidate-limit.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAgentDb } from './agent-db.mjs';
import { listVersionsByLifecycle } from '../../../functions/_connect/agent/store.js';
import { CANDIDATE_LIMIT } from '../../../functions/api/connect/agent/[[path]].js';

const TENANT = 't1';
const DEP = 'dep-1';
const iso = (n) => new Date(1700000000000 + n * 60000).toISOString();

function dbWithCandidates(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({ id: 'ver-' + i, tenant_id: TENANT, deployment_id: DEP, lifecycle: 'AWAITING_APPROVAL',
      created_at: iso(i), updated_at: iso(i), evidence_hash: 'sha256:x', policy_version: null });
  }
  return makeAgentDb({ connect_adapter_version: rows });
}

test('the limit is three', () => {
  assert.equal(CANDIDATE_LIMIT, 3);
});

test('candidates come back newest first, which is what "keep the newest three" depends on', async () => {
  const db = dbWithCandidates(5);
  const rows = await listVersionsByLifecycle(db, TENANT, DEP, 'AWAITING_APPROVAL');
  assert.deepEqual(rows.map((r) => r.id), ['ver-4', 'ver-3', 'ver-2', 'ver-1', 'ver-0']);
});

test('only candidates of THIS deployment and THIS lifecycle are listed', async () => {
  const db = makeAgentDb({ connect_adapter_version: [
    { id: 'mine', tenant_id: TENANT, deployment_id: DEP, lifecycle: 'AWAITING_APPROVAL', created_at: iso(1) },
    { id: 'other-deployment', tenant_id: TENANT, deployment_id: 'dep-2', lifecycle: 'AWAITING_APPROVAL', created_at: iso(2) },
    { id: 'other-tenant', tenant_id: 't2', deployment_id: DEP, lifecycle: 'AWAITING_APPROVAL', created_at: iso(3) },
    { id: 'already-live', tenant_id: TENANT, deployment_id: DEP, lifecycle: 'ACTIVE', created_at: iso(4) },
    { id: 'already-discarded', tenant_id: TENANT, deployment_id: DEP, lifecycle: 'REVOKED', created_at: iso(5) },
  ] });
  const rows = await listVersionsByLifecycle(db, TENANT, DEP, 'AWAITING_APPROVAL');
  assert.deepEqual(rows.map((r) => r.id), ['mine']);
});

test('a deployment holding nothing lists nothing rather than throwing', async () => {
  const rows = await listVersionsByLifecycle(dbWithCandidates(0), TENANT, DEP, 'AWAITING_APPROVAL');
  assert.deepEqual(rows, []);
});
