// Real-browser test (QA sheet SMD-01/02): MaiK header controls are raised glass; streamed answers paint
// without flicker (unchanged blocks kept, caret inline, no shrinking, only new blocks fade), code rain dims.
//   node test/run-maik-stream-ui.mjs      (CHROME=/path/to/chrome to override the browser)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const PORT = 9086, CDP = 9486, OUT = "/tmp/stewardmd-maikstream";
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return; }
  const fp = join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  readFile(fp, (err, data) => { if (err) { res.writeHead(404); res.end('404'); return; } res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream' }); res.end(data); });
}).listen(PORT);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/abg-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'], { stdio: 'ignore' });
let ws, sid, id = 0, failures = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid })); });
const ev = async (expression) => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result?.result?.value; };
const ok = (pass, label) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`); if (!pass) failures++; };
const until = async (expr, ms = 10000) => { for (let t = 0; t < ms; t += 100) { try { if (await ev(expr)) return true; } catch { /* page busy */ } await sleep(100); } return false; };
// A real key press through CDP (keyDown with its text fires keypress, which activates a button).
const key = async (k) => { const vk = k === 'Enter' ? 13 : 32, t = k === 'Enter' ? '\r' : ' '; await call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: t, unmodifiedText: t }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`);
const armToasts = () => ev(`window.__toasts=[];if(!window.toast||!window.toast.__rec){const t0=window.toast;const f=function(m){window.__toasts.push(String(m));try{return t0&&t0.apply(this,arguments)}catch(e){}};f.__rec=1;window.toast=f;}1`);
async function shot(name) { await sleep(250); await mkdir(OUT, { recursive: true }); const r = await call('Page.captureScreenshot', { format: 'png' }); await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); }
try {
  let version; for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/` });
  ok(await until('!!(window.SMD_askMaik && window.SMD_AI)', 30000), 'app and MaiK loaded');
  await ev(`['introPoster','splash','accountGate','introOverlay','smdBootSplash'].forEach(k=>document.getElementById(k)?.remove());1`);
  await ev(`SMD_askMaik("");1`);
  ok(await until(`!!document.querySelector('#maikSheet #maikExport')&&!!window.__MAIK_TEST`), 'MaiK sheet open');
  await sleep(600);
  /* SMD-01: raised Liquid Glass header controls */
  const g = await ev(`(()=>{const c=getComputedStyle(document.querySelector('#maikExport'));return {bf:c.backdropFilter||c.webkitBackdropFilter,sh:c.boxShadow,bd:c.borderTopWidth}})()`);
  ok(/blur/.test(g.bf) && g.sh !== 'none' && /inset/.test(g.sh) && parseFloat(g.bd) >= 1, 'SMD-01 Share and New are raised glass (blur, rim light, shadow, hairline): ' + JSON.stringify(g));
  /* SMD-02: the stream painter */
  const P = await ev(`(()=>{const T=__MAIK_TEST,md=s=>SMD_MaiK.renderMarkdown(s);if(!T.patchStream)return {err:'no patchStream'};
    const h=document.createElement('div');h.className='maik-b ai';document.querySelector('#maikBody').appendChild(h);
    T.patchStream(h,md('First paragraph of the answer.\\n\\nSecond is growi'));const p1=h.querySelector('.maik-streaming').firstElementChild,mh1=parseFloat(h.querySelector('.maik-streaming').style.minHeight)||0;
    T.patchStream(h,md('First paragraph of the answer.\\n\\nSecond is growing now.'));const same=h.querySelector('.maik-streaming').firstElementChild===p1;
    const last=h.querySelector('.maik-streaming').lastElementChild,caretIn=!!last.querySelector('.maik-caret'),refade=last.classList.contains('maik-sin');
    T.patchStream(h,md('First paragraph of the answer.\\n\\nSecond is growing now.\\n\\n- a new list item'));const nl=h.querySelector('.maik-streaming').lastElementChild,newFade=nl.classList.contains('maik-sin');
    const mh2=parseFloat(h.querySelector('.maik-streaming').style.minHeight)||0;
    T.patchStream(h,md('First.'));const mh3=parseFloat(h.querySelector('.maik-streaming').style.minHeight)||0;
    const carets=h.querySelectorAll('.maik-caret').length;h.remove();
    return {same,caretIn,refade,newFade,mh1,mh2,mh3,carets}})()`);
  ok(P.same, 'SMD-02 an unchanged paragraph is kept, not re-rendered, as the stream grows');
  ok(P.caretIn && P.carets === 1, 'SMD-02 one caret, at the end of the text (not on a line of its own)');
  ok(!P.refade && P.newFade, 'SMD-02 only a new block fades in; the growing block is swapped silently');
  ok(P.mh2 >= P.mh1 && P.mh3 >= P.mh2 && P.mh1 > 0, `SMD-02 the answer box never shrinks mid-stream (${P.mh1} -> ${P.mh2} -> ${P.mh3})`);
  /* SMD-02 live: a stubbed provider streams; the first paragraph node survives the whole stream */
  await ev(`(()=>{const A=window.SMD_AI;A.__s=A.explainGroundedStream;A.explainGroundedStream=function(pkg,o,onDelta){const parts=['Zeta answer opening line.','\\n\\nMore text arrives','\\n\\nMore text arrives here slowly.','\\n\\n- item one','\\n- item two'];let acc='';return new Promise(r=>{let k=0;const t=setInterval(()=>{acc+=parts[k++];onDelta(acc);if(k===parts.length){clearInterval(t);window.__streamDone=1;setTimeout(()=>r({text:acc,mode:'grounded'}),1500)}},180)})};
    window.__p1=null;window.__p1Lost=0;window.__obs=setInterval(()=>{const s=document.querySelector('#maikBody .maik-streaming');if(!s)return;const f=s.firstElementChild;if(!window.__p1)window.__p1=f;else if(f!==window.__p1)window.__p1Lost++;},30)})();1`);
  await ev(`(()=>{const q=document.querySelector('#maikQ');q.value='zeta qwerty unusual stream probe';q.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#maikSend')?.click()})();1`);
  const streamed = await until(`!!window.__streamDone`, 20000);
  const saw = await ev(`!!window.__p1`);
  const dim = await ev(`(()=>{const c=document.querySelector('#maikSheet .mk-atmo-code');return c?getComputedStyle(c).opacity:'none'})()`);
  ok(streamed && saw, 'SMD-02 the stubbed answer streamed into the live bubble');
  ok(saw && await ev(`window.__p1Lost===0`), 'SMD-02 the first paragraph stayed the same element for the whole stream (no flicker)');
  ok(dim === 'none' || +dim <= 0.1 + 1e-6, 'SMD-02 the code rain is dimmed behind a streaming answer (opacity ' + dim + ')');
  await shot('maik-stream');
} catch (e) { console.log('FAIL', e.message); failures++; } finally { try { ws.close(); } catch {} chrome.kill(); server.close(); }
console.log(failures ? failures + ' failed' : 'all passed'); process.exit(failures ? 1 : 0);
