/* Account deletion, in the real bundle (App Store 5.1.1(v)).
 * The in-app "Delete account & data" must delete server-side (/api/account/delete) first, because
 * the web SDK's user.delete() needs a recent login and cannot re-authenticate by popup in the native
 * WebView. When the server delete fails, the fallback must say the account was NOT fully removed.
 * USAGE: npm run build:www && node test/run-account-delete-ui.mjs   (serves www/ itself)
 */
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
import { spawn } from 'node:child_process';
const port = 8996;
const srv = spawn('node', [new URL('./serve.mjs', import.meta.url).pathname, new URL('../www', import.meta.url).pathname, String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const browser = await chromium.launch(); const ctx = await browser.newContext({ ...devices['iPhone 13'] }); const page = await ctx.newPage();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errs = []; page.on('pageerror', e => errs.push(String(e)));
async function run(serverOk) {
  const calls = [];
  await page.unroute('**/api/account/delete').catch(()=>{});
  await page.route('**/api/account/delete', async (route) => { const r = route.request(); calls.push({ auth: r.headers()['authorization'], body: r.postData() });
    await route.fulfill({ status: serverOk ? 200 : 502, contentType: 'application/json', body: JSON.stringify(serverOk ? { ok: true, deleted: true } : { ok: false }) }); });
  await page.addInitScript(() => { window.addEventListener('click', (ev) => { if (ev.target && ev.target.id === 'sessionSignOut') sessionStorage.setItem('t_so', String(+sessionStorage.getItem('t_so')+1)); }, true); try { localStorage.setItem('stewardmd_account', JSON.stringify({ email: 'doc@example.org', name: 'Test Doc', type: 'google' })); } catch (e) {} });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' }); await page.waitForTimeout(6000);
  await page.evaluate(() => {
    ['introPoster','splash','accountGate','introOverlay'].forEach(k => { const e = document.getElementById(k); if (e) e.remove(); });
    sessionStorage.setItem('t_del','0'); sessionStorage.setItem('t_so','0'); sessionStorage.removeItem('t_toast');
    window.SMD_IDTOKEN_REFRESH = () => Promise.resolve('tok-123');
    window.SMD_CASES = { clear: (k, fs, cb) => { if (cb) setTimeout(cb, 10); } };
    window.SMD_AUTH = { currentUser: { delete: () => { sessionStorage.setItem('t_del', String(+sessionStorage.getItem('t_del')+1)); return Promise.reject({ code: 'auth/requires-recent-login' }); } } };
    let b = document.getElementById('sessionSignOut'); if (!b) { b = document.createElement('button'); b.id = 'sessionSignOut'; document.body.appendChild(b); }
    
    const ot = window.toast; new MutationObserver(() => { const m = document.body.innerText.match(/Your (account|saved data)[^\n]*/); if (m) sessionStorage.setItem('t_toast', m[0]); sessionStorage.setItem('t_acct', String(localStorage.getItem('stewardmd_account'))); }).observe(document.body, { subtree: true, childList: true, characterData: true });
    window.location.reload = () => {};
    window.SMD_openProfile();
  });
  await page.waitForTimeout(800);
  const hasDel = await page.evaluate(() => { const d = document.querySelector('[data-acct="delete"]'); if (d) d.click(); return !!d; });
  ok(hasDel, 'Delete account button present in Profile sheet');
  await page.waitForTimeout(600);
  await page.evaluate(() => { const y = document.getElementById('smdDelYes'); if (y) y.click(); });
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => ({ deleted: +sessionStorage.getItem('t_del'), signedOut: +sessionStorage.getItem('t_so'), acct: sessionStorage.getItem('t_acct'), toast: sessionStorage.getItem('t_toast') || '' }));
  return { calls, st };
}
let r = await run(true);
ok(r.calls.length === 1 && r.calls[0].auth === 'Bearer tok-123' && JSON.parse(r.calls[0].body).confirm === 'DELETE', 'server delete called once with bearer token + confirm');
ok(r.st.deleted === 0, 'web SDK user.delete() NOT used when server delete succeeds');
ok(r.st.signedOut >= 1, 'signed out after server delete');
ok(r.st.acct === 'null', 'local account wiped');
console.log('  toast:', r.st.toast);
r = await run(false);
ok(r.calls.length === 1, 'server failure path still attempted server first');
ok(r.st.deleted === 1, 'falls back to client delete when server fails');
ok(/finish removing the account/.test(r.st.toast), 'honest message when account could not be removed');
console.log('  toast:', r.st.toast);
ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
await browser.close(); srv.kill(); process.exit(fails ? 1 : 0);
