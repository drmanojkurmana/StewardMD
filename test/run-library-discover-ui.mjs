import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const server=spawn('node',[repo+'test/serve.mjs',repo,'9032'],{stdio:'ignore'});
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=9432',`--user-data-dir=/tmp/library-chrome-${process.pid}`,'--no-first-run','--disable-gpu'],{stdio:'ignore'});
let ws,sid,id=0,failures=0;const pending=new Map();
const call=(method,params={})=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params,sessionId:sid}));});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
const ok=(pass,label)=>{console.log(`${pass?'PASS':'FAIL'} ${label}`);if(!pass)failures++;};
async function shot(name){await sleep(200);await mkdir('/tmp/stewardmd-library',{recursive:true});const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(`/tmp/stewardmd-library/${name}.png`,Buffer.from(r.result.data,'base64'));}
try{
 let version;for(let i=0;i<60;i++){try{version=await(await fetch('http://localhost:9432/json/version')).json();break;}catch{await sleep(200);}}
 ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
 const created=await call('Target.createTarget',{url:'about:blank'});sid=(await call('Target.attachToTarget',{targetId:created.result.targetId,flatten:true})).result.sessionId;
 await call('Page.navigate',{url:'http://localhost:9032/'});
 for(let i=0;i<100;i++){if(await ev('!!window.SB?.__smdKbWrapped && Object.keys(window.KB_ENRICHMENT?.byId||{}).length>4000'))break;await sleep(250);}
 await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());document.body.classList.remove('dark');SB.openRef('syndromes');document.activeElement?.blur()`);
 console.log('Catalog:',await ev(`Object.keys(KB_ENRICHMENT.byId).length`));
 ok(await ev(`document.querySelector('.kblib-intro').textContent.includes('4,800+')`),'catalog breadth is prominent');
 ok(await ev(`document.querySelectorAll('.kblib-tiles [data-br]').length===new Set(Object.values(KB_ENRICHMENT.byId).map(x=>x.system)).size`) || await ev(`document.querySelectorAll('.kblib-tiles [data-br]').length>=10`),'medical branches are available');
 for(const width of [320,390,768,1280]){await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<700});ok(await ev(`document.querySelector('#sbrefOverlay').scrollWidth<=innerWidth`),`no overflow at ${width}px`);if(width===390)await shot('discover-mobile');if(width===1280)await shot('discover-desktop');}
 await ev(`document.querySelector('.kblib-tiles [data-br="Cardiology"]').click()`);
 ok(await ev(`document.querySelector('#kblibResultsTitle').textContent==='Cardiology' && document.querySelector('#kblibDiscovery').hidden`),'branch selection opens focused index');
 const first=await ev(`document.querySelectorAll('#kblibGrid .kblib-row').length`);
 await ev(`document.querySelector('#kblibMore').click()`);
 ok(await ev(`document.querySelectorAll('#kblibGrid .kblib-row').length`)>first,'more entries are reachable');
 await ev(`document.querySelector('#kblibClear').click();const q=document.querySelector('#kblibQ');q.value='COPD';q.dispatchEvent(new Event('input',{bubbles:true}));`);
 ok(await ev(`document.querySelector('#kblibGrid').textContent.toLowerCase().includes('obstructive')`),'abbreviation search still works');
 await ev(`q.value='zzzzzzzzzzzz';q.dispatchEvent(new Event('input',{bubbles:true}));`);
 ok(await ev(`document.querySelector('#kblibGrid').textContent.includes('No matches') && document.querySelector('#kblibMore').hidden`),'empty search has clear feedback');
 await ev(`document.querySelector('#kblibClear').click();document.querySelector('.kblib-f[data-cls="inf"]').click()`);
 ok(await ev(`Array.from(document.querySelectorAll('#kblibGrid .kblib-row')).every(x=>x.classList.contains('inf'))`),'infective filter preserved');
 await ev(`document.querySelector('#kblibClear').click();document.body.classList.add('dark');SB.openRef('syndromes')`);
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await shot('discover-dark');
 const diseaseName=await ev(`document.querySelector('#kblibGrid .kblib-name').textContent`);
 await ev(`document.querySelector('#kblibGrid .kblib-row').click()`);await sleep(250);
 ok(await ev(`document.querySelector('#dxOverlay').textContent`).then(t=>t.includes(diseaseName)),'disease entry opens existing reference');
 console.log(failures?`${failures} failures`:'All library checks pass');
}catch(e){console.error(e);failures++;}finally{ws?.close();chrome.kill();server.kill();process.exitCode=failures?1:0;}
