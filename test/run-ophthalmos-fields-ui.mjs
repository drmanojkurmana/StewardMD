/* Ophthalmós content rules in the REAL app (headless Chrome, 390 x 844):
 * - R3: a glossary abbreviation's first [[term]] in a lesson reads "lateral geniculate nucleus (LGN)", later ones
 *   "LGN"; the glossary sheet's title is the full form; Hindi keeps the English full form in brackets.
 * - R5: a lesson's "fields" block ("What the patient sees") renders three canvases (left eye, right eye, both eyes
 *   open) on the shared scene picture, switches pattern, draws each eye from the PATIENT's view (temporal = outer
 *   half of that eye), shows dark or blurred loss, works in Hindi and in dark mode, and never scrolls sideways at 390.
 * - A pathway site in "See it" links to its field pattern.
 * The fields block is tested on a small fixture lesson built here (lessons/*.json are owned by the content agents).
 *
 * USAGE: node test/run-ophthalmos-fields-ui.mjs   (env: PORT for the static server, CHROME_PORT for CDP, SHOTS=dir)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const SPORT = process.env.PORT || "8996";
const BASE = (process.env.BASE || `http://localhost:${SPORT}/`).replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9398), userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ophthalmos-fields-chrome-" + PORT;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, SPORT])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const evp = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let nShots = 0;
async function shot(name) {
  if (!SHOTS || nShots >= 12) return;
  nShots++;
  await sleep(250); await mkdir(SHOTS, { recursive: true });
  const r = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(`${SHOTS}/${name}.png`, Buffer.from(r.result.data, "base64"));
}

// Fixture: a tiny lesson with [[lgn]] used three times and a fields block covering the pathway sites.
const FIX = {
  id: "zz-fields-fixture", unit: "neuro", level: "mbbs", minutes: 3, review: "ai_drafted",
  title: { en: "Fields fixture", hi: "फ़ील्ड फ़िक्स्चर" },
  idea: { en: "The optic tract ends at the [[lgn]]. The [[lgn]] relays to the cortex.", hi: "ऑप्टिक ट्रैक्ट [[lgn]] पर ख़त्म होता है। [[lgn]] आगे कॉर्टेक्स तक संकेत भेजता है।" },
  see: { diagram: "diagrams/neuro-pathway.svg", w: 480, h: 600, alt: { en: "Pathway", hi: "रास्ता" }, caption: { en: "Pathway", hi: "रास्ता" },
    hotspots: [{ x: 0.5, y: 0.423, label: { en: "Chiasm", hi: "कियाज़्म (chiasm)" }, note: { en: "Nasal fibres cross here.", hi: "नाक वाले तंतु यहाँ पार करते हैं।" } },
      { x: 0.642, y: 0.57, label: { en: "Lateral geniculate nucleus", hi: "LGN" }, note: { en: "Again the [[lgn]].", hi: "फिर [[lgn]]।" } },
      { x: 0.3, y: 0.9, label: { en: "Brainstem", hi: "ब्रेनस्टेम" }, note: { en: "No field item here.", hi: "यहाँ कोई फ़ील्ड नहीं।" } }] },
  why: { steps: [{ en: "Later use: [[lgn]].", hi: "बाद में: [[lgn]]।" }], analogy: { en: "Like a relay.", hi: "रिले की तरह।" } },
  fields: {
    intro: { en: "Pick a lesion site and compare it with normal.", hi: "एक जगह चुनें और सामान्य से तुलना करें।" },
    items: [
      { id: "bitemporal", label: { en: "Bitemporal hemianopia", hi: "बाइटेम्पोरल हेमियानोपिया (bitemporal hemianopia)" }, le: "temporal", re: "temporal", where: { en: "Chiasm: a pituitary tumour presses the crossing fibres.", hi: "कियाज़्म (chiasm): पिट्यूटरी ट्यूमर पार करते तंतुओं को दबाता है।" }, lesion: "chiasm" },
      { id: "left-homonymous", label: { en: "Left homonymous hemianopia", hi: "बायाँ होमोनिमस हेमियानोपिया (left homonymous hemianopia)" }, le: "left-half", re: "left-half", where: { en: "Right optic tract, after the [[lgn]].", hi: "दायाँ ऑप्टिक ट्रैक्ट (optic tract)।" }, lesion: "lgn" },
      { id: "right-blind", label: { en: "Right eye blind", hi: "दाईं आँख अंधी" }, le: "full", re: "blind", where: { en: "Right optic nerve.", hi: "दाईं ऑप्टिक नर्व (optic nerve)।" }, lesion: "optic-nerve" },
      { id: "tunnel", label: { en: "Tunnel vision", hi: "टनल विज़न (tunnel vision)" }, le: "tunnel", re: "tunnel" },
      { id: "cataract", label: { en: "Cataract blur", hi: "मोतियाबिंद का धुंधलापन" }, le: "blur", re: "blur" }
    ]
  },
  spot: [{ en: "Spot.", hi: "पहचानें।" }], todo: [{ en: "Do.", hi: "करें।" }], remember: { en: "Remember the [[lgn]].", hi: "[[lgn]] याद रखें।" },
  check: [{ q: { en: "Q?", hi: "प्रश्न?" }, o: [{ en: "A", hi: "क" }, { en: "B", hi: "ख" }], a: 0, why: { en: "Because.", hi: "क्योंकि।" } }],
  test: { mcqTopic: "neuro" }, glossary: ["lgn"], sources: ["Fixture."]
};

// Luminance of a canvas pixel at (fx, fy) as fractions of its size.
const LUM = `function lum(cv, fx, fy){ var x=cv.getContext("2d"), p=x.getImageData(Math.floor(cv.width*fx), Math.floor(cv.height*fy), 1, 1).data; return 0.2126*p[0]+0.7152*p[1]+0.0722*p[2]; }
  function cv(e){ return document.querySelector('#lnFSim canvas[data-eye="'+e+'"]'); }`;
const noOverflow = `var sc=document.getElementById("lnScroll"), bad=[].filter.call(document.querySelectorAll("#smdOphthalmos .ln-art *"), function(e){ var r=e.getBoundingClientRect(); return r.width>0 && (r.right>390.5 || r.left<-0.5); });
  return sc.scrollWidth <= sc.clientWidth + 1 && bad.length === 0 ? true : "overflow: " + sc.scrollWidth + "/" + sc.clientWidth + " " + bad.slice(0,3).map(function(e){return e.className;}).join(",");`;

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/ophthalmos|OPHTHALMOS/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.OPHTHALMOS && OPHTHALMOS._renderHub && window.SMD_showHome);`, 30000), "app loads with Ophthalmós");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();});
    localStorage.removeItem("smd_ophthalmos_v1"); localStorage.setItem("smd_ophthalmos_prefs", JSON.stringify({tab:"learn", lang:"en"})); document.body.classList.remove("dark"); return 1;`);
  await ev(`SMD_showHome(); OPHTHALMOS.open(); return 1;`);
  ok(await until(`var W=OPHTHALMOS._learn && OPHTHALMOS._learn._w; return !!(W && W.ix && W.gloss && W.media);`, 20000), "Learn loads the index, glossary and image library");

  // glossary data: every abbreviation term carries abbr + full {en, hi}; the scene is in the library
  ok(await ev(`var g=OPHTHALMOS._learn._w.gloss, D=OPHTHALMOS_DATA, ids=Object.keys(g).filter(function(k){return /[A-Z]{2,}/.test(g[k].term.en);});
    return ids.length > 40 && ids.every(function(k){ return g[k].abbr === true && g[k].full && g[k].full.en && g[k].full.hi; }) && D.glossFull(g.lgn, "en") === "lateral geniculate nucleus (LGN)";`) === true, "glossary: every abbreviation has abbr and a full form (LGN -> lateral geniculate nucleus)");
  ok(await ev(`var m=OPHTHALMOS._learn._w.media["fields-scene"]; return !!m && m.licence === "CC0" && /^fields\\//.test(m.file);`) === true, "the field scene is in the image library with its CC0 credit");

  // the fixture validates and opens
  ok(await ev(`var W=OPHTHALMOS._learn._w, f=${JSON.stringify(FIX)}, e=OPHTHALMOS_DATA.validateLesson(f, W.gloss, W.media); W.lessons[f.id]=f; return e.length ? e.join("; ") : true;`) === true, "a lesson with a fields block passes validateLesson");
  ok(await ev(`var D=OPHTHALMOS_DATA, f=JSON.parse(JSON.stringify(${JSON.stringify(FIX)})); f.fields.items[0].le="outer"; f.fields.items[1].lesion="moon"; return D.validateLesson(f, OPHTHALMOS._learn._w.gloss).filter(function(x){return /fields/.test(x);}).length === 2;`) === true, "validateLesson rejects an unknown pattern and an unknown lesion site");
  await ev(`OPHTHALMOS._internal.ACTIONS.lesson({getAttribute:function(){return "${FIX.id}";}}); return 1;`);
  ok(await until(`return OPHTHALMOS._st.view === "lesson" && document.getElementById("lnArt").getAttribute("data-step") === "idea";`), "the fixture lesson opens");

  // R3: first use expanded, later uses short
  ok(await ev(`var t=[].map.call(document.querySelectorAll('#lnArt .ln-term[data-g=lgn]'), function(e){return e.textContent;}); return t.join("|");`) === "lateral geniculate nucleus (LGN)|LGN", "R3: the first [[lgn]] reads \"lateral geniculate nucleus (LGN)\", the second \"LGN\"");
  await ev(`document.querySelector('#lnArt .ln-term[data-g=lgn]').click(); return 1;`);
  ok(await until(`var h=document.getElementById("lnSheetH"); return !!h && h.textContent === "lateral geniculate nucleus (LGN)";`), "tap-to-define still works and the sheet's title is the full form");
  await ev(`OPHTHALMOS._internal.ACTIONS.lnsheetclose(); return 1;`);
  await sleep(250);

  // See it: the chiasm and LGN sites link to their field patterns; the brainstem does not
  await ev(`OPHTHALMOS._internal.ACTIONS.lnnext(); return 1;`);
  ok(await until(`return document.getElementById("lnArt").getAttribute("data-step") === "see";`), "Next goes to See it");
  await ev(`OPHTHALMOS._internal.ACTIONS.lnshowall(); return 1;`);
  ok(await ev(`return [].map.call(document.querySelectorAll('#lnHotList [data-act=lnfgo]'), function(b){return b.getAttribute("data-f");}).join(",");`) === "bitemporal,left-homonymous", "pathway sites link to their field patterns (chiasm, LGN), other sites do not");
  ok(await ev(`return [].map.call(document.querySelectorAll('#lnHotList .ln-term[data-g=lgn]'), function(e){return e.textContent;}).join("|");`) === "LGN", "R3: a later use in a hotspot note stays short");
  await shot("01-see-links-light");
  await ev(`document.querySelector('#lnHotList [data-act=lnfgo][data-f=bitemporal]').click(); return 1;`);
  ok(await until(`var a=document.getElementById("lnArt"); return a.getAttribute("data-step") === "fields" && !!document.querySelector('[data-act=lnfsel][data-f=bitemporal][aria-pressed=true]');`), "the link opens What the patient sees with that pattern chosen");

  // the scene paints on all three canvases, sized to the device pixel ratio
  ok(await until(`${LUM} var c=[cv("L"),cv("R"),cv("B")]; return c.every(function(x){ return x && x.width >= Math.round(x.clientWidth*3) - 1 && lum(x, 0.5, 0.5) > 0; });`, 15000), "three canvases (left eye, right eye, both eyes) painted at 3x");
  ok(await ev(`return document.querySelector("#lnArt .ln-h").textContent === "What the patient sees" && document.querySelectorAll("#lnArt [data-act=lnfsel]").length === 6 && document.querySelector("[data-act=lnfsel]").getAttribute("data-f") === "normal";`) === true, "heading, Normal first, then every item");
  // Bitemporal: each eye loses its OUTER half (left eye: left; right eye: right); both eyes: centre kept, outer edges lost
  ok(await ev(`${LUM} var L=cv("L"), R=cv("R"), B=cv("B");
    return lum(L,0.2,0.5) < 20 && lum(L,0.8,0.5) > 30 && lum(R,0.8,0.5) < 20 && lum(R,0.2,0.5) > 30 && lum(B,0.5,0.5) > 30 && lum(B,0.03,0.5) < 20 && lum(B,0.97,0.5) < 20
      ? true : [lum(L,0.2,0.5), lum(L,0.8,0.5), lum(R,0.8,0.5), lum(R,0.2,0.5), lum(B,0.5,0.5), lum(B,0.03,0.5)].map(Math.round).join(",");`) === true, "bitemporal from the patient's view: left eye loses the left half, right eye the right half; both eyes keep the centre");
  ok(await ev(`return /Chiasm/.test(document.querySelector(".ln-fwhere").textContent) && /outer half: the left side/.test(document.querySelector('#lnFSim canvas[data-eye=L]').getAttribute("aria-label"));`) === true, "the lesion site and each eye's pattern are written out");
  await shot("02-fields-bitemporal-light");
  // switch: left homonymous hemianopia, both eyes lose the left half
  await ev(`document.querySelector('[data-act=lnfsel][data-f="left-homonymous"]').click(); return 1;`);
  ok(await until(`${LUM} var B=cv("B"); return !!document.querySelector('[data-act=lnfsel][data-f="left-homonymous"][aria-pressed=true]') && document.activeElement === document.querySelector('[data-act=lnfsel][data-f="left-homonymous"]') && lum(B,0.25,0.5) < 20 && lum(B,0.75,0.5) > 30;`), "switching item keeps focus; homonymous left: both eyes open lose the left half");
  // Normal: nothing dark
  await ev(`document.querySelector('[data-act=lnfsel][data-f=normal]').click(); return 1;`);
  ok(await until(`${LUM} return [cv("L"),cv("R"),cv("B")].every(function(c){ return lum(c,0.2,0.5) > 20 && lum(c,0.8,0.5) > 20; }) && !document.querySelector(".ln-fwhere");`), "Normal: the whole scene in every view");
  // one blind eye: the other eye covers it with both eyes open
  await ev(`document.querySelector('[data-act=lnfsel][data-f="right-blind"]').click(); return 1;`);
  ok(await until(`${LUM} return lum(cv("R"),0.5,0.5) < 20 && lum(cv("L"),0.5,0.5) > 20 && lum(cv("B"),0.5,0.5) > 20 && lum(cv("B"),0.97,0.5) < 20;`), "right optic nerve: right eye blind, both eyes open keep all but the right outer crescent");
  // blurred style: the lost part is blurred, not black
  await ev(`document.querySelector('[data-act=lnfsel][data-f=bitemporal]').click(); document.querySelector('[data-act=lnfstyle][data-s=blur]').click(); return 1;`);
  ok(await until(`${LUM} return document.querySelector('#lnFSim').getAttribute("data-style") === "blur" && lum(cv("L"),0.2,0.5) > 25;`), "Blurred: the lost half is drawn blurred instead of dark (choice remembered in prefs)");
  ok(await ev(`return JSON.parse(localStorage.getItem("smd_ophthalmos_prefs")).fstyle === "blur";`) === true, "the loss style is remembered");
  await ev(`document.querySelector('[data-act=lnfsel][data-f=tunnel]').click(); return 1;`);
  await shot("03-fields-tunnel-blur-light");
  await ev(`document.querySelector('[data-act=lnfstyle][data-s=dark]').click(); return 1;`);
  ok(await until(`${LUM} return lum(cv("B"),0.05,0.1) < 20 && lum(cv("B"),0.5,0.5) > 20;`), "tunnel vision: only the centre is left");
  ok(await ev(noOverflow) === true, "390 px: no horizontal overflow on the fields step");
  // offsetWidth/Height are CSS px; the app may zoom the whole page (html zoom 0.95), which getBoundingClientRect includes.
  { const r44 = await ev(`var bad=[].filter.call(document.querySelectorAll("#lnArt [data-act=lnfsel], #lnArt [data-act=lnfstyle]"), function(b){ return b.offsetHeight < 44 || b.offsetWidth < 44; }); return bad.length ? bad.map(function(b){ return b.textContent + " " + b.offsetWidth + "x" + b.offsetHeight; }).join(", ") : true;`);
    ok(r44 === true, "every chip and style button is at least 44 x 44 CSS px" + (r44 === true ? "" : ": " + r44)); }

  // dark mode
  await ev(`document.body.classList.add("dark"); document.querySelector('[data-act=lnfsel][data-f=bitemporal]').click(); return 1;`);
  ok(await until(`var c=getComputedStyle(document.querySelector(".ln-fchip:not([aria-pressed=true])")); return /^rgb\\(18, 18, 20\\)$/.test(c.backgroundColor) && getComputedStyle(document.getElementById("smdOphthalmos")).backgroundColor === "rgb(0, 0, 0)";`), "dark mode: chips and page follow the dark tokens");
  await shot("04-fields-bitemporal-dark");
  await ev(`document.querySelector('#lnScroll').scrollTop = 9999; return 1;`);
  await shot("05-fields-bottom-dark");
  await ev(`document.body.classList.remove("dark"); document.querySelector('#lnScroll').scrollTop = 0; return 1;`);

  // Hindi
  await ev(`document.querySelector('[data-act=lnlang]').click(); return 1;`);
  ok(await until(`${LUM} return document.getElementById("smdOphthalmos").getAttribute("lang") === "hi" && document.querySelector("#lnArt .ln-h").textContent === "मरीज़ क्या देखता है" && /बाईं आँख/.test(document.querySelector("#lnFSim").textContent) && lum(cv("L"),0.2,0.5) < 20;`), "Hindi: the fields step re-renders in Hindi with the same pattern drawn");
  ok(await ev(noOverflow) === true, "390 px Hindi: no horizontal overflow");
  await shot("06-fields-hindi-light");
  await ev(`OPHTHALMOS._internal.ACTIONS.lesson({getAttribute:function(){return "${FIX.id}";}}); return 1;`);
  ok(await until(`var t=document.querySelector('#lnArt .ln-term[data-g=lgn]'); return !!t && t.textContent === "लैटरल जेनिकुलेट न्यूक्लियस (lateral geniculate nucleus, LGN)";`), "R4: Hindi first use reads \"लैटरल जेनिकुलेट न्यूक्लियस (lateral geniculate nucleus, LGN)\"");
  await ev(`document.querySelector('[data-act=lnlang]').click(); return 1;`);

  // the real neuro-pathway lesson: its first [[lgn]] is expanded wherever it falls
  await ev(`OPHTHALMOS._internal.leave(); OPHTHALMOS._internal.ACTIONS.lesson({getAttribute:function(){return "neuro-pathway";}}); return 1;`);
  ok(await until(`return OPHTHALMOS._st.view === "lesson" && OPHTHALMOS._learn._w.les && OPHTHALMOS._learn._w.les.id === "neuro-pathway";`, 15000), "the real neuro-pathway lesson opens");
  let found = "";
  for (let n = 0; n < 12 && !found; n++) {
    found = await ev(`var t=document.querySelector('#lnArt .ln-term[data-g=lgn]'); return t ? t.textContent : "";`);
    if (!found) { await ev(`var b=document.getElementById("lnNext"); if (b && !b.disabled) b.click(); else { var a=document.querySelector('#lnArt .oph-ans'); if (a) a.click(); } return 1;`); await sleep(200); }
  }
  ok(found === "lateral geniculate nucleus (LGN)", "neuro-pathway: the first LGN reads \"lateral geniculate nucleus (LGN)\" (got \"" + found + "\")");
  await shot("07-neuro-pathway-lgn-light");
  await ev(`OPHTHALMOS.close(); return 1;`);

  ok(errors.length === 0, "no uncaught Ophthalmós errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: content rules + What the patient sees" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
