// test/run-iso-figures-ui.mjs: the isometric equipment figures in headless Chrome at 390 x 844.
// Part 1 mounts all seven on tools/iso/preview.html (light and dark), checks they animate, that their controls change
// the model, and that nothing overflows. Part 2 opens each host in the real app: Narke's circuit explorer (host-driven
// circle system, vaporizer, sampling line), the Neonatal dopamine infusion (pump at the calculated rate), CliniX's
// BP diagram, SURGX chest trauma (chest drain) and Ophthalmos' focus explorer (retinoscope).
// USAGE: PORT=<free port> CHROME_PORT=<free port> [CHROME=/path/to/chrome] [SHOTS=dir] node test/run-iso-figures-ui.mjs
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const SPORT = +(process.env.PORT || 8995), CPORT = +(process.env.CHROME_PORT || 9415);
const BASE = `http://localhost:${SPORT}/`;
const CHROME = process.env.CHROME || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const IDS = ["circle-system", "vaporizer", "capno-line", "syringe-pump", "bp-cuff", "chest-drain", "retinoscope"];

const server = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(SPORT)], { stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + "iso-figures.js"); break; } catch { await sleep(150); } }
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${CPORT}`, `--user-data-dir=/tmp/iso-ui-chrome-${process.pid}`, "--no-first-run", "--disable-gpu", "--disable-dev-shm-usage"], { stdio: "ignore" });
let ws, sessionId, msgId = 0, fails = 0; const pending = new Map(), errors = [];
const call = (method, params = {}) => new Promise((r) => { const i = ++msgId; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const shot = async (name) => { if (!SHOTS) return; await sleep(300); const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
const go = async (url) => { await call("Page.navigate", { url }); await sleep(400); };
const read = (sel) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent : null;`);

try {
  let ver; for (let i = 0; i < 100; i++) { try { ver = await (await fetch(`http://localhost:${CPORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable"); await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  /* ---------- part 1: every figure on the preview page ---------- */
  for (const dark of [false, true]) {
    await go(BASE + "tools/iso/preview.html?ids=" + IDS.join(",") + (dark ? "&dark=1" : ""));
    ok(await until(`return document.querySelectorAll('[data-iso-on="1"]').length === ${IDS.length};`, 15000), `${dark ? "dark" : "light"}: all ${IDS.length} figures mount`);
    ok(await ev(`return document.documentElement.scrollWidth <= innerWidth + 1;`) === true, "no horizontal overflow at 390");
    ok(await ev(`var c=getComputedStyle(document.querySelector(".smd-iso")).getPropertyValue("--anatomy-paper").trim(); return c;`) === (dark ? "#131313" : "#fbfbfa"), "theme follows body.dark");
    for (const id of IDS) {
      const sel = `[data-smd-iso="${id}"]`;
      await ev(`document.querySelector('${sel}').scrollIntoView(); return 1;`);
      const snap = () => ev(`return document.querySelector('${sel} .smd-iso-stage').innerHTML;`);
      const a = await read(sel + " [data-iso-read]"), s0 = await snap();
      await sleep(900);
      const b = await read(sel + " [data-iso-read]"), s1 = await snap();
      ok(!!a && !/NaN|undefined/.test(a + b + s1), `${id}: readout "${b}"`);
      if (!dark) ok(s0 !== s1, `${id}: the figure moves while on screen`);
      const say0 = await read(sel + " [data-iso-say]");
      const changed = await ev(`var r=document.querySelector('${sel}'), b=r.querySelector('.smd-iso-seg button[aria-pressed="false"]');
        if (b) { b.click(); return 1; } var i=r.querySelector('input[type=range]'); i.value=i.max; i.dispatchEvent(new Event("input",{bubbles:true})); return 2;`);
      await sleep(150);
      const say1 = await read(sel + " [data-iso-say]");
      ok(changed && say1 && say1 !== say0, `${id}: a control changes the model ("${(say1 || "").slice(0, 70)}")`);
      if (!dark) await shot("preview-" + id);
    }
  }
  // kill switch
  await go(BASE + "tools/iso/preview.html?ids=circle-system&iso=0");
  await sleep(800);
  ok(await ev(`return !document.querySelector('[data-iso-on]') && SMD_ISO.slot("circle-system") === "";`) === true, "?iso=0: nothing mounts and slot() returns nothing");

  /* ---------- part 2: the hosts in the real app ---------- */
  await go(BASE);
  ok(await until(`return !!(window.SMD_ISO && window.NARKE_LOADER);`, 30000), "app boot loads iso-figures.js (and no figure file)");
  ok(await ev(`return ![].some.call(document.scripts, function(s){return /iso-fig-/.test(s.src);});`) === true, "no figure file at boot");

  // Narke circuit explorer
  await ev(`NARKE_LOADER.load(); return 1;`);
  ok(await until(`return !!(window.NARKE && NARKE._exploreUI && NARKE._explore && NARKE._explore.some(function(x){return x.id==="circuit";}));`, 20000), "Narke loads its explorers");
  await ev(`NARKE.open(); return 1;`);
  await sleep(800);
  await ev(`NARKE._exploreUI.open("circuit"); return 1;`);
  ok(await until(`return ['circle-system','vaporizer','capno-line'].every(function(id){ var e=document.querySelector('[data-smd-iso="'+id+'"]'); return e && e.getAttribute("data-iso-on")==="1"; });`, 15000), "circuit explorer: circle system, vaporizer and sampling line mount");
  ok(await ev(`return !document.querySelector('[data-smd-iso="circle-system"] .smd-iso-ctl');`) === true, "the circle system has no controls of its own (the explorer's sliders drive it)");
  await ev(`var r=document.querySelector('[data-xin="fgf"]'); r.value=0; r.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
  ok(await until(`return /0\\.25 L\\/min/.test(document.querySelector('[data-smd-iso="circle-system"] [data-iso-read]').textContent);`, 3000), "the FGF slider drives the figure (0.25 L/min)");
  await ev(`document.querySelector('[data-act="nkxciabs"][data-v="exhausted"]').click(); return 1;`);
  ok(await until(`var e=document.querySelector('[data-smd-iso="circle-system"][data-iso-on="1"] [data-iso-read]'); return !!e && /rising/.test(e.textContent);`, 5000), "exhausted absorber at 0.25 L/min: inspired CO2 rising, as the explorer's own readout");
  await ev(`document.querySelector('[data-smd-iso="circle-system"]').scrollIntoView(); return 1;`);
  await shot("narke-circuit");
  await ev(`NARKE.close && NARKE.close(); return 1;`);

  // Neonatal dopamine infusion
  await ev(`SMD_openRoute('neo'); return 1;`);
  if (await until(`return !!document.querySelector('#neoHub:not([hidden]) #nh_weightG');`, 15000)) {
    const typeIn = (sel, v) => ev(`var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 0; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
    const born = new Date(Date.now() - 4 * 864e5), p2 = (n) => String(n).padStart(2, "0");
    await typeIn("#nh_gaW", "30"); await typeIn("#nh_gaD", "2"); await typeIn("#nh_dob", `${born.getFullYear()}-${p2(born.getMonth() + 1)}-${p2(born.getDate())}`); await typeIn("#nh_tob", "00:00");
    await typeIn("#nh_weightG", "1250"); await typeIn("#nh_birthWeightG", "1180"); await ev(`var b=document.querySelector('#neoHub [data-sex=F]'); b&&b.click(); return 1;`);
    await ev(`SMD_NEO_HUB.open('inf',{drug:'dopamine'}); return 1;`);
    await until(`return !!document.querySelector('#neoHub [data-inf=dose]');`, 5000);
    await typeIn("#neoHub [data-inf=dose]", "5");
    ok(await until(`return !!document.querySelector('#neoHub details.nh-iso');`, 5000), "neonatal: the pump figure is offered under the calculated rate");
    const rate = await ev(`var m=document.querySelector('#neoHub .nh-val').textContent.match(/([\\d.]+) mL\\/h/); return m ? m[1] : null;`);
    await ev(`var d=document.querySelector('#neoHub details.nh-iso'); d.open=true; d.dispatchEvent(new Event('toggle')); d.scrollIntoView(); return 1;`);
    ok(await until(`var e=document.querySelector('#neoHub [data-smd-iso="syringe-pump"][data-iso-on="1"]'); return !!e;`, 8000), "neonatal: the pump mounts");
    ok(await until(`var t=document.querySelector('#neoHub [data-iso-part="rate"]'); return !!t && t.textContent === ${JSON.stringify(rate + " mL/h")};`, 3000), `neonatal: the pump shows the calculated ${rate} mL/h`);
    ok(await ev(`return !document.querySelector('#neoHub [data-iso-k="rateI"]');`) === true, "neonatal: the rate is not adjustable on the figure");
    await shot("neo-pump");
  } else ok(false, "neonatal hub opens");

  // CliniX BP diagram (the registry renders the slot; the runtime mounts it)
  await ev(`var h=document.createElement('div'); h.id='isoCx'; h.innerHTML=SMD_CLINIX_DIAGRAMS ? SMD_CLINIX_DIAGRAMS.render('diagram.bpiso',{}) : ''; document.body.appendChild(h); return 1;`);
  ok(await until(`return !!document.querySelector('#isoCx [data-smd-iso="bp-cuff"][data-iso-on="1"]');`, 8000) || (await ev(`return !window.SMD_CLINIX_DIAGRAMS;`)) === true, "CliniX: the BP diagram mounts the cuff figure");

  // SURGX chest trauma
  await ev(`window.SMD_NEO_HUB && SMD_NEO_HUB.close(); window.SMD_showHome && SMD_showHome(); return 1;`); await sleep(500);
  await ev(`window.SURGX && SURGX.open(); return 1;`);
  if (await until(`return !!window.SMD_SURGX_SCREENS && !!document.getElementById('surgxRoot');`, 10000)) {
    await ev(`SMD_SURGX_SCREENS.go('protocol/chest-trauma'); return 1;`);
    ok(await until(`return !!document.querySelector('#surgxRoot [data-smd-iso="chest-drain"][data-iso-on="1"]');`, 10000), "SURGX chest trauma: the chest drain mounts");
    await ev(`document.querySelector('#surgxRoot [data-smd-iso="chest-drain"]').scrollIntoView(); return 1;`);
    await shot("surgx-drain");
    await ev(`SURGX.close && SURGX.close(); return 1;`);
  } else ok(false, "SURGX opens");

  // Ophthalmos focus explorer
  await until(`return !!(window.OPHTHALMOS && OPHTHALMOS._renderHub && window.SMD_showHome);`, 20000);
  await ev(`SMD_showHome(); OPHTHALMOS.open(); return 1;`);
  await sleep(1500);
  if (await until(`return !!(window.OPHTHALMOS && OPHTHALMOS._explore);`, 20000)) {
    await ev(`OPHTHALMOS._explore.open('focus'); return 1;`);
    ok(await until(`return !!document.querySelector('[data-smd-iso="retinoscope"][data-iso-on="1"]');`, 10000), "Ophthalmos focus: the retinoscope mounts");
    ok(await until(`var e=document.querySelector('[data-smd-iso="retinoscope"] [data-iso-read]'); return !!e && /motion|Neutral/.test(e.textContent);`, 3000), "Ophthalmos: the reflex reads with, against or neutral");
    await ev(`document.querySelector('[data-smd-iso="retinoscope"]').scrollIntoView(); return 1;`);
    await shot("oph-retinoscope");
  } else ok(false, "Ophthalmos opens");

  const mine = errors.filter((e) => /iso-fig|iso-figures|SMD_ISO/.test(e));
  ok(!mine.length, "no exceptions from the figure runtime or figures" + (mine.length ? ": " + mine.join(" | ").slice(0, 400) : ""));
} catch (e) { console.error(e); fails++; }
finally { chrome.kill(); server.kill(); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
