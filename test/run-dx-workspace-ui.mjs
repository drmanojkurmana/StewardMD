import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const base = 'http://localhost:9021/';
const server = spawn('node', [repo + 'test/serve.mjs', repo, '9021'], { stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9421', `--user-data-dir=/tmp/dx-workspace-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'], { stdio:'ignore' });
let ws, sid, id=0, failures=0; const pending=new Map();
const call=(method,params={})=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params,sessionId:sid}));});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(r.result.exceptionDetails.text);return r.result?.result?.value;};
const ok=(pass,label)=>{console.log(`${pass?'PASS':'FAIL'} ${label}`);if(!pass)failures++;};
async function shot(name){if(!process.env.DX_SHOTS)return;await sleep(300);await mkdir(process.env.DX_SHOTS,{recursive:true});const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(`${process.env.DX_SHOTS}/${name}.png`,Buffer.from(r.result.data,'base64'));}
try {
  let version;for(let i=0;i<60;i++){try{version=await(await fetch('http://localhost:9421/json/version')).json();break;}catch{await sleep(200);}}
  ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
  const created=await call('Target.createTarget',{url:'about:blank'});
  sid=(await call('Target.attachToTarget',{targetId:created.result.targetId,flatten:true})).result.sessionId;
  await call('Page.navigate',{url:base});
  for(let i=0;i<80;i++){if(await ev('!!window.DX'))break;await sleep(300);}
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());DX.openWorkspace();DX.reset();document.body.classList.remove('dark');document.activeElement?.blur();`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(350);
  ok(await ev(`!!document.querySelector('#dxIntake') && !!document.querySelector('#dxReview')`),'intake and review render');
  ok(await ev(`document.querySelector('#dxAdv').style.display==='none'`),'case tools start collapsed');
  const viewportFit=await ev(`({top:document.querySelector('#dxOverlay').getBoundingClientRect().top,bottom:document.querySelector('#dxOverlay').getBoundingClientRect().bottom,height:innerHeight,position:getComputedStyle(document.querySelector('#dxOverlay')).position})`);
  console.log('Dx viewport fit',viewportFit);
  ok(viewportFit.position==='fixed' && viewportFit.top>=-1 && Math.abs(viewportFit.bottom-viewportFit.height)<=1,'workspace ends at the visible viewport');
  ok(await ev(`innerHeight-document.querySelector('#dxAdvToggle').getBoundingClientRect().bottom <= 50`),'empty-case tools sit near the bottom edge');
  ok(await ev(`document.querySelector('.dx-body').scrollHeight <= document.querySelector('.dx-body').clientHeight+1`),'empty case has no phantom vertical scroll');
  await shot('dx-empty-mobile');
  await ev(`document.querySelector('#dxAdvToggle').click();document.querySelector('#dxFreeText').value='Synthetic note retained during review';DX.addFindings(['fever']);`);
  ok(await ev(`document.querySelector('#dxFreeText').value === 'Synthetic note retained during review'`),'adding findings preserves narrative draft');
  await ev(`document.querySelector('#dxAdvToggle').click()`);
  ok(await ev(`document.querySelector('#dxFindingCount').textContent === '1'`),'finding count updates');
  await ev(`DX.addFindings(['cough','dyspnea']);`);
  const beforeSkip=await ev(`JSON.stringify(DX._differential())`);
  await ev(`document.querySelector('#dxSkipQuestion').click()`);
  ok(beforeSkip===await ev(`JSON.stringify(DX._differential())`),'skipping a question does not change clinical ranking');
  ok(await ev(`document.querySelectorAll('#dxSuggest [data-confirm]').length===1`),'guided consult shows one question');
  await ev(`document.querySelector('.dx-body').scrollTop=0;window.scrollTo(0,0)`);
  await shot('dx-guided-question-mobile');
  ok(await ev(`document.querySelector('#dxSuggest').getBoundingClientRect().bottom <= innerHeight`),'guided question fits the phone viewport');
  ok(await ev(`document.querySelectorAll('#dxCols .dx-card').length > 0`),'differential renders from findings');
  const before=await ev(`JSON.stringify(DX._differential())`);
  await ev(`document.querySelector('[data-dx-jump="dxReview"]').click();`);
  await shot('dx-results-mobile');
  await ev(`document.querySelector('#dxCols .dx-row-head').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
  ok(await ev(`!!document.querySelector('#dxCols .dx-row-head[aria-expanded="true"]')`),'diagnosis opens with keyboard');
  ok(before===await ev(`JSON.stringify(DX._differential())`),'navigation and expansion leave ranking unchanged');
  await ev(`document.querySelector('#dxCols').scrollIntoView({block:'start'});`);
  await shot('dx-diagnosis-mobile');
  await ev(`document.querySelector('#dxCols .dx-cmp').click();`);
  ok(await ev(`DX._state.compare.length === 1`),'compare control selects diagnosis');
  await ev(`document.querySelector('[data-dx-jump="dxIntake"]').click();document.querySelector('#dxSel .dx-sel-chip').click();`);
  ok(await ev(`document.querySelector('#dxFindingCount').textContent === '2'`),'removing finding updates count');
  await ev(`const q=document.querySelector('#dxSearch');q.value='dysuria';q.dispatchEvent(new Event('input',{bubbles:true}));`);
  ok(await ev(`document.querySelector('#dxSearch').getAttribute('aria-expanded')==='true' && !!document.querySelector('#dxSearchDrop .dx-search-row')`),'search shows finding results');
  await ev(`document.querySelector('#dxSearchDrop .dx-search-row[data-f]').click();`);
  ok(await ev(`document.querySelector('#dxFindingCount').textContent === '3'`),'search result adds finding');
  for(const width of [320,390,1280]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<700});
    ok(await ev(`document.querySelector('.dx-body').scrollWidth <= document.querySelector('.dx-body').clientWidth`),`no overflow at ${width}px`);
    if(width===1280)await shot('dx-desktop');
  }
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await ev(`document.body.classList.add('dark');document.querySelector('[data-dx-jump="dxReview"]').click();`);
  await shot('dx-dark-mobile');
  ok(await ev(`document.querySelector('#dxIntake').hidden && !document.querySelector('#dxReview').hidden`),'review navigation switches panes');
  await ev(`document.querySelector('[data-dx-jump="dxIntake"]').click()`);
  const selectedCount=await ev(`Object.keys(DX._state.f).length`);
  await ev(`document.querySelector('#dxSuggest [data-confirm]').click()`);
  ok(await ev(`Object.keys(DX._state.f).length`)===selectedCount+1,'confirming guided finding adds exactly one finding');
  await ev(`DX.reset()`);
  ok(await ev(`DX._state.consultSkipped.length===0`),'reset clears skipped-question state');
  ok(await ev(`document.querySelector('#dxFindingCount').textContent==='0' && document.querySelector('#dxFreeText').value===''`),'reset clears findings and narrative');
  ok(await ev(`!document.querySelector('#dxOverlay').classList.contains('dx-has-case')`),'reset restores the full intake introduction');
  console.log(failures?`${failures} failures`:'All Dx workspace checks pass');
}catch(error){console.error(error);failures++;}
finally{ws?.close();chrome.kill();server.kill();process.exitCode=failures?1:0;}
