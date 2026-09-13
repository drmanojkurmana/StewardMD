/* Connect Agent browser-continuity spike against a REAL, locally-running Camofox server
 * (jo-inc/camofox-browser, stealth-Firefox/Camoufox engine - the actual chosen browser-provider,
 * not a CDP/Chrome stand-in). Requires `npm start` running in that repo, CAMOFOX_URL pointed at it.
 *
 * Camofox's own architecture (per its README) scopes cookies/storage to the per-userId BrowserContext,
 * not to an individual tab: "User Session (BrowserContext) - isolated cookies/storage" containing
 * multiple tab groups. That means a doctor's login tab and the agent's LATER discovery call, if they
 * share the same userId, should already share the authenticated session even though
 * discoverAuthorizedEmr() always opens a fresh tab (gap #1 - it has no attach-to-existing-tab support
 * yet). This spike tests exactly that claim for real, and runs the real discoverAuthorizedEmr()
 * pipeline (unmodified) as the "agent" step, not a hand-rolled substitute.
 *
 * USAGE: (in the camofox-browser checkout) npm start
 *        CAMOFOX_URL=http://127.0.0.1:9377 node test/run-connect-agent-camofox-continuity.mjs
 */
import { randomUUID } from 'node:crypto';
import { startSyntheticEmr } from './connect-agent/synthetic-emr-server.mjs';
import { createCamofoxClient } from '../connect-agent/camofox-client.mjs';
import { discoverAuthorizedEmr } from '../connect-agent/discovery.mjs';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const emr = await startSyntheticEmr();
const client = createCamofoxClient();
const userId = `spike-doctor-${randomUUID()}`;

try {
  const preflight = await client.preflight();
  ok(preflight.ok === true, `real Camofox server reachable and API-compatible (version ${preflight.api})`);

  // --- Doctor logs in: one tab, this userId ---------------------------------------------------
  const loginTab = await client.createTab({ userId, sessionKey: 'login', url: `${emr.origin}/login` });
  const loginTabId = loginTab.tabId;
  ok(!!loginTabId, 'Camofox created a real tab for the login step');

  await client.wait({ tabId: loginTabId, userId, ms: 500 });
  const formCheck = await client.evaluate({ tabId: loginTabId, userId, expression: `!!document.getElementById('f')` });
  ok(formCheck.result === true, 'doctor sees the real login form in the Camofox-driven tab');

  await client.evaluate({ tabId: loginTabId, userId,
    expression: `document.getElementById('u').value=${JSON.stringify(emr.creds.username)}; document.getElementById('p').value=${JSON.stringify(emr.creds.password)}; document.getElementById('f').submit(); true` });
  await client.wait({ tabId: loginTabId, userId, ms: 600 });
  const loggedIn = await client.evaluate({ tabId: loginTabId, userId, expression: `location.pathname === '/worklist' && !!document.getElementById('ready')` });
  ok(loggedIn.result === true, 'login completed inside the real Camofox browser');

  // Doctor's tab closes (they hand off) - the underlying userId session/cookies must outlive it.
  await client.closeTab({ tabId: loginTabId, userId });

  // --- Agent attaches: SAME userId, via the actual (unmodified) discoverAuthorizedEmr() --------
  const spec = await discoverAuthorizedEmr({
    startUrl: `${emr.origin}/worklist`,
    allowedOrigins: [emr.origin],
    userId,                       // same userId as the doctor's login - the continuity claim under test
    sessionKey: `agent-${randomUUID()}`,
    client,
    waitMs: 800,
  });

  ok(spec.events.some(e => e.status === 200), `agent read authenticated data via the real discovery pipeline with NO re-login (events: ${JSON.stringify(spec.events.map(e => ({ path: e.path, status: e.status })))})`);
  ok(!spec.events.some(e => e.status === 401), 'no request came back 401 (a fresh/unauthenticated context would 401 on /api/patients)');

  ok(emr.mutationTrapHits.count === 0, 'mutation-trap endpoint was never hit (zero writes throughout)');
} catch (e) {
  console.error('SPIKE ERROR:', e);
  fails++;
} finally {
  await client.closeSession({ userId }).catch(() => {});
  await emr.close();
}

console.log(fails ? `\n${fails} FAILED` : '\nAll spike checks passed');
process.exit(fails ? 1 : 0);
