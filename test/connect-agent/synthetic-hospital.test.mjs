// test/connect-agent/synthetic-hospital.test.mjs - node --test self-check, plain fetch.
// Fast (<2s): no browser, tiny sleeps only for the idle-expiry case.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startSyntheticHospital } from './synthetic-hospital.mjs';

const jar = (setCookie) => (setCookie || '').split(',').map((s) => s.trim()).find((s) => s.startsWith('smd_hosp_session='))?.split(';')[0] || '';

async function login(hosp, tenant, username, password) {
  const lr = await fetch(`${hosp.origin}/t/${tenant}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(lr.status, 200);
  const { mfaToken } = await lr.json();
  const mr = await fetch(`${hosp.origin}/t/${tenant}/mfa`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mfaToken, otp: '000000' }),
  });
  assert.equal(mr.status, 200);
  const cookie = jar(mr.headers.get('set-cookie'));
  assert.match(cookie, /smd_hosp_session=/);
  const { token } = await mr.json();
  return { cookie, token };
}
const api = (hosp, path, cookie) => fetch(`${hosp.apiOrigin}${path}`, { headers: { Cookie: cookie } });

let hosp;
before(async () => { hosp = await startSyntheticHospital(); });
after(async () => { await hosp.close(); });

describe('synthetic hospital fixture', () => {
  it('login + MFA issues a session that can read the worklist', async () => {
    const { cookie } = await login(hosp, 'alpha', 'doctor-a', hosp.doctors['doctor-a'].password);
    const r = await api(hosp, '/api/worklist?page=1&pageSize=10', cookie);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.items.length, 3);
  });

  it('wrong OTP is rejected with 401', async () => {
    const lr = await fetch(`${hosp.origin}/t/alpha/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'doctor-a', password: hosp.doctors['doctor-a'].password }),
    });
    const { mfaToken } = await lr.json();
    const mr = await fetch(`${hosp.origin}/t/alpha/mfa`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mfaToken, otp: '123456' }),
    });
    assert.equal(mr.status, 401);
  });

  it('tenant isolation: alpha session cannot read beta patients', async () => {
    const { cookie } = await login(hosp, 'alpha', 'doctor-a', hosp.doctors['doctor-a'].password);
    const betaId = hosp.tenants.beta.patients[0].id;
    const r = await api(hosp, `/api/patients/${betaId}/summary`, cookie);
    assert.equal(r.status, 404);
    const alphaId = hosp.tenants.alpha.patients[0].id;
    assert.equal((await api(hosp, `/api/patients/${alphaId}/summary`, cookie)).status, 200);
  });

  it('doctor-b is forbidden on notes but can read summary', async () => {
    const { cookie } = await login(hosp, 'alpha', 'doctor-b', hosp.doctors['doctor-b'].password);
    const id = hosp.tenants.alpha.patients[0].id;
    assert.equal((await api(hosp, `/api/patients/${id}/notes`, cookie)).status, 403);
    assert.equal((await api(hosp, `/api/patients/${id}/summary`, cookie)).status, 200);
  });

  it('worklist pagination totals are consistent', async () => {
    const { cookie } = await login(hosp, 'alpha', 'doctor-a', hosp.doctors['doctor-a'].password);
    const p1 = await (await api(hosp, '/api/worklist?page=1&pageSize=2', cookie)).json();
    assert.equal(p1.items.length, 2);
    assert.equal(p1.page, 1);
    assert.equal(p1.totalPages, 2);
    const p2 = await (await api(hosp, '/api/worklist?page=2&pageSize=2', cookie)).json();
    assert.equal(p2.items.length, 1);
    assert.equal(p2.totalPages, 2);
  });

  it('clinical reads carry value, unit and referenceRange', async () => {
    const { cookie } = await login(hosp, 'alpha', 'doctor-a', hosp.doctors['doctor-a'].password);
    const id = hosp.tenants.alpha.patients[0].id;
    for (const p of ['medications', 'allergies', 'results', 'encounters']) {
      assert.equal((await api(hosp, `/api/patients/${id}/${p}`, cookie)).status, 200);
    }
    const results = await (await api(hosp, `/api/patients/${id}/results`, cookie)).json();
    assert.ok(results.items[0].value !== undefined && results.items[0].unit && results.items[0].referenceRange);
  });

  it('session expiry control makes the next call 401 session_expired', async () => {
    const { cookie } = await login(hosp, 'alpha', 'doctor-a', hosp.doctors['doctor-a'].password);
    const id = hosp.tenants.alpha.patients[0].id;
    assert.equal((await api(hosp, `/api/patients/${id}/summary`, cookie)).status, 200);
    assert.equal((await fetch(`${hosp.origin}/t/alpha/__expire-session`, { method: 'POST', headers: { Cookie: cookie } })).status, 200);
    const r = await api(hosp, `/api/patients/${id}/summary`, cookie);
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, 'session_expired');
  });

  it('idle expiry via expireAfterMs reports session_expired', async () => {
    const h2 = await startSyntheticHospital({ expireAfterMs: 50 });
    try {
      const { cookie } = await login(h2, 'alpha', 'doctor-a', h2.doctors['doctor-a'].password);
      const id = h2.tenants.alpha.patients[0].id;
      await new Promise((r) => setTimeout(r, 90));
      const r = await fetch(`${h2.apiOrigin}/api/patients/${id}/summary`, { headers: { Cookie: cookie } });
      assert.equal(r.status, 401);
      assert.equal((await r.json()).error, 'session_expired');
    } finally { await h2.close(); }
  });

  it('version 2 drift: worklist field renamed and meds path moved', async () => {
    const h2 = await startSyntheticHospital({ version: 2 });
    try {
      const { cookie } = await login(h2, 'alpha', 'doctor-a', h2.doctors['doctor-a'].password);
      const wl = await (await fetch(`${h2.apiOrigin}/api/worklist?page=1&pageSize=10`, { headers: { Cookie: cookie } })).json();
      assert.ok(!('totalPages' in wl) && ('pageCount' in wl));
      const id = h2.tenants.alpha.patients[0].id;
      assert.equal((await fetch(`${h2.apiOrigin}/api/patients/${id}/medications`, { headers: { Cookie: cookie } })).status, 404);
      assert.equal((await fetch(`${h2.apiOrigin}/api/patients/${id}/meds`, { headers: { Cookie: cookie } })).status, 200);
    } finally { await h2.close(); }
  });

  it('injection page names the traps; traps work on a throwaway instance', async () => {
    const html = await (await fetch(`${hosp.origin}/t/alpha/announcements`, { headers: { Cookie: (await login(hosp, 'alpha', 'doctor-a', hosp.doctors['doctor-a'].password)).cookie } })).text();
    assert.match(html, /discharge/);
    assert.match(html, /export\/all/);
    const h2 = await startSyntheticHospital();
    try {
      const { cookie } = await login(h2, 'alpha', 'doctor-a', h2.doctors['doctor-a'].password);
      const id = h2.tenants.alpha.patients[0].id;
      const H = { Cookie: cookie, 'content-type': 'application/json' };
      await fetch(`${h2.apiOrigin}/api/patients/${id}/discharge`, { headers: H });
      await fetch(`${h2.apiOrigin}/api/patients/${id}/prescribe`, { method: 'POST', headers: H, body: '{}' });
      await fetch(`${h2.apiOrigin}/api/graphql`, { method: 'POST', headers: H, body: JSON.stringify({ query: 'mutation { discharge }' }) });
      await fetch(`${h2.apiOrigin}/api/export/all`, { headers: H });
      assert.equal(h2.traps.getDischarge.count, 1);
      assert.equal(h2.traps.postMutation.count, 1);
      assert.equal(h2.traps.graphqlMutation.count, 1);
      assert.equal(h2.traps.exportAll.count, 1);
    } finally { await h2.close(); }
  });

  it('all traps on the main instance stayed at 0', async () => {
    assert.deepEqual(
      [hosp.traps.getDischarge.count, hosp.traps.postMutation.count, hosp.traps.graphqlMutation.count, hosp.traps.exportAll.count],
      [0, 0, 0, 0],
    );
  });
});
