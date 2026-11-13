/* Figure viewer on a phone-size screen: fits the width, never scrolls sideways, scrolls down, pinch / double-tap / pan zoom. */
import { createRequire } from "node:module"; import { execSync } from "node:child_process"; import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { chromium } from "/Users/mkk/Developer/StewardMD/tools/figures/dev/pw.mjs";
const ROOT="/Users/mkk/Developer/wt-figs";
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split("?")[0]);if(u==="/host"){r.setHeader("content-type","text/html");return r.end('<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body class="dark" style="background:#000"><script src="/fig-guide.js"></script><script src="/fig-viewer.js"></script>');}
 const f=path.join(ROOT,u);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.statusCode=404;return r.end();}
 r.setHeader("content-type",f.endsWith(".html")?"text/html":f.endsWith(".js")?"text/javascript":"application/json");r.end(fs.readFileSync(f));}).listen(0);
const port=srv.address().port;
const b=await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",args:["--no-sandbox"]});
const sizes=[["ipadL",1024,768]];
const figs=process.argv.slice(2);
for(const [n,w,h] of sizes) for(const fg of figs){
 const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:1,hasTouch:true});
 const p=await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
 await p.goto(`http://localhost:${port}/host`);
 await p.evaluate((f)=>SMD_FIG.ready().then(()=>SMD_FIG.open({src:"prep/figures/"+f+".html",title:f,query:"d=1&l=2"})),fg);
 await p.waitForTimeout(1800);
 const fr=p.frames().find(f=>f.url().includes(fg));
 await fr.evaluate(()=>{const h=document.querySelector(".smd-help-ok")||document.querySelector(".smd-help button");if(h)h.click();const m=[...document.querySelectorAll(".smd-mode button")].find(b=>/learn/i.test(b.textContent));if(m)m.click();});
 await p.waitForTimeout(300);
 const m=await fr.evaluate(()=>({sh:document.documentElement.scrollHeight,ch:document.documentElement.clientHeight,sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,st:document.querySelector(".smdz-st").getBoundingClientRect().height|0}));
 console.log(n,fg,JSON.stringify(m),errs.join("|"));
 await p.waitForTimeout(500); await fr.evaluate(()=>{const n=document.querySelector(".smd-next");if(n){n.click();n.click();}}); await p.waitForTimeout(600); console.log(await fr.evaluate(()=>JSON.stringify({guide:[...document.querySelectorAll(".smd-guide")].map(g=>({h:g.hidden,disp:getComputedStyle(g).display,t:g.textContent.slice(0,160)})),why:[...document.querySelectorAll(".smd-why")].map(g=>getComputedStyle(g).display),mode:[...document.querySelectorAll(".smd-mode button")].map(b=>b.textContent+":"+b.getAttribute("aria-pressed"))}))); await p.screenshot({path:process.env.CLAUDE_JOB_DIR+"/tmp/lay-"+n+"-"+fg+".png"});
 await ctx.close();
}
await b.close(); srv.close();
