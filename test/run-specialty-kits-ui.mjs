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
const server=spawn('node',[repo+'test/serve.mjs',repo,'9071'],{stdio:'ignore'});
const chrome=spawn(CHROME,['--headless=new','--no-sandbox','--remote-debugging-port=9471',`--user-data-dir=/tmp/kits-chrome-${process.pid}`,'--no-first-run','--disable-gpu'],{stdio:'ignore'});
let ws,sid,id=0,failures=0;const pending=new Map();
const call=(method,params={})=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params,sessionId:sid}));});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
const ok=(pass,label)=>{console.log(`${pass?'PASS':'FAIL'} ${label}`);if(!pass)failures++;};
const until=async(expr,ms=10000)=>{for(let t=0;t<ms;t+=100){if(await ev(expr))return true;await sleep(100);}return false;};
async function shot(name){await sleep(250);await mkdir('/tmp/stewardmd-kits',{recursive:true});const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(`/tmp/stewardmd-kits/${name}.png`,Buffer.from(r.result.data,'base64'));}
const BUNDLE=JSON.parse(readFileSync(repo+'kb/specialty-kits/kits.json','utf8'));
// Set a kit input the way a user does: value + input event (dates/selects/numbers alike).
const setF=(scope,name,val,root)=>ev(`(()=>{const el=document.querySelector('${root} [data-kit-f="${scope}:${name}"]');if(!el)return false;if(el.type==='checkbox')el.checked=!!${JSON.stringify(val)};else el.value=${JSON.stringify(val)};el.dispatchEvent(new Event(el.tagName==='SELECT'||el.type==='checkbox'?'change':'input',{bubbles:true}));return true})()`);
const click=(sel)=>ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
// The app wraps window.toast after load (haptics), so the recorder is re-armed right before an action.
const armToasts=()=>ev(`window.__toasts=[];if(!window.toast||!window.toast.__rec){const t0=window.toast;const f=function(m){window.__toasts.push(String(m));try{return t0&&t0.apply(this,arguments)}catch(e){}};f.__rec=1;window.toast=f;}1`);
const vals=()=>ev(`JSON.stringify(OPDEMR._state().assessVals)`).then(JSON.parse);
// Visual stacking: the element actually on top at the screen centre.
const topIs=(sel)=>ev(`(()=>{const e=document.elementFromPoint(innerWidth/2,innerHeight/2);return !!(e&&e.closest(${JSON.stringify(sel)}))})()`);
const noSideScroll=(sel)=>ev(`(()=>{const c=document.querySelector(${JSON.stringify(sel)});return !!c&&c.scrollWidth<=c.clientWidth+1})()`);
try{
 let version;for(let i=0;i<60;i++){try{version=await(await fetch('http://localhost:9471/json/version')).json();break;}catch{await sleep(200);}}
 ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
 const created=await call('Target.createTarget',{url:'about:blank'});sid=(await call('Target.attachToTarget',{targetId:created.result.targetId,flatten:true})).result.sessionId;
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await call('Page.navigate',{url:'http://localhost:9071/'});
 ok(await until('!!(window.SMD_KITS&&window.SMD_KITS_FLAGS&&window.OPDEMR&&window.MEDCALC&&window.SMD_KBPROTO&&window.SB)',25000),'app loaded with the kit engine, OPD EMR, calculators and the Knowledge Library');
 await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());document.body.classList.remove('dark');document.activeElement?.blur();
   1`);
 ok(await ev(`SMD_KITS.KITS_V===${JSON.stringify(BUNDLE.version)}`),'the loaded engine carries the current bundle version');

 /* ---------------- Home tile + standalone sheet ---------------- */
 ok(await until(`!!document.querySelector('#rnavToolsGrid .rnav-tile[data-act="speckit"]')`,8000),'Home shows the Specialty Kits tile by default');
 await click('#rnavToolsGrid .rnav-tile[data-act="speckit"]');
 ok(await until(`document.querySelector('#smdKit.on .kit-chips')&&document.querySelectorAll('#smdKit .kit-chip').length===${BUNDLE.kits.length}`),`tile opens the kit sheet with all ${BUNDLE.kits.length} kits`);
 ok(await ev(`document.documentElement.classList.contains('kit-lock')&&getComputedStyle(document.querySelector('#smdKit')).zIndex==='880'`),'sheet is a full-screen layer and lifts the linked overlays');
 ok(await ev(`[...document.querySelectorAll('#smdKit .kit-add')].every(b=>/Copy/.test(b.textContent))`),'standalone: every add action is Copy');
 ok(await ev(`!document.querySelector('#smdKit [data-kit-act^="inv:"]')&&!document.querySelector('#smdKit [data-kit-tool="immunisation"]')`),'standalone: no OPD-only investigation or immunisation shortcuts');
 await shot('sheet-obgyn-390');

 // Pregnancy dating computes in place and keeps focus while typing.
 await setF('dating','lmp','2026-01-01','#smdKit'); await setF('dating','asOf','2026-03-12','#smdKit');
 ok(await until(`/8 Oct 2026/.test(document.querySelector('#smdKit [data-kit-out="pregnancy-dating"]').textContent)&&/10\\+0 weeks/.test(document.querySelector('#smdKit [data-kit-out="pregnancy-dating"]').textContent)`),'dating tool shows EDD 8 Oct 2026 and 10+0 weeks');
 await setF('dating','usgDate','2026-03-12','#smdKit'); await setF('dating','usgWeeks','11','#smdKit'); await setF('dating','usgDays','2','#smdKit');
 ok(await until(`/redate to the ultrasound EDD/.test(document.querySelector('#smdKit [data-kit-out="pregnancy-dating"]').textContent)`),'a 9-day LMP and scan difference at 11 weeks redates (ACOG)');
 ok(await ev(`!!document.querySelector('#smdKit [data-kit-f="dating:usgDays"]')`),'inputs survive the in-place update (no repaint)');
 await armToasts();
 await click('#smdKit [data-kit-act="tool:pregnancy-dating"]');
 ok(await until(`window.__toasts.some(t=>/^Copied to the clipboard\.$|^Could not copy\. Pregnancy dating: /.test(t))`),'Copy reports what happened (copied, or the text itself)');

 // Protocol and calculator shortcuts open ABOVE the sheet, and closing them returns to it.
 const proto=BUNDLE.kits[0].protocols[0];
 await click(`#smdKit [data-kit-act="proto:${proto}"]`);
 ok(await until(`document.querySelector('#sbrefOverlay')?.classList.contains('open')&&!!document.querySelector('#sbrefBody .kbp-hero, #sbrefBody .kbp-back')`),`protocol shortcut opens "${proto}" in the Knowledge Library`);
 ok(await topIs('#sbrefOverlay'),'the Knowledge Library is on top of the kit sheet');
 await ev(`SB.closeRef?SB.closeRef():document.querySelector('#sbrefOverlay').classList.remove('open')`);
 ok(await until(`!document.querySelector('#sbrefOverlay').classList.contains('open')`)&&await topIs('#smdKit'),'closing it returns to the kit sheet');
 const calc=BUNDLE.kits[0].calculators[0];
 await click(`#smdKit [data-kit-act="calc:${calc}"]`);
 ok(await until(`document.querySelector('.mc-overlay.on')`)&&await topIs('.mc-overlay'),`calculator shortcut opens "${calc}" on top of the sheet`);
 await ev(`MEDCALC.close()`);
 ok(await topIs('#smdKit'),'closing the calculator returns to the kit sheet');

 // Paediatrics: WHO growth loads lazily and computes.
 await click('#smdKit [data-kit-act="kit:paediatrics"]');
 ok(await until(`/Paediatrics/.test(document.querySelector('#smdKit .kit-head h2').textContent)`),'kit chip switches to Paediatrics');
 await setF('growth','sex','Female','#smdKit'); await setF('growth','dob','2023-01-01','#smdKit'); await setF('growth','asOf','2025-09-25','#smdKit');
 await setF('growth','weight','11','#smdKit'); await setF('growth','lenhei','88','#smdKit'); await setF('growth','measured','Standing (height)','#smdKit');
 ok(await until(`document.querySelectorAll('#smdKit [data-kit-out="growth-who"] tbody tr').length>=4`,15000),'WHO growth tables load on first use and give four indicators');
 ok(await ev(`/Weight-for-age/.test(document.querySelector('#smdKit [data-kit-out="growth-who"]').textContent)&&/2 y 8 m/.test(document.querySelector('#smdKit [data-kit-out="growth-who"]').textContent)`),'growth output names the indicator and the age');
 await shot('sheet-paeds-growth-390');
 await click('#smdKit [data-kit-act="mine:paediatrics"]');
 ok(await until(`SMD_KITS.mySpecialty()==='paediatrics'&&!!document.querySelector('#smdKit .kit-mine')`),'"Set as my specialty" is saved and shown');
 await click('#smdKit [data-kit-act="close"]');
 ok(await until(`!document.querySelector('#smdKit').classList.contains('on')&&!document.documentElement.classList.contains('kit-lock')&&document.body.style.overflow===''`),'close removes the sheet, the stacking lift and the scroll lock');

 /* ---------------- OPD EMR Specialty tab ---------------- */
 const openOpd=async(wait='tab:kit')=>{await ev(`OPDEMR.close&&OPDEMR.close();OPDEMR.openProfile({patientId:'MR-KIT-1',name:'Kit Patient',sex:'Female',noStore:true});1`);return until(`!!document.querySelector('#smdOpdEmr.on [data-oe-act="${wait}"]')`);};
 ok(await openOpd(),'OPD EMR shows a Specialty tab');
 ok(await ev(`(()=>{const t=[...document.querySelectorAll('#smdOpdEmr .oe-tab')].map(b=>b.dataset.oeAct);return t[t.indexOf('tab:assess')+1]==='tab:kit'})()`),'Specialty sits right after Assessment');
 await click('#smdOpdEmr [data-oe-act="tab:kit"]');
 ok(await until(`!!document.querySelector('#smdOpdEmr .kit[data-kit-host="opd"]')`),'Specialty tab renders the kit with the OPD host');
 ok(await ev(`(()=>{const t=document.querySelector('#smdOpdEmr .oe-tabs'),on=t.querySelector('.oe-tab.on');const a=t.getBoundingClientRect(),b=on.getBoundingClientRect();return on.dataset.oeAct==='tab:kit'&&b.left>=a.left-1&&b.right<=a.right+1})()`),'the active Specialty tab stays in view in the tab strip');
 ok(await ev(`document.querySelector('#smdOpdEmr .kit-chip.on').dataset.kitAct==='kit:paediatrics'`),'"my specialty" is the default kit in the consult');
 ok(await ev(`[...document.querySelectorAll('#smdOpdEmr .kit-add')].every(b=>!b.disabled)`),'write mode with the assessment loaded: every Add is enabled');
 ok(await ev(`!!document.querySelector('#smdOpdEmr [data-kit-act="tool:growth-who"]')&&/Add to Nutrition$/.test(document.querySelector('#smdOpdEmr [data-kit-act="tool:growth-who"]').textContent)&&/Add to Systemic examination$/.test(document.querySelector('#smdOpdEmr [data-kit-act="sec:danger-signs"]').textContent)`),'Add buttons name the form\'s own field labels');
 ok(await ev(`document.querySelector('#smdOpdEmr [data-kit-f="growth:sex"]').value==='Female'`),'growth sex comes from the patient record');

 // Growth -> Add fills Nutrition + weight/height, in the assessment state and on the Assessment tab.
 await setF('growth','dob','2023-01-01','#smdOpdEmr'); await setF('growth','asOf','2025-09-25','#smdOpdEmr');
 await setF('growth','weight','11','#smdOpdEmr'); await setF('growth','lenhei','88','#smdOpdEmr'); await setF('growth','measured','Standing (height)','#smdOpdEmr');
 await until(`document.querySelectorAll('#smdOpdEmr [data-kit-out="growth-who"] tbody tr').length>=4`);
 await armToasts();
 await click('#smdOpdEmr [data-kit-act="tool:growth-who"]');
 let v=await vals();
 ok(/^Growth \(WHO Child Growth Standards/.test(v.Nutrtion||'')&&v.Weight==='11'&&v.Height==='88','growth Add writes Nutrition and fills Weight and Height');
 ok(await ev(`window.__toasts.some(t=>/^Added to Nutrition and 2 more fields/.test(t))`),'toast says where the text went');
 ok(await ev(`document.querySelector('#smdOpdEmr .kit[data-kit-host="opd"]')&&!!document.querySelector('#smdOpdEmr [data-kit-f="growth:weight"]')&&document.querySelector('#smdOpdEmr [data-kit-f="growth:weight"]').value==='11'`),'the kit keeps its values across the repaint');

 // Section with a red-flag alert: ticking shows the alert in place; Add composes only what was filled.
 await setF('f','ds_vomit',true,'#smdOpdEmr');
 ok(await ev(`!document.querySelector('#smdOpdEmr [data-kit-alert="danger-signs"]').hidden`),'ticking a danger sign shows the WHO IMCI alert without a repaint');
 await click('#smdOpdEmr [data-kit-act="sec:danger-signs"]');
 v=await vals();
 ok(/General danger signs \(WHO IMCI, 2 months to 5 years\): Vomits everything\./.test(v.sys_examination||''),'section text lands in Systemic examination');
 await setF('f','hydration_status','Some dehydration','#smdOpdEmr');
 await click('#smdOpdEmr [data-kit-act="sec:paediatric-examination"]');
 v=await vals();
 ok(v.hydration==='Some dehydration'&&/\nPaediatric examination: Hydration: Some dehydration\./.test(v.sys_examination),'a second section appends on a new line and fills Hydration');

 // Milestones: pick a checkpoint, tick, Add.
 await setF('milestones','age','12','#smdOpdEmr');
 await until(`!!document.querySelector('#smdOpdEmr [data-kit-f^="milestones:done:12:"]')`);
 await ev(`(()=>{const c=document.querySelector('#smdOpdEmr [data-kit-f^="milestones:done:12:"]');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
 await click('#smdOpdEmr [data-kit-act="tool:milestones"]');
 v=await vals();
 ok(/Developmental milestones \(1 year checkpoint, CDC 2022\): achieved 1 of \d+; not yet: /.test(v.History_past_illness||''),'milestones summary lands in Past history');

 // The Assessment tab shows what the kit added (saved by the normal Save path).
 await click('#smdOpdEmr [data-oe-act="tab:assess"]');
 ok(await until(`[...document.querySelectorAll('#smdOpdEmr textarea, #smdOpdEmr input')].some(el=>/Vomits everything/.test(el.value))`),'Assessment tab shows the added findings');
 await click('#smdOpdEmr [data-oe-act="tab:kit"]');
 await until(`!!document.querySelector('#smdOpdEmr .kit')`);

 // Shortcuts: investigation search, immunisation tab, protocol reader.
 await click('#smdOpdEmr [data-kit-act="inv:0"]');
 ok(await until(`OPDEMR._state().tab==='inv'&&document.querySelector('#smdOpdEmr .oe-tab.on').getBoundingClientRect().left>=0&&OPDEMR._state().invQuery===${JSON.stringify(BUNDLE.kits.find(k=>k.id==='paediatrics').investigations[0].query)}`),'investigation shortcut opens the search with the test filled in');
 await click('#smdOpdEmr [data-oe-act="tab:kit"]'); await until(`!!document.querySelector('#smdOpdEmr .kit')`);
 await click('#smdOpdEmr [data-kit-act="imm"]');
 ok(await until(`OPDEMR._state().tab==='immun'`),'immunisation tool opens the Immunisation tab');
 await click('#smdOpdEmr [data-oe-act="tab:kit"]'); await until(`!!document.querySelector('#smdOpdEmr .kit')`);
 await click('#smdOpdEmr [data-kit-act="proto:fever-in-under-5s"]');
 ok(await until(`OPDEMR._state().tab==='protocol'&&!!document.querySelector('#smdOpdEmr .kbp-embed')`),'protocol shortcut opens the reader in the Protocol tab');
 await click('#smdOpdEmr [data-oe-act="tab:kit"]'); await until(`!!document.querySelector('#smdOpdEmr .kit')`);
 await click('#smdOpdEmr [data-kit-act="calc:paeds_weight"]');
 ok(await until(`document.querySelector('.mc-overlay.on')`)&&await topIs('.mc-overlay'),'calculator shortcut opens above the OPD EMR');
 await ev(`MEDCALC.close()`);
 ok(await topIs('#smdOpdEmr'),'closing it returns to the consult');

 // O&G in the consult: dating Add fills LMP; a section with set fields fills children alive.
 await click('#smdOpdEmr [data-kit-act="kit:obgyn"]');
 await until(`/Obstetrics/.test(document.querySelector('#smdOpdEmr .kit-head h2').textContent)`);
 ok(await ev(`localStorage.getItem(OPDEMR._specialtyKey(OPDEMR._state().author))==='obgyn'`),'picking the O&G kit selects the O&G MaiK Scribe template');
 await setF('dating','lmp','2026-01-01','#smdOpdEmr'); await setF('dating','asOf','2026-03-12','#smdOpdEmr');
 await click('#smdOpdEmr [data-kit-act="tool:pregnancy-dating"]');
 await setF('f','gravida','2','#smdOpdEmr'); await setF('f','living','1','#smdOpdEmr');
 await click('#smdOpdEmr [data-kit-act="sec:obstetric-history"]');
 v=await vals();
 ok(/Pregnancy dating: LMP 1 Jan 2026; EDD 8 Oct 2026 \(by LMP\)/.test(v.History_present_illness||'')&&v.LMP==='1 Jan 2026','dating Add writes Present history and LMP');
 ok(/Obstetric history: Gravida: 2; Living children: 1\./.test(v.Others||'')&&v.children_living==='1','obstetric history lands in Menstrual - others and fills Children alive');
 ok(await ev(`OPDEMR._state().assessTouched.LMP===true`),'kit writes count as the doctor\'s own edits (the scribe will not overwrite them)');

 // Every kit renders at 390px with no sideways scroll; tap targets are at least 40px high.
 for(const k of BUNDLE.kits){
  await click(`#smdOpdEmr [data-kit-act="kit:${k.id}"]`);
  ok(await until(`document.querySelector('#smdOpdEmr .kit-chip.on')?.dataset.kitAct==='kit:${k.id}'`),`${k.id}: selected`);
  ok(await noSideScroll('#smdOpdEmr .oe-canvas'),`${k.id}: no sideways scroll at 390px`);
  ok(await ev(`[...document.querySelectorAll('#smdOpdEmr .kit-add, #smdOpdEmr .kit-chip, #smdOpdEmr .kit-pill, #smdOpdEmr .kit-inp')].every(b=>parseFloat(getComputedStyle(b).height)>=39.5)`),`${k.id}: tap targets at least 40 CSS px`);
  ok(!/[–—]/.test(await ev(`document.querySelector('#smdOpdEmr .kit').innerText`)),`${k.id}: no em or en dash on screen`);
  await ev(`document.querySelector('#smdOpdEmr .oe-canvas').scrollTop=0`);
  await shot(`opd-${k.id}-390`);
 }

 // Specialty tools in the other kits compute in place.
 if(BUNDLE.kits.some(k=>k.id==='ophthalmology')){
  await click('#smdOpdEmr [data-kit-act="kit:ophthalmology"]');await until(`!!document.querySelector('#smdOpdEmr [data-kit-f="vision:re"]')`);
  await setF('vision','re','6/60','#smdOpdEmr');await setF('vision','le','6/9','#smdOpdEmr');await setF('vision','reIop','26','#smdOpdEmr');
  ok(await until(`/No visual impairment/.test(document.querySelector('#smdOpdEmr [data-kit-out="visual-acuity"]').textContent)&&/above 21 mmHg/.test(document.querySelector('#smdOpdEmr [data-kit-out="visual-acuity"]').textContent)`),'visual acuity: WHO category from the better eye, raised IOP flagged');
 }
 if(BUNDLE.kits.some(k=>k.id==='ent')){
  await click('#smdOpdEmr [data-kit-act="kit:ent"]');await until(`!!document.querySelector('#smdOpdEmr [data-kit-f="hearing:weber"]')`);
  await setF('hearing','weber','Right','#smdOpdEmr');await setF('hearing','rinneR','Negative','#smdOpdEmr');await setF('hearing','rinneL','Positive','#smdOpdEmr');
  ok(await until(`/Conductive hearing loss in the right ear/.test(document.querySelector('#smdOpdEmr [data-kit-out="hearing"]').textContent)`),'hearing: tuning forks interpreted');
 }
 if(BUNDLE.kits.some(k=>(k.tools||[]).includes('pasi'))){
  const kid=BUNDLE.kits.find(k=>(k.tools||[]).includes('pasi')).id;
  await click(`#smdOpdEmr [data-kit-act="kit:${kid}"]`);await until(`!!document.querySelector('#smdOpdEmr [data-kit-f="pasi:trunk_a"]')`);
  await setF('pasi','trunk_a','20','#smdOpdEmr');await setF('pasi','trunk_e','2','#smdOpdEmr');await setF('pasi','trunk_i','1','#smdOpdEmr');await setF('pasi','trunk_d','1','#smdOpdEmr');
  ok(await until(`/PASI 2\\.4 of 72/.test(document.querySelector('#smdOpdEmr [data-kit-out="pasi"]').textContent)`),'PASI computes');
 }
 if(BUNDLE.kits.some(k=>(k.tools||[]).includes('odontogram'))){
  const kid=BUNDLE.kits.find(k=>(k.tools||[]).includes('odontogram')).id;
  await click(`#smdOpdEmr [data-kit-act="kit:${kid}"]`);await until(`!!document.querySelector('#smdOpdEmr [data-kit-act="tooth:16"]')`);
  await click('#smdOpdEmr [data-kit-act="tooth:16"]');
  ok(await until(`/DMFT 1 \\(D 1/.test(document.querySelector('#smdOpdEmr [data-kit-out="odontogram"]').textContent)`),'odontogram: tapping a tooth marks it decayed and updates DMFT');
  ok(await noSideScroll('#smdOpdEmr .oe-canvas'),'dental chart fits 390px');
  await shot('opd-dental-chart-390');
 }

 // Read-only consult (a GHIS consult without the write flag has writeOn false): the kit explains,
 // Add is disabled, and nothing is written.
 ok(await openOpd(),'consult reopened');
 await ev(`OPDEMR._state().writeOn=false;1`);
 await click('#smdOpdEmr [data-oe-act="tab:kit"]');
 ok(await until(`!!document.querySelector('#smdOpdEmr .kit')&&/write mode/.test(document.querySelector('#smdOpdEmr .kit').textContent)`),'read-only: the kit says it needs write mode');
 ok(await ev(`[...document.querySelectorAll('#smdOpdEmr .kit-add:not([data-kit-act="imm"])')].every(b=>b.disabled)`),'read-only: every Add is disabled');
 const before=JSON.stringify(await vals());
 await ev(`(()=>{const b=document.querySelector('#smdOpdEmr [data-kit-act^="sec:"]');b.disabled=false;b.click();return 1})()`);
 ok(JSON.stringify(await vals())===before,'read-only: a forced click writes nothing');

 // Flag off: no Specialty tab, no Home tile.
 await ev(`SMD_KITS_FLAGS.set('smd_specialty_kits',false);1`);
 await openOpd('tab:profile');
 ok(await ev(`!document.querySelector('#smdOpdEmr [data-oe-act="tab:kit"]')`),'flag off: no Specialty tab');
 await ev(`OPDEMR.close();SMD_KITS.open();1`);
 ok(await ev(`!document.querySelector('#smdKit.on')`),'flag off: the kit sheet does not open');
 await ev(`OPDEMR.close();localStorage.removeItem('smd_specialty_kits');localStorage.removeItem('smd_my_specialty');1`);
}catch(e){console.error(e);failures++;}
finally{try{ws&&ws.close()}catch{}chrome.kill();server.kill();}
console.log(failures?`\n${failures} FAILED`:'\nALL PASS');process.exit(failures?1:0);
