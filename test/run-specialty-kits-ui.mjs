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
// Pick a kit the way a user does: from the chip row, or from the All kits picker when it is not there.
const pickKit=async(root,kid)=>{if(!await ev(`!!document.querySelector('${root} .kit-chips [data-kit-act="kit:${kid}"]')`)){await click(`${root} [data-kit-act="picker"]`);await until(`!!document.querySelector('${root} [data-kit-picker] [data-kit-act="kit:${kid}"]')`);}await click(`${root} [data-kit-act="kit:${kid}"]`);return until(`document.querySelector('${root} .kit-chip.on')?.dataset.kitAct==='kit:${kid}'`);};
const outText=(root,tool)=>ev(`(document.querySelector('${root} [data-kit-out="${tool}"]')||{}).textContent||''`);
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
 ok(await until(`document.querySelector('#smdKit.on .kit-chips')&&document.querySelectorAll('#smdKit .kit-chip:not(.kit-all)').length<=5&&/All ${BUNDLE.kits.length} kits/.test(document.querySelector('#smdKit .kit-all').textContent)`),`tile opens the kit sheet: a short chip row and "All ${BUNDLE.kits.length} kits"`);
 await click('#smdKit [data-kit-act="picker"]');
 ok(await until(`document.querySelectorAll('#smdKit [data-kit-picker] .kit-pgroup').length===${BUNDLE.groups.length}&&document.querySelectorAll('#smdKit [data-kit-picker] [data-kit-act^="kit:"]').length===${BUNDLE.kits.length}`),`the picker lists all ${BUNDLE.kits.length} kits in ${BUNDLE.groups.length} groups`);
 await ev(`(()=>{const el=document.querySelector('#smdKit [data-kit-f="picker:q"]');el.focus();el.value='burn';el.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
 ok(await until(`(()=>{const b=[...document.querySelectorAll('#smdKit [data-kit-picker] [data-kit-act^="kit:"]')];return b.length>=1&&b.length<${BUNDLE.kits.length}&&document.activeElement&&document.activeElement.id==='kit_picker_q'})()`),'picker search filters as you type and keeps focus');
 await setF('picker','q','','#smdKit');
 await click('#smdKit [data-kit-act="picker"]');
 ok(await until(`!document.querySelector('#smdKit [data-kit-picker]')`),'tapping All kits again closes the picker');
 ok(await ev(`document.documentElement.classList.contains('kit-lock')&&getComputedStyle(document.querySelector('#smdKit')).zIndex==='880'`),'sheet is a full-screen layer and lifts the linked overlays');
 ok(await ev(`[...document.querySelectorAll('#smdKit .kit-add:not([data-kit-act="lcgadd"])')].every(b=>/Copy/.test(b.textContent))`),'standalone: every add action is Copy');
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
 ok(await pickKit('#smdKit','paediatrics')&&await until(`/Paediatrics/.test(document.querySelector('#smdKit .kit-head h2').textContent)`),'kit chip switches to Paediatrics');
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
 await pickKit('#smdOpdEmr','obgyn');
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
  ok(await pickKit('#smdOpdEmr',k.id),`${k.id}: selected`);
  ok(await noSideScroll('#smdOpdEmr .oe-canvas'),`${k.id}: no sideways scroll at 390px`);
  ok(await ev(`[...document.querySelectorAll('#smdOpdEmr .kit-add, #smdOpdEmr .kit-chip, #smdOpdEmr .kit-pill, #smdOpdEmr .kit-inp')].every(b=>parseFloat(getComputedStyle(b).height)>=39.5)`),`${k.id}: tap targets at least 40 CSS px`);
  ok(!/[–—]/.test(await ev(`document.querySelector('#smdOpdEmr .kit').innerText`)),`${k.id}: no em or en dash on screen`);
  await ev(`document.querySelector('#smdOpdEmr .oe-canvas').scrollTop=0`);
  await shot(`opd-${k.id}-390`);
 }

 // Specialty tools in the other kits compute in place.
 if(BUNDLE.kits.some(k=>k.id==='ophthalmology')){
  await pickKit('#smdOpdEmr','ophthalmology');await until(`!!document.querySelector('#smdOpdEmr [data-kit-f="vision:re"]')`);
  await setF('vision','re','6/60','#smdOpdEmr');await setF('vision','le','6/9','#smdOpdEmr');await setF('vision','reIop','26','#smdOpdEmr');
  ok(await until(`/No visual impairment/.test(document.querySelector('#smdOpdEmr [data-kit-out="visual-acuity"]').textContent)&&/above 21 mmHg/.test(document.querySelector('#smdOpdEmr [data-kit-out="visual-acuity"]').textContent)`),'visual acuity: WHO category from the better eye, raised IOP flagged');
 }
 if(BUNDLE.kits.some(k=>k.id==='ent')){
  await pickKit('#smdOpdEmr','ent');await until(`!!document.querySelector('#smdOpdEmr [data-kit-f="hearing:weber"]')`);
  await setF('hearing','weber','Right','#smdOpdEmr');await setF('hearing','rinneR','Negative','#smdOpdEmr');await setF('hearing','rinneL','Positive','#smdOpdEmr');
  ok(await until(`/Conductive hearing loss in the right ear/.test(document.querySelector('#smdOpdEmr [data-kit-out="hearing"]').textContent)`),'hearing: tuning forks interpreted');
 }
 if(BUNDLE.kits.some(k=>(k.tools||[]).includes('pasi'))){
  const kid=BUNDLE.kits.find(k=>(k.tools||[]).includes('pasi')).id;
  await pickKit('#smdOpdEmr',kid);await until(`!!document.querySelector('#smdOpdEmr [data-kit-f="pasi:trunk_a"]')`);
  await setF('pasi','trunk_a','20','#smdOpdEmr');await setF('pasi','trunk_e','2','#smdOpdEmr');await setF('pasi','trunk_i','1','#smdOpdEmr');await setF('pasi','trunk_d','1','#smdOpdEmr');
  ok(await until(`/PASI 2\\.4 of 72/.test(document.querySelector('#smdOpdEmr [data-kit-out="pasi"]').textContent)`),'PASI computes');
 }
 if(BUNDLE.kits.some(k=>(k.tools||[]).includes('odontogram'))){
  const kid=BUNDLE.kits.find(k=>(k.tools||[]).includes('odontogram')).id;
  await pickKit('#smdOpdEmr',kid);await until(`!!document.querySelector('#smdOpdEmr [data-kit-act="tooth:16"]')`);
  await click('#smdOpdEmr [data-kit-act="tooth:16"]');
  ok(await until(`/DMFT 1 \\(D 1/.test(document.querySelector('#smdOpdEmr [data-kit-out="odontogram"]').textContent)`),'odontogram: tapping a tooth marks it decayed and updates DMFT');
  ok(await noSideScroll('#smdOpdEmr .oe-canvas'),'dental chart fits 390px');
  await shot('opd-dental-chart-390');
 }

 /* ---------------- wave 1 tools, order sets, notifiable reminder, documents, review desk ---------------- */
 const R='#smdOpdEmr';
 // Local anaesthetic: 80 kg lidocaine plain is capped at the 200 mg ceiling and counted at 70 kg.
 await pickKit(R,'anaesthesia'); await until(`!!document.querySelector('${R} [data-kit-f="la:drug"]')`);
 await setF('la','weight','80',R); await setF('la','drug','Lidocaine (lignocaine)',R);
 await until(`!!document.querySelector('${R} [data-kit-f="la:strength"] option[value="1%"]')`);
 await setF('la','adr','Plain',R); await setF('la','strength','1%',R);
 ok(await until(`/200 mg/.test((document.querySelector('${R} [data-kit-out="la-dose"]')||{}).textContent||'')&&/20 mL/.test(document.querySelector('${R} [data-kit-out="la-dose"]').textContent)&&/70 kg/.test(document.querySelector('${R} [data-kit-out="la-dose"]').textContent)`),'LA dose: 200 mg ceiling, 20 mL of 1%, worked out for 70 kg');
 // Burns: adult anterior trunk all burnt = 13%; Parkland 4 x 70 x 13 = 3640 mL.
 await pickKit(R,'emergency'); await until(`!!document.querySelector('${R} [data-kit-f="burns:age"]')`);
 await setF('burns','age','Adult',R); await until(`!!document.querySelector('${R} [data-kit-f="burns:r_ant-trunk"]')`);
 await setF('burns','weight','70',R); await setF('burns','r_ant-trunk','All',R);
 ok(await until(`/13% TBSA/.test(document.querySelector('${R} [data-kit-out="burns-chart"]').textContent)&&/3640/.test(document.querySelector('${R} [data-kit-out="burns-chart"]').textContent.replace(/,/g,''))`),'burns: 13% TBSA and the Parkland volume');
 // Order set: queues its tests on the Investigations tab; nothing is ordered.
 const os=BUNDLE.kits.find(k=>k.id==='emergency').orderSets[0];
 await armToasts(); await click(`${R} [data-kit-act="oset:${os.id}"]`);
 ok(await until(`OPDEMR._state().tab==='inv'&&${JSON.stringify(os.tests)}.every(t=>(OPDEMR._state().dictatedInv||[]).includes(t))`),`order set "${os.label}" queues its ${os.tests.length} tests on the Investigations tab`);
 ok(await ev(`window.__toasts.some(t=>/tests queued from/.test(t))&&/Queued in this consultation/.test(document.querySelector('${R}').textContent)`),'the toast and the queued shelf say what happened');
 await click(`${R} [data-oe-act="tab:kit"]`); await until(`!!document.querySelector('${R} .kit')`);
 // CKD grid: creatinine 1.2, 60-year-old man, ACR 100 mg/g -> G2 A2 by CKD-EPI 2021.
 await pickKit(R,'nephrology-urology'); await until(`!!document.querySelector('${R} [data-kit-f="ckd:scr"]')`);
 await setF('ckd','scr','1.2',R); await setF('ckd','age','60',R); await setF('ckd','sex','Male',R); await setF('ckd','acr','100',R); await setF('ckd','acrUnit','mg/g',R);
 ok(await until(`/G2 A2/.test(document.querySelector('${R} [data-kit-out="ckd-grid"]').textContent)&&/CKD-EPI 2021/.test(document.querySelector('${R} [data-kit-out="ckd-grid"]').textContent)&&!!document.querySelector('${R} [data-kit-out="ckd-grid"] .kit-here')`),'CKD grid: G2 A2 from creatinine, marked on the heat map');
 // Joint chart: tap cycles tender -> swollen -> both.
 await pickKit(R,'rheumatology'); await until(`!!document.querySelector('${R} [data-kit-act="joint:R:wrist"]')`);
 await click(`${R} [data-kit-act="joint:R:wrist"]`); await click(`${R} [data-kit-act="joint:R:wrist"]`); await click(`${R} [data-kit-act="joint:R:wrist"]`);
 await setF('joints','esr','30',R); await setF('joints','ptga','50',R);
 ok(await until(`/Tender 1, swollen 1 of 28/.test(document.querySelector('${R} [data-kit-out="joint-chart"]').textContent)&&/DAS28/.test(document.querySelector('${R} [data-kit-out="joint-chart"]').textContent)`),'joint chart: three taps mark a joint tender and swollen; DAS28 computes');
 ok(await noSideScroll(`${R} .oe-canvas`),'joint chart fits 390px');
 // Forensic: body chart region + MCCD warning on a mode of dying.
 await pickKit(R,'forensic'); await until(`!!document.querySelector('${R} [data-kit-act="bodyreg:f-chest-l"]')`);
 await ev(`document.querySelector('${R} [data-kit-act="bodyreg:f-chest-l"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));1`);
 ok(await until(`/Left chest/.test(document.querySelector('${R} [data-kit-tool="body-chart"]').textContent)&&!!document.querySelector('${R} [data-kit-f="body:inj:0:type"]')`),'body chart: tapping a region adds an injury for it');
 if(await ev(`!!document.querySelector('${R} [data-kit-f="mccd:c0"]')`)){
  await setF('mccd','c0','Cardiac arrest',R);
  ok(await until(`/mode of dying/.test(document.querySelector('${R} [data-kit-out="mccd"]').textContent)`),'MCCD: a mode of dying as the only cause is flagged');
 }
 await shot('opd-forensic-tools-390');
 // Labour Care Guide: a time point with FHR 170 shows as an alert.
 await pickKit(R,'obgyn'); await until(`!!document.querySelector('${R} [data-kit-act="lcgadd"]')`);
 await click(`${R} [data-kit-act="lcgadd"]`); await until(`!!document.querySelector('${R} [data-kit-f="lcg:e:0:fhr"]')`);
 await setF('lcg','e:0:fhr','170',R);
 ok(await until(`!!document.querySelector('${R} [data-kit-out="labour-care"] .kit-alertcell')&&/170/.test(document.querySelector('${R} [data-kit-out="labour-care"] .kit-alertcell').textContent)`),'Labour Care Guide: FHR 170 is highlighted as an alert value');
 ok(await noSideScroll(`${R} .oe-canvas`),'Labour Care Guide fits 390px');
 await shot('opd-lcg-390');
 // Notifiable reminder on the Assessment tab when the provisional diagnosis names a notifiable disease.
 await click(`${R} [data-oe-act="tab:assess"]`);
 ok(await until(`!!document.querySelector('${R} [data-oe-inp="assess:provisional_diagnosis"]')`),'assessment has a provisional diagnosis field');
 await ev(`(()=>{const el=document.querySelector('${R} [data-oe-inp="assess:provisional_diagnosis"]');el.focus();el.value='Dengue fever with warning signs';el.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
 ok(await until(`/Notifiable disease: .*Dengue/i.test((document.querySelector('#oeNotif')||{}).textContent||'')`),'notifiable reminder appears for dengue as you type');
 ok(await ev(`document.activeElement&&document.activeElement.getAttribute('data-oe-inp')==='assess:provisional_diagnosis'`),'typing keeps focus in the diagnosis field');
 await click(`${R} [data-oe-act="tab:kit"]`); await until(`!!document.querySelector('${R} .kit')`);
 // Documents from the consult: above the OPD EMR, prefilled with the patient.
 await pickKit(R,'forensic');
 await click(`${R} [data-kit-act="docs"]`);
 ok(await until(`document.querySelector('#smdDocs.on')`)&&await topIs('#smdDocs'),'documents open above the consult');
 await click('#smdDocs [data-dl-act="type:leave"]');
 ok(await until(`(document.querySelector('#smdDocs [data-dl-f="name"], #smdDocs #dl_name')||{}).value==='Kit Patient'`),'leave certificate is prefilled with the patient name');
 await click('#smdDocs [data-dl-act="preview"]');
 ok(await until(`!!document.querySelector('#smdDocs iframe.dl-frame')&&/Medical leave certificate/.test(document.querySelector('#smdDocs iframe.dl-frame').srcdoc)`),'the preview shows the certificate');
 ok(!/[–—]/.test(await ev(`document.querySelector('#smdDocs').innerText`)),'documents: no em or en dash on screen');
 await shot('docs-leave-390');
 // Consent form in Telugu and a handout in Hindi: the preview is in that script and says it is machine-drafted.
 await click('#smdDocs [data-dl-act="back"]'); await click('#smdDocs [data-dl-act="type:consent"]');
 await until(`!!document.querySelector('#smdDocs [data-dl-act="lang:te"]')`);
 await click('#smdDocs [data-dl-act="lang:te"]'); await click('#smdDocs [data-dl-act="consent:caesarean-section"]');
 ok(await until(`/native-speaker check of the Telugu/.test(document.querySelector('#smdDocs').textContent)`),'a Telugu consent form says its translation needs a native-speaker check');
 ok(await ev(`(()=>{const el=document.querySelector('#smdDocs [data-dl-f="risks"], #smdDocs #dl_risks');if(!el)return false;el.value='Placenta accreta risk discussed';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true})()`),'consent form has a box for procedure-specific risks');
 await click('#smdDocs [data-dl-act="preview"]');
 ok(await until(`/[\u0C00-\u0C7F]{4}/.test((document.querySelector('#smdDocs iframe.dl-frame')||{}).srcdoc||'')&&/Kit Patient/.test(document.querySelector('#smdDocs iframe.dl-frame').srcdoc)`),'consent preview is in Telugu with the patient named');
 ok(await until(`/\u0C08 \u0C2A\u0C4D\u0C30\u0C15\u0C4D\u0C30\u0C3F\u0C2F\u0C15\u0C41 \u0C38\u0C02\u0C2C\u0C02\u0C27\u0C3F\u0C02\u0C1A\u0C3F \u0C35\u0C3F\u0C35\u0C30\u0C3F\u0C02\u0C1A\u0C3F\u0C28 \u0C07\u0C24\u0C30 \u0C2A\u0C4D\u0C30\u0C2E\u0C3E\u0C26\u0C3E\u0C32\u0C41/.test(document.querySelector('#smdDocs iframe.dl-frame').srcdoc)&&/Placenta accreta risk discussed/.test(document.querySelector('#smdDocs iframe.dl-frame').srcdoc)`),'the risks entered print under a Telugu heading in the consent preview');
 await click('#smdDocs [data-dl-act="back"]'); await click('#smdDocs [data-dl-act="type:handout"]');
 await until(`!!document.querySelector('#smdDocs [data-dl-act="lang:hi"]')`);
 await click('#smdDocs [data-dl-act="lang:hi"]');
 await until(`!!document.querySelector('#smdDocs [data-dl-adv]')`);
 ok(await ev(`document.querySelector('#smdDocs [data-dl-adv]').getAttribute('data-dl-adv').startsWith('forensic/')`),'the kit the documents came from lists its advice first');
 await ev(`(()=>{const c=document.querySelector('#smdDocs [data-dl-adv]');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
 await ev(`(()=>{const el=document.querySelector('#smdDocs [data-dl-q]');el.focus();el.value='xyzzy';el.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
 ok(await until(`document.querySelectorAll('#smdDocs [data-dl-adv]').length===1&&document.activeElement===document.querySelector('#smdDocs [data-dl-q]')`),'advice search filters, keeps the ticked item and keeps focus');
 await click('#smdDocs [data-dl-act="preview"]');
 ok(await until(`/[\u0900-\u097F]{4}/.test((document.querySelector('#smdDocs iframe.dl-frame')||{}).srcdoc||'')`),'handout preview is in Hindi');
 ok(await ev(`!document.querySelector('#smdDocs [data-dl-adv]').parentElement.textContent.includes('(English)')`),'the advice text has a Hindi translation (no English fallback marker)');
 await shot('docs-handout-hi-390');
 await click('#smdDocs [data-dl-act="close"]');
 ok(await until(`!document.querySelector('#smdDocs.on')`)&&await topIs('#smdOpdEmr'),'closing documents returns to the consult');
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

 // Review desk: off Home by default; opens, lists protocols, saves a decision on the phone, exports it.
 await ev(`OPDEMR.close();1`);
 ok(await ev(`!document.querySelector('#rnavToolsGrid .rnav-tile[data-act="review"]')`),'Review content is not on Home by default');
 await ev(`localStorage.removeItem('smd_review_decisions');SMD_REVIEW.open();1`);
 ok(await until(`document.querySelectorAll('#smdReview.on .rv-row').length>=200`,15000),'review desk lists the protocols');
 await click('#smdReview [data-rv-act="kind:kit"]');
 ok(await until(`document.querySelectorAll('#smdReview .rv-row').length===${BUNDLE.kits.length}`),'and the specialty kits');
 await click('#smdReview [data-rv-act="sel:obgyn"]');
 await until(`!!document.querySelector('#rv_dec')`);
 await ev(`document.getElementById('rv_dec').value='changes';document.getElementById('rv_comment').value='Section 2: add the FOGSI anaemia cut-off';document.getElementById('rv_name').value='Dr Test Reviewer';1`);
 await armToasts(); await click('#smdReview [data-rv-act="save"]');
 ok(await until(`JSON.parse(localStorage.getItem('smd_review_decisions')||'{}')['kit:obgyn']?.decision==='changes'&&/You asked for changes/.test(document.querySelector('#smdReview').textContent)`),'a decision is saved on the phone and shown in the list');
 ok(await ev(`!document.querySelector('#smdReview [data-rv-act="export"]').disabled&&/Export 1 decision/.test(document.querySelector('#smdReview [data-rv-act="export"]').textContent)`),'export is enabled with the count');
 await click('#smdReview [data-rv-act="sel:obgyn"]'); await until(`!!document.querySelector('#smdReview [data-rv-act="read"]')`);
 await click('#smdReview [data-rv-act="read"]');
 ok(await until(`document.querySelector('#smdKit.on')`)&&await topIs('#smdKit'),'Read it opens the kit above the review desk');
 await click('#smdKit [data-kit-act="close"]');
 ok(await topIs('#smdReview'),'closing the kit returns to the review desk');
 ok(!/[–—]/.test(await ev(`document.querySelector('#smdReview').innerText`)),'review desk: no em or en dash on screen');
 await shot('review-desk-390');
 await click('#smdReview [data-rv-act="close"]');
 await ev(`localStorage.removeItem('smd_review_decisions');1`);

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
