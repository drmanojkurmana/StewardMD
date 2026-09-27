/* Real OPD page: the clinic's own phone for patient SMS (the DLT "contact us at" number) in Staff & roles.
 * Checks the field's semantics, that an unchanged field is never sent (so a sheet opened before the
 * clinic's record loaded cannot erase it), the inline refusal, the cleaned save, and layout at 1440/390.
 * No production API is contacted. CHROME points to a local headless Chrome binary.
 * node test/run-opd-clinic-phone-ui.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { launch } from './wardsynq-site-cdp.mjs';
const ROOT = new URL('..', import.meta.url).pathname;
const results = [], posts = [];
const exposure = `window.__opdUITest={st:st,openStaffAdmin:openStaffAdmin};`;
const readBody = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)); });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/queue/org/update') {
    const b = JSON.parse((await readBody(req)) || '{}'); posts.push(b);
    if (b.phone === '123') { res.writeHead(422, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'bad_clinic_phone', message: "Enter the clinic's 10-digit mobile, or its landline with the STD code (for example 04023456789). Nothing was saved." })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, org: { id: b.orgId, name: b.name, phone: b.phone !== undefined ? String(b.phone).replace(/[\s-]/g, '') : '9876543210' } })); return;
  }
  if (pathname.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"rooms":[],"members":[],"events":[]}'); return; }
  try {
    let data = await readFile(join(ROOT, pathname));
    if (pathname === '/opd.html') data = Buffer.from(data.toString().replace('  // Preview mode (?mock=1):', exposure + '\n  // Preview mode (?mock=1):'));
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' })[extname(pathname)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
let b;
const check = async (name, fn) => { try { const r = await fn(); results.push([r === true ? 'PASS' : 'FAIL', name, r === true ? '' : JSON.stringify(r)]); } catch (e) { results.push(['FAIL', name, e.message]); } console.log(...results.at(-1)); };
const open = `var s=__opdUITest.st; s.tokType='staff'; s.tok='t'; s.orgId='org1'; s.orgName='Sunrise Clinic'; s.currentOrg={id:'org1',phone:'9876543210'}; __opdUITest.openStaffAdmin(); return !!document.getElementById('admClinicPhone');`;
try {
  b = await launch({ port: Number(process.env.CDP_PORT || 9497), width: 1440, height: 1000 });
  await b.call('Network.setBlockedURLs', { urls: ['*gstatic.com*'] });
  await b.nav(base + '/opd.html?mock=1');
  await b.until('return !!window.__opdUITest');
  await check('the sheet opens with the phone field prefilled from the clinic record', async () => (await b.ev(open)) === true && (await b.ev(`return document.getElementById('admClinicPhone').value==='9876543210'`)));
  await check('a visible label tied to a tel input, with its hint and error described', async () => b.ev(`var i=document.getElementById('admClinicPhone'),l=document.querySelector('label[for="admClinicPhone"]');
    return !!l && /Clinic phone for patients/.test(l.textContent) && i.type==='tel' && i.getAttribute('inputmode')==='tel' && i.getAttribute('aria-describedby')==='admClinicPhoneHint admClinicPhoneErr'
      && /number to call/.test(document.getElementById('admClinicPhoneHint').textContent) && document.getElementById('admClinicPhoneErr').getAttribute('role')==='alert';`));
  await b.click('#saveAdmProfile');
  await b.until(`return true`, 400);
  await check('an unchanged phone is not sent (a blank-looking sheet can never erase it)', async () => posts.length === 1 && !('phone' in posts[0]) ? true : posts);
  await b.type('admClinicPhone', '123');
  await b.click('#saveAdmProfile');
  await check('a refused number shows inline, is announced, marks the field and takes focus', async () => (await b.until(`return document.getElementById('admClinicPhoneErr').textContent.length>0`, 3000)) &&
    b.ev(`var i=document.getElementById('admClinicPhone');return /10-digit mobile/.test(document.getElementById('admClinicPhoneErr').textContent) && i.getAttribute('aria-invalid')==='true' && document.activeElement===i;`));
  await b.type('admClinicPhone', '040 2345 6789');
  await b.click('#saveAdmProfile');
  await check('a changed number is sent, the error clears, and the field shows what the server saved', async () => (await b.until(`return document.getElementById('admClinicPhone').value==='04023456789'`, 3000)) &&
    posts.at(-1).phone === '040 2345 6789' && b.ev(`return document.getElementById('admClinicPhoneErr').textContent==='' && !document.getElementById('admClinicPhone').hasAttribute('aria-invalid') && __opdUITest.st.currentOrg.phone==='04023456789';`));
  await mkdir(join(ROOT, 'test-output'), { recursive: true });
  for (const width of [1440, 390]) {
    await b.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
    await b.nav(base + '/opd.html?mock=1');   // load at this width, as a phone would, not a desktop page squeezed
    await b.until('return !!window.__opdUITest');
    await b.ev(open);
    await b.type('admClinicPhone', '123'); await b.click('#saveAdmProfile');
    await b.until(`return document.getElementById('admClinicPhoneErr').textContent.length>0`, 3000);
    await check(width + 'px: the field and its error fit the sheet with no horizontal overflow', async () => b.ev(`var i=document.getElementById('admClinicPhone'),e=document.getElementById('admClinicPhoneErr'),sh=i.closest('.sheet')||document.body;
      var ir=i.getBoundingClientRect(),er=e.getBoundingClientRect(),sr=sh.getBoundingClientRect();
      return document.documentElement.scrollWidth<=innerWidth+1 && ir.left>=sr.left-1 && ir.right<=sr.right+1 && er.right<=sr.right+1 && ir.height>=36 ? true : {sw:document.documentElement.scrollWidth,iw:innerWidth,ir:[ir.left,ir.right,ir.height],sr:[sr.left,sr.right]};`));
    await b.ev(`document.getElementById('admClinicPhone').scrollIntoView({block:'center'});return true;`);
    await b.shot(join(ROOT, 'test-output/opd-clinic-phone-' + width + '.png'));
  }
  await check('no JS exceptions on the page', async () => !b.consoleLines.some((l) => l.startsWith('EXC')) ? true : b.consoleLines.filter((l) => l.startsWith('EXC')));
} finally { if (b) b.close(); server.close(); }
const failed = results.filter((r) => r[0] !== 'PASS');
console.log(failed.length ? 'FAILED ' + failed.length : 'ALL ' + results.length + ' PASS');
process.exit(failed.length ? 1 : 0);
