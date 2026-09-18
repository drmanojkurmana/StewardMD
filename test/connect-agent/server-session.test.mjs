/* The agent-built adapter must be the SAME KIND OF THING as the hand-built one: it runs on the
 * server, the doctor signs in with their own hospital id and password, and a cookie jar lives in KV
 * for fifteen minutes. Until now the agent's adapter ran only on the phone inside a browser the
 * doctor had already signed into - the data matched the hand-built adapter but the adapter did not.
 *
 * The fake hospital below is GHIS-shaped on purpose, because that is the shape that has to work:
 * an SSO host that wants an antiforgery token before it will take a password, a JSON login reply
 * (`param1: 200`), a launcher page whose tile link is the ONLY route that yields a data-capable
 * session, a redirect chain onto a different host, and a worklist page carrying the CSRF token.
 *
 * node --test test/connect-agent/server-session.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loginWithRecipe, getSession, putSession, SESSION_TTL_MS, SESS_KV_TTL } from '../../functions/_connect/agent/session.js';
import { adapterReq, mergeCookies, jarHeader, jarSet } from '../../functions/_connect/agent/http.js';

const SSO = 'https://sso.example';
const EMR = 'https://emr.example';

/** A fetch that speaks the GHIS sign-in dance. Records what it was asked, for the assertions. */
function fakeHospital({ goodPassword = 'right' } = {}) {
  const seen = [];
  const res = (status, body, headers = {}) => ({
    status,
    headers: {
      get: (k) => headers[String(k).toLowerCase()] || null,
      getSetCookie: () => headers['set-cookie'] || [],
    },
    text: async () => body,
  });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const body = String(opts.body || '');
    seen.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body });
    // 1. the SSO sign-in page carries the antiforgery token
    if (u.origin === SSO && u.pathname === '/') {
      return res(200, '<input name="__RequestVerificationToken" value="TOK-1" />',
        { 'set-cookie': ['SSOSESS=s1; Path=/'] });
    }
    // 2. the password post - answers JSON, never a redirect
    if (u.origin === SSO && u.pathname === '/Index') {
      const ok = body.includes('PASSWORD=' + goodPassword) && body.includes('__RequestVerificationToken=TOK-1');
      return res(200, JSON.stringify({ param1: ok ? 200 : 401 }));
    }
    // 3. the launcher: the Doctor tile's route is the only session that can read data
    if (u.origin === SSO && u.pathname === '/apps') {
      return res(200, '<a href="route?id=ENC-9"></a><h4> Doctor </h4>');
    }
    // 4. that route hops SSO -> EMR and lands on the doctor home
    if (u.origin === SSO && u.pathname === '/route') {
      return res(302, '', { location: EMR + '/Login/?id=ENC-9' });
    }
    if (u.origin === EMR && u.pathname === '/Login/') {
      return res(302, '', { location: EMR + '/Doctor/Home', 'set-cookie': ['AspNetCore.Session=abc; Path=/'] });
    }
    if (u.origin === EMR && u.pathname === '/Doctor/Home') {
      return res(200, '<html>home</html>');
    }
    // 5. the worklist page holds the CSRF token the data POSTs need
    if (u.origin === EMR && u.pathname === '/Doctor/Home/Worklist') {
      return res(200, '<input name="__RequestVerificationToken" value="CSRF-7" />');
    }
    // data calls
    if (u.origin === EMR && u.pathname === '/Doctor/Home/GetIPWL') {
      const cookie = (opts.headers && opts.headers.Cookie) || '';
      if (!/AspNetCore\.Session=abc/.test(cookie)) return res(302, '', { location: SSO + '/' });
      return res(200, JSON.stringify([{ patient_id: 'P1' }]));
    }
    if (u.origin === EMR && u.pathname === '/expired') return res(302, '', { location: SSO + '/' });
    return res(404, '');
  };
  return { fetchImpl, seen };
}

const RECIPE = {
  origin: EMR,
  cookieHost: 'emr.example',
  referer: '/Doctor/Home',
  steps: [
    { name: 'page', method: 'GET', url: SSO + '/', capture: { token: { regex: 'name="__RequestVerificationToken"[^>]*value="([^"]+)"' } } },
    { name: 'post', method: 'POST', url: SSO + '/Index', headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: 'USER_ID={{userId}}&PASSWORD={{password}}&__RequestVerificationToken={{token}}',
      expect: { json: 'param1', equals: 200 } },
    { name: 'apps', method: 'GET', url: SSO + '/apps', capture: { route: { regex: 'href="(route\\?id=[^"]+)"' } } },
    { name: 'home', method: 'GET', url: SSO + '/{{route}}', follow: true },
    { name: 'wl', method: 'GET', url: EMR + '/Doctor/Home/Worklist' },
  ],
  csrf: { fromStep: 'wl', regex: 'name="__RequestVerificationToken"[^>]*value="([^"]+)"' },
};

/** The smallest KV that behaves like Cloudflare's for what session.js uses. */
function fakeKV() {
  const m = new Map();
  return {
    store: m,
    async get(k, type) { const v = m.get(k); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}

test('the doctor signs in with their own hospital id and password, exactly as the hand-built adapter does', async () => {
  const { fetchImpl, seen } = fakeHospital();
  const sess = await loginWithRecipe({ recipe: RECIPE, userId: 'doc1', password: 'right', fetchImpl });
  assert.match(sess.cookie, /AspNetCore\.Session=abc/, 'the data host session cookie is what the jar keeps');
  assert.equal(sess.csrf, 'CSRF-7', 'the antiforgery token is read off the page that carries it');
  // the antiforgery token has to ride on the password post, or the hospital refuses it
  const post = seen.find((s) => s.url.endsWith('/Index'));
  assert.match(post.body, /__RequestVerificationToken=TOK-1/, 'the token from the sign-in page is posted back');
  assert.match(post.body, /USER_ID=doc1/, 'the doctor signs in as themselves, not as a service account');
});

test('the launcher route is followed, because only that hop yields a session that can read data', async () => {
  const { fetchImpl, seen } = fakeHospital();
  await loginWithRecipe({ recipe: RECIPE, userId: 'doc1', password: 'right', fetchImpl });
  const paths = seen.map((s) => new URL(s.url).pathname);
  assert.ok(paths.includes('/route'), 'the tile route is requested');
  assert.ok(paths.includes('/Login/'), 'its redirect onto the EMR host is followed by hand');
  assert.ok(paths.includes('/Doctor/Home'), '...all the way to the doctor home');
});

test('a wrong password is refused as bad_credentials and mints no session', async () => {
  const { fetchImpl } = fakeHospital();
  await assert.rejects(
    () => loginWithRecipe({ recipe: RECIPE, userId: 'doc1', password: 'wrong', fetchImpl }),
    (e) => e.code === 'bad_credentials');
});

test('the password is never stored: only the cookie jar and the token reach KV', async () => {
  const { fetchImpl } = fakeHospital();
  const kv = fakeKV();
  const env = { GHIS_KV: kv };
  const sess = await loginWithRecipe({ recipe: RECIPE, userId: 'doc1', password: 'right', fetchImpl });
  await putSession(env, 'tok-1', sess);
  const written = [...kv.store.values()].join(' ');
  assert.ok(!/right/.test(written), 'the password is nowhere in what was written: ' + written);
  assert.ok(!/password/i.test(written), 'not even under another name');
  assert.match(written, /AspNetCore\.Session=abc/, 'the cookie jar is what is kept');
});

test('the session lives fifteen minutes and slides while the doctor is working', async () => {
  assert.equal(SESSION_TTL_MS, 15 * 60 * 1000, 'same fifteen minute window as the hand-built adapter');
  assert.equal(SESS_KV_TTL, 1800, 'same 30 minute KV lifetime');
  const kv = fakeKV();
  const env = { GHIS_KV: kv };
  await putSession(env, 'tok-2', { cookie: 'A=1', csrf: 'c' });
  // a session touched six minutes ago is slid forward on use
  const stale = JSON.parse(kv.store.get('casess:tok-2'));
  stale.ts = Date.now() - 6 * 60 * 1000;
  kv.store.set('casess:tok-2', JSON.stringify(stale));
  const got = await getSession(env, 'tok-2');
  assert.equal(got.cookie, 'A=1');
  assert.ok(Date.now() - JSON.parse(kv.store.get('casess:tok-2')).ts < 5000, 'using it pushed the expiry forward');
});

test('a 302 on a data call means the hospital dropped the session, not that the call failed', async () => {
  const { fetchImpl } = fakeHospital();
  const session = { cookie: 'AspNetCore.Session=abc', csrf: 'CSRF-7', referer: '/Doctor/Home' };
  const ok = await adapterReq({ origin: EMR, session, method: 'GET', path: '/Doctor/Home/GetIPWL', extra: { 'X-Requested-With': 'XMLHttpRequest' }, fetchImpl });
  assert.equal(ok.status, 200, 'a live session reads');
  const gone = await adapterReq({ origin: EMR, session, method: 'GET', path: '/expired', fetchImpl });
  assert.equal(gone.unauth, true, 'a redirect is reported as unauth, and the doctor signs in again');
  const noSess = await adapterReq({ origin: EMR, session: null, method: 'GET', path: '/Doctor/Home/GetIPWL', fetchImpl });
  assert.equal(noSess.unauth, true, 'no session at all is the same answer, never an anonymous request');
});

test('a data call without the session cookie is refused by the hospital, so the jar must be carried', async () => {
  const { fetchImpl } = fakeHospital();
  const r = await adapterReq({ origin: EMR, session: { cookie: 'NOTHING=1' }, method: 'GET', path: '/Doctor/Home/GetIPWL', fetchImpl });
  assert.equal(r.unauth, true, 'the fake hospital 302s an unauthenticated read, and that is surfaced');
});

test('cookie helpers keep the freshest value, so a POST carries the antiforgery cookie the GET returned', () => {
  assert.equal(mergeCookies('A=1; B=2', ['B=9; Path=/', 'C=3; HttpOnly']), 'A=1; B=9; C=3');
  const jar = {};
  jarSet(jar, 'h', { headers: { getSetCookie: () => ['X=1; Path=/'], get: () => null } });
  jarSet(jar, 'h', { headers: { getSetCookie: () => ['X=2; Path=/'], get: () => null } });
  assert.equal(jarHeader(jar, 'h'), 'X=2', 'last write wins, as in the hand-built jar');
});
