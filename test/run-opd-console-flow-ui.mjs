/* Real OPD page: verify the redesign preserves action nodes, permissions, room order,
 * diagnostics, search, polling focus, responsive layout, and the recovery switch.
 * No production API is contacted. CHROME points to a local headless Chrome binary.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { launch } from './wardsynq-site-cdp.mjs';
const ROOT = new URL('..', import.meta.url).pathname;
const results = [];
const exposure = `window.__opdUITest={st:st,render:renderNurseStation,legacy:renderBoard};`;
const server = createServer(async (req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  if(pathname.startsWith('/api/')){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true,"rooms":[],"members":[],"events":[]}');return;}
  try {
    let data=await readFile(join(ROOT,pathname));
    if(pathname==='/opd.html')data=Buffer.from(data.toString().replace('  // Preview mode (?mock=1):',exposure+'\n  // Preview mode (?mock=1):'));
    res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'})[extname(pathname)]||'application/octet-stream'});res.end(data);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let b;
const check=async(name,fn)=>{try{const r=await fn();results.push([r===true?'PASS':'FAIL',name,r===true?'':JSON.stringify(r)]);}catch(e){results.push(['FAIL',name,e.message]);}console.log(...results.at(-1));};
try{
 b=await launch({port:Number(process.env.CDP_PORT||9493),width:1440,height:1000});
 await b.call('Network.setBlockedURLs',{urls:['*gstatic.com*']});
 await b.nav('http://127.0.0.1:'+server.address().port+'/opd.html?mock=1');
 await b.until('return !!window.__opdUITest && !!document.querySelector(".opd-flow-board")');
 await check('actual page boots without JS errors',async()=>!b.consoleLines.some(l=>l.startsWith('EXC')));
 await b.ev(`window.fixture=JSON.parse(JSON.stringify(__opdUITest.st.opd));fixture.pool[0].registeredAt=Date.now()-70*60000;fixture.pool[0].token='C-042';fixture.rooms[0].tickets.push({id:'lab1',name:'Diagnostic Example',mrnLast4:'9999',status:'at_diagnostics',priority:0,registeredAt:Date.now()-90*60000});__opdUITest.render(fixture);return true;`);
 const snapshot=`Array.from(document.querySelectorAll('#app button[data-a],#app button[data-assign],#app button[data-audit]')).map(n=>Array.from(n.attributes).filter(a=>a.name.indexOf('data-')===0).map(a=>a.name+'='+a.value).sort().join('|')).sort()`;
 await check('all patients appear exactly once in four honest stages',async()=>b.ev(`return document.querySelectorAll('.opd-lane').length===4&&document.querySelectorAll('.opd-lane .pcard,.opd-lane .row').length===8;`));
 await check('diagnostic patient has return action and is not counted as long waiting',async()=>b.ev(`var n=document.querySelector('[data-t="lab1"]').closest('.row');return !!n.closest('[data-opd-lane="tests"]')&&!!n.querySelector('[data-a="diagdone"]')&&!n.querySelector('.opd-long-wait');`));
 await check('switching views preserves actual action nodes and room order',async()=>b.ev(`window.saved=Array.from(document.querySelectorAll('.opd-lane [data-a],.opd-lane [data-assign]'));document.querySelector('[data-opd-view="rooms"]').click();var first=Array.from(document.querySelector('.rcard .rows').children).map(n=>n.querySelector('[data-t]').getAttribute('data-t')).join(',');document.querySelector('[data-opd-view="flow"]').click();document.querySelector('[data-opd-view="rooms"]').click();return first==='t1,t2,t3,lab1'&&saved.every(n=>n.isConnected&&typeof n.onclick==='function');`));
 await b.click('[data-opd-view="flow"]');
 for(const [role,caps] of Object.entries({admin:['queue.view','queue.add','queue.reorder','queue.status','queue.priority','queue.assign','staff.admin','emr.vitals','emr.view'],doctor:['queue.view','queue.status','emr.view'],nurse:['queue.view','queue.add','queue.assign','emr.vitals'],cashier:['queue.view'],pharmacy:['queue.view']})){
  await check(role+': classic and modern expose identical clinical actions and toolbar permissions',async()=>b.ev(`__opdUITest.st.who={role:${JSON.stringify(role)},caps:${JSON.stringify(caps)},name:'Test',kind:'staff'};__opdUITest.st.ownsOrg=false;localStorage.setItem('smd_opd_flow_ui','0');__opdUITest.render(fixture);var old=${snapshot};var ids=Array.from(document.querySelectorAll('.toolbar button')).map(n=>n.id).sort();localStorage.removeItem('smd_opd_flow_ui');__opdUITest.render(fixture);return JSON.stringify(old)===JSON.stringify(${snapshot})&&ids.every(id=>document.getElementById(id)&&typeof document.getElementById(id).onclick==='function');`));
 }
 await b.ev(`__opdUITest.st.who={role:'admin',caps:['queue.view','queue.add','queue.reorder','queue.status','queue.priority','queue.assign','staff.admin','emr.vitals','emr.view'],name:'Test',kind:'staff'};__opdUITest.render(fixture);return true;`);
 await b.type('opdPatientSearch','C-042');
 await check('search finds issuing token without removing hidden actions',async()=>b.ev(`return document.getElementById('opdFilterCount').textContent==='1 of 8 patients'&&document.querySelectorAll('.opd-lane .pcard,.opd-lane .row').length===8;`));
 await check('poll rerender retains search and keyboard focus',async()=>b.ev(`document.getElementById('opdPatientSearch').focus();__opdUITest.render(fixture);return document.activeElement.id==='opdPatientSearch'&&document.getElementById('opdPatientSearch').value==='C-042'&&document.getElementById('opdFilterCount').textContent==='1 of 8 patients';`));
 await b.type('opdPatientSearch','');
 await check('long-wait filter excludes consultation and diagnostics',async()=>b.ev(`var s=document.getElementById('opdPatientFilter');s.value='long';s.dispatchEvent(new Event('change'));return document.getElementById('opdFilterCount').textContent==='1 of 8 patients';`));
 await b.click('#opdHome');
 await check('Home clears filtering without losing patients',async()=>b.ev(`return document.getElementById('opdFilterCount').textContent==='8 of 8 patients';`));
 await b.type('opdPatientSearch','no such patient');
 await check('empty search reports zero and keeps reset accessible',async()=>b.ev(`return document.getElementById('opdFilterCount').textContent==='0 of 8 patients'&&Array.from(document.querySelectorAll('.opd-lane-empty')).every(n=>!n.hidden);`));
 await b.click('#opdHome');
 await check('route action opens existing destination dialog',async()=>{await b.click('[data-assign="p1"]');return b.ev(`return document.querySelector('.scrim').classList.contains('on')&&document.querySelector('.sheet').textContent.includes('John Peter');`);});
 await b.ev(`var c=document.querySelector('.sheet #cx');if(c)c.click();return true;`);
 await mkdir(join(ROOT,'test-output'),{recursive:true});
 for(const width of [1440,1024,768,390,320]){
  await b.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  await check(width+'px: no horizontal overflow or clipped action buttons',async()=>b.ev(`var wide=document.documentElement.scrollWidth>innerWidth+1;var bad=Array.from(document.querySelectorAll('#app button')).filter(n=>n.getClientRects().length&&n.getBoundingClientRect().right>innerWidth+1);return !wide&&!bad.length;`));
  if(width===1440||width===390)await b.shot(join(ROOT,'test-output/opd-flow-'+width+'.png'));
 }
 await b.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'},{name:'prefers-reduced-motion',value:'reduce'}]});
 await check('dark theme and reduced motion',async()=>b.ev(`return getComputedStyle(document.querySelector('.opd-modern')).getPropertyValue('--bg').trim()==='#171c19'&&getComputedStyle(document.getElementById('walk')).transitionDuration==='0s';`));
 await check('legacy doctor queues preserve all actions too',async()=>b.ev(`__opdUITest.st.opd=null;__opdUITest.st.board=[{session:{id:'s1',doctorUid:'drA',doctorName:'Doctor A'},tickets:fixture.rooms[0].tickets}];localStorage.setItem('smd_opd_flow_ui','0');__opdUITest.legacy();var old=${snapshot};localStorage.removeItem('smd_opd_flow_ui');__opdUITest.legacy();return JSON.stringify(old)===JSON.stringify(${snapshot})&&document.querySelectorAll('.opd-lane .row').length===4;`));
 await check('recovery switch returns original board',async()=>b.ev(`localStorage.setItem('smd_opd_flow_ui','0');__opdUITest.render(fixture);return !document.querySelector('.opd-flow-board')&&document.querySelectorAll('.ctl .row,.ctl .pcard').length===8;`));
 await check('no runtime exceptions during interactions',async()=>b.consoleLines.filter(l=>l.startsWith('EXC')).length===0||b.consoleLines);
}finally{if(b)b.close();server.close();}
console.log('\n'+results.filter(x=>x[0]==='PASS').length+'/'+results.length+' passed');
if(results.some(x=>x[0]==='FAIL'))process.exitCode=1;
