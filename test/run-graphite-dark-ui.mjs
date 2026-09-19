import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const server=spawn('node',[repo+'test/serve.mjs',repo,'9040'],{stdio:'ignore'});
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=9440',`--user-data-dir=/tmp/graphite-chrome-${process.pid}`,'--no-first-run','--disable-gpu'],{stdio:'ignore'});
let ws,sid,id=0,failures=0;const pending=new Map();
const call=(method,params={})=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params,sessionId:sid}));});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
const ok=(pass,label)=>{console.log(`${pass?'PASS':'FAIL'} ${label}`);if(!pass)failures++;};
async function shot(name){await sleep(250);await mkdir('/tmp/stewardmd-graphite',{recursive:true});const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(`/tmp/stewardmd-graphite/${name}.png`,Buffer.from(r.result.data,'base64'));}
try{
 let version;for(let i=0;i<60;i++){try{version=await(await fetch('http://localhost:9440/json/version')).json();break;}catch{await sleep(200);}}
 ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
 const created=await call('Target.createTarget',{url:'about:blank'});sid=(await call('Target.attachToTarget',{targetId:created.result.targetId,flatten:true})).result.sessionId;await call('Page.navigate',{url:'http://localhost:9040/'});
 for(let i=0;i<100;i++){if(await ev('!!window.DX && !!window.SB && !!window.SMD_openSettings'))break;await sleep(250);}
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());document.documentElement.removeAttribute('data-theme');document.body.classList.remove('dark','v3-dark');window.SMD_setUI?.(true)`);
 const light=await ev(`getComputedStyle(document.body).getPropertyValue('--paper').trim()`);
 await ev(`document.body.classList.add('dark','v3-dark')`);
 const palette=JSON.parse(await ev(`JSON.stringify(Object.fromEntries(['--paper','--panel','--ink','--line','--v3-bg','--v3-panel','--rds-bg','--rds-surface'].map(k=>[k,getComputedStyle(document.body).getPropertyValue(k).trim()])))`));
 console.log('Resolved palette:',palette);
 ok(light.toLowerCase()!=='#000000','light appearance is unchanged');
 ok(palette['--paper']==='#000000'&&palette['--panel']==='#0c0c0e','shared surfaces use Graphite');
 ok(palette['--v3-bg']==='#000000'&&palette['--v3-panel']==='#0c0c0e','home system uses Graphite');
 ok(palette['--rds-bg']==='#000000'&&palette['--rds-surface']==='#0c0c0e','module design system uses Graphite');
 const themes=JSON.parse(await ev(`JSON.stringify(['blue','ocean','tiranga','amber','slate','contrast'].map(t=>{document.documentElement.dataset.theme=t;const s=getComputedStyle(document.body);return [s.getPropertyValue('--paper').trim(),s.getPropertyValue('--panel').trim()]}))`));
 ok(themes.every(x=>x[0]==='#000000'&&x[1]==='#0c0c0e'),'Graphite remains consistent across accent preferences');
 await ev(`document.documentElement.removeAttribute('data-theme')`);
 const status=JSON.parse(await ev(`JSON.stringify(['--red','--orange','--yellow','--green'].map(k=>getComputedStyle(document.body).getPropertyValue(k).trim()))`));
 ok(JSON.stringify(status)===JSON.stringify(['#e85070','#f07040','#f0c060','#4dd68c']),'clinical status colors are preserved');
 const contrast=await ev(`(()=>{const lum=h=>{const v=h.match(/[a-f0-9]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4));return .2126*v[0]+.7152*v[1]+.0722*v[2]};const a=lum('f4f4f5'),b=lum('000000');return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})()`);
 ok(contrast>=7,`primary text contrast is ${contrast.toFixed(1)}:1`);
 await ev(`window.SMD_setUI?.(true);document.querySelectorAll('#homeV2,[data-home]').forEach(e=>e.style.removeProperty('display'));window.scrollTo(0,0)`);await shot('graphite-home');
 await ev(`window.SMD_openSettings()`);await sleep(100);
 ok(await ev(`getComputedStyle(document.querySelector('.sbr-set-ov')).backgroundColor==='rgb(0, 0, 0)'`),'settings screen uses Graphite');await shot('graphite-settings');
 await ev(`document.querySelector('.sbr-set-ov')?.remove();SB.openRef('syndromes')`);await sleep(100);
 ok(await ev(`getComputedStyle(document.querySelector('.kblib-tiles .kblib-f')).backgroundColor==='rgb(12, 12, 14)'`),'Knowledge Library inherits Graphite');await shot('graphite-library');
 await ev(`SB.closeRef();DX.openWorkspace()`);await sleep(100);
 ok(await ev(`getComputedStyle(document.querySelector('#dxOverlay')).backgroundColor==='rgb(0, 0, 0)'`),'clinical reasoning inherits Graphite');await shot('graphite-reasoning');
 await ev(`DX.close();const s=document.createElement('div');s.id='sknxRoot';document.body.appendChild(s)`);
 ok(await ev(`getComputedStyle(document.querySelector('#sknxRoot')).getPropertyValue('--sknx-bg').trim()==='#000000'`),'SKNX module tokens use Graphite');
 const localModules=JSON.parse(await ev(`(()=>{document.documentElement.classList.add('abx-ui');const specs=[['ece','--bg'],['cs-ov','--bg'],['smdonb-card','backgroundColor'],['smdea-card','backgroundColor'],['smdv-sheet','--panel']];const out=specs.map(([c,p])=>{const e=document.createElement('div');e.className=c;document.body.appendChild(e);const s=getComputedStyle(e);return p==='backgroundColor'?s.backgroundColor:s.getPropertyValue(p).trim()});const a=document.createElement('div');a.id='abxWizard';document.body.appendChild(a);out.push(getComputedStyle(a).getPropertyValue('--w-paper').trim());return JSON.stringify(out)})()`));
 ok(JSON.stringify(localModules)===JSON.stringify(['#000000','#000000','rgb(12, 12, 14)','rgb(12, 12, 14)','#0c0c0e','#000000']),'smaller module sheets use Graphite');
 await ev(`window.SMD_askMaik('')`);await sleep(100);
 const maik=await ev(`getComputedStyle(document.querySelector('#maikSheet')).getPropertyValue('--mk-bg').trim()`);
 ok(maik==='#000000','MaiK uses Graphite');
 await ev(`const e=document.createElement('div');e.className='icu-modal';document.body.appendChild(e)`);
 ok(await ev(`getComputedStyle(document.querySelector('.icu-modal')).getPropertyValue('--bg').trim()==='#000000'`),'ICU independent surfaces use black');
 await ev(`document.body.classList.remove('dark','v3-dark');document.documentElement.removeAttribute('data-theme')`);
 ok(await ev(`getComputedStyle(document.body).getPropertyValue('--paper').trim()` )===light,'switching back restores the original light palette');
 console.log(failures?`${failures} failures`:'All Graphite checks pass');
}catch(e){console.error(e);failures++;}finally{ws?.close();chrome.kill();server.kill();process.exitCode=failures?1:0;}
