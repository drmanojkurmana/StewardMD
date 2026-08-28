/* Interstitial UI test (presentation-only, flag-gated: html.smd-splash-v2 - Direction C).
 * Verifies at a 390x844 phone viewport that:
 *   - the flag applies by default and ?splashv2=0 removes it,
 *   - the first-run intro poster renders all three phases with the Direction C CSS in effect
 *     (gradient mesh, glass tile/cards, progress pills),
 *   - the first-run landing splash (#splash) renders with the glass case card and gradient CTA,
 *   - the REAL brand assets are used and resolve: /mark-white.png for the app mark and
 *     /maik-logo-white.png (+ /maik-logo.png for light theme) for the MaiK credit,
 *   - the craft pass holds: the self-hosted Bricolage Grotesque display face genuinely LOADS
 *     (a silent fallback to the system sans would undo the change while leaving the layout
 *     intact), the mark is a hero size with no glass tile around it, and the brand lock-up is
 *     set with light-against-extrabold weight contrast,
 *   - the boot splash is a SEQUENCE, not a replacement: it opens in the CLASSIC composition
 *     (107px mark, two-tone 30px/800 Steward/MD wordmark, "Built by clinicians, for clinicians",
 *     the 132x3 progress bar, the stacked developed-by foot) in BOTH themes, and only after a
 *     short beat crossfades into phase 2,
 *   - phase 2 is the personalised boot splash (84px avatar, status dot, loading pill), read
 *     from the SAME localStorage "stewardmd_account" record the sidebar/profile use, in both
 *     the light and dark themes,
 *   - guests/first-time users do NOT get it and keep the classic splash for the whole boot,
 *   - prefers-reduced-motion still stills every interstitial,
 *   - no uncaught JS errors are raised on any of those paths.
 * Screenshots are written to $SHOT_DIR (default /tmp) for eyeballing.
 * USAGE: CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node test/run-splash-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8992/").replace(/\/?$/, "/");
const PORT = 9384;
const SHOT_DIR = process.env.SHOT_DIR || "/tmp";
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/splash-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8992"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-sandbox", "--disable-gpu", "--mute-audio", "--hide-scrollbars"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0;
const ok = (c, m, got) => { console.log((c ? "PASS " : "FAIL ") + m + (c || got === undefined ? "" : "  [got: " + JSON.stringify(got) + "]")); if (!c) fails++; };
/* assert on a value read once, so a failure reports what was actually measured */
const okv = (v, want, m) => ok(v === want, m, v);

async function shot(name) {
  const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const d = r.result && r.result.data;
  if (!d) { console.log("  (screenshot failed: " + name + ")"); return; }
  const p = join(SHOT_DIR, name + ".png");
  writeFileSync(p, Buffer.from(d, "base64"));
  console.log("  shot -> " + p);
}

async function newTab() {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
}

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params && m.params.exceptionDetails;
      errors.push((d && d.exception && d.exception.description) || (d && d.text) || "unknown");
    }
  };

  /* ---------- 1. FIRST-RUN: intro poster + landing splash ---------- */
  await newTab();
  await call("Page.navigate", { url: BASE });
  await sleep(3500);

  ok(await ev(`return document.documentElement.classList.contains("smd-splash-v2");`) === true,
    "flag applies by default (html.smd-splash-v2)");
  ok(await ev(`var e=document.getElementById("introPoster"); return !!e && getComputedStyle(e).display!=="none";`) === true,
    "#introPoster renders for a first-time user");

  /* ---- the display face must REALLY load ----------------------------------------------
     These screens paint before any network is guaranteed inside the Capacitor shell, so the
     font is self-hosted (assets/fonts/bricolage-grotesque.woff2, @font-face in
     redesign-system.css). A silent fallback to the system sans would leave the layout intact
     and quietly undo the whole change, so assert the family is (a) requested by the CSS,
     (b) actually loaded in document.fonts, and (c) genuinely drawing different glyphs from
     the fallback stack, which is the only check a fallback cannot pass. */
  ok(await ev(`var e=document.querySelector(".ip-appname"); return e ? /Bricolage Grotesque/.test(getComputedStyle(e).fontFamily||"") : false;`) === true,
    "the brand word-mark asks for the Bricolage Grotesque display face");
  ok(await ev(`return document.fonts && document.fonts.check("300 54px 'Bricolage Grotesque'") === true;`) === true,
    "Bricolage Grotesque is loaded in document.fonts (300 54px)");
  ok(await ev(`return document.fonts && document.fonts.check("800 34px 'Bricolage Grotesque'") === true;`) === true,
    "the extrabold end of the weight axis is loaded too (800 34px)");
  okv(await ev(`var loaded=[]; document.fonts.forEach(function(f){ if(f.family.indexOf("Bricolage")>=0) loaded.push(f.family+" "+f.weight+" "+f.status); });
      return loaded.join(",")||"NOT LOADED";`), "Bricolage Grotesque 200 800 loaded",
    "the self-hosted variable face is in the loaded font set with its full weight axis");
  ok(await ev(`
      function w(fam){var c=document.createElement("canvas").getContext("2d");c.font="300 54px "+fam;return c.measureText("StewardMD").width;}
      var dsp=w("'Bricolage Grotesque'"), fb=w("'Inter Variable',system-ui,sans-serif");
      return Math.abs(dsp-fb) > 1;`) === true,
    "the display face actually draws (its metrics differ from the fallback stack)");
  ok(await ev(`var e=document.querySelector(".ip-dot.active"); return e ? getComputedStyle(e).width : "";`) === "20px",
    "revamped progress dots in effect (active dot 20px)");
  ok(await ev(`var e=document.querySelector(".ip-skip"); return e ? getComputedStyle(e).borderTopLeftRadius : "";`) === "999px",
    "revamped skip control in effect (pill radius)");
  ok(await ev(`var e=document.querySelector(".ip-bg"); return e ? /radial-gradient/.test(getComputedStyle(e).backgroundImage||"") : false;`) === true,
    "poster background is the Direction C radial gradient mesh");
  ok(await ev(`var e=document.querySelector(".ip-logo-fallback"); return e ? /mark-white\\.png/.test(getComputedStyle(e).backgroundImage||"") : false;`) === true,
    "phase 1 uses the REAL /mark-white.png app mark");
  /* the craft pass: the mark is a hero, not an icon in a tile. Assert the SIZE (that is the
     owner-visible change) and the absence of the tile chrome that used to box it in. */
  okv(await ev(`var e=document.querySelector(".ip-logo-fallback"); return e ? Math.round(parseFloat(getComputedStyle(e).width)) : 0;`), 152,
    "phase 1 mark is a hero lock-up (152px), not a small tiled icon");
  okv(await ev(`var e=document.querySelector(".ip-logo-wrap"); if(!e)return "no wrap";
      var s=getComputedStyle(e);
      return s.borderTopLeftRadius + " " + s.backgroundImage + " " + s.borderTopWidth;`), "0px none 0px",
    "the generic rounded glass tile around the mark is gone");
  ok(await ev(`var e=document.querySelector(".ip-logo-fallback"); return e ? /drop-shadow/.test(getComputedStyle(e).filter||"") : false;`) === true,
    "the mark carries its own depth (drop-shadow/glow) rather than sitting flat");
  // the poster must clear its own footer: the phase content stops above the dots/skip row
  ok(await ev(`var p=document.getElementById("ipPhase1"),f=document.querySelector(".ip-footer");
      if(!p||!f)return false; return p.getBoundingClientRect().bottom <= f.getBoundingClientRect().top + 1;`) === true,
    "phase content does not collide with the footer at 390x844");
  /* the displayed brand is "StewardMD", never the domain. Functional uses of stewardmd.in
     (api calls, mailto links) are untouched; this is the visible word-mark only. */
  okv(await ev(`var e=document.querySelector(".ip-appname"); return e ? e.textContent.trim() : "missing";`),
    "StewardMD", "poster word-mark reads StewardMD (no .in suffix)");
  await shot("splash-01-intro-phase1");

  // advance to the AMR phase and the credit phase (tap anywhere but the skip button)
  await ev(`var p=document.getElementById("introPoster"); p.click(); return 1;`); await sleep(900);
  ok(await ev(`var e=document.getElementById("ipPhase2"); return !!e && !e.classList.contains("ip-hidden");`) === true,
    "tap advances to the AMR phase");
  ok(await ev(`var e=document.querySelector(".ip-stats"); return e ? getComputedStyle(e).display : "";`) === "grid",
    "AMR stat block is a grid");
  /* the craft pass de-carded this block on purpose: three identical glass panels in a row was
     the most template-looking thing in the set, so the figures are now an open list hung off a
     teal rule. Assert the card chrome is gone and the rule is there. */
  okv(await ev(`var e=document.querySelector(".ip-stats"); if(!e)return "no stats";
      var s=getComputedStyle(e);
      return s.borderTopLeftRadius + " " + s.backgroundImage + " " + s.borderTopWidth;`), "0px none 0px",
    "AMR figures are no longer boxed in a third identical glass card");
  ok(await ev(`var e=document.querySelector(".ip-stats"); if(!e)return false;
      var s=getComputedStyle(e); return parseFloat(s.borderLeftWidth) >= 1 && /rgba?\\(/.test(s.borderLeftColor||"");`) === true,
    "AMR figures hang off a teal rule instead");
  ok(await ev(`var e=document.querySelector(".ip-stat-num"); return e ? /Bricolage Grotesque/.test(getComputedStyle(e).fontFamily||"") : false;`) === true,
    "the AMR figures are set in the display face");
  ok(await ev(`var e=document.querySelector(".ip-amr-head"),k=document.querySelector(".ip-amr-sub");
      if(!e||!k)return false;
      return parseInt(getComputedStyle(e).fontWeight,10) >= 700 && parseInt(getComputedStyle(k).fontWeight,10) <= 300;`) === true,
    "the AMR headline uses real weight contrast (bold head against a light kicker)");
  await shot("splash-02-intro-phase2-amr");

  await ev(`var p=document.getElementById("introPoster"); p.click(); return 1;`); await sleep(900);
  ok(await ev(`var e=document.getElementById("ipPhase3"); return !!e && !e.classList.contains("ip-hidden");`) === true,
    "tap advances to the credit phase");
  okv(await ev(`var e=document.getElementById("ipPhase3"); if(!e)return "no phase";
      var s=getComputedStyle(e); return s.borderTopLeftRadius + "/" + s.borderBottomLeftRadius;`), "26px/8px",
    "credit phase is the one glass card, cut back at the bottom-left so it reads as a shape");
  ok(await ev(`var e=document.querySelector(".ip-grave"); if(!e)return false;
      var s=getComputedStyle(e);
      return /Bricolage Grotesque/.test(s.fontFamily||"") && parseInt(s.fontWeight,10) <= 300 && parseFloat(s.fontSize) >= 18;`) === true,
    "the quote is a large light display setting, not another 15px semibold paragraph");
  ok(await ev(`var e=document.querySelector(".ip-dev-company"); if(!e)return false;
      return /maik-logo-white\\.png/.test(getComputedStyle(e,"::after").backgroundImage||"");`) === true,
    "credit uses the REAL /maik-logo-white.png word-mark (not a drawn lock-up)");
  ok(await ev(`var e=document.querySelector(".ip-dev-maik-logo"); return e ? getComputedStyle(e).display : "gone";`) === "none",
    "the old inline placeholder MaiK image is not rendered under the flag");
  okv(await ev(`var e=document.querySelector(".ip-copy"); return e ? /\\.in\\b/.test(e.textContent||"") : "missing";`),
    false, "the poster copyright line drops the .in too");
  await shot("splash-03-intro-phase3-credit");

  // skip -> the landing splash underneath
  await ev(`var b=document.getElementById("introPosterSkip"); if(b)b.click(); return 1;`); await sleep(1200);
  ok(await ev(`var e=document.getElementById("splash"); return !!e && getComputedStyle(e).display!=="none" && e.offsetHeight>1;`) === true,
    "#splash (landing) renders after the poster is dismissed");
  okv(await ev(`var e=document.querySelector("#splash .demo-card"); return e ? getComputedStyle(e).borderTopLeftRadius : "";`), "22px",
    "Direction C case-preview glass card in effect (radius 22px)");
  ok(await ev(`var e=document.querySelector("#splash .demo-card"); return e ? /blur\\(/.test(getComputedStyle(e).backdropFilter||getComputedStyle(e).webkitBackdropFilter||"") : false;`) === true,
    "case-preview card is glass (backdrop-filter blur)");
  /* ---- the liquid-glass material -------------------------------------------------------
     Every pill/card on the interstitials shares one Apple-style material. The three things a
     flat translucent panel CANNOT fake, and that a silent regression would drop, are asserted
     here: a real refraction (blur + saturate on the backdrop, prefixed AND unprefixed, since
     these ship in WKWebView and Chrome WebView), a 1px specular RIM drawn as a gradient
     border rather than a flat solid one, and layered inset highlights along the edges. */
  const glass = async (sel, label) => {
    const r = await ev(`var e=document.querySelector(${JSON.stringify(sel)}); if(!e)return "MISSING";
        var s=getComputedStyle(e);
        var bf=s.backdropFilter||s.getPropertyValue("-webkit-backdrop-filter")||"";
        var out=[];
        if(!/blur\\(/.test(bf)||!/saturate\\(/.test(bf)) out.push("backdrop-filter="+(bf||"none"));
        if(!/gradient/.test(s.backgroundImage||"")) out.push("no rim/sheen gradient");
        if((s.boxShadow||"").split("inset").length-1 < 2) out.push("no layered inset specular");
        return out.join(", ")||"glass";`);
    okv(r, "glass", label);
  };
  /* The prefixed property is what actually ships: iOS renders these screens in WKWebView.
     Chromium drops -webkit-backdrop-filter at parse time (it is a WebKit-only alias), so the
     CSSOM cannot prove it is there - read the served source instead and require that every
     unprefixed backdrop-filter in the glass material is paired with its -webkit- twin. */
  {
    const src = await (await fetch(BASE)).text();
    const un = (src.match(/(?<!-webkit-)backdrop-filter:var\(--lg-blur/g) || []).length;
    const pf = (src.match(/-webkit-backdrop-filter:var\(--lg-blur/g) || []).length;
    okv(un > 0 && un === pf ? "paired" : "unprefixed=" + un + " prefixed=" + pf, "paired",
      "every liquid-glass backdrop-filter ships with its -webkit- prefixed twin");
  }
  await glass("#splash .demo-card", "landing case card is the liquid-glass material");
  await glass("#splash .splash-module-pill", "landing module chips are the liquid-glass material");
  await glass("#splash .demo-cta", "primary CTA is tinted glass (legible fill + specular rim)");
  await glass("#ipPhase3", "the poster credit card is the liquid-glass material");
  await glass(".ip-skip", "the poster skip pill is the liquid-glass material");
  ok(await ev(`var e=document.querySelector("#splash .demo-drug"); return e ? getComputedStyle(e).borderTopLeftRadius : "";`) === "999px",
    "revamped drug chips in effect (pill radius)");
  ok(await ev(`var e=document.querySelector("#splash .demo-cta"); return e ? /linear-gradient/.test(getComputedStyle(e).backgroundImage||"") : false;`) === true,
    "primary CTA uses the Direction C teal gradient");
  ok(await ev(`var e=document.querySelector("#splash .splash-mark-logo"); return e ? /mark-white\\.png/.test(getComputedStyle(e).backgroundImage||"") : false;`) === true,
    "landing splash uses the REAL /mark-white.png app mark (not a mask or inline SVG)");
  /* the landing hero gets the same craft pass as poster phase 1 */
  okv(await ev(`var e=document.querySelector("#splash .splash-mark-logo"); return e ? Math.round(parseFloat(getComputedStyle(e).width)) : 0;`), 118,
    "landing mark is a hero lock-up (118px), not an icon in a tile");
  okv(await ev(`var e=document.querySelector("#splash .splash-mark"); if(!e)return "no mark";
      var s=getComputedStyle(e);
      return s.borderTopLeftRadius + " " + s.backgroundImage + " " + s.borderTopWidth;`), "0px none 0px",
    "the rounded glass tile is gone from the landing hero too");
  ok(await ev(`var n=document.querySelector("#splash .splash-name"),a=document.querySelector("#splash .splash-name .accent");
      if(!n||!a)return false;
      var sn=getComputedStyle(n), sa=getComputedStyle(a);
      return /Bricolage Grotesque/.test(sn.fontFamily||"") && parseFloat(sn.fontSize) >= 40 &&
             parseInt(sn.fontWeight,10) <= 300 && parseInt(sa.fontWeight,10) >= 800;`) === true,
    "the 'Steward|MD' lock-up is large and set with light-against-extrabold weight contrast");
  await shot("splash-04-landing");

  /* ---------- 2. RETURNING signed-in clinician: CLASSIC boot splash, THEN personalised ----
     The owner's requirement is a sequence, not a replacement: the boot splash must open in its
     original composition (mark, Steward/MD wordmark, tagline, thin progress bar, developed-by
     foot) in both themes, and only then crossfade into the personalised phase 2. Phase 1 is
     asserted first, before the ~900ms beat, then phase 2 after it. */
  await newTab();
  await call("Page.navigate", { url: BASE });
  await sleep(1500);
  await ev(`localStorage.setItem("stewardmd_account", JSON.stringify({type:"google",name:"Dr. Manoj Kumar Kurmana",email:"doctor@example.com",picture:"https://example.invalid/photo.jpg"})); return 1;`);
  await call("Page.navigate", { url: BASE });
  await sleep(380);

  /* ---- phase 1: the classic splash, exactly as it was before the v2 layer ---- */
  const classic = async (label) => {
    okv(await ev(`var e=document.getElementById("smdBootSplash");
        return !!e && !e.classList.contains("smd-boot-phase2");`), true,
      label + ": boot splash opens in the classic phase (no .smd-boot-phase2)");
    okv(await ev(`var w=document.querySelector("#smdBootSplash .sbs-word");
        return w ? w.textContent.trim() : "missing";`), "StewardMD",
      label + ": the Steward/MD wordmark is on screen");
    okv(await ev(`var w=document.querySelector("#smdBootSplash .sbs-word"); if(!w)return "missing";
        var s=getComputedStyle(w), sp=getComputedStyle(w.querySelector("span"));
        if(/Bricolage/.test(s.fontFamily||"")) return "display face (v2 styling leaked)";
        if(Math.round(parseFloat(s.fontSize))!==30) return "font-size "+s.fontSize;
        if(parseInt(s.fontWeight,10)!==800) return "weight "+s.fontWeight;
        if(s.color===sp.color) return "wordmark is not two-tone";
        return "classic";`), "classic",
      label + ": wordmark keeps its classic two-tone 30px/800 setting");
    okv(await ev(`var t=document.querySelector("#smdBootSplash .sbs-tag"); if(!t)return "missing";
        var s=getComputedStyle(t);
        return s.display!=="none" && t.offsetHeight>1 ? t.textContent.trim() : "hidden";`),
      "Built by clinicians, for clinicians", label + ": the tagline is on screen");
    okv(await ev(`var b=document.querySelector("#smdBootSplash .sbs-bar"); if(!b)return "missing";
        var s=getComputedStyle(b), i=b.firstElementChild;
        if(!i||getComputedStyle(i).display==="none") return "no progress indicator";
        return Math.round(parseFloat(s.width))+"x"+Math.round(parseFloat(s.height));`), "132x3",
      label + ": the thin classic progress bar is back (132x3, not the loading pill)");
    okv(await ev(`var b=document.querySelector("#smdBootSplash .sbs-bar");
        return b ? (getComputedStyle(b,"::after").content||"none") : "missing";`), "none",
      label + ": no 'Loading your workspace' pill copy in phase 1");
    okv(await ev(`var m=document.querySelector("#smdBootSplash .sbs-logo"),k=document.querySelector("#smdBootSplash .sbs-mark");
        var e=[m,k].filter(function(x){return x&&getComputedStyle(x).display!=="none"})[0];
        return e ? Math.round(parseFloat(getComputedStyle(e).width)) : 0;`), 107,
      label + ": the mark is at its classic 107px size");
    okv(await ev(`var h=document.getElementById("sbsHello");
        return !h || getComputedStyle(h).display==="none";`), true,
      label + ": the personalised row is not shown yet");
    okv(await ev(`var f=document.querySelector("#smdBootSplash .sbs-foot"); if(!f)return "missing";
        var s=getComputedStyle(f);
        if(s.flexDirection!=="column") return "foot layout is "+s.flexDirection;
        var img=[].slice.call(f.querySelectorAll(".sbs-maik")).filter(function(x){return getComputedStyle(x).display!=="none"})[0];
        if(!img) return "no MaiK logo";
        if(Math.round(parseFloat(getComputedStyle(img).height))!==53) return "MaiK logo "+getComputedStyle(img).height;
        return "classic foot";`), "classic foot",
      label + ": the developed-by foot keeps its classic stacked composition");
    /* the one thing that carries over: the owner asked for the glass material there */
    await glass("#smdBootSplash .sbs-foot", label + ": the developed-by bar is still liquid glass");
  };
  await classic("classic light");
  await shot("splash-05a-boot-classic-light");

  await sleep(900);
  okv(await ev(`var e=document.getElementById("smdBootSplash");
      return !!e && e.classList.contains("smd-boot-phase2");`), true,
    "after the beat the splash transitions into phase 2");

  ok(await ev(`var e=document.getElementById("sbsHello"); return !!e && !e.hidden && e.offsetHeight>1;`) === true,
    "returning signed-in user gets the personalised welcome row");
  ok(await ev(`var e=document.getElementById("sbsHelloName"); return e ? e.textContent : "";`) === "Dr. Manoj Kumar Kurmana",
    "greeting shows the account name from localStorage stewardmd_account");
  ok(await ev(`var e=document.getElementById("smdBootSplash"); return !!e && e.classList.contains("sbs-personal");`) === true,
    "generic tagline is swapped for the personal greeting (.sbs-personal)");
  ok(await ev(`var e=document.getElementById("sbsDp"); return e ? e.textContent : "";`) === "M",
    "avatar falls back to the clinician's monogram when the photo cannot load");
  // layout widths come back sub-pixel under device-metrics emulation, so round before comparing
  okv(await ev(`var e=document.getElementById("sbsDp"); return e ? Math.round(parseFloat(getComputedStyle(e).width)) : 0;`), 84,
    "Direction C avatar treatment (84px) on the personalised boot splash");
  okv(await ev(`var e=document.getElementById("sbsDp"); if(!e)return "no avatar";
      var s=getComputedStyle(e,"::after");
      return s.position + " " + Math.round(parseFloat(s.width)) + " " + s.backgroundColor;`), "absolute 16 rgb(77, 214, 140)",
    "avatar carries the online-status dot accent");
  ok(await ev(`var e=document.querySelector("#smdBootSplash .sbs-bar"); if(!e)return "";
      return (getComputedStyle(e,"::after").content||"").replace(/^["']|["']$/g,"");`) === "Loading your workspace…",
    "translucent loading pill reads 'Loading your workspace...'");
  ok(await ev(`var e=document.querySelector("#smdBootSplash .sbs-foot"); return e ? getComputedStyle(e).flexDirection : "";`) === "row",
    "the 'developed by MaiK' credit is the Direction C glass bar");
  ok(await ev(`var l=document.querySelector("#smdBootSplash .sbs-maik-light"),d=document.querySelector("#smdBootSplash .sbs-maik-dark");
      return !!l && !!d && /maik-logo\\.png/.test(l.getAttribute("src")||"") && /maik-logo-white\\.png/.test(d.getAttribute("src")||"");`) === true,
    "the existing light/dark MaiK logo pairing in .sbs-foot is preserved");
  // the two surfaces the owner circled, in the LIGHT theme (the screenshot he reviewed)
  await glass("#smdBootSplash .sbs-bar", "light boot splash: the loading pill is liquid glass");
  await glass("#smdBootSplash .sbs-foot", "light boot splash: the 'developed by' bar is liquid glass");
  await shot("splash-05-boot-personal-monogram");

  // same layout with a real photo in the avatar (local asset stands in for the Google photoURL)
  await ev(`var d=document.getElementById("sbsDp"); if(d){d.style.backgroundImage='url("/logo.png")';d.textContent="";d.className="sbs-dp has-pic";} return 1;`);
  await sleep(300);
  await shot("splash-06-boot-personal-photo");

  // the same personalised boot splash in the dark theme (Direction C's gradient mesh)
  await newTab();
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await call("Page.navigate", { url: BASE });
  await sleep(1500);
  await ev(`localStorage.setItem("stewardmd_account", JSON.stringify({type:"google",name:"Dr. Manoj Kumar Kurmana",email:"doctor@example.com"})); return 1;`);
  await call("Page.navigate", { url: BASE });
  await sleep(380);
  okv(await ev(`var e=document.getElementById("smdBootSplash");
      return !!e && e.classList.contains("sbs-dark");`), true, "the dark theme variant resolves");
  await classic("classic dark");
  await shot("splash-05b-boot-classic-dark");

  await sleep(900);
  ok(await ev(`var e=document.getElementById("smdBootSplash");
      return !!e && e.classList.contains("sbs-dark") && e.classList.contains("smd-boot-phase2") &&
             /radial-gradient/.test(getComputedStyle(e,"::before").backgroundImage||"") &&
             getComputedStyle(e,"::before").opacity === "1";`) === true,
    "dark boot splash fades up the Direction C gradient mesh in phase 2");
  await glass("#smdBootSplash .sbs-bar", "dark boot splash: the loading pill is liquid glass");
  await glass("#smdBootSplash .sbs-foot", "dark boot splash: the 'developed by' bar is liquid glass");
  await shot("splash-07-boot-personal-dark");
  await call("Emulation.setEmulatedMedia", { features: [] });

  /* ---------- 3. Guest: no personalisation ---------- */
  await newTab();
  await call("Page.navigate", { url: BASE });
  await sleep(1200);
  await ev(`localStorage.clear(); localStorage.setItem("stewardmd_guest_used","1"); return 1;`);
  await call("Page.navigate", { url: BASE });
  await sleep(380);
  ok(await ev(`var e=document.getElementById("sbsHello"); return !e || e.hidden===true;`) === true,
    "guest sees no personalised row (brand tagline retained)");
  /* guests never enter phase 2: their "what you created" is the intro poster + landing that
     follow, so the boot splash stays classic for the whole boot */
  await classic("guest");
  await sleep(1400);
  okv(await ev(`var e=document.getElementById("smdBootSplash");
      return !e || !e.classList.contains("smd-boot-phase2");`), true,
    "a guest never enters phase 2 (classic splash for the whole boot)");

  /* ---------- 4. Flag OFF reverts cleanly ---------- */
  await newTab();
  await call("Page.navigate", { url: BASE + "?splashv2=0" });
  await sleep(2500);
  ok(await ev(`return document.documentElement.classList.contains("smd-splash-v2");`) === false,
    "?splashv2=0 removes the flag");
  ok(await ev(`var e=document.querySelector(".ip-dot.active"); return e ? getComputedStyle(e).width : "";`) === "7px",
    "?splashv2=0 restores the original dots (7px)");
  ok(await ev(`var e=document.getElementById("sbsHello"); return !e || e.hidden===true;`) === true,
    "?splashv2=0 leaves the boot splash unpersonalised");

  /* ---------- 5. prefers-reduced-motion still covers all three interstitials ---------- */
  await newTab();
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await call("Page.navigate", { url: BASE });
  await sleep(3000);
  okv(await ev(`var sel=[".ip-bg",".ip-phase",".ip-logo-fallback"],out=[];
      for(var i=0;i<sel.length;i++){var e=document.querySelector(sel[i]);
        if(!e){out.push(sel[i]+":missing");continue}
        if(getComputedStyle(e).animationName!=="none")out.push(sel[i]+":"+getComputedStyle(e).animationName);}
      return out.join(",")||"all still";`), "all still",
    "prefers-reduced-motion stills the intro poster animations");
  await ev(`localStorage.setItem("stewardmd_account", JSON.stringify({type:"google",name:"Dr. Test",email:"t@example.com"})); return 1;`);
  await call("Page.navigate", { url: BASE });
  await sleep(1200);
  okv(await ev(`var e=document.querySelector("#smdBootSplash .sbs-bar");
      if(!e)return "no bar"; return getComputedStyle(e,"::after").animationName;`), "none",
    "prefers-reduced-motion stills the boot-splash loading pill");
  await call("Emulation.setEmulatedMedia", { features: [] });

  /* ---------- 6. The real brand assets actually resolve (no 404 placeholders) ---------- */
  for (const asset of ["mark-white.png", "maik-logo-white.png", "maik-logo.png",
                       "assets/fonts/bricolage-grotesque.woff2"]) {
    let status = 0;
    try { status = (await fetch(BASE + asset)).status; } catch {}
    ok(status === 200, "/" + asset + " resolves (200, got " + status + ")");
  }

  ok(errors.length === 0, "no uncaught JS errors (" + (errors.length ? errors.join(" | ") : "none") + ")");
} catch (e) {
  console.log("HARNESS ERROR: " + (e && e.stack || e));
  fails++;
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
console.log(fails === 0 ? "ALL PASS" : fails + " FAILED");
process.exit(fails === 0 ? 0 : 1);
