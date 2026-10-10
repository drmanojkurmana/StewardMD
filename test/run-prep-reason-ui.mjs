/* PrepNucleus reasoning explanations + knowledge links in the REAL runner (real Google Chrome and Playwright
 * WebKit, both through playwright-core with the repo served from disk on an https test origin: a secure context,
 * as capacitor://localhost is on the phone). Items come from test/fixtures/prep-reason/items.json (all synthetic)
 * and run through PREP._host.run; the links index, module files, lessons and cards come from
 * test/fixtures/prep-reason/api/. Each item is answered wrong (to show "Your pick") and checked: new-field items
 * show the reasoning sections in order with the pick's row open, Learn more, the one next action and related
 * questions; old items show no new node and byte-identical feedback with and without PREP_REASON. Knowledge readers
 * are stubbed at open (their real entry points are asserted first) while the lift above PrepNucleus is exercised on
 * real overlay elements; lessons and cards open for real from fixtures. Review-screen coverage runs a two-question
 * set to the result and opens row 0.
 *
 * USAGE: CHROME=<path> node test/run-prep-reason-ui.mjs
 *   SHOTS=<dir>   screenshots reason-<browser>-<size>-<theme>-<item>.png
 *   BROWSERS=chrome,webkit (default both; either needs playwright-core, else SKIP)
 *   SIZES=phone,ipad (390x844, 820x1180; default both); THEMES=light,dark (default both)
 */
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIX = "/test/fixtures/prep/";
const RFIX = "/test/fixtures/prep-reason/api/";
const ITEMS = JSON.parse(fs.readFileSync(join(HERE, "fixtures", "prep-reason", "items.json"), "utf8")).items;
const NEW_IDS = ITEMS.slice(0, 6).map((x) => x.id);
const BROWSERS = (process.env.BROWSERS || "chrome,webkit").split(",");
const SIZES = { phone: { width: 390, height: 844 }, ipad: { width: 820, height: 1180 } };
const sizes = (process.env.SIZES || "phone,ipad").split(",").filter((s) => SIZES[s]);
const themes = (process.env.THEMES || "light,dark").split(",");
const SHOTS = process.env.SHOTS || "";

let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const INIT = `window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(RFIX)}; window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false;`;
const CLEAN = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
const STAMP = (it) => ({ ...it, _s: it.t.indexOf("scd-") === 0 ? "ss-cardiology" : "anatomy", _m: it.t });
const FINISH_ANIMS = `document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`;

/* ---------- shared checks (drivers implement ev/click/shot) ---------- */
async function feedbackState(d) {
  return JSON.parse(await d.ev(`var f=document.querySelector("#smdPrep .pn-fb"); if(!f) return "null";
    var h3=Array.from(f.querySelectorAll("h3")).map(function(e){return e.textContent;});
    var dets=Array.from(f.querySelectorAll("details.pn-ro")).map(function(e){return e.open?1:0;});
    var slot=f.querySelector(".pn-rx");
    return JSON.stringify({ h3: h3, dets: dets, open: dets.filter(Boolean).length,
      mineOpen: (function(){var o=f.querySelector("details.pn-ro[open] .pn-rot"); return o?o.textContent:"";})(),
      pearl: (f.querySelector(".pn-kp b")||{}).textContent||"", lo: !!f.querySelector(".pn-rlo"),
      refs: f.querySelectorAll(".pn-rref li").length, done: !!(slot&&slot.getAttribute("data-done")),
      learn: Array.from(f.querySelectorAll(".pn-rlr")).map(function(e){return e.getAttribute("data-act")+":"+(e.querySelector("b")||{}).textContent;}),
      next: (function(){var b=f.querySelector(".pn-rn"); return b?b.getAttribute("data-act")+"|"+b.textContent:"";})(),
      rel: Array.from(f.querySelectorAll(".pn-rqr")).map(function(e){return e.textContent.slice(0,40);}),
      why: f.querySelectorAll(".pn-why li").length, txt: f.textContent.slice(0,60) });`));
}

const EXPECT_SLOT = {
  "fx-reason-1": { learnActs: ["r-kb"], nextAct: "r-kb", relN: 1 },
  "fx-reason-2": { learnActs: ["r-drug", "l-open"], nextAct: "l-open", relN: 0 },
  "fx-reason-3": { learnActs: ["r-kb"], nextAct: "r-practise", relN: 1 },
  "fx-reason-4": { learnActs: ["r-proto"], nextAct: "r-plan", relN: 0 },
  "fx-reason-5": { learnActs: ["r-kb"], nextAct: "r-kb", relN: 1 },
  "fx-reason-6": { learnActs: ["r-kb", "k-open"], nextAct: "r-kb", relN: 0 },
};

async function checkItem(d, tag, it, full) {
  await d.ev(`localStorage.removeItem("smd_prep_v1"); PREP._host.run([${JSON.stringify(STAMP(it))}], "study", "Reasoning"); return 1;`);
  if (!await d.waitFor(`return !!document.querySelector("#smdPrep .pn-opt[data-k='0']");`, 6000)) { ok(false, tag + ": the question shows"); return null; }
  const wrong = (it.a + 1) % it.o.length;
  await d.click(`#smdPrep .pn-opt[data-k='${wrong}']`);
  if (!await d.waitFor(`return !!document.querySelector("#smdPrep .pn-fb");`, 5000)) { ok(false, tag + ": feedback shows"); return null; }
  const isNew = NEW_IDS.includes(it.id);
  if (!isNew) {
    const s = JSON.parse(await d.ev(`var f=document.querySelector("#smdPrep .pn-fb");
      return JSON.stringify({ rx: f.querySelectorAll(".pn-ro,.pn-rx,.pn-rlr,.pn-rn,.pn-rqr,.pn-rlo,.pn-rref").length,
        why: f.querySelectorAll(".pn-why li").length, pearl: (f.querySelector(".pn-kp b")||{}).textContent||"",
        html: f.outerHTML });`));
    const exOld = it.id === "fx-reason-old1" ? { why: 0, pearl: "" } : { why: it.o.length - 1, pearl: "Remember" };
    ok(s.rx === 0 && s.why === exOld.why && s.pearl === exOld.pearl, tag + ": old item: legacy rendering, no reasoning node");
    // byte-identical feedback whether the item takes the reasoning path or not (a bookmark repaint keeps the
    // reveal still, so both paints match; stubbing has() to false takes the same branch as a missing module)
    await d.click(`#smdPrep [data-act="bookmark"]`);
    const h1 = await d.ev(`return document.querySelector("#smdPrep .pn-fb").outerHTML;`);
    await d.ev(`window.__rxHas = PREP_REASON.has; PREP_REASON.has = function () { return false; }; return 1;`);
    await d.click(`#smdPrep [data-act="bookmark"]`);
    const h2 = await d.ev(`return document.querySelector("#smdPrep .pn-fb").outerHTML;`);
    await d.ev(`PREP_REASON.has = window.__rxHas; return 1;`);
    ok(h1 === h2, tag + ": feedback byte-identical off the reasoning path");
    if (full) await d.shot(`reason-${d.name}-${d.size}-${d.theme}-${it.id}`, false);
    d.stash = d.stash || {};
    d.stash[it.id] = h1;
    await d.ev(`PREP.back(); return 1;`);
    return { old: true };
  }
  if (!await d.waitFor(`return !!(document.querySelector("#smdPrep .pn-rx")||{}).getAttribute;`, 2000)) { ok(false, tag + ": the reasoning slot renders"); return null; }
  const s = await feedbackState(d);
  const order = ["Key clues", "Differential", "Mechanism", "Why the others are wrong", "Related questions"];
  let seq = s.h3.filter((h) => order.includes(h) || /^Why [A-D] is right$/.test(h) || h === "Learn more");
  const want = ["Key clues", "Differential", "Mechanism", "WHY", "Why the others are wrong", "Learn more", "Related questions"];
  let wi = 0, ordered = true;
  for (const h of seq) {
    const w = /^Why [A-D] is right$/.test(h) ? "WHY" : h;
    const at = want.indexOf(w, wi);
    if (at < 0) { ordered = false; break; }
    wi = at + 1;
  }
  ok(ordered && s.h3.includes("Why the others are wrong") && s.pearl === "Exam pearl", tag + ": sections in order + Exam pearl (" + s.h3.join(" / ") + ")");
  ok(s.dets.length === it.o.length - 1 && s.open === 1, tag + ": " + s.dets.length + " collapsed rows, the pick open");
  ok(s.mineOpen.includes("Your pick"), tag + ": the open row is the student's pick");
  if (!await d.waitFor(`return !!((document.querySelector("#smdPrep .pn-rx")||{}).getAttribute("data-done"));`, 8000)) { ok(false, tag + ": links fill in"); return s; }
  const s2 = await feedbackState(d);
  const ex = EXPECT_SLOT[it.id];
  const acts = s2.learn.map((l) => l.split(":")[0]);
  ok(ex.learnActs.every((a) => acts.includes(a)), tag + ": Learn more has " + acts.join(","));
  ok(s2.next.split("|")[0] === ex.nextAct, tag + ": next action " + s2.next.split("|")[0]);
  ok(s2.rel.length === ex.relN, tag + ": " + s2.rel.length + " related questions");
  const ov = await d.ev(`var b=document.querySelector("#smdPrep .pn-body"); return b.scrollWidth<=b.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth+1;`);
  ok(ov === true, tag + ": nothing scrolls sideways");
  if (full) await d.shot(`reason-${d.name}-${d.size}-${d.theme}-${it.id}`, false);
  return s2;
}

const STUBS = `window.__rxCalls=[];
window.__rxReal={ kb: !!(window.SMD_REASON&&SMD_REASON.openRef), drug: !!(window.MEDDB&&MEDDB.openComposition),
  proto: !!(window.SMD_KBPROTO&&SMD_KBPROTO.open), lesson: !!(window.PREP_LESSONS&&PREP_LESSONS.open), cards: !!window.PREP_FLASH };
if (window.SMD_REASON) SMD_REASON.openRef=function(id,opts){ window.__rxCalls.push(["kb",id,opts&&opts.from]);
  var el=document.getElementById("dxOverlay"); if(!el){el=document.createElement("div");el.id="dxOverlay";document.body.appendChild(el);} el.classList.add("on"); };
window.MEDDB={ openComposition: function(t){ window.__rxCalls.push(["drug",t]);
  var el=document.getElementById("dbOverlay"); if(!el){el=document.createElement("div");el.id="dbOverlay";document.body.appendChild(el);} el.classList.add("on"); } };
if (window.SMD_KBPROTO) SMD_KBPROTO.open=function(o){ window.__rxCalls.push(["proto",o&&o.id]);
  var el=document.getElementById("sbrefOverlay"); if(el) el.classList.add("open"); };
return 1;`;

async function runCombo(d) {
  const tag = `${d.name} ${d.size} ${d.theme}`;
  await d.setup();
  ok(await d.waitFor(`return !!(window.PREP && window.SMD_showHome);`, 30000), tag + ": page loads");
  await d.ev(CLEAN);
  await d.ev(d.theme === "dark" ? `document.body.classList.add("dark"); return 1;` : `document.body.classList.remove("dark"); return 1;`);
  await d.ev(`PREP.open(); return 1;`);
  ok(await d.waitFor(`return !!(PREP._host && document.querySelector("#smdPrep .pn-body"));`, 20000), tag + ": PrepNucleus opens");
  // the guard contract: a KB row shows exactly when the reader has that article
  const guard = JSON.parse(await d.ev(`return JSON.stringify({ kb: !!(window.SMD_REASON&&SMD_REASON.hasDiseaseRef&&SMD_REASON.hasDiseaseRef("fibromuscular_dysplasia")),
    kb2: !!window.KB_ENRICHMENT });`));
  if (!guard.kb) {
    await d.ev(`window.KB_ENRICHMENT=window.KB_ENRICHMENT||{byId:{}}; window.KB_ENRICHMENT.byId.fibromuscular_dysplasia={name:"Fibromuscular dysplasia"}; window.KB_ENRICHMENT.byId.zika_virus={name:"Zika virus"}; window.KB_ENRICHMENT.byId.BRAIN_ABSCESS={name:"Brain abscess"}; return 1;`);
    console.log("  (note: KB_ENRICHMENT not loaded in this harness; seeded 3 article names for the open-path test)");
  }
  const kbNow = await d.ev(`return !!(window.SMD_REASON&&SMD_REASON.hasDiseaseRef&&SMD_REASON.hasDiseaseRef("fibromuscular_dysplasia"));`);
  ok(kbNow === true, tag + ": the KB guard passes for the fixture article");
  await d.ev(STUBS);
  const real = JSON.parse(await d.ev(`return JSON.stringify(window.__rxReal);`));
  ok(real.kb && real.proto && real.lesson && real.cards, tag + ": real entry points exist (KB, protocols, lessons, cards)" + (real.drug ? " + Drug Index" : " (Drug Index stubbed: MEDDB not loaded yet)"));
  const full = d.size === "phone";

  for (const it of ITEMS) {
    const t2 = `${tag} ${it.id}`;
    const r = await checkItem(d, t2, it, it.id === "fx-reason-1" || it.id === "fx-reason-old2");
    if (!r || r.old) continue;
    // a closed row opens on tap
    await d.ev(`var s=document.querySelector("#smdPrep details.pn-ro:not([open]) summary"); if(s) s.click(); return 1;`);
    ok(await d.ev(`return document.querySelectorAll("#smdPrep details.pn-ro[open]").length;`) === 2, t2 + ": a tapped row opens");
    await d.ev(`PREP.back(); return 1;`);
  }

  // Learn more opens the right article above PrepNucleus, and closing returns here
  await d.ev(`PREP._host.run([${JSON.stringify(STAMP(ITEMS[0]))}], "study", "Reasoning"); return 1;`);
  await d.waitFor(`return !!document.querySelector("#smdPrep .pn-opt");`, 6000);
  await d.click(`#smdPrep .pn-opt[data-k='0']`);
  await d.waitFor(`return !!document.querySelector("#smdPrep .pn-rx[data-done]");`, 8000);
  await d.click(`#smdPrep [data-act="r-kb"]`);
  ok(JSON.stringify(await d.ev(`return window.__rxCalls;`)).includes('["kb","fibromuscular_dysplasia","prep"]'), tag + ": Learn more opens the fixture article from prep");
  ok(await d.ev(`var el=document.getElementById("dxOverlay"); return !!(el&&el.style.zIndex==="2147480000");`) === true, tag + ": the reader lifts above PrepNucleus");
  await d.ev(`document.getElementById("dxOverlay").classList.remove("on"); return 1;`);
  await sleep(150);
  ok(await d.ev(`var el=document.getElementById("dxOverlay"); return el.style.zIndex===""&&!!document.querySelector("#smdPrep .pn-fb");`) === true, tag + ": closing it puts the overlay back and prep is underneath");
  await d.ev(`var el=document.getElementById("dxOverlay"); if(el) el.remove(); return 1;`);
  // related question opens alone, unanswered
  await d.click(`#smdPrep [data-act="r-rel"]`);
  ok(await d.waitFor(`return !!document.querySelector("#smdPrep .pn-opt") && !document.querySelector("#smdPrep .pn-fb");`, 8000), tag + ": a related question opens alone, unanswered");
  const relQ = await d.ev(`return document.querySelector("#smdPrep .pn-q").textContent.slice(0,40);`);
  ok(/carotid/i.test(relQ), tag + ": it is the linked question (" + relQ + ")");
  await d.ev(`PREP.back(); return 1;`);

  if (full) {
    // drug monograph + lift
    await d.ev(`PREP._host.run([${JSON.stringify(STAMP(ITEMS[1]))}], "study", "Reasoning"); return 1;`);
    await d.waitFor(`return !!document.querySelector("#smdPrep .pn-opt");`, 6000);
    await d.click(`#smdPrep .pn-opt[data-k='0']`);
    await d.waitFor(`return !!document.querySelector("#smdPrep .pn-rx[data-done]");`, 8000);
    await d.click(`#smdPrep [data-act="r-drug"]`);
    ok(JSON.stringify(await d.ev(`return window.__rxCalls;`)).includes('["drug","Metformin"]'), tag + ": the drug row opens the monograph");
    ok(await d.ev(`var el=document.getElementById("dbOverlay"); return !!(el&&el.style.zIndex==="2147480000");`) === true, tag + ": the Drug Index lifts above prep");
    await d.ev(`var el=document.getElementById("dbOverlay"); el.classList.remove("on"); return 1;`);
    await sleep(150);
    ok(await d.ev(`return document.getElementById("dbOverlay").style.zIndex==="";`) === true, tag + ": closing restores it");
    await d.ev(`var el=document.getElementById("dbOverlay"); if(el) el.remove(); return 1;`);
    // revise opens the real lesson at step 1; back returns to the feedback
    await d.click(`#smdPrep .pn-rn[data-act="l-open"]`);
    ok(await d.waitFor(`return /Synthetic placenta lesson/.test(document.querySelector("#smdPrep").textContent);`, 8000), tag + ": Revise opens the lesson");
    await d.ev(`PREP.back(); return 1;`);
    ok(await d.waitFor(`return !!document.querySelector("#smdPrep .pn-fb");`, 5000), tag + ": back returns to the feedback");
    // protocol + schedule revision
    await d.ev(`PREP._host.run([${JSON.stringify(STAMP(ITEMS[3]))}], "study", "Reasoning"); return 1;`);
    await d.waitFor(`return !!document.querySelector("#smdPrep .pn-opt");`, 6000);
    await d.click(`#smdPrep .pn-opt[data-k='0']`);
    await d.waitFor(`return !!document.querySelector("#smdPrep .pn-rx[data-done]");`, 8000);
    await d.click(`#smdPrep [data-act="r-proto"]`);
    ok(JSON.stringify(await d.ev(`return window.__rxCalls;`)).includes('["proto","accidental-hypothermia"]'), tag + ": the protocol row opens that protocol");
    await d.ev(`var el=document.getElementById("sbrefOverlay"); if(el) el.classList.remove("open"); return 1;`);
    await d.click(`#smdPrep .pn-rn[data-act="r-plan"]`);
    ok(await d.waitFor(`return /Today/.test(document.querySelector("#smdPrep").textContent);`, 6000), tag + ": Schedule revision opens Today's plan");
    await d.ev(`PREP.back(); return 1;`);
    ok(await d.waitFor(`return !!document.querySelector("#smdPrep .pn-fb");`, 5000), tag + ": back returns to the feedback");
    // practise runs the related set
    await d.ev(`PREP._host.run([${JSON.stringify(STAMP(ITEMS[2]))}], "study", "Reasoning"); return 1;`);
    await d.waitFor(`return !!document.querySelector("#smdPrep .pn-opt");`, 6000);
    await d.click(`#smdPrep .pn-opt[data-k='0']`);
    await d.waitFor(`return !!document.querySelector("#smdPrep .pn-rx[data-done]");`, 8000);
    await d.click(`#smdPrep .pn-rn[data-act="r-practise"]`);
    ok(await d.waitFor(`return /Related questions/.test(document.querySelector("#smdPrep").textContent) && !!document.querySelector("#smdPrep .pn-opt");`, 8000), tag + ": Practise starts the related set");
    await d.ev(`PREP.back(); return 1;`);
    // flashcards open the deck
    await d.ev(`PREP._host.run([${JSON.stringify(STAMP(ITEMS[5]))}], "study", "Reasoning"); return 1;`);
    await d.waitFor(`return !!document.querySelector("#smdPrep .pn-opt");`, 6000);
    await d.click(`#smdPrep .pn-opt[data-k='0']`);
    await d.waitFor(`return !!document.querySelector("#smdPrep .pn-rx[data-done]");`, 8000);
    await d.click(`#smdPrep [data-act="k-open"]`);
    ok(await d.waitFor(`return /Cards/.test((document.querySelector("#smdPrep .pn-bar")||{}).textContent||"") && !document.querySelector("#smdPrep .pn-fb");`, 8000), tag + ": the Flashcards row opens the deck");
    await d.ev(`PREP.back(); return 1;`);
    // review screen carries the reasoning layout
    await d.ev(`PREP._host.run([${JSON.stringify(STAMP(ITEMS[0]))},${JSON.stringify(STAMP(ITEMS[6]))}], "study", "Review set"); return 1;`);
    await d.waitFor(`return !!document.querySelector("#smdPrep .pn-opt");`, 6000);
    await d.click(`#smdPrep .pn-opt[data-k='0']`);
    await d.waitFor(`return !!document.querySelector("#smdPrep [data-act='next']");`, 5000);
    await d.click(`#smdPrep [data-act="next"]`);
    await d.waitFor(`return (document.querySelector("#smdPrep .pn-bar")||{textContent:""}).textContent.includes("2 of 2");`, 5000);
    await d.click(`#smdPrep .pn-opt[data-k='1']`);
    await d.waitFor(`return !!document.querySelector("#smdPrep [data-act='next']");`, 5000);
    await d.click(`#smdPrep [data-act="next"]`);
    ok(await d.waitFor(`return !!document.querySelector("#smdPrep [data-act='reviewq']");`, 8000), tag + ": the set finishes with review rows");
    await d.click(`#smdPrep [data-act="reviewq"]`);
    ok(await d.waitFor(`return !!document.querySelector("#smdPrep .pn-fb");`, 5000), tag + ": review opens");
    await d.waitFor(`return !!((document.querySelector("#smdPrep .pn-rx")||{}).getAttribute("data-done"));`, 8000);
    const rv = await feedbackState(d);
    ok(rv.h3.includes("Key clues") && rv.open === 1 && rv.pearl === "Exam pearl" && rv.next.split("|")[0] === "r-kb", tag + ": review shows sections, the pick open, pearl, next action");
    // 44px targets on every new control
    const px = JSON.parse(await d.ev(`return JSON.stringify(Array.from(document.querySelectorAll("#smdPrep summary, #smdPrep .pn-rlr, #smdPrep .pn-rn, #smdPrep .pn-rqr")).map(function(e){return Math.round(e.getBoundingClientRect().height*10)/10;}));`));
    ok(px.length > 3 && px.every((h) => h >= 43.5), tag + ": new controls >= 44px (" + px.join(",") + ")");
    await d.ev(`PREP.back(); PREP.back(); return 1;`);
  }
  // without the module file at all, an old item renders exactly as with it
  const old2 = ITEMS[7];
  await d.ev(`delete window.PREP_REASON; localStorage.removeItem("smd_prep_v1"); PREP._host.run([${JSON.stringify(STAMP(old2))}], "study", "Reasoning"); return 1;`);
  await d.waitFor(`return !!document.querySelector("#smdPrep .pn-opt");`, 6000);
  await d.click(`#smdPrep .pn-opt[data-k='${(old2.a + 1) % old2.o.length}']`);
  if (await d.waitFor(`return !!document.querySelector("#smdPrep .pn-fb");`, 5000)) {
    const hn = (await d.ev(`return document.querySelector("#smdPrep .pn-fb").outerHTML;`)).replace(" pn-new", "");
    ok(hn === (d.stash && d.stash[old2.id]), tag + ": old feedback identical with the module file missing");
  } else ok(false, tag + ": old feedback renders with the module file missing");
  ok(d.errors().length === 0, tag + ": no uncaught PrepNucleus error" + (d.errors().length ? ": " + d.errors().join(" | ").slice(0, 300) : ""));
}

/* ---------- playwright-core drivers (Chrome + WebKit, served from disk, no server) ---------- */
async function loadPW() {
  const tries = [];
  if (process.env.PLAYWRIGHT_CORE) tries.push(process.env.PLAYWRIGHT_CORE);
  tries.push(join(ROOT, "node_modules", "playwright-core"));
  const npx = join(os.homedir(), ".npm", "_npx");
  try { for (const dd of fs.readdirSync(npx)) tries.push(join(npx, dd, "node_modules", "playwright-core")); } catch {}
  for (const p of tries) {
    if (!fs.existsSync(join(p, "index.mjs"))) continue;
    const pw = await import(pathToFileURL(join(p, "index.mjs")).href);
    const exes = {};
    for (const k of ["chromium", "webkit"]) { try { const e = pw[k].executablePath(); if (e && fs.existsSync(e)) exes[k] = e; } catch {} }
    if (exes.chromium || exes.webkit) return { pw, exes };
  }
  return null;
}
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
function serveFile(route) {
  let p = decodeURIComponent(new URL(route.request().url()).pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = join(ROOT, p.replace(/^\/+/, ""));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: "" });
  const ext = (f.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
  return route.fulfill({ status: 200, contentType: TYPES[ext] || "application/octet-stream", body: fs.readFileSync(f) });
}
async function pwDriver(name, browser, size, theme) {
  const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: 2, isMobile: size === "phone", hasTouch: true, ignoreHTTPSErrors: true });
  await ctx.addInitScript({ content: INIT });
  const page = await ctx.newPage();
  await page.route("https://prep.test/**", serveFile);
  const errors = [];
  page.on("pageerror", (e) => { if (/prep|PREP/i.test(String((e && e.stack) || e))) errors.push(String((e && e.message) || e)); });
  const wrap = (e) => `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`;
  const d = {
    name, size, theme, errors: () => errors,
    ev: (e) => page.evaluate(wrap(e)),
    waitFor: async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await page.evaluate(wrap(e)) === true) return true; } catch {} await sleep(150); } return false; },
    click: async (sel) => page.click("#smdPrep " + sel.replace(/^#smdPrep /, "")).then(() => true, () => false),
    shot: async (name) => {
      if (!SHOTS) return;
      await sleep(120);
      try { await page.evaluate(FINISH_ANIMS); } catch {}
      try { await page.evaluate(`var f=document.querySelector("#smdPrep .pn-fb"), b=document.querySelector("#smdPrep .pn-body"); if(f&&b) b.scrollTop += f.getBoundingClientRect().top - b.getBoundingClientRect().top - 12;`); } catch {}
      await page.screenshot({ path: join(SHOTS, name + ".png") });
    },
    setup: async () => {
      await page.goto("https://prep.test/?prep=1", { waitUntil: "domcontentloaded" });
      try { await page.evaluate(`try{localStorage.setItem("smd_prep","1"); localStorage.removeItem("smd_prep_v1");}catch(e){} indexedDB.deleteDatabase("prep-bank");`); } catch {}
    },
    close: async () => { try { await ctx.close(); } catch {} },
  };
  return d;
}

/* ---------- main ---------- */
try {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const found = await loadPW();
  if (!found) { console.log("SKIP: no playwright-core with an installed browser (set PLAYWRIGHT_CORE)"); process.exit(0); }
  const CHROME = process.env.CHROME || "";
  for (const b of BROWSERS) {
    let browser = null;
    try {
      if (b === "chrome") {
        const cands = [];
        if (CHROME && fs.existsSync(CHROME)) cands.push({ label: "CHROME=" + CHROME, opts: { executablePath: CHROME } });
        if (found.exes.chromium) cands.push({ label: "bundled chromium", opts: {} });
        let lastErr = null;
        for (const c of cands) {
          try { browser = await found.pw.chromium.launch({ ...c.opts, args: ["--no-sandbox", "--disable-dev-shm-usage"] }); console.log("  (chrome via " + c.label + " " + browser.version() + ")"); break; }
          catch (e) { lastErr = e; console.log("  (note: " + c.label + " would not launch: " + String((e && e.message) || e).split("\n")[0] + ")"); }
        }
        if (!browser) { console.log("FAIL chrome: a Chromium binary is present but none launches (" + String((lastErr && lastErr.message) || "none").split("\n")[0] + ")"); fails++; continue; }
      } else if (b === "webkit") {
        if (!found.exes.webkit) { console.log("SKIP webkit: no installed WebKit"); continue; }
        browser = await found.pw.webkit.launch();
        console.log("  (webkit " + browser.version() + ")");
      } else continue;
    } catch (e) { console.log("FAIL harness: cannot launch " + b + ": " + (e && e.message || e)); fails++; continue; }
    try {
      for (const size of sizes) for (const theme of themes) {
        const d = await pwDriver(b, browser, size, theme);
        try { await runCombo(d); } catch (e) { console.log("FAIL harness " + b + " " + size + " " + theme + ": " + (e && e.stack || e)); fails++; }
        finally { await d.close(); }
      }
    } finally { try { await browser.close(); } catch {} }
  }
} catch (e) {
  console.log("FAIL harness: " + (e && e.stack || e)); fails++;
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

