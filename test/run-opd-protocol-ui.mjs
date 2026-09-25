// Real-browser test of the OPD EMR Protocol tab: clinical protocols (Knowledge Library) + oncology
// regimens in one list, branch filter, cancer-type picker, search that keeps focus, in-tab reader,
// read-only mode, oncology flag off, and the "&amp;" / em-dash text regressions from the owner's
// 2026-09-25 screenshot.   node test/run-opd-protocol-ui.mjs   (CHROME=... to override)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const CHROME=process.env.CHROME||['/opt/pw-browsers/chromium-1194/chrome-linux/chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>existsSync(p));
const server=spawn('node',[repo+'test/serve.mjs',repo,'9061'],{stdio:'ignore'});
const chrome=spawn(CHROME,['--headless=new','--no-sandbox','--remote-debugging-port=9461',`--user-data-dir=/tmp/opdproto-chrome-${process.pid}`,'--no-first-run','--disable-gpu'],{stdio:'ignore'});
let ws,sid,id=0,failures=0;const pending=new Map();
const call=(method,params={})=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params,sessionId:sid}));});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
const ok=(pass,label)=>{console.log(`${pass?'PASS':'FAIL'} ${label}`);if(!pass)failures++;};
const until=async(expr,ms=10000)=>{for(let t=0;t<ms;t+=100){if(await ev(expr))return true;await sleep(100);}return false;};
async function shot(name){await sleep(250);await mkdir('/tmp/stewardmd-opd-protocols',{recursive:true});const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(`/tmp/stewardmd-opd-protocols/${name}.png`,Buffer.from(r.result.data,'base64'));}
const idx=JSON.parse(readFileSync(repo+'kb/clinical-protocols/index.json','utf8'));
const type=q=>ev(`(()=>{const i=document.querySelector('[data-oe-inp="proto-q"]');i.focus();i.value=${JSON.stringify(q)};i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
const rows=()=>ev(`[...document.querySelectorAll('#oe-out-proto .oe-proto-row')].map(r=>r.querySelector('.oe-proto-t').textContent+' | '+(r.querySelector('.oe-proto-m')||{}).textContent)`);
// noStore forces write mode (opd-emr.js openProfile); read-only needs a plain GHIS-source open.
const open=async(extra='',noStore=true)=>{await ev(`window.OPDEMR.close&&window.OPDEMR.close();${extra}window.OPDEMR.openProfile({patientId:'MR-PROTO-1',name:'Test Patient',noStore:${noStore}});1`);await until(`!!document.querySelector('#smdOpdEmr [data-oe-act="tab:protocol"]')`);await ev(`document.querySelector('#smdOpdEmr [data-oe-act="tab:protocol"]').click()`);};
try{
 let version;for(let i=0;i<60;i++){try{version=await(await fetch('http://localhost:9461/json/version')).json();break;}catch{await sleep(200);}}
 ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
 const created=await call('Target.createTarget',{url:'about:blank'});sid=(await call('Target.attachToTarget',{targetId:created.result.targetId,flatten:true})).result.sessionId;
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await call('Page.navigate',{url:'http://localhost:9061/test/opd-protocol-ui-harness.html'});
 ok(await until('window.__ready===true'),'real kb-protocols.js + onco-protocols.js + opd-emr.js loaded');
 await open();
 ok(await until(`document.querySelectorAll('#oe-out-proto .oe-proto-row[data-oe-act^="proto-open:"]').length===${idx.count}`),`all ${idx.count} clinical protocols listed under All`);
 ok(await until(`document.querySelectorAll('#oe-out-proto [data-oe-act^="proto-assign:"]').length>100`),'oncology regimens listed with Assign (write mode)');
 const sub=await ev(`document.querySelector('#smdOpdEmr .oe-h3').textContent`);
 ok(!/&amp;/.test(sub)&&!/[–—]/.test(await ev(`document.querySelector('#smdOpdEmr .oe-canvas').innerText`)),'no literal "&amp;" and no em/en dash in the tab');
 ok(await ev(`[...document.querySelectorAll('.oe-proto-chip')].map(c=>c.dataset.oeAct.split(':')[1]).join(',')`)===['all','oncology',...idx.subjects.map(s=>s.key)].join(','),'branch chips: All, Oncology, then every clinical subject');
 ok(await ev(`[...document.querySelectorAll('#oe-out-proto .oe-proto-m')].every(m=>m.textContent.trim().length>0)`),'every row has a real subtitle (no placeholder dash)');
 ok(await ev(`(()=>{const c=document.querySelector('#smdOpdEmr .oe-canvas');const sec=[...c.querySelectorAll('.oe-sec')].pop().getBoundingClientRect();return c.scrollWidth<=c.clientWidth+1&&sec.right<=innerWidth+0.5})()`),'list: section card fits the screen at 390px, no sideways scroll');
 await shot('all-390');

 // Search: cancer type with a space, drug name, clinical title; the input keeps focus.
 await type('breast cancer');
 let r=await rows();
 ok(r.length>5&&r.every(x=>/breast/i.test(x)),`"breast cancer" finds breast regimens (${r.length})`);
 ok(await ev(`document.activeElement&&document.activeElement.getAttribute('data-oe-inp')==='proto-q'`),'search keeps focus (keyboard stays open)');
 await type('paclitaxel');
 ok((await ev(`document.querySelectorAll('#oe-out-proto [data-oe-act^="proto-assign:"]').length`))>3,'drug-name search finds regimens containing it');
 await type('lymphoma');
 ok((await rows()).some(x=>/R-CHOP|lymphoma/i.test(x)),'"lymphoma" finds lymphoma regimens by humanised disease name');
 const sepsis=idx.protocols.find(p=>p.id==='sepsis-septic-shock');
 await type('septic shock');
 ok((await rows()).some(x=>x.startsWith(sepsis.title)),'clinical protocol found by title words');
 await type('zzqqxx');
 ok(await ev(`document.querySelector('#oe-out-proto').textContent.includes('No protocol matches')`),'empty search explains itself');
 await type('');

 // Branch filter: a clinical subject shows only that subject; Oncology shows only regimens + cancer-type picker.
 const subj=idx.subjects[0];
 await ev(`document.querySelector('[data-oe-act="proto-branch:${subj.key}"]').click()`);
 ok(await until(`document.querySelectorAll('#oe-out-proto .oe-proto-row').length===${subj.count}&&!document.querySelector('#oe-out-proto [data-oe-act^="proto-assign:"]')`),`branch ${subj.label}: exactly its ${subj.count} protocols, no regimens`);
 ok(await ev(`document.querySelector('[data-oe-act="proto-branch:${subj.key}"]').getAttribute('aria-pressed')==='true'`),'active branch chip is pressed');
 await ev(`document.querySelector('[data-oe-act="proto-branch:oncology"]').click()`);
 ok(await until(`!!document.querySelector('[data-oe-inp="proto-type"]')&&!document.querySelector('#oe-out-proto [data-oe-act^="proto-open:"]')`),'Oncology branch: cancer-type picker, no clinical rows');
 await ev(`(()=>{const s=document.querySelector('[data-oe-inp="proto-type"]');s.value='prostate_cancer';s.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 r=await rows();
 ok(r.length>=5&&r.every(x=>/Prostate cancer/.test(x)),`cancer type Prostate narrows to ${r.length} regimens`);
 await ev(`(()=>{const s=document.querySelector('[data-oe-inp="proto-type"]');s.value='';s.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 ok(await ev(`(()=>{const c=document.querySelector('#smdOpdEmr .oe-canvas');return c.scrollWidth<=c.clientWidth+1})()`),'all regimens (long names wrap): no sideways scroll');
 await ev(`(()=>{const s=document.querySelector('[data-oe-inp="proto-type"]');s.value='prostate_cancer';s.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await shot('oncology-390');
 await ev(`document.querySelector('[data-oe-act="proto-branch:all"]').click()`);
 ok(await until(`!document.querySelector('[data-oe-inp="proto-type"]')&&document.querySelectorAll('#oe-out-proto .oe-proto-row').length>${idx.count}`),'back to All restores both lists');

 // Reader inside the tab.
 await ev(`document.querySelector('[data-oe-act="proto-open:${sepsis.id}"]').click()`);
 ok(await until(`!!document.querySelector('#smdOpdEmr .kbp-embed .kbp-reader h1')`),'clinical protocol opens inside the OPD tab');
 const doc=JSON.parse(readFileSync(repo+`kb/clinical-protocols/${sepsis.id}.json`,'utf8'));
 ok(await ev(`document.querySelector('#smdOpdEmr .kbp-reader h1').textContent===${JSON.stringify(doc.title)}&&document.querySelectorAll('#smdOpdEmr .kbp-reader .kbp-sec:not(.kbp-drugs):not(.kbp-sources)').length===${doc.sections.length}`),'reader shows title and every section');
 ok(await ev(`/pending clinical review/i.test(document.querySelector('#smdOpdEmr .kbp-status').textContent)`),'reader states the draft review status');
 ok(await ev(`document.querySelector('#smdOpdEmr .oe-proto-back').matches('[aria-label^="Back"]')`),'Back control is recognisable to swipe-back');
 ok(await ev(`(()=>{const c=document.querySelector('#smdOpdEmr .oe-canvas');return c.scrollWidth<=c.clientWidth+1})()`),'reader: no horizontal overflow at 390px');
 await ev(`document.querySelector('#smdOpdEmr [data-kbp-jump="oeKbpSources"]').click()`);await sleep(700);
 ok(await ev(`document.querySelector('#smdOpdEmr .oe-canvas').scrollTop>0`),'section jump scrolls the OPD canvas');
 await shot('reader-390');
 await ev(`document.querySelector('#smdOpdEmr .oe-proto-back').click()`);
 ok(await until(`document.querySelectorAll('#oe-out-proto .oe-proto-row').length>${idx.count}`),'Back returns to the list');

 // Read-only: regimens still list (used to hang on "Loading the protocol library..."), rows say view only.
 await open(`window.__flagOff={smd_opd_emr_write:true};`,false);
 ok(await ev(`window.OPDEMR._state().writeOn===false`),'profile really is read-only');
 ok(await until(`document.querySelectorAll('#oe-out-proto .oe-proto-row.static').length>100`),'read-only mode lists regimens (no infinite loading)');
 ok(await ev(`!document.querySelector('#oe-out-proto [data-oe-act^="proto-assign:"]')&&document.querySelector('#oe-out-proto').textContent.includes('view only')`),'read-only rows are view only');

 // Oncology flag off: clinical protocols still available, no Oncology chip.
 await open(`window.__flagOff={smd_onco_protocols:true};`);
 ok(await until(`document.querySelectorAll('#oe-out-proto .oe-proto-row').length===${idx.count}`),'oncology off: clinical protocols still listed');
 ok(await ev(`!document.querySelector('[data-oe-act="proto-branch:oncology"]')`),'oncology off: no Oncology chip');

 // Both off: honest empty state.
 await open(`window.__flagOff={smd_onco_protocols:true};window.SMD_KBPROTO_FLAGS.set('smd_kb_protocols',false);`);
 ok(await until(`/Protocols are not enabled/.test(document.querySelector('#smdOpdEmr .oe-canvas').textContent)`),'both flags off: not-enabled message');
 await ev(`localStorage.removeItem('smd_kb_protocols');1`);
}catch(e){console.error(e);failures++;}
finally{try{ws?.close();}catch{}chrome.kill();server.kill();}
console.log(failures?`${failures} FAILURE(S)`:'ALL PASS');process.exit(failures?1:0);
