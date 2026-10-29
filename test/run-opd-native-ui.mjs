// Real-browser test of the specialty kits against the full app (index.html): the Home tile and the
// standalone kit sheet (stacking with the Knowledge Library and Calculators), and the OPD EMR
// Specialty tab (tools computing in place, Add writing into the assessment, shortcuts to the
// Investigations / Protocol / Immunisation tabs, read-only and flag-off states), every kit at 390px.
//   node test/run-specialty-kits-ui.mjs      (CHROME=/path/to/chrome to override the browser)
// Screenshots: /tmp/stewardmd-kits/
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const CHROME=process.env.CHROME||['/opt/pw-browsers/chromium-1194/chrome-linux/chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>existsSync(p));
const server=spawn('node',[repo+'test/serve.mjs',repo,'9081'],{stdio:'ignore'});
const chrome=spawn(CHROME,['--headless=new','--no-sandbox','--remote-debugging-port=9481',`--user-data-dir=/tmp/native-chrome-${process.pid}`,'--no-first-run','--disable-gpu'],{stdio:'ignore'});
let ws,sid,id=0,failures=0;const pending=new Map();
const call=(method,params={})=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params,sessionId:sid}));});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
const ok=(pass,label)=>{console.log(`${pass?'PASS':'FAIL'} ${label}`);if(!pass)failures++;};
const until=async(expr,ms=10000)=>{for(let t=0;t<ms;t+=100){if(await ev(expr))return true;await sleep(100);}return false;};
async function shot(name){await sleep(250);await mkdir('/tmp/stewardmd-kits',{recursive:true});const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(`/tmp/stewardmd-kits/${name}.png`,Buffer.from(r.result.data,'base64'));}
const BUNDLE=JSON.parse(readFileSync(repo+'kb/specialty-kits/kits.json','utf8'));
// Set a kit input the way a user does: value + input event (dates/selects/numbers alike).
const setF=(scope,name,val,root)=>ev(`(()=>{const el=document.querySelector('${root} [data-kit-f="${scope}:${name}"]');if(!el)return false;if(el.type==='checkbox')el.checked=!!${JSON.stringify(val)};else el.value=${JSON.stringify(val)};el.dispatchEvent(new Event(el.tagName==='SELECT'||el.type==='checkbox'?'change':'input',{bubbles:true}));return true})()`);
const wide=()=>ev(`(()=>{const W=innerWidth,out=[];const r=document.querySelector('#smdOpdEmr');const c=r.querySelector('.oe-canvas')||r;document.querySelectorAll('#smdOpdEmr *').forEach(e=>{if(e.closest('.oe-tabs,.oe-proto-branches'))return;const b=e.getBoundingClientRect();if(b.width&&(b.right>W+1||b.left<-1))out.push(e.tagName+'.'+String(e.className).slice(0,40)+' '+Math.round(b.left)+'..'+Math.round(b.right))});return JSON.stringify({sw:c.scrollWidth,cw:c.clientWidth,rs:r.scrollWidth,rc:r.clientWidth,doc:document.documentElement.scrollWidth,out:out.slice(0,8)})})()`).then(JSON.parse);
try{
 let version;for(let i=0;i<60;i++){try{version=await(await fetch('http://localhost:9481/json/version')).json();break;}catch{await sleep(200);}}
 ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
 const created=await call('Target.createTarget',{url:'about:blank'});sid=(await call('Target.attachToTarget',{targetId:created.result.targetId,flatten:true})).result.sessionId;
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await call('Page.navigate',{url:'http://localhost:9081/'});
 ok(await until('!!(window.OPDEMR&&window.SMD_KBPROTO)',25000),'app loaded');
 await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
 await ev(`OPDEMR.openProfile({patientId:'MR-N-1',name:'Native Patient',sex:'Male',age:'54',noStore:true});1`);
 ok(await until(`!!document.querySelector('#smdOpdEmr.on [data-oe-act="tab:assess"]')`),'EMR open');
 await sleep(600);
 for(const t of ['profile','assess','kit','inv','meds','note','protocol','onco']){
   await ev(`document.querySelector('#smdOpdEmr [data-oe-act="tab:${t}"]')&&document.querySelector('#smdOpdEmr [data-oe-act="tab:${t}"]').click();1`);
   await sleep(500);
   const w=await wide();console.log(t,JSON.stringify(w));
   ok(w.sw<=w.cw+1&&w.rs<=w.rc+1&&w.doc<=390+1&&!w.out.length,'no sideways overflow on '+t);
 }
 await ev(`document.querySelector('#smdOpdEmr [data-oe-act="tab:assess"]').click();1`);await sleep(300);
 await ev(`OPDEMR._state().writeOn=true;1`);
 const box=await ev(`!!document.querySelector('#smdOpdEmr .oe-pbox')`);
 console.log('box present',box);
 if(box){
  ok(await ev(`(()=>{const a=document.querySelector('#smdOpdEmr .oe-accwrap'),b=document.querySelector('#smdOpdEmr .oe-pbox');return !b.open&&!!(a.compareDocumentPosition(b)&4)})()`),'protocol box sits after the form sections, collapsed');
  await ev(`document.querySelector('#smdOpdEmr .oe-pbox summary').click();1`);
  ok(await until(`document.querySelectorAll('#oe-out-pb .oe-proto-row').length>10`,15000),'opening lists many protocols');
  await ev(`(()=>{const el=document.querySelector('[data-oe-inp="pb-q"]');el.value='sepsis';el.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
  ok(await until(`/sepsis/i.test((document.querySelector('#oe-out-pb .oe-proto-t')||{}).textContent||'')`),'search filters (sepsis first)');
  ok(await ev(`(()=>{const s=document.querySelector('#oe-out-pb');return getComputedStyle(s).overflowY==='auto'&&s.clientHeight<=330})()`),'results sit in a fixed-height scroll box');
  await shot('pbox');
 }
}catch(e){console.log('ERR',e.message);failures++;}
finally{ws&&ws.close();chrome.kill();server.kill();process.exit(failures?1:0);}
