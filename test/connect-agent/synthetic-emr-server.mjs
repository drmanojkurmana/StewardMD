// test/connect-agent/synthetic-emr-server.mjs — a REAL, local, throwaway EMR-shaped HTTP server.
// Test-harness only (never shipped). Exists so the browser-continuity spike and the discovery observer
// can be exercised against real HTTP + real session cookies in a real browser, instead of a fake fetch.
//
// Serves: a login page (username/password form, no MFA - MFA/CAPTCHA/SSO are explicitly out of scope
// for this spike per the handoff), a worklist page for the signed-in session, a couple of read-only JSON
// endpoints under a numeric-id path (to exercise path redaction), and one GET "mutation trap" endpoint
// whose counter must stay at zero for the whole spike - if discovery/the agent ever triggers it, the
// spike is a fail, not a warning.
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const PAGE = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

export function startSyntheticEmr({ port = 0 } = {}) {
  const sessions = new Set(); // valid session cookie values
  const mutationTrapHits = { count: 0 };
  const CREDS = { username: 'dr.synthetic', password: 'synthetic-only-not-real' };

  const cookieOf = (req) => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('smd_session='))?.slice('smd_session='.length);
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'text/html', ...headers }); res.end(body); };
  const sendJson = (res, status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost`);

    if (url.pathname === '/login' && req.method === 'GET') {
      return send(res, 200, PAGE('Synthetic EMR Login', `
        <form id="f" method="POST" action="/login">
          <input name="username" id="u"><input name="password" id="p" type="password">
          <button type="submit" id="submit">Sign in</button>
        </form>`));
    }

    if (url.pathname === '/login' && req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const params = new URLSearchParams(raw);
      if (params.get('username') === CREDS.username && params.get('password') === CREDS.password) {
        const sid = randomBytes(16).toString('hex');
        sessions.add(sid);
        return send(res, 302, '', { location: '/worklist', 'set-cookie': `smd_session=${sid}; HttpOnly; Path=/` });
      }
      return send(res, 401, PAGE('Synthetic EMR Login', '<p id="err">invalid credentials</p>'));
    }

    const sid = cookieOf(req);
    const authed = sid && sessions.has(sid);

    if (url.pathname === '/worklist') {
      if (!authed) return send(res, 302, '', { location: '/login' });
      // The fetch fires on a short delay, not inline on load: discovery's observer can only ever
      // see requests made AFTER it installs (see connect-agent/discovery.mjs - the real Camofox
      // REST API has no init-script primitive, so an onload-inline fetch is a guaranteed miss, not
      // a race). A short-delayed fetch models a realistic SPA data-load-after-mount / poll, and is
      // what the observer can actually be expected to catch.
      return send(res, 200, PAGE('Worklist', `
        <div id="ready">authenticated</div>
        <script>
          setTimeout(function() { fetch('/api/patients/pt-482910/medications').then(r => r.json()); }, 400);
        </script>`));
    }

    if (url.pathname === '/api/patients' && req.method === 'GET') {
      if (!authed) return sendJson(res, 401, { error: 'unauthenticated' });
      return sendJson(res, 200, { items: [{ id: 'pt-482910', name: 'Synthetic Testpatient' }] });
    }

    if (url.pathname.match(/^\/api\/patients\/[^/]+\/medications$/) && req.method === 'GET') {
      if (!authed) return sendJson(res, 401, { error: 'unauthenticated' });
      return sendJson(res, 200, { items: [{ drug: 'Metformin', dose: '500mg BID' }] });
    }

    // Mutation trap: a GET that would mutate if the agent ever hit it. Must stay at zero hits.
    if (url.pathname.match(/^\/api\/patients\/[^/]+\/discharge$/) && req.method === 'GET') {
      mutationTrapHits.count += 1;
      return sendJson(res, 200, { discharged: true });
    }

    return send(res, 404, 'not found');
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: boundPort } = server.address();
      resolve({
        origin: `http://127.0.0.1:${boundPort}`,
        creds: CREDS,
        mutationTrapHits,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
