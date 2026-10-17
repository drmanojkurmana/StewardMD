/* Figure viewer on a phone-size screen: fits the width, never scrolls sideways, scrolls down, pinch / double-tap / pan zoom. */
import { createRequire } from "node:module"; import { execSync } from "node:child_process"; import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const require=createRequire(import.meta.url); const { chromium } = require(require("node:path").join(execSync("npm root -g").toString().trim(),"playwright"));
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split("?")[0]);if(u==="/host"){r.setHeader("content-type","text/html");return r.end('<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body class="dark" style="background:#000"><script src="/fig-viewer.js"></script>');}
 const f=path.join(ROOT,u);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.statusCode=404;return r.end();}
 r.setHeader("content-type",f.endsWith(".html")?"text/html":f.endsWith(".js")?"text/javascript":"application/json");r.end(fs.readFileSync(f));}).listen(0);
const port=srv.address().port;
const b=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,args:(process.env.CHROME_FLAGS||"").split(" ").filter(Boolean)});
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
const p=await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.goto(`http://localhost:${port}/host`);
await p.evaluate(()=>SMD_FIG.ready().then(()=>SMD_FIG.open({src:"prep/figures/beta-blockers.html",title:"bb",query:"d=2"})));
await p.waitForTimeout(1500);
const fr=p.frames().find(f=>f.url().includes("beta-blockers"));
const cdp=await ctx.newCDPSession(p);
const res=[];const ok=(n,c,x)=>{res.push((c?"PASS ":"FAIL ")+n+(x?" "+x:""));};
const geom=()=>fr.evaluate(()=>{const st=document.querySelector(".smdz-st").getBoundingClientRect();return {x:st.x,y:st.y+0,w:st.width,h:st.height,z:window.__smdZoom,sy:window.scrollY,sx:window.scrollX,ow:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}});
let g=await geom(); ok("fits width, no sideways overflow", g.ow<=g.cw, JSON.stringify({ow:g.ow,cw:g.cw}));
// vertical scroll with one finger outside the drawing (swipe up)
const fx=await p.evaluate(()=>document.querySelector(".smdfig-fr").getBoundingClientRect().y);
const swipe=async(x1,y1,x2,y2)=>{await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:x1,y:y1}]});for(let i=1;i<=8;i++){await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x1+(x2-x1)*i/8,y:y1+(y2-y1)*i/8}]});await p.waitForTimeout(16);}await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await p.waitForTimeout(250);};
await swipe(200,700,200,300); g=await geom(); ok("page scrolls down with a swipe", g.sy>50, "scrollY="+g.sy);
await swipe(200,300,200,700); g=await geom(); ok("page scrolls back up", g.sy<5, "scrollY="+g.sy);
// swipe vertically starting ON the drawing: still scrolls (not trapped)
await swipe(200,300,200,100); g=await geom(); ok("vertical swipe on the drawing still scrolls the page", g.sy>20, "scrollY="+g.sy);
await swipe(200,100,200,500);
// horizontal swipe does not scroll sideways
await swipe(300,600,60,600); g=await geom(); ok("sideways swipe does nothing", g.sx===0 && g.ow<=g.cw);
// pinch zoom
const pinch=async(cx,cy,d0,d1)=>{await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:cx-d0/2,y:cy,id:1},{x:cx+d0/2,y:cy,id:2}]});for(let i=1;i<=8;i++){const d=d0+(d1-d0)*i/8;await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:cx-d/2,y:cy,id:1},{x:cx+d/2,y:cy,id:2}]});await p.waitForTimeout(16);}await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await p.waitForTimeout(200);};
await fr.evaluate(()=>window.scrollTo(0,0)); await p.waitForTimeout(200); g=await geom();
await pinch(195,g.y+g.h/2+60,60,200); g=await geom(); ok("pinch zooms in", g.z.s>2, "scale="+g.z.s.toFixed(2));
const s1=g.z.x;
await swipe(300,g.y+120,120,g.y+120); g=await geom(); ok("one-finger pan moves the drawing when zoomed", g.z.x<s1-40, "x "+s1.toFixed(0)+" -> "+g.z.x.toFixed(0)); ok("pan does not scroll the page sideways", g.sx===0&&g.ow<=g.cw);
await pinch(195,g.y+g.h/2+60,200,40); g=await geom(); ok("pinch out returns to fit", g.z.s<1.05, "scale="+g.z.s.toFixed(2));
// double tap
const tap=async(x,y)=>{await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});};
await tap(150,g.y+g.h/2+60); await p.waitForTimeout(80); await tap(150,g.y+g.h/2+60); await p.waitForTimeout(250); g=await geom(); ok("double-tap zooms in", g.z.s>2, "scale="+g.z.s.toFixed(2));
await tap(150,g.y+g.h/2+60); await p.waitForTimeout(80); await tap(150,g.y+g.h/2+60); await p.waitForTimeout(250); g=await geom(); ok("double-tap again fits", g.z.s<1.05);
// controls usable
const sel=await fr.evaluate(()=>{const s=document.getElementById("drug");return s.getBoundingClientRect().height});
ok("drug selector is a big touch target", sel>=44, sel+"px");
await fr.evaluate(()=>{const s=document.getElementById("drug");s.value="2";s.dispatchEvent(new Event("change",{bubbles:true}))}); await p.waitForTimeout(200);
ok("changing drug updates the readout", /./.test(await fr.evaluate(()=>document.querySelector("[data-readout]").textContent)), await fr.evaluate(()=>document.querySelector("[data-readout]").textContent));
// tap a part shows its text
const shown=await fr.evaluate(()=>{const h=document.querySelector(".hot");h.dispatchEvent(new Event("touchend"));return document.getElementById("info").textContent});
ok("tapping a labelled part shows its explanation", shown.length>10 && !/Tap a labelled/.test(shown), shown.slice(0,50));
// with / without switch and arrows in brackets
const sw=await fr.evaluate(()=>{const b=[...document.querySelectorAll(".smdc-t button")];const sel=document.getElementById("drug");const out={};out.hasToggle=b.length===2;b[0].click();out.afterWithout=sel.value;out.rowWithout=document.querySelectorAll(".smdc-r")[0].textContent;b[1].click();out.afterWith=sel.value;out.rowWith=document.querySelectorAll(".smdc-r")[1].textContent;out.out=document.getElementById("b1-out").textContent;out.font=getComputedStyle(document.querySelector(".dr-label")).fontFamily;return out;});
ok("switch: Without drug sets the selector to none", sw.hasToggle && sw.afterWithout==="0", JSON.stringify(sw.afterWithout));
ok("switch: With drug restores a drug", sw.afterWith!=="0", sw.afterWith);
ok("both readouts shown", sw.rowWithout.length>12 && sw.rowWith.length>12 && sw.rowWithout!==sw.rowWith, sw.rowWithout+" | "+sw.rowWith);
ok("heart output has a heart and the arrow in brackets", /\u2665/.test(sw.out) && /\([\u2191\u2193]\)|not (in|de)creased/.test(sw.out), sw.out);
ok("figure text is not the code font", !/mono|Menlo|Consolas/i.test(sw.font), sw.font.slice(0,40));
await p.screenshot({path:"/tmp/figure-gestures.png"});
console.log(res.join("\n")); console.log("errors:",errs.join("|")||"none");
if(res.some(r=>r.startsWith("FAIL"))||errs.length)process.exitCode=1;
await b.close();srv.close();
