/* test/hospital-registry.test.mjs - Canonical Hospital Registry (hospital-registry.js).
 *
 * Covers the multi-hospital core contract:
 *   - default list seeds GIMSR + the Demo hospital
 *   - per-doctor store isolation (getStoreId)
 *   - registering an approved hospital (KIMS/Apollo) and listing it
 *   - DRAFT/DISABLED filtered unless requested
 *   - activation + localStorage persistence
 *   - syncFromAgentTenants registers only approved (activeVersionId) tenants
 *
 * Usage: node test/hospital-registry.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import REG from '../hospital-registry.js';

// Isolated localStorage fake so the suite never touches the real profile.
function fakeLS() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    _map: m
  };
}
globalThis.localStorage = fakeLS();

test('default list includes GIMSR and the Demo hospital', () => {
  const ids = REG.list().map((h) => h.hospitalId);
  assert.ok(ids.includes('gimsr'), 'GIMSR seeded, got ' + JSON.stringify(ids));
  assert.ok(ids.includes('stewardmd'), 'Demo hospital seeded, got ' + JSON.stringify(ids));
  const g = REG.get('gimsr');
  assert.equal(g.name, 'GITAM Institute of Medical Sciences & Research');
  assert.equal(g.shortName, 'GIMSR');
  assert.equal(g.emrName, 'GHIS');
  assert.equal(g.emrUrl, 'https://gimsrlogin.gitam.edu');
  assert.equal(g.adapterType, 'legacy_proxy');
  assert.equal(g.status, 'ACTIVE');
  assert.equal(g.isBuiltin, true);
  const d = REG.get('stewardmd');
  assert.equal(d.name, 'StewardMD Hospital');
  assert.equal(d.adapterType, 'demo');
  assert.equal(d.status, 'ACTIVE');
  assert.equal(d.isBuiltin, true);
});

test('user session storeIds are isolated per doctor', () => {
  const a = REG.getStoreId('gimsr', 'doctorA');
  const b = REG.getStoreId('gimsr', 'doctorB');
  assert.notEqual(a, b);
  assert.ok(a.includes('gimsr') && b.includes('gimsr'), 'store id stays hospital-scoped');
  assert.notEqual(REG.getStoreId('kims', 'doctorA'), REG.getStoreId('gimsr', 'doctorA'));
  assert.equal(REG.getStoreId('gimsr'), REG.getStoreId('gimsr', null));
});

test('registering a new approved hospital lists it', () => {
  REG.register({
    hospitalId: 'kims',
    name: 'KIMS Hospital',
    shortName: 'KIMS',
    emrName: 'KIMS Web',
    emrUrl: 'https://hims.kims.example',
    adapterType: 'connect_agent',
    adapterId: 'dep-kims',
    activeVersionId: 'ver-1',
    status: 'ACTIVE',
    capabilities: { worklist: true, medications: true, labs: true, radiology: true }
  });
  const ids = REG.list().map((h) => h.hospitalId);
  assert.ok(ids.includes('kims'), 'KIMS listed, got ' + JSON.stringify(ids));
  const k = REG.get('kims');
  assert.equal(k.adapterId, 'dep-kims');
  assert.equal(k.activeVersionId, 'ver-1');
  assert.equal(k.isBuiltin, false);
});

test('draft or disabled hospitals are filtered out unless requested', () => {
  REG.register({ hospitalId: 'apollo-draft', name: 'Apollo Hospitals', adapterType: 'connect_agent', status: 'DRAFT' });
  REG.register({ hospitalId: 'metro-off', name: 'SMD Metro', adapterType: 'connect_agent', status: 'DISABLED' });
  const ids = REG.list().map((h) => h.hospitalId);
  assert.ok(!ids.includes('apollo-draft'), 'DRAFT hidden by default');
  assert.ok(!ids.includes('metro-off'), 'DISABLED hidden by default');
  const all = REG.list({ includeInactive: true }).map((h) => h.hospitalId);
  assert.ok(all.includes('apollo-draft') && all.includes('metro-off'), 'includeInactive shows them');
  assert.deepEqual(REG.list({ status: 'DRAFT' }).map((h) => h.hospitalId), ['apollo-draft']);
});

test('hospital activation persists across reads', () => {
  REG.setActive('kims');
  assert.equal(REG.getActive().hospitalId, 'kims');
  assert.equal(globalThis.localStorage.getItem('smd_active_hospital_id'), 'kims');
  const saved = JSON.parse(globalThis.localStorage.getItem('smd_hospital_registry'));
  assert.ok(saved && saved.kims && saved.kims.activeVersionId === 'ver-1', 'registry persisted');
});

test('syncFromAgentTenants registers only approved tenants', () => {
  const out = REG.syncFromAgentTenants([
    { tenantId: 't-apollo', name: 'Apollo Hospitals', connections: [{ deploymentId: 'dep-r', origins: ['https://his.apollo.example'], activeVersionId: 'ver-r' }] },
    { tenantId: 't-draft', name: 'Draft Care', connections: [{ deploymentId: 'dep-d', origins: ['https://draft.example'], activeVersionId: null }] }
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].hospitalId, 't-apollo');
  assert.equal(out[0].adapterType, 'connect_agent');
  assert.ok(REG.list().map((h) => h.hospitalId).includes('t-apollo'));
  assert.ok(!REG.list().map((h) => h.hospitalId).includes('t-draft'));
  assert.ok(!REG.list({ includeInactive: true }).map((h) => h.hospitalId).includes('t-draft'));
});
