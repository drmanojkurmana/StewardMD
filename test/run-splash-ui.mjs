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
 *   - phase 2 is the personalised boot splash (84px avatar, status dot), read from the SAME
 *     localStorage "stewardmd_account" record the sidebar/profile use, in both themes, with a
 *     passive "Loading your workspace" pill; both phases fit inside one three-second total,
 *   - the native iOS/Android launch surfaces are unbranded and manual-hide, so the HTML trace is
 *     the first visible logo and begins at the actual native handoff rather than behind it,
 *   - guests/first-time users do NOT get it and keep the classic splash for the whole boot,
 *     are never gated, and still auto-hide,
 *   - prefers-reduced-motion still stills every interstitial,
 *   - no uncaught JS errors are raised on any of those paths.
 * Screenshots are written to $SHOT_DIR (default /tmp) for eyeballing.
 * USAGE: CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node test/run-splash-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
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
  const iosLaunch = readFileSync(join(ROOT, "ios/App/App/Base.lproj/LaunchScreen.storyboard"), "utf8");
  const androidTheme = readFileSync(join(ROOT, "android/app/src/main/res/values/styles.xml"), "utf8");
  const capConfig = JSON.parse(readFileSync(join(ROOT, "capacitor.config.json"), "utf8"));
  ok(!/image="Splash"/.test(iosLaunch), "iOS native launch surface has no standalone logo");
  ok(/windowSplashScreenAnimatedIcon">@android:color\/transparent</.test(androidTheme), "Android native launch icon is transparent");
  ok(capConfig.plugins.SplashScreen.launchAutoHide === false, "native splash waits for the painted web handoff");

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
  // the profile dir persists between runs and a later section signs in: clear on OUR origin
  // first (about:blank has no usable storage), so "first-run" is actually first-run
  await call("Page.navigate", { url: BASE });
  await sleep(600);
  await ev(`localStorage.clear(); try { sessionStorage.clear(); } catch (e) {} return 1;`);
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

  /* ---------- 2. RETURNING signed-in clinician: classic frame, THEN the welcome-back screen ----
     Two passive screens (owner: "i want both"). Screen 1 keeps the classic frame while the mark
     traces and fills over 1.2s. After a 1.5s beat it crossfades into screen 2:
     avatar, name, glass foot. Both phases fit inside one 3s total, then Face ID / PIN
     fires by itself. No button, no hold, on either screen. */
  await newTab();
  await call("Page.navigate", { url: BASE });
  await sleep(1500);
  await ev(`localStorage.setItem("stewardmd_account", JSON.stringify({type:"google",name:"Dr. Manoj Kumar Kurmana",email:"doctor@example.com",picture:"https://example.invalid/photo.jpg"})); return 1;`);
  await call("Page.navigate", { url: BASE });
  await sleep(380);

  const classic = async (label) => {
    okv(await ev(`var e=document.getElementById("smdBootSplash"); return !!e && !e.classList.contains("smd-boot-phase2");`), true,
      label + ": opens on screen 1 (no .smd-boot-phase2)");
    okv(await ev(`var w=document.querySelector("#smdBootSplash .sbs-word"); return w ? w.textContent.trim() : "missing";`), "StewardMD",
      label + ": the Steward/MD wordmark is on screen");
    okv(await ev(`var w=document.querySelector("#smdBootSplash .sbs-word"); if(!w)return "missing";
        var s=getComputedStyle(w), sp=getComputedStyle(w.querySelector("span"));
        if(Math.round(parseFloat(s.fontSize))!==30) return "font-size "+s.fontSize;
        if(parseInt(s.fontWeight,10)!==800) return "weight "+s.fontWeight;
        if(s.color===sp.color) return "wordmark is not two-tone";
        return "classic";`), "classic", label + ": wordmark keeps its classic two-tone 30px/800 setting");
    okv(await ev(`var t=document.querySelector("#smdBootSplash .sbs-tag"); if(!t)return "missing"; return t.offsetHeight>1 ? t.textContent.trim() : "hidden";`),
      "Built by clinicians, for clinicians", label + ": the tagline is on screen");
    okv(await ev(`var b=document.querySelector("#smdBootSplash .sbs-bar"); if(!b)return "missing"; var s=getComputedStyle(b), i=b.firstElementChild;
        if(!i||getComputedStyle(i).display==="none") return "no progress indicator";
        return Math.round(parseFloat(s.width))+"x"+Math.round(parseFloat(s.height));`), "132x3", label + ": the thin classic progress bar");
    okv(await ev(`var m=document.querySelector("#smdBootSplash .sbs-logo"),k=document.querySelector("#smdBootSplash .sbs-mark");
        var e=[m,k].filter(function(x){return x&&getComputedStyle(x).display!=="none"})[0];
        return e ? Math.round(parseFloat(getComputedStyle(e).width)) : 0;`), 107, label + ": the mark is at its classic 107px size");
    okv(await ev(`var h=document.getElementById("sbsHello"); return !h || getComputedStyle(h).display==="none";`), true,
      label + ": the personalised row is not part of screen 1");
    okv(await ev(`var f=document.querySelector("#smdBootSplash .sbs-foot"); if(!f)return "missing";
        var img=[].slice.call(f.querySelectorAll(".sbs-maik")).filter(function(x){return getComputedStyle(x).display!=="none"})[0];
        return getComputedStyle(f).flexDirection==="column" && img && Math.round(parseFloat(getComputedStyle(img).height))===53 ? "classic foot" : "foot changed";`), "classic foot",
      label + ": the developed-by foot keeps its classic stacked composition");
    /* The logo traces and fills while the rest of the classic composition is already present. */
    okv(await ev(`var paths=document.querySelectorAll("#smdBootSplash .sbs-logo-trace path"),fill=[document.querySelector("#smdBootSplash .sbs-logo"),document.querySelector("#smdBootSplash .sbs-mark")].filter(function(x){return x&&getComputedStyle(x).display!=="none"})[0];
        return paths.length===3 && paths[0].getAttribute("pathLength")==="1" && fill && parseFloat(getComputedStyle(fill).opacity)===0 && getComputedStyle(paths[0]).animationPlayState==="running" ? "outline-running" : "missing";`), "outline-running",
      label + ": the visible mark traces without a solid fill");
    okv(await ev(`var bad=[]; [".sbs-word",".sbs-tag",".sbs-foot",".sbs-center"].forEach(function(sel){
        var e=document.querySelector("#smdBootSplash "+sel); if(!e||getComputedStyle(e).display==="none") return;
        var s=getComputedStyle(e); if(s.animationName!=="none") bad.push(sel+":"+s.animationName); if(parseFloat(s.opacity)<1) bad.push(sel+":opacity "+s.opacity); });
        return bad.length ? bad.join(",") : "static";`), "static",
      label + ": the wordmark, tagline and foot remain fully present while the logo draws");
    okv(await ev(`var b=document.querySelector("#smdBootSplash .sbs-go"); return !b && !window.__smdBootGate;`), true,
      label + ": no Open Workspace button, no hold");
  };
  await classic("screen 1 light");
  await shot("splash-05a-boot-classic-light");

  /* ---- screen 2 after the beat ---- */
  await sleep(1500);   // t ~1.9s: past BEAT (1.5s) + the 220ms crossfade
  okv(await ev(`var e=document.getElementById("smdBootSplash"); return !!e && e.classList.contains("smd-boot-phase2");`), true,
    "after the beat the splash crossfades into screen 2");
  ok(await ev(`var e=document.getElementById("sbsHello"); return !!e && !e.hidden && e.offsetHeight>1;`) === true,
    "screen 2: the personalised welcome row is up");
  ok(await ev(`var e=document.getElementById("sbsHelloName"); return e ? e.textContent : "";`) === "Dr. Manoj Kumar Kurmana",
    "screen 2: greeting shows the account name from localStorage stewardmd_account");
  ok(await ev(`var e=document.getElementById("smdBootSplash"); return !!e && e.classList.contains("sbs-personal");`) === true,
    "screen 2: .sbs-personal (generic tagline swapped for the greeting)");
  ok(await ev(`var e=document.getElementById("sbsDp"); return e ? e.textContent : "";`) === "M",
    "screen 2: avatar falls back to the clinician's monogram when the photo cannot load");
  okv(await ev(`var e=document.getElementById("sbsDp"); return e ? Math.round(parseFloat(getComputedStyle(e).width)) : 0;`), 84,
    "screen 2: Direction C avatar treatment (84px)");
  okv(await ev(`var e=document.getElementById("sbsDp"); if(!e)return "no avatar"; var s=getComputedStyle(e,"::after");
      return s.position + " " + Math.round(parseFloat(s.width)) + " " + s.backgroundColor;`), "absolute 16 rgb(77, 214, 140)",
    "screen 2: avatar carries the online-status dot accent");
  okv(await ev(`var h=document.getElementById("sbsHello"); return h ? getComputedStyle(h).animationName : "missing";`), "none",
    "screen 2 arrives as ONE crossfade: the welcome row has no entrance animation of its own");
  ok(await ev(`var e=document.querySelector("#smdBootSplash .sbs-foot"); return e ? getComputedStyle(e).flexDirection : "";`) === "row",
    "screen 2: the 'developed by MaiK' credit is the Direction C glass bar");
  await glass("#smdBootSplash .sbs-foot", "screen 2: the developed-by bar is the liquid-glass material");
  okv(await ev(`var b=document.querySelector("#smdBootSplash .sbs-bar"); return b ? (getComputedStyle(b,"::after").content||"none") : "missing";`).then(v => /Loading your workspace/.test(v)), true,
    "screen 2: the passive 'Loading your workspace' pill (no button)");
  okv(await ev(`var b=document.querySelector("#smdBootSplash .sbs-go"); return !b && !window.__smdBootGate;`), true,
    "screen 2: still no Open Workspace button, no hold");
  await shot("splash-05-boot-personal-monogram");

  /* ---- both screens share one fast 3s window; screen 2 does not add another hold ---- */
  const makeReady = `var g=document.getElementById("accountGate");
      if(g){g.classList.remove("hidden"); g.setAttribute("style","display:block;visibility:visible;opacity:1;min-height:200px");}
      return !!g;`;
  okv(await ev(makeReady), true, "the harness can force the hide loop's ready() condition");
  await sleep(500);    // t ~2.5s
  okv(await ev(`var e=document.getElementById("smdBootSplash"); return !!e && !e.classList.contains("sbs-hide");`), true,
    "screen 2 stays up until the shared 3s window completes");
  await sleep(1100);   // t ~3.6s
  okv(await ev(`var e=document.getElementById("smdBootSplash"); return !e || e.classList.contains("sbs-hide");`), true,
    "the complete two-phase splash hides shortly after 3s (no tap)");

  /* ---- the clocks start when the frame is SEEN: with the native splash lifting late (native-bridge
     stamps __smdSplashShownAt), both the beat and the hold count from that stamp */
  await call("Page.navigate", { url: BASE });
  await sleep(80);
  await ev(`var e=document.getElementById("smdBootSplash");if(e)e.classList.remove("sbs-visible");delete window.__smdSplashShownAt;return 1;`);
  await sleep(1200);   // pretend the unbranded native splash still covers the WebView
  await ev(`window.__smdSplashShownAt = Date.now();var e=document.getElementById("smdBootSplash");if(e)e.classList.add("sbs-visible");return 1;`);
  await ev(makeReady);
  await sleep(700);    // seen ~0.7s: still screen 1
  okv(await ev(`var e=document.getElementById("smdBootSplash"); return !!e && !e.classList.contains("smd-boot-phase2") && !e.classList.contains("sbs-hide");`), true,
    "native splash lifted at 1.2s: 0.7s later it is still screen 1 (beat counts from the stamp)");
  await sleep(1300);   // seen ~2s: screen 2
  okv(await ev(`var e=document.getElementById("smdBootSplash"); return !!e && e.classList.contains("smd-boot-phase2") && !e.classList.contains("sbs-hide");`), true,
    "...and 2s after the stamp it is screen 2, still up");
  await sleep(1300);   // seen ~3.3s
  okv(await ev(`var e=document.getElementById("smdBootSplash"); return !e || e.classList.contains("sbs-hide");`), true,
    "...and hides after 3s total counted from the native handoff");

  // the same two screens in the dark theme (Direction C's gradient mesh on screen 2)
  await newTab();
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await call("Page.navigate", { url: BASE });
  await sleep(1500);
  await ev(`localStorage.setItem("stewardmd_account", JSON.stringify({type:"google",name:"Dr. Manoj Kumar Kurmana",email:"doctor@example.com"})); return 1;`);
  await call("Page.navigate", { url: BASE });
  await sleep(380);
  okv(await ev(`var e=document.getElementById("smdBootSplash"); return !!e && e.classList.contains("sbs-dark");`), true, "the dark theme variant resolves");
  await classic("screen 1 dark");
  await shot("splash-05b-boot-classic-dark");
  await sleep(1800); // allow the 30% slower formation and background crossfade to settle
  ok(await ev(`var e=document.getElementById("smdBootSplash");
      return !!e && e.classList.contains("sbs-dark") && e.classList.contains("smd-boot-phase2") &&
             /radial-gradient/.test(getComputedStyle(e,"::before").backgroundImage||"") &&
             getComputedStyle(e,"::before").opacity === "1";`) === true,
    "dark screen 2 fades up the Direction C gradient mesh");
  await glass("#smdBootSplash .sbs-foot", "dark screen 2: the 'developed by' bar is liquid glass");
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
  await sleep(1600);
  okv(await ev(`var e=document.getElementById("smdBootSplash"); return !!e && !e.classList.contains("smd-boot-phase2");`), true,
    "a guest never enters screen 2 (classic frame for the whole boot)");
  await ev(makeReady);
  await sleep(1700);
  okv(await ev(`var e=document.getElementById("smdBootSplash"); return !e || e.classList.contains("sbs-hide");`), true,
    "the guest splash hides by itself once the 3s frame is up");

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
  okv(await ev(`var t=document.querySelector("#smdBootSplash .sbs-logo-trace"),f=[document.querySelector("#smdBootSplash .sbs-logo"),document.querySelector("#smdBootSplash .sbs-mark")].filter(function(x){return x&&getComputedStyle(x).display!=="none"})[0];return t&&getComputedStyle(t).display!=="none"&&getComputedStyle(t.querySelector("path")).strokeDashoffset==="0px"&&f&&parseFloat(getComputedStyle(f).opacity)===0?"still":"moving";`), "still",
    "prefers-reduced-motion shows the completed mark without tracing");
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
