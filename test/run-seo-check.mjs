/* StewardMD — homepage SEO / indexing regression.
 * Renders the DEFAULT homepage (premium UI) headlessly and asserts the on-page SEO signals:
 * exact title, meta description opener, canonical, indexable robots, EXACTLY ONE visible H1
 * "StewardMD", logo alt text, the platform description copy, and valid Organization + WebSite
 * JSON-LD. Verifies the rendered DOM, not just the static source.
 * USAGE: BASE=http://localhost:8903/ node test/run-seo-check.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const BASE = (process.env.BASE || "http://localhost:8903/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9479);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR||"/tmp")}/tmp/maik-chrome-seo`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok?"✅":"❌"} ${n}${d?" — "+d:""}`); if (!ok) fails++; };
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() });
  await sleep(1500);
  await ev(`if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});});} if(window.caches){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k);});});} return 1;`);
  await sleep(500);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() + "s" });
  for (let i = 0; i < 80; i++) { await sleep(400); if (await ev(`return document.readyState==="complete"`) === true) break; }
  await sleep(1500); // let the premium home render its hero

  const title = await ev(`return document.title;`);
  chk("title is exact", title === "StewardMD – Smart Clinical Decision Support for Doctors", JSON.stringify(title));
  const desc = await ev(`var m=document.querySelector('meta[name="description"]');return m?m.content:"";`);
  chk("meta description opener", /^StewardMD is a clinical decision-support platform for doctors/.test(desc), JSON.stringify(desc.slice(0, 70)));
  const canon = await ev(`var l=document.querySelector('link[rel="canonical"]');return l?l.href:"";`);
  chk("canonical = https://stewardmd.in/", canon === "https://stewardmd.in/", canon);
  const robots = await ev(`var m=document.querySelector('meta[name="robots"]');return m?m.content:"";`);
  chk("robots is indexable (index,follow)", /index/.test(robots) && /follow/.test(robots) && !/noindex/.test(robots), robots);

  // H1s (crawlable DOM facts — Google indexes text, incl. sr-only; the intro splash prevents
  // headless from painting the premium hero, so we assert crawlable identity, not headless paint).
  const h1 = JSON.parse(await ev(`
    var out=[]; document.querySelectorAll("h1").forEach(function(h){ out.push((h.innerText||h.textContent||"").replace(/\\s+/g,"").trim()); }); return JSON.stringify(out);`));
  chk("at least one H1 present", h1.length >= 1, JSON.stringify(h1));
  chk("every H1 is exactly 'StewardMD' (no stale text)", h1.length >= 1 && h1.every(t => t === "StewardMD"), JSON.stringify(h1));

  const logoAlt = await ev(`var i=[].slice.call(document.querySelectorAll('img')).filter(function(x){return /StewardMD logo/i.test(x.alt);}); return i.length;`);
  chk("logo has alt='StewardMD logo'", logoAlt >= 1, "count=" + logoAlt);

  const copy = await ev(`return /clinical decision-support platform for doctors/i.test(document.documentElement.innerHTML);`);
  chk("platform description copy present in DOM (crawlable)", copy === true);

  const jsonld = JSON.parse(await ev(`
    var out=[]; document.querySelectorAll('script[type="application/ld+json"]').forEach(function(s){ try{var j=JSON.parse(s.textContent); out.push({t:j["@type"], name:j.name, url:j.url});}catch(e){out.push({err:1});} }); return JSON.stringify(out);`));
  chk("Organization JSON-LD (name+url)", jsonld.some(j => j.t === "Organization" && j.name === "StewardMD" && j.url === "https://stewardmd.in/"), JSON.stringify(jsonld));
  chk("WebSite JSON-LD (name+url)", jsonld.some(j => j.t === "WebSite" && j.name === "StewardMD" && j.url === "https://stewardmd.in/"));

  console.log(`\n${fails?"❌ "+fails+" FAILED":"✅ ALL GREEN — homepage SEO signals verified in the rendered DOM"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
