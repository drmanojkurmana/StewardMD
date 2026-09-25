// Real-browser test of the Knowledge Library Protocols tab against the full app (index.html).
//   node test/run-kb-protocols-ui.mjs      (CHROME=/path/to/chrome to override the browser)
// Screenshots: /tmp/stewardmd-protocols/
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const CHROME=process.env.CHROME||['/opt/pw-browsers/chromium-1194/chrome-linux/chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>existsSync(p));
const server=spawn('node',[repo+'test/serve.mjs',repo,'9041'],{stdio:'ignore'});
const chrome=spawn(CHROME,['--headless=new','--no-sandbox','--remote-debugging-port=9441',`--user-data-dir=/tmp/kbproto-chrome-${process.pid}`,'--no-first-run','--disable-gpu'],{stdio:'ignore'});
let ws,sid,id=0,failures=0;const pending=new Map();
const call=(method,params={})=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params,sessionId:sid}));});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
const ok=(pass,label)=>{console.log(`${pass?'PASS':'FAIL'} ${label}`);if(!pass)failures++;};
const until=async(expr,ms=8000)=>{for(let t=0;t<ms;t+=100){if(await ev(expr))return true;await sleep(100);}return false;};
async function shot(name){await sleep(250);await mkdir('/tmp/stewardmd-protocols',{recursive:true});const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(`/tmp/stewardmd-protocols/${name}.png`,Buffer.from(r.result.data,'base64'));}
const size=(width,height=844)=>call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});
try{
 let version;for(let i=0;i<60;i++){try{version=await(await fetch('http://localhost:9441/json/version')).json();break;}catch{await sleep(200);}}
 ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
 const created=await call('Target.createTarget',{url:'about:blank'});sid=(await call('Target.attachToTarget',{targetId:created.result.targetId,flatten:true})).result.sessionId;
 await size(390);
 await call('Page.navigate',{url:'http://localhost:9041/'});
 ok(await until('!!(window.SB&&SB.__smdKbProtoWrapped&&SB.__smdKbWrapped&&window.SMD_KBPROTO)',25000),'Protocols module wraps SB.openRef alongside the library');
 await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());document.body.classList.remove('dark');document.activeElement?.blur()`);
 // The app zooms <html> from Display settings (home.js applyD), so scrollWidth is in zoomed CSS px
 // while innerWidth is not: compare each box against its OWN clientWidth, and the visual edge in viewport px.
 await ev(`window.noOverflow=()=>{const o=document.querySelector('#sbrefOverlay'),b=document.querySelector('#sbrefBody');return o.scrollWidth<=o.clientWidth+1&&b.scrollWidth<=b.clientWidth+1&&o.getBoundingClientRect().right<=innerWidth+0.5}`);
 const idx=await (await fetch('http://localhost:9041/kb/clinical-protocols/index.json')).json();

 // 1. The fifth tab appears on every original tab (app.js renders four).
 for(const tab of ['syndromes','antibiogram','aware','guidelines']){
  await ev(`SB.openRef('${tab}')`);await sleep(150);
  ok(await ev(`document.querySelectorAll('#sbrefBody .sbref-tabs [data-kbp-tab]').length===1`),`Protocols tab present on ${tab}`);
 }
 await ev(`SB.abgOrg&&SB.abgOrg(Object.keys((window.ASP_ABG&&ASP_ABG.national&&ASP_ABG.national.org)||{})[1]||'')`);await sleep(150);
 ok(await ev(`document.querySelectorAll('#sbrefBody .sbref-tabs [data-kbp-tab]').length===1`),'Protocols tab survives an antibiogram organism re-render');

 // 2. Open from the tab button.
 await ev(`document.querySelector('#sbrefBody [data-kbp-tab]').click()`);
 ok(await until(`document.querySelectorAll('#kbpList .kbp-row').length===${idx.count}`),`list renders all ${idx.count} protocols`);
 ok(await ev(`document.querySelector('#sbrefBody').classList.contains('kblib-tool-protocols')&&document.querySelector('.kblib-tool-intro h1').textContent==='Protocols'`),'uses the Knowledge Library tool-page hierarchy');
 ok(await ev(`document.querySelector('#sbrefTitle').textContent==='Knowledge Library'`),'bar title matches the other tool tabs');
 ok(await ev(`document.querySelector('.sbref-tab.active').textContent.trim()==='Protocols'&&document.querySelectorAll('.sbref-tabs .sbref-tab').length===5`),'five tabs, Protocols active');
 ok(await ev(`document.querySelectorAll('.kbp-group-h').length===${idx.subjects.length}`),'browsing groups by subject');
 ok(await ev(`!!document.querySelector('.kbp-status')`)===idx.protocols.some(p=>p.status==='ai_drafted'),'draft notice shown exactly when drafts exist');
 ok(await ev(`getComputedStyle(document.querySelector('#sbrefOverlay')).overflow==='hidden'&&getComputedStyle(document.querySelector('#sbrefBody')).overflowY==='auto'`),'pinned shell, only content scrolls');
 await shot('list-390');

 // 3. Search + subject filter.
 const first=idx.protocols[0];
 await ev(`(()=>{const q=document.querySelector('#kbpQ');q.value=${JSON.stringify(first.title.split(' ')[0])};q.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 ok(await ev(`[...document.querySelectorAll('#kbpList .kbp-row')].some(r=>r.dataset.kbpOpen===${JSON.stringify(first.id)})&&document.querySelectorAll('#kbpList .kbp-row').length<=${idx.count}`),'search finds a protocol by title word');
 ok(await ev(`document.querySelector('#kbpCount').textContent.startsWith('Showing')`),'search reports a count');
 await ev(`(()=>{const q=document.querySelector('#kbpQ');q.value='zzzzqqq';q.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 ok(await ev(`document.querySelector('#kbpList').textContent.includes('No protocol matches')`),'empty search has clear feedback');
 await ev(`(()=>{const q=document.querySelector('#kbpQ');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 const subj=idx.subjects[idx.subjects.length-1];
 await ev(`document.querySelector('[data-kbp-subject="${subj.key}"]').click()`);
 ok(await ev(`document.querySelectorAll('#kbpList .kbp-row').length===${subj.count}&&document.querySelector('[data-kbp-subject="${subj.key}"]').getAttribute('aria-pressed')==='true'`),`subject filter narrows to ${subj.label}`);
 await ev(`document.querySelector('[data-kbp-subject="all"]').click()`);

 // 3b. Guideline basis: International / India segmented control, pills, subject counts follow it.
 const india=idx.bases.find(b=>b.key==='india');
 ok(await ev(`[...document.querySelectorAll('[data-kbp-basis]')].map(b=>b.dataset.kbpBasis).join(',')`)==='all,international,india','basis control: All guidelines, International, India');
 ok(await ev(`[...document.querySelectorAll('.kbp-seg')].every(b=>b.scrollWidth<=b.clientWidth+1)&&getComputedStyle(document.querySelector('.kbp-basis')).display==='flex'`),'basis control is styled and no label is cut off');
 await ev(`document.querySelector('[data-kbp-basis="india"]').click()`);
 ok(await until(`document.querySelectorAll('#kbpList .kbp-row').length===${india.count}`),`India shows its ${india.count} protocols`);
 ok(await ev(`[...document.querySelectorAll('#kbpList .kbp-row')].every(r=>r.querySelector('.kbp-basis-pill.kbp-b-india'))`),'every India row carries the India pill');
 ok(await ev(`[...document.querySelectorAll('[data-kbp-subject]:not([data-kbp-subject="all"]) small')].reduce((n,x)=>n+ +x.textContent,0)===${india.count}`),'subject chip counts follow the basis');
 await shot('basis-india-390');
 await ev(`document.querySelector('[data-kbp-basis="all"]').click()`);
 ok(await until(`document.querySelectorAll('#kbpList .kbp-row').length===${idx.count}`),'All guidelines restores the full list');

 // 4. Reader.
 const sepsis=idx.protocols.find(p=>p.id==='sepsis-septic-shock')||first;
 await ev(`document.querySelector('#sbrefBody').scrollTop=400`);
 const listScroll=await ev(`document.querySelector('#sbrefBody').scrollTop`);
 await ev(`document.querySelector('[data-kbp-open="${sepsis.id}"]').click()`);
 ok(await until(`!!document.querySelector('.kbp-reader h1')`),'protocol opens in the reader');
 const body=await (await fetch(`http://localhost:9041/kb/clinical-protocols/${sepsis.id}.json`)).json();
 ok(await ev(`document.querySelector('.kbp-reader h1').textContent===${JSON.stringify(body.title)}`),'reader shows the protocol title');
 ok(await ev(`document.querySelectorAll('.kbp-reader .kbp-sec:not(.kbp-drugs):not(.kbp-sources)').length===${body.sections.length}`),'every section renders');
 ok(await ev(`document.querySelectorAll('.kbp-drug').length===${(body.drugs||[]).length}`),'every drug row renders');
 ok(await ev(`document.querySelectorAll('.kbp-sources a[target="_blank"][rel="noopener"]').length===${body.sources.length}`),'sources link out safely');
 ok(await ev(`/pending clinical review/i.test(document.querySelector('.kbp-reader .kbp-status').textContent)`)===(body.review.status==='ai_drafted'),'reader states the review status');
 ok(await ev(`document.querySelector('#sbrefBody').scrollTop===0`),'reader starts at the top');
 ok(await ev(`!/[\\u2013\\u2014]/.test(document.querySelector('#sbrefBody').innerText)`),'no em or en dash on screen');
 await shot('reader-390');
 await ev(`document.querySelector('[data-kbp-jump="kbpSources"]').click()`);await sleep(600);
 ok(await ev(`document.querySelector('#sbrefBody').scrollTop>0`),'section jump scrolls to the section');
 for(const w of [320,375,390,430,768,1280]){await size(w);await sleep(120);ok(await ev(`noOverflow()`),`reader: no horizontal overflow at ${w}px`);}
 await size(390);

 // 4b. A protocol with a counterpart links the other guideline version.
 const pair=idx.protocols.find(p=>p.counterpart);
 if(pair){
  const other=idx.protocols.find(p=>p.id===pair.counterpart);
  await ev(`SB.openRef('protocols')`);await until(`document.querySelectorAll('#kbpList .kbp-row').length>0`);
  await ev(`document.querySelector('[data-kbp-open="${pair.id}"]').click()`);
  ok(await until(`!!document.querySelector('.kbp-twin')`),`${pair.id} shows the link to its other version`);
  await ev(`document.querySelector('.kbp-twin').click()`);
  ok(await until(`document.querySelector('.kbp-reader h1')&&document.querySelector('.kbp-reader h1').textContent===${JSON.stringify(other.title)}`),'the link opens the other guideline version');
  ok(await ev(`!!document.querySelector('.kbp-meta.kbp-b-${other.basis}')`),'the reader names its guideline basis');
  await ev(`SB.openRef('protocols')`);await until(`document.querySelectorAll('#kbpList .kbp-row').length>0`);
  await ev(`document.querySelector('[data-kbp-open="${sepsis.id}"]').click()`);await until(`!!document.querySelector('.kbp-reader h1')`);
 } else console.log('SKIP counterpart link (no paired protocols in the catalogue yet)');

 // 5. Back returns to the list where the user left it (and is the control swipe-back would click).
 ok(await ev(`document.querySelector('.kbp-back').matches('[aria-label^="Back"]')`),'reader back is a Back control for swipe-back');
 await ev(`document.querySelector('.kbp-back').click()`);
 ok(await until(`document.querySelectorAll('#kbpList .kbp-row').length===${idx.count}`),'back returns to the list');
 ok(Math.abs(await ev(`document.querySelector('#sbrefBody').scrollTop`)-listScroll)<=2,'list scroll position restored');

 // 6. Tabs row fits at every width (a rail below 380px).
 for(const w of [320,360,390,430,768]){await size(w);await sleep(120);ok(await ev(`(()=>{const t=document.querySelector('.sbref-tabs');return noOverflow()&&t.getBoundingClientRect().right<=innerWidth+0.5&&[...t.children].every(b=>b.scrollWidth<=b.clientWidth+1&&Math.abs(b.getBoundingClientRect().top-t.children[0].getBoundingClientRect().top)<1)&&(innerWidth<375||t.scrollWidth<=t.clientWidth+1)})()`),`tabs: one row, no clipped label${w>=375?', all five visible':''} at ${w}px`);}
 await size(320);await shot('list-320');await size(390);

 // 7. Switching back to another tab from Protocols works.
 await ev(`document.querySelector('[data-kbp-go="guidelines"]').click()`);await sleep(200);
 ok(await ev(`document.querySelector('#sbrefBody').classList.contains('kblib-tool-guidelines')&&document.querySelectorAll('#sbrefBody .sbref-gl').length>20`),'Guidelines tab still opens from Protocols');

 // 7b. A protocol that finishes loading after the user switched tabs must not paint over that tab.
 await ev(`SB.openRef('protocols')`);
 ok(await until(`document.querySelectorAll('#kbpList .kbp-row').length>0`),'protocols reopen from SB.openRef');
 await ev(`document.querySelector('#kbpList .kbp-row').click();SB.openRef('aware')`);await sleep(800);
 ok(await ev(`document.querySelector('#sbrefBody').classList.contains('kblib-tool-aware')&&!document.querySelector('.kbp-reader')`),'late protocol load does not replace the tab the user switched to');

 // 8. Deep link opens a protocol directly; dark mode renders.
 await ev(`document.body.classList.add('dark');SB.closeRef();SMD_KBPROTO.open({id:${JSON.stringify(sepsis.id)}})`);
 ok(await until(`!!document.querySelector('.kbp-reader h1')&&document.querySelector('#sbrefOverlay').classList.contains('open')`),'SMD_KBPROTO.open({id}) opens the reader');
 await shot('reader-dark');
 await ev(`SB.closeRef()`);
 ok(await ev(`!document.querySelector('#sbrefOverlay').classList.contains('open')&&document.body.style.overflow===''`),'closing releases the page');

 // 8b. Universal Search (search.js) lists protocols and opens the reader.
 await ev(`document.body.classList.remove('dark');openSearch()`);
 ok(await until(`!!document.getElementById('usInput')`),'universal search opens');
 await ev(`(()=>{const i=document.getElementById('usInput');i.value='septic shock';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 ok(await until(`!!document.querySelector('#usBody .us-row[data-cat="proto"]')`),'universal search lists a Protocols result');
 await ev(`document.querySelector('#usBody .us-row[data-cat="proto"]').click()`);
 ok(await until(`!!document.querySelector('.kbp-reader h1')&&document.querySelector('#sbrefOverlay').classList.contains('open')`),'a Protocols search result opens the reader');
 await ev(`SB.closeRef()`);

 // 9. Kill switch hides the tab.
 await ev(`localStorage.setItem('smd_kb_protocols','0');document.body.classList.remove('dark');SB.openRef('guidelines')`);await sleep(150);
 ok(await ev(`!document.querySelector('#sbrefBody [data-kbp-tab]')`),'flag off: no Protocols tab');
 await ev(`localStorage.removeItem('smd_kb_protocols');SB.closeRef()`);
}catch(e){console.error(e);failures++;}
finally{try{ws?.close();}catch{}chrome.kill();server.kill();}
console.log(failures?`${failures} FAILURE(S)`:'ALL PASS');process.exit(failures?1:0);
