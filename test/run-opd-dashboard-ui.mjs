/* Real OPD page, the operations dashboard (opd-dashboard.js) over the preview (?mock=1) data.
 *
 * Verifies: every card renders with data; each occupancy row's action is the console's OWN button (clicking the
 * proxy opens the same dialog); the palette opens on Ctrl-K, finds actions and patients, and is keyboard driven;
 * the view switch keeps the Flow Board's nodes; a live repaint does not touch a field being typed in; the phone
 * layout has a drawer + bottom nav and no horizontal scroll; dark mode and reduced motion; the classic switch.
 * Screenshots: test-output/opd-dash-{light,dark}-{1440,390}.png (and docs/opd/screens/ with SHOTS_DIR).
 * CHROME points to a local headless Chrome binary. No production API is contacted.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { launch } from './wardsynq-site-cdp.mjs';
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = process.env.SHOTS_DIR ? join(ROOT, process.env.SHOTS_DIR) : join(ROOT, 'test-output');
const results = [];
const exposure = `window.__opdUITest={st:st,render:renderNurseStation,legacy:renderBoard};`;
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"rooms":[],"members":[],"events":[]}'); return; }
  try {
    let data = await readFile(join(ROOT, pathname));
    if (pathname === '/opd.html') data = Buffer.from(data.toString().replace('  // Preview mode (?mock=1):', exposure + '\n  // Preview mode (?mock=1):'));
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' })[extname(pathname)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let b;
const check = async (name, fn) => { try { const r = await fn(); results.push([r === true ? 'PASS' : 'FAIL', name, r === true ? '' : JSON.stringify(r)]); } catch (e) { results.push(['FAIL', name, e.message]); } console.log(...results.at(-1)); };
const size = (width, height) => b.call('Emulation.setDeviceMetricsOverride', { width, height: height || 1000, deviceScaleFactor: 1, mobile: width < 500 });
const media = (dark) => b.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: dark ? 'reduce' : 'no-preference' }] });
const fullShot = async (path) => {
  const h = await b.ev('return Math.ceil(document.documentElement.scrollHeight)');
  const w = await b.ev('return innerWidth');
  await b.call('Emulation.setDeviceMetricsOverride', { width: w, height: Math.min(h, 6000), deviceScaleFactor: 1, mobile: w < 500 });
  await b.sleep(250);
  await b.shot(path);
};
try {
  b = await launch({ port: Number(process.env.CDP_PORT || 9497), width: 1440, height: 1000 });
  await b.call('Network.setBlockedURLs', { urls: ['*gstatic.com*'] });
  await media(false);
  await b.nav('http://127.0.0.1:' + server.address().port + '/opd.html?mock=1');
  await b.until('return !!window.__opdUITest && !!document.getElementById("dzDash")');
  await b.ev('return document.fonts && document.fonts.ready.then(()=>true)');
  await check('page boots into the dashboard without JS errors', async () => !b.consoleLines.some((l) => l.startsWith('EXC')) && (await b.ev('return document.getElementById("app").classList.contains("opd-dash-on")')) === true || b.consoleLines);
  await check('KPI strip: seen with /registered, collected, door to doctor, did not wait, each with a delta', async () => b.ev(`var k=[].map.call(document.querySelectorAll('[data-kpi]'),n=>n.getAttribute('data-kpi')).join(',');var seen=document.querySelector('[data-kpi="seen"]');return k==='seen,money,d2d,dnw'&&/\\//.test(seen.querySelector('.dz-suffix').textContent)&&document.querySelectorAll('[data-kpi] .dz-delta').length===4&&/vs yesterday/.test(seen.textContent)||k;`));
  await check('live occupancy lists every active patient with a status pill and an action', async () => b.ev(`var rows=document.querySelectorAll('#dzOcc tbody tr');return rows.length===7&&[].every.call(rows,r=>r.querySelector('.dz-pill')&&r.querySelector('.dz-act button'))||rows.length;`));
  await check('the row action is the console own button: Route opens the same routing dialog', async () => b.ev(`var tr=[].find.call(document.querySelectorAll('#dzOcc tbody tr'),r=>/John Peter/.test(r.textContent));tr.querySelector('.dz-act .dz-btn').click();var ok=document.querySelector('.scrim').classList.contains('on')&&document.querySelector('.sheet').textContent.includes('John Peter');var c=document.querySelector('.sheet #cx');if(c)c.click();else document.querySelector('.scrim').classList.remove('on');return ok;`));
  await check('the More menu offers exactly the console buttons for that row', async () => b.ev(`var tr=[].find.call(document.querySelectorAll('#dzOcc tbody tr'),r=>/Ramesh Kumar/.test(r.textContent));tr.querySelector('.dz-iconbtn').click();var m=document.querySelector('.dz-menu-pop');var n=m?m.querySelectorAll('[role=menuitem]').length:0;var real=document.querySelector('.row [data-t="t1"]').closest('.row').querySelectorAll('button[data-a],button[data-assign]').length;var focused=document.activeElement&&document.activeElement.getAttribute('role')==='menuitem';document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return n===real-1&&focused&&!document.querySelector('.dz-menu-pop')||[n,real,focused];`));
  await check('filter chips narrow the table and say how many', async () => b.ev(`document.querySelector('[data-dz-filter="treat"]').click();var n=document.querySelectorAll('#dzOcc tbody tr').length;document.querySelector('[data-dz-filter="all"]').click();return n===1;`));
  await check('peak hours: bars with this hour in the accent colour, three stat chips, a legend and a table', async () => b.ev(`return !!document.querySelector('.dz-bar.now')&&document.querySelectorAll('.dz-stat').length===3&&!!document.querySelector('#dzPeak .dz-legend')&&!!document.querySelector('#dzPeak table.dz-sr')&&document.querySelector('.dz-hours-svg').getAttribute('aria-label').length>20;`));
  await check('month: one cell per day, today ringed, closed days ticked', async () => b.ev(`var d=document.querySelectorAll('.dz-day:not(.blank)').length;var ins=__opdUITest.st.insights;var days=new Date(Date.UTC(+ins.date.slice(0,4),+ins.date.slice(5,7),0)).getUTCDate();return d===days&&document.querySelectorAll('.dz-day.today').length===1&&document.querySelectorAll('.dz-tick').length>0;`));
  await check('visit mix: donut plus legend with counts and percent, and priority bubbles', async () => b.ev(`return document.querySelectorAll('.dz-seg-f').length===3&&document.querySelectorAll('.dz-keys li').length===3&&document.querySelectorAll('.dz-bubble').length===4;`));
  await check('tasks: every inbox source present, each with an action', async () => b.ev(`var t=[].map.call(document.querySelectorAll('[data-dz-task]'),n=>n.getAttribute('data-dz-task')).join(',');return t==='reconcile,offline,results,noshows,schedule,billing,dayclose'||t;`));
  await check('Results back task filters the occupancy table to them', async () => b.ev(`document.querySelector('[data-dz-task="results"]').click();var rows=document.querySelectorAll('#dzOcc tbody tr');var ok=rows.length===1&&/Sita/.test(rows[0].textContent);document.querySelector('[data-dz-filter="all"]').click();return ok;`));
  await check('sidebar: grouped, the console own buttons moved in with their handlers, badges shown', async () => b.ev(`var g=[].map.call(document.querySelectorAll('.dz-group:not([hidden]) .dz-glabel'),n=>n.textContent).join(',');var bill=document.getElementById('billing');return g==='Operations,Clinical,Revenue,Manage'&&bill.closest('.dz-side')&&typeof bill.onclick==='function'&&!document.querySelector('[data-dz-badge="recall"]').hidden||g;`));
  await check('Ctrl-K opens the palette; typing filters actions; Enter runs; focus returns', async () => b.ev(`var s=document.getElementById('dzSearch');s.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));var w=document.querySelector('.dz-pal-wrap');var q=document.getElementById('dzPalQ');var open=!w.hidden&&document.activeElement===q;q.value='room queues';q.dispatchEvent(new Event('input'));var first=document.querySelector('#dzPalL li').textContent;q.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));var flow=document.getElementById('app').classList.contains('dz-v-flow');return open&&/Room queues/.test(first)&&w.hidden&&flow||[open,first,flow];`));
  await check('palette finds a patient by token and opens the flow board filtered to them', async () => b.ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}));var q=document.getElementById('dzPalQ');q.value='A-16';q.dispatchEvent(new Event('input'));var li=document.querySelector('#dzPalL li');var ok=/Abdul Rahman/.test(li.textContent);q.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return ok&&document.getElementById('opdPatientSearch').value==='A-16'&&document.getElementById('opdFilterCount').textContent.indexOf('1 of')===0||[ok,document.getElementById('opdFilterCount').textContent];`));
  await check('flow view keeps the Flow Board; Overview hides it again', async () => b.ev(`document.querySelector('[data-opd-view="flow"]').click();var board=document.querySelector('.opd-flow-board');var vis=board.getClientRects().length>0;document.getElementById('opdPatientSearch').value='';document.getElementById('opdPatientSearch').dispatchEvent(new Event('input'));document.querySelector('[data-dz-nav="overview"]').click();return vis&&board.getClientRects().length===0&&document.getElementById('dzDash').getClientRects().length>0;`));
  await check('a live repaint leaves a field being typed in alone', async () => b.ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));var q=document.getElementById('dzPalQ');q.value='bil';q.dispatchEvent(new Event('input'));__opdUITest.st.pulse.pulse.seen+=1;__opdUITest.render(__opdUITest.st.opd);var ok=document.activeElement===q&&q.value==='bil'&&!document.querySelector('.dz-pal-wrap').hidden;q.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));__opdUITest.st.pulse.pulse.seen-=1;__opdUITest.render(__opdUITest.st.opd);return ok;`));
  await check('a repaint with unchanged figures does not rebuild the charts (no flicker)', async () => b.ev(`var svg=document.querySelector('.dz-hours-svg');window.SMD_OPD_DASH.paint();return document.querySelector('.dz-hours-svg')===svg;`));
  await mkdir(OUT, { recursive: true });
  for (const dark of [false, true]) {
    await media(dark);
    for (const width of [1440, 390]) {
      await size(width, width < 500 ? 844 : 1000);
      await b.sleep(200);
      await check((dark ? 'dark ' : 'light ') + width + 'px: no horizontal scroll, no clipped buttons, 44px targets on the phone', async () => b.ev(`var wide=document.documentElement.scrollWidth>innerWidth+1;var vis=[].filter.call(document.querySelectorAll('#app button'),n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'&&!n.closest('.dz-side'));var bad=vis.filter(n=>n.getBoundingClientRect().right>innerWidth+1);var small=${width < 500}?vis.filter(n=>n.closest('#dzDash,.dz-bottom,.dz-top')&&(n.getBoundingClientRect().height<40)).map(n=>n.textContent.trim().slice(0,20)):[];return !wide&&!bad.length&&!small.length||{wide,bad:bad.map(n=>n.textContent.trim().slice(0,20)),small};`));
      await fullShot(join(OUT, `opd-dash-${dark ? 'dark' : 'light'}-${width}.png`));
      await size(width, width < 500 ? 844 : 1000);
    }
  }
  await check('dark theme uses its own tokens', async () => b.ev(`return getComputedStyle(document.documentElement).getPropertyValue('--dz-bg').trim()==='#101311';`));
  await check('phone: the menu opens the sidebar as a drawer and Escape closes it', async () => { await size(390, 844); return b.ev(`document.querySelector('[data-dz-b="menu"]').click();var open=document.getElementById('app').classList.contains('dz-drawer-open')&&document.getElementById('dzSide').getBoundingClientRect().left>=0;document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return open&&!document.getElementById('app').classList.contains('dz-drawer-open');`); });
  await fullShot(join(OUT, 'opd-dash-dark-390-drawer-check.png')).catch(() => {});
  await size(1440, 1000);
  await check('Classic layout is one click away, and so is the way back', async () => b.ev(`document.querySelector('[data-dz-nav="classic"]').click();var classic=!document.getElementById('dzDash')&&!!document.querySelector('.opd-flow-board')&&localStorage.getItem('smd_opd_dash')==='0';document.getElementById('opdDashBack').click();var back=!!document.getElementById('dzDash')&&localStorage.getItem('smd_opd_dash')===null;return classic&&back;`));
  await check('original-board recovery switch still wins over the dashboard', async () => b.ev(`localStorage.setItem('smd_opd_flow_ui','0');__opdUITest.render(__opdUITest.st.opd);var ok=!document.getElementById('dzDash')&&!document.querySelector('.opd-flow-board')&&document.querySelectorAll('.ctl .row,.ctl .pcard').length===7;localStorage.removeItem('smd_opd_flow_ui');__opdUITest.render(__opdUITest.st.opd);return ok;`));
  await check('no runtime exceptions during interactions', async () => b.consoleLines.filter((l) => l.startsWith('EXC')).length === 0 || b.consoleLines);
} finally { if (b) b.close(); server.close(); }
console.log('\n' + results.filter((x) => x[0] === 'PASS').length + '/' + results.length + ' passed');
if (results.some((x) => x[0] === 'FAIL')) process.exitCode = 1;
