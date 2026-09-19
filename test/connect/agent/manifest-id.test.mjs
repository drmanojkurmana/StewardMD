/* THE ID THAT FAILED EVERY REAL HOSPITAL.
 *
 * The discovery route compiled its adapter under `manifest-<deploymentId>-<jobId>`. Real ids are
 * `dep_<uuid>` and `job_<uuid>`, so that string is 90 characters; the manifest schema caps a
 * manifestId at 64, and compileManifest fails closed on an invalid manifest. Every discovery that
 * reached the compile step therefore died with "spec could not be compiled" - including a doctor's
 * crawl of 21 pages of a live hospital on 2026-09-12. The fixtures never caught it because their
 * ids are "dep-1" and "job-1".
 *
 *   node --test test/connect/agent/manifest-id.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifestIdFor } from '../../../functions/api/connect/agent/[[path]].js';
import { compileManifest } from '../../../connect-agent/manifest/compile.mjs';

const DEP = 'dep_7f707d9c-d0f4-4f74-b283-4008d802d1b3';
const JOB = 'job_b2be9a78-9450-496a-a2fb-d357af6b3b17';
const MANIFEST_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;   // schema.mjs

test('a manifest id built from real deployment and job ids satisfies the schema', () => {
  const id = manifestIdFor(DEP, JOB);
  assert.ok(MANIFEST_ID_RE.test(id), `${id} (${id.length} chars) must match the manifest id rule`);
  assert.ok(id.length <= 64);
  assert.ok(id.includes('7f707d9c'), 'names the deployment');
  assert.ok(id.includes('b2be9a78'), 'names the job');
});

test('different deployments and jobs get different ids', () => {
  const a = manifestIdFor(DEP, JOB);
  const b = manifestIdFor('dep_00000000-0000-4000-8000-000000000001', JOB);
  const c = manifestIdFor(DEP, 'job_00000000-0000-4000-8000-000000000002');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('compileManifest accepts it, which is what the discovery route depends on', async () => {
  const spec = { version: 3, allowedOrigins: ['https://ghis.example'], events: [], browser: 'phone-android' };
  const { manifest } = await compileManifest(spec, { manifestId: manifestIdFor(DEP, JOB), timezone: 'Asia/Kolkata' });
  assert.equal(manifest.manifestId, manifestIdFor(DEP, JOB));
});

test('a missing or unrecognisable id still yields a valid one rather than throwing', () => {
  for (const bad of [undefined, '', '???', 'dep_']) {
    assert.ok(MANIFEST_ID_RE.test(manifestIdFor(bad, bad)), `${bad} must still produce a valid id`);
  }
});
