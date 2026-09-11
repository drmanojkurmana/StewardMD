import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repo=fileURLToPath(new URL('../',import.meta.url));
const base='http://localhost:9024/';
const server=spawn('node',[repo+'test/serve.mjs',repo,'9024'],{stdio:'ignore'});
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=9424',`--user-data-dir=/tmp/followcare-quiet-${process.pid}`,'--no-first-run','--disable-gpu'],{stdio:'ignore'});
let ws,sid,id=0,failures=0;const pending=new Map();
const call=(method,params={})=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params,sessionId:sid}));});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(r.result.exceptionDetails.text);return r.result?.result?.value;};
const ok=(pass,label)=>{console.log(`${pass?'PASS':'FAIL'} ${label}`);if(!pass)failures++;};
async function shot(name){if(!process.env.FC_SHOTS)return;await sleep(200);await mkdir(process.env.FC_SHOTS,{recursive:true});const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(`${process.env.FC_SHOTS}/${name}.png`,Buffer.from(r.result.data,'base64'));}

try{
  let version;for(let i=0;i<60;i++){try{version=await(await fetch('http://localhost:9424/json/version')).json();break;}catch{await sleep(200);}}
  ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);
  ws.onmessage=event=>{const message=JSON.parse(event.data);if(pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}};
  const created=await call('Target.createTarget',{url:'about:blank'});
  sid=(await call('Target.attachToTarget',{targetId:created.result.targetId,flatten:true})).result.sessionId;
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await call('Page.navigate',{url:base});
  for(let i=0;i<80;i++){if(await ev('!!window.FollowCare && !!window.FollowCareAnalytics'))break;await sleep(250);}
  await ev(`
    ['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(id=>document.getElementById(id)?.remove());
    localStorage.setItem('smd_followcare','1');localStorage.setItem('smd_followcare_ui2','1');
    const now=Date.now();
    FollowCare._api.ready=()=>Promise.resolve({body:{ready:true}});
    FollowCare._api.episodes=()=>Promise.resolve({status:200,body:{episodes:[
      {episodeId:'ep-red',disease:'Heart failure recovery',status:'active',escalation:'red',needsReview:true,score:42,nextDueMs:now-3600000,riskPercent:31,dischargeMs:now-172800000},
      {episodeId:'ep-watch',disease:'Pneumonia recovery',status:'active',escalation:'orange',needsReview:true,score:68,nextDueMs:now+7200000,riskPercent:18,dischargeMs:now-86400000},
      {episodeId:'ep-good',disease:'Post-operative recovery',status:'active',escalation:'green',needsReview:false,score:88,nextDueMs:now+86400000,dischargeMs:now-259200000}
    ]}});
    FollowCare._api.voiceSettingsGet=()=>Promise.resolve({body:{settings:{voice:{enabled:true}}}});
    document.body.classList.add('dark');FollowCare.open();
  `);
  for(let i=0;i<40;i++){if(await ev(`!!document.querySelector('.fc-dashboard .fc-row')`))break;await sleep(150);}
  await sleep(350);
  ok(await ev(`document.querySelector('.fc-hd-title b')?.textContent==='FollowCare'`),'FollowCare heading is clear');
  ok(await ev(`document.body.classList.contains('fc-lock') && getComputedStyle(document.querySelector('.fc-ov')).overflow==='hidden' && getComputedStyle(document.querySelector('.fc-bd')).overflowY==='auto'`),'FollowCare stays pinned while its content scrolls');
  ok(await ev(`document.querySelector('.fc-x').getBoundingClientRect().right<=innerWidth && document.querySelector('.fc-x').getBoundingClientRect().left>=0`),'close control stays inside the phone viewport');
  ok(await ev(`document.querySelector('.fc-q-intro h2')?.textContent==='Your patients at a glance.'`),'quiet recovery overview renders');
  ok(await ev(`document.querySelectorAll('.fc-q-metrics .fc-cc').length===4`),'recovery metrics remain available');
  ok(await ev(`document.querySelectorAll('.fc-dashboard .fc-row').length===3 && [...document.querySelectorAll('.fc-dashboard .fc-row')].every(row=>row.tagName==='BUTTON')`),'patient rows are accessible actions');
  const sheetFit=await ev(`({height:document.querySelector('.fc-sheet').getBoundingClientRect().height,viewport:innerHeight,top:document.querySelector('.fc-sheet').getBoundingClientRect().top,bottom:document.querySelector('.fc-sheet').getBoundingClientRect().bottom})`);
  console.log('FollowCare viewport fit',sheetFit);
  ok(Math.abs(sheetFit.height-sheetFit.viewport)<=1 && sheetFit.top>=-1 && Math.abs(sheetFit.bottom-sheetFit.viewport)<=1,'FollowCare fits the phone viewport');
  ok(await ev(`document.querySelector('.fc-bd').scrollWidth<=document.querySelector('.fc-bd').clientWidth`),'FollowCare has no horizontal overflow');
  await shot('followcare-quiet-mobile');
  await ev(`document.querySelector('.fc-maitri-btn').click()`);
  for(let i=0;i<40;i++){if(await ev(`!!document.querySelector('.fc-maitri .mai-wordmark')`))break;await sleep(150);}
  await sleep(250);
  ok(await ev(`document.querySelector('.fc-hd-title b')?.textContent==='MAiTRI'`),'MAiTRI heading replaces the parent title');
  ok(await ev(`document.querySelector('.fc-x').getBoundingClientRect().right<=innerWidth && document.querySelector('.fc-x').getBoundingClientRect().left>=0`),'MAiTRI keeps close control visible');
  ok(await ev(`document.querySelector('.mai-logo')?.naturalWidth>0`),'existing MAiTRI logo loads');
  ok(await ev(`document.querySelector('.mai-wordmark')?.naturalWidth>0 && document.querySelector('.mai-wordmark').alt.includes('Medical Adaptive Intelligence')`),'official full-form wordmark remains visible');
  ok(await ev(`document.querySelector('.fc-maitri-status')?.textContent.includes('Voice calling ON')`),'voice status remains explicit');
  ok(await ev(`document.querySelectorAll('.fc-maitri .fc-row').length===2`),'MAiTRI keeps the attention queue');
  ok(await ev(`document.querySelector('.fc-bd').scrollWidth<=document.querySelector('.fc-bd').clientWidth`),'MAiTRI has no horizontal overflow');
  await shot('maitri-quiet-mobile');
  await call('Emulation.setDeviceMetricsOverride',{width:320,height:720,deviceScaleFactor:1,mobile:true});
  ok(await ev(`document.querySelector('.fc-bd').scrollWidth<=document.querySelector('.fc-bd').clientWidth`),'MAiTRI fits at 320px');
  await ev(`document.querySelector('.fc-maitri-back').click()`);await sleep(250);
  ok(await ev(`!!document.querySelector('.fc-dashboard') && document.querySelector('.fc-hd-title b')?.textContent==='FollowCare'`),'back returns to FollowCare');
  await ev(`document.querySelector('.fc-x').click()`);
  ok(await ev(`!document.body.classList.contains('fc-lock') && !document.querySelector('.fc-ov')`),'closing FollowCare restores the app shell');
  console.log(failures?`${failures} failures`:'All FollowCare Quiet Intelligence checks pass');
}catch(error){console.error(error);failures++;}
finally{ws?.close();chrome.kill();server.kill();process.exitCode=failures?1:0;}
