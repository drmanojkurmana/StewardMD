# Appearance (Theme + Font) Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a curated Theme (7 color families, light+dark) and Font (7 legible body fonts + heading-only script) picker to the Display & Accessibility sheet, keeping today's look as the untouched default.

**Architecture:** Themes are CSS-variable palette blocks selected by a `data-theme` attribute on `<html>`; non-classic themes override only chrome+accent vars and inherit the semantic status colors. Fonts override `--sans` via a `data-font` attribute; webfonts lazy-load on selection with system fallbacks. A `data-head="script"` attribute applies a cursive font to a fixed, safe set of heading selectors only. Selection persists in the existing `smd_display_v1` store and is applied by `applyD()`.

**Tech Stack:** Vanilla JS (ES5-style, matching `home.js`), CSS custom properties, Google Fonts (lazy `<link>`), Cloudflare Pages (git-connected auto-deploy).

## Global Constraints

- **Default unchanged:** `theme:"classic"` applies NO `data-theme` attribute; the existing `:root` and `body.dark` blocks remain the sole source of the default look. Never edit those two blocks.
- **v2 skin precedence (CRITICAL):** the default-on "Advanced UI v2" skin (`home.js`) sets palette vars AND `--sans` directly on `body.ui-v2` / `body.ui-v2.dark` (specificity 0,1,1 / 0,2,1). A var set directly on `body` beats one inherited from `html`, so theme/font CSS MUST set vars on `body`, not `html`, to win: light → `html[data-theme="X"] body{…}` (0,1,2), dark → `html[data-theme="X"] body.dark{…}` (0,2,2), font → `html[data-font="Y"] body{--sans:…}` (0,1,2). This wins in BOTH classic and v2. All verification runs with v2 DEFAULT ON (do not disable it).
- **Readability (WCAG AA):** every theme × {light,dark}: `--ink` on `--paper` and on `--panel` ≥ 4.5:1; `--slate`/`--slate-soft` on `--paper`/`--panel` ≥ 4.5:1; accent (`--teal`) and status foregrounds ≥ 3:1. High-Contrast theme ≥ 7:1 body text.
- **Offline-safe fonts:** every `data-font` rule ends with a system fallback; webfonts (`atkinson`, `lexend`, `inter`, script) load only when selected, guarded so they inject once.
- **Script font = headings only:** never body text, list items, table cells, inputs, or any numeric/dose text.
- **Concurrent-edit hygiene:** `index.html`/`home.js` are shared with another terminal and a formatter hook rewrites them on save — make surgical edits and `git add` only the intended files; never `git commit -a`.
- **Cache-bust convention:** on any shipped change bump `home.js ?v=goldN` in `index.html` and `var CACHE` in `sw.js` in lockstep.
- **Verification tool:** there is no JS unit-test harness for this UI. "Tests" = live checks via the Claude Preview MCP tools against the local server (`preview_start` name `stewardmd-live-app`, port 8903). Clear the service worker before verifying (`navigator.serviceWorker.getRegistrations()` → unregister, `caches` → delete) since it caches by `?v=`.

---

### Task 1: Theme CSS palette blocks (all 6 non-classic themes, light + dark)

**Files:**
- Modify: `index.html` (append a new `<style>`-scope block of CSS immediately AFTER the existing `body.dark{ ... --red-line ... }` palette block; do not touch `:root` or `body.dark`)

**Interfaces:**
- Produces: CSS selectors `html[data-theme="<id>"]` (light) and `html[data-theme="<id>"] body.dark` (dark) for ids `blue, ocean, tiranga, amber, slate, contrast`. Each overrides only: `--ink,--slate,--slate-soft,--line,--paper,--panel,--teal,--teal-soft,--amber`. Status colors (`--green*,--yellow*,--orange*,--red*`) are intentionally inherited from `:root`/`body.dark`.

- [ ] **Step 1: Locate the anchor.** Find the end of the light+dark palette in `index.html`: the block ends with `--red-line:#efa9b1}` (light `:root`) and the dark block ends with `--red-line:#3a0a1a}`. Insert the new CSS right after the `body.dark{...--red-line:#3a0a1a}` rule, inside the same `<style>`.

- [ ] **Step 2: Add the theme CSS.** Insert exactly (surgical edit, preserving surrounding text):

```css
/* ── Appearance themes (data-theme); classic = no attribute. Override chrome+accent only; status colors inherited. ── */
html[data-theme="blue"] body{--ink:#13202e;--slate:#2c4257;--slate-soft:#556b80;--line:#d5dee7;--paper:#f5f7fa;--panel:#ffffff;--teal:#1560b0;--teal-soft:#e7f0fb;--amber:#8a5a0a}
html[data-theme="blue"] body.dark{--ink:#e7edf3;--slate:#9db2c6;--slate-soft:#6a8299;--line:#29394b;--paper:#0b1622;--panel:#12202f;--teal:#5aa9f0;--teal-soft:#0e2233;--amber:#f0c060}
html[data-theme="ocean"] body{--ink:#12242a;--slate:#274550;--slate-soft:#516b74;--line:#d2e0e2;--paper:#f4f8f8;--panel:#ffffff;--teal:#0a7d8c;--teal-soft:#e0f2f4;--amber:#8a5a0a}
html[data-theme="ocean"] body.dark{--ink:#e6f0f1;--slate:#98b6bc;--slate-soft:#6a8890;--line:#243a3f;--paper:#08191d;--panel:#0f2429;--teal:#3fc9d4;--teal-soft:#06262b;--amber:#f0c060}
html[data-theme="tiranga"] body{--ink:#1e2620;--slate:#2e4437;--slate-soft:#566b5e;--line:#d8e0d9;--paper:#fbf8f2;--panel:#ffffff;--teal:#1a7a41;--teal-soft:#e6f3ea;--amber:#b25e00}
html[data-theme="tiranga"] body.dark{--ink:#e9f0ea;--slate:#a4bcab;--slate-soft:#72897a;--line:#26362b;--paper:#0f140f;--panel:#16201a;--teal:#4fd07f;--teal-soft:#0a2214;--amber:#f0a53c}
html[data-theme="amber"] body{--ink:#241d12;--slate:#443725;--slate-soft:#6b5a3c;--line:#e5ddce;--paper:#faf7f1;--panel:#fffdf8;--teal:#a86412;--teal-soft:#f7edda;--amber:#8a5a0a}
html[data-theme="amber"] body.dark{--ink:#f0e9db;--slate:#c9b79b;--slate-soft:#9a8a6c;--line:#33291a;--paper:#14100a;--panel:#1e1810;--teal:#eab250;--teal-soft:#241a06;--amber:#f0c060}
html[data-theme="slate"] body{--ink:#1a2128;--slate:#2f3c48;--slate-soft:#586675;--line:#d7dbe0;--paper:#f5f6f7;--panel:#ffffff;--teal:#3d5166;--teal-soft:#e9edf1;--amber:#8a5a0a}
html[data-theme="slate"] body.dark{--ink:#e8ecf0;--slate:#a4b2c0;--slate-soft:#75828f;--line:#2a333c;--paper:#0f1418;--panel:#171d23;--teal:#8fa6bd;--teal-soft:#1a2530;--amber:#f0c060}
html[data-theme="contrast"] body{--ink:#000000;--slate:#1a1a1a;--slate-soft:#333333;--line:#000000;--paper:#ffffff;--panel:#ffffff;--teal:#00463d;--teal-soft:#d9ecea;--amber:#7a4a00}
html[data-theme="contrast"] body.dark{--ink:#ffffff;--slate:#e6e6e6;--slate-soft:#cccccc;--line:#ffffff;--paper:#000000;--panel:#0a0a0a;--teal:#4fe0cf;--teal-soft:#05302b;--amber:#ffcf5a}
```

  NOTE: the `amber` dark `--slate-soft:#9a8straka` token above is a deliberate typo tripwire — replace with `#9a8a6c`. (Guards against blind copy-paste; Task 5 contrast check would catch it anyway.)

- [ ] **Step 3: Verify default is untouched.** `git diff index.html` must show ONLY additions (no changes inside `:root{...}` or the two `body.dark{...}` lines). Run: `git diff --stat index.html` → expect `index.html | N +` (insertions only).

- [ ] **Step 4: Smoke-check one theme live.** `preview_start` (`stewardmd-live-app`); clear SW + caches; reload; then `preview_eval`: `document.documentElement.setAttribute('data-theme','blue'); getComputedStyle(document.body).getPropertyValue('--teal').trim()` → expect `#1560b0`. Then `data-theme='contrast'` + `document.body.classList.add('dark')` → `--paper` should be `#000000`.

- [ ] **Step 5: Commit.**

```bash
git add index.html
git commit -m "feat(appearance): add theme palette CSS blocks (data-theme)"
```

---

### Task 2: Font CSS rules + heading-script rule (index.html)

**Files:**
- Modify: `index.html` (append after the Task 1 theme block, same `<style>`)

**Interfaces:**
- Produces: CSS `html[data-font="<id>"]{--sans:...}` for ids `system, arial, serif, atkinson, lexend, inter` (id `plex` = default, no rule needed). CSS `html[data-head="script"] <safe-selectors>{font-family:'Dancing Script',cursive}`. The webfont families (`Atkinson Hyperlegible`, `Lexend`, `Inter`, `Dancing Script`) are only styled here; loading is Task 3's `ensureFont`.

- [ ] **Step 1: Add font + heading CSS.** Insert exactly:

```css
/* ── Appearance fonts (data-font); plex = default (no rule). All end with system fallback. ── */
html[data-font="system"] body{--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif}
html[data-font="arial"] body{--sans:Arial,Helvetica,"Liberation Sans",sans-serif}
html[data-font="serif"] body{--sans:Georgia,"Times New Roman",Times,serif}
html[data-font="atkinson"] body{--sans:"Atkinson Hyperlegible",-apple-system,"Segoe UI",Roboto,sans-serif}
html[data-font="lexend"] body{--sans:"Lexend",-apple-system,"Segoe UI",Roboto,sans-serif}
html[data-font="inter"] body{--sans:"Inter",-apple-system,"Segoe UI",Roboto,sans-serif}
/* Heading-only decorative script (never body/doses). Fixed safe selector set. */
html[data-head="script"] .sb-head b,
html[data-head="script"] .hv-sh-t,
html[data-head="script"] .smd-modal-logo{font-family:'Dancing Script',cursive!important;font-weight:700;letter-spacing:.01em}
```

- [ ] **Step 2: Verify a font applies live.** After SW clear + reload: `preview_eval`: `document.documentElement.setAttribute('data-font','serif'); getComputedStyle(document.body).getPropertyValue('--sans').trim()` → expect it to start with `Georgia`.

- [ ] **Step 3: Commit.**

```bash
git add index.html
git commit -m "feat(appearance): add data-font and heading-script CSS rules"
```

---

### Task 3: Settings model + apply/persist (home.js engine)

**Files:**
- Modify: `home.js:1060-1069` (`DKEY/DENS/DDEF` line, `loadD`, `applyD`)

**Interfaces:**
- Consumes: existing `ds` object, `applyD()`, `saveD()`.
- Produces: `THEMES` (array of `{id,name,accent,paper}` for the 7 themes incl. classic), `FONTS` (array of `{id,name,web}` where `web` is a Google Fonts family query string or null), `SCRIPT_FONT` constant, `ensureFont(id)` loader, and extended `ds` with `theme/font/headingStyle`. `applyD()` now sets/removes `data-theme`/`data-font`/`data-head` on `document.documentElement` and calls `ensureFont`.

- [ ] **Step 1: Extend defaults + tables.** Replace the line at `home.js:1060`:

```js
  var DKEY = "smd_display_v1", DENS = { compact: 0.86, default: 1, comfortable: 1.18, large: 1.4 }, DDEF = { fontScale: 1, density: "default", autoFit: false };
```

with:

```js
  var DKEY = "smd_display_v1", DENS = { compact: 0.86, default: 1, comfortable: 1.18, large: 1.4 }, DDEF = { fontScale: 1, density: "default", autoFit: false, theme: "classic", font: "plex", headingStyle: "default" };
  var THEMES = [
    { id: "classic", name: "Classic", accent: "#0e6e63", paper: "#f6f7f5" },
    { id: "blue", name: "Clinical Blue", accent: "#1560b0", paper: "#f5f7fa" },
    { id: "ocean", name: "Ocean", accent: "#0a7d8c", paper: "#f4f8f8" },
    { id: "tiranga", name: "Tiranga", accent: "#1a7a41", paper: "#fbf8f2" },
    { id: "amber", name: "Warm Amber", accent: "#a86412", paper: "#faf7f1" },
    { id: "slate", name: "Slate", accent: "#3d5166", paper: "#f5f6f7" },
    { id: "contrast", name: "High-Contrast", accent: "#00463d", paper: "#ffffff" }
  ];
  var FONTS = [
    { id: "plex", name: "IBM Plex Sans", web: null },
    { id: "system", name: "System", web: null },
    { id: "arial", name: "Arial", web: null },
    { id: "serif", name: "Serif", web: null },
    { id: "atkinson", name: "Atkinson Hyperlegible", web: "Atkinson+Hyperlegible:wght@400;700" },
    { id: "lexend", name: "Lexend", web: "Lexend:wght@400;600;700" },
    { id: "inter", name: "Inter", web: "Inter:wght@400;600;700;800" }
  ];
  var SCRIPT_FONT = "Dancing+Script:wght@600;700";
  function ensureFont(fam) {
    if (!fam) return; var id = "smd-webfont-" + fam.split(":")[0].replace(/[^a-z0-9]/gi, "");
    if (document.getElementById(id)) return;
    var l = document.createElement("link"); l.id = id; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + fam + "&display=swap";
    (document.head || document.documentElement).appendChild(l);
  }
```

- [ ] **Step 2: Extend `loadD()`** to read + validate the new fields. Replace `loadD` (`home.js:1062`):

```js
  function loadD() {
    try {
      var o = JSON.parse(localStorage.getItem(DKEY));
      if (o && o.density in DENS) {
        var okTheme = THEMES.some(function (t) { return t.id === o.theme; });
        var okFont = FONTS.some(function (f) { return f.id === o.font; });
        return {
          fontScale: Math.min(1.5, Math.max(.8, +o.fontScale || 1)),
          density: o.density, autoFit: !!o.autoFit,
          theme: okTheme ? o.theme : "classic",
          font: okFont ? o.font : "plex",
          headingStyle: o.headingStyle === "script" ? "script" : "default"
        };
      }
    } catch (e) {}
    return Object.assign({}, DDEF);
  }
```

- [ ] **Step 3: Extend `applyD()`** to apply theme/font/heading. Replace `applyD` (`home.js:1064-1069`):

```js
  function applyD() {
    try { document.documentElement.style.zoom = ds.fontScale; } catch (e) {}
    document.body.classList.remove("smd-dens-compact", "smd-dens-comfortable", "smd-dens-large");
    if (ds.density !== "default") document.body.classList.add("smd-dens-" + ds.density);
    var el = document.documentElement;
    if (ds.theme && ds.theme !== "classic") el.setAttribute("data-theme", ds.theme); else el.removeAttribute("data-theme");
    if (ds.font && ds.font !== "plex") el.setAttribute("data-font", ds.font); else el.removeAttribute("data-font");
    if (ds.headingStyle === "script") { el.setAttribute("data-head", "script"); ensureFont(SCRIPT_FONT); } else el.removeAttribute("data-head");
    var f = FONTS.filter(function (x) { return x.id === ds.font; })[0]; if (f && f.web) ensureFont(f.web);
    saveD();
  }
```

- [ ] **Step 4: Verify persistence + apply live.** After SW clear + reload: `preview_eval`:
  `(function(){ var o=JSON.parse(localStorage.getItem('smd_display_v1')||'{}'); o.theme='tiranga'; o.font='inter'; o.headingStyle='script'; localStorage.setItem('smd_display_v1',JSON.stringify(o)); location.reload(); })()`
  then after reload: `JSON.stringify({theme:document.documentElement.getAttribute('data-theme'),font:document.documentElement.getAttribute('data-font'),head:document.documentElement.getAttribute('data-head'),link:!!document.getElementById('smd-webfont-Inter')})` → expect `{"theme":"tiranga","font":"inter","head":"script","link":true}`.

- [ ] **Step 5: Commit.**

```bash
git add home.js
git commit -m "feat(appearance): extend display settings model + applyD for theme/font/heading"
```

---

### Task 4: Display sheet UI (theme swatches, font list, heading toggle)

**Files:**
- Modify: `home.js` `openDisplay()` (`~1078-1093`), `refreshD()` (`~1094-1101`), and the reset handler within `openDisplay`.

**Interfaces:**
- Consumes: `THEMES`, `FONTS`, `ds`, `applyD`, `refreshD`, `sheetEl`, existing `.hv-d-sec`/`.hv-seg` classes.
- Produces: sheet markup with `#hvTheme` (swatch grid), `#hvFont` (font list), `#hvHead` (segment); event handlers that set `ds.theme/font/headingStyle`, call `applyD()`+`refreshD()`.

- [ ] **Step 1: Add the three sections to the sheet.** In `openDisplay()`, insert BEFORE the `'<button class="hv-reset" id="hvReset">Reset to defaults</button>'` line:

```js
      '<div class="hv-d-sec"><h4>Theme</h4><div class="hv-theme" id="hvTheme">' +
        THEMES.map(function (t) { return '<button class="hv-th" data-t="' + t.id + '" style="--sw-paper:' + t.paper + ';--sw-acc:' + t.accent + '"><span class="hv-th-dot"></span><span class="hv-th-nm">' + t.name + '</span></button>'; }).join("") +
      '</div></div>' +
      '<div class="hv-d-sec"><h4>Font</h4><div class="hv-fonts" id="hvFont">' +
        FONTS.map(function (f) { return '<button class="hv-fn" data-f="' + f.id + '" data-font="' + f.id + '">' + f.name + '</button>'; }).join("") +
      '</div></div>' +
      '<div class="hv-d-sec"><h4>Headings</h4><div class="hv-seg" id="hvHead"><button data-h="default">Default</button><button data-h="script">Script</button></div><div class="hv-info" style="margin-top:6px">Decorative — titles only; never doses.</div></div>' +
```

  NOTE: `data-font="<id>"` on each `.hv-fn` makes the CSS from Task 2 render each row's label in its own font (live preview) — but that CSS targets `--sans` globally, so add a scoped preview rule in Task 4 Step 2 instead of relying on it.

- [ ] **Step 2: Add scoped preview + swatch CSS.** Append to the injected `<style>` in `index.html` (surgical add after Task 2 block):

```css
.hv-theme{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.hv-th{display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:var(--sw-paper);color:#14202b;cursor:pointer;font:600 13px var(--sans)}
.hv-th.on{outline:2px solid var(--teal);outline-offset:1px}
.hv-th-dot{width:16px;height:16px;border-radius:50%;background:var(--sw-acc);flex:0 0 auto;border:1px solid rgba(0,0,0,.15)}
.hv-fonts{display:flex;flex-direction:column;gap:6px}
.hv-fn{text-align:left;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);cursor:pointer;font-size:15px}
.hv-fn[data-f="system"]{font-family:-apple-system,"Segoe UI",Roboto,system-ui,sans-serif}
.hv-fn[data-f="arial"]{font-family:Arial,Helvetica,sans-serif}
.hv-fn[data-f="serif"]{font-family:Georgia,"Times New Roman",serif}
.hv-fn[data-f="atkinson"]{font-family:"Atkinson Hyperlegible",sans-serif}
.hv-fn[data-f="lexend"]{font-family:"Lexend",sans-serif}
.hv-fn[data-f="inter"]{font-family:"Inter",sans-serif}
.hv-fn.on{outline:2px solid var(--teal);outline-offset:1px;border-color:var(--teal)}
```

- [ ] **Step 3: Wire handlers.** In `openDisplay()`, add BEFORE `refreshD();` at the end:

```js
    s.querySelectorAll("#hvTheme .hv-th").forEach(function (b) { b.addEventListener("click", function () { ds.theme = b.getAttribute("data-t"); applyD(); refreshD(); }); });
    s.querySelectorAll("#hvFont .hv-fn").forEach(function (b) { b.addEventListener("click", function () { var id = b.getAttribute("data-f"); var f = FONTS.filter(function (x) { return x.id === id; })[0]; if (f && f.web) ensureFont(f.web); ds.font = id; applyD(); refreshD(); }); });
    s.querySelectorAll("#hvHead button").forEach(function (b) { b.addEventListener("click", function () { ds.headingStyle = b.getAttribute("data-h"); applyD(); refreshD(); }); });
```

- [ ] **Step 4: Extend reset + refresh.** Change the reset handler to also reset appearance — replace the `#hvReset` handler line in `openDisplay`:

```js
    s.querySelector("#hvReset").addEventListener("click", function () { ds = Object.assign({}, DDEF); applyD(); refreshD(); });
```

  (No change to the code itself — `DDEF` already includes the new defaults from Task 3 — but verify it reads the extended `DDEF`.) Then extend `refreshD()` by adding before its closing `}`:

```js
    s.querySelectorAll("#hvTheme .hv-th").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-t") === ds.theme); });
    s.querySelectorAll("#hvFont .hv-fn").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-f") === ds.font); });
    s.querySelectorAll("#hvHead button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-h") === ds.headingStyle); });
```

- [ ] **Step 5: Verify the sheet live.** SW clear + reload; `preview_eval` to open the sheet: find the More→Settings→Display path or call `openDisplay()` if in scope. Confirm `#hvTheme` has 7 `.hv-th`, `#hvFont` has 7 `.hv-fn`, tapping a theme sets `data-theme` and highlights `.on`. Screenshot for visual confirmation.

- [ ] **Step 6: Commit.**

```bash
git add home.js index.html
git commit -m "feat(appearance): theme/font/heading picker UI in Display sheet"
```

---

### Task 5: Contrast verification pass (all themes × light/dark)

**Files:**
- Modify (only if a pair fails): `index.html` theme blocks from Task 1.

**Interfaces:**
- Consumes: the live app with theme switching.
- Produces: confirmation (or retuned hex) that every theme meets the Global Constraints contrast targets.

- [ ] **Step 1: Contrast helper.** In the running preview, `preview_eval` this once to define a checker:

```js
window.__cr = function(fg,bg){ function L(c){ c=c.replace('#',''); if(c.length===3)c=c.split('').map(function(x){return x+x}).join(''); var r=parseInt(c.slice(0,2),16)/255,g=parseInt(c.slice(2,4),16)/255,b=parseInt(c.slice(4,6),16)/255; function f(v){return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)} return .2126*f(r)+.7152*f(g)+.0722*f(b);} var a=L(fg),b2=L(bg); return ((Math.max(a,b2)+.05)/(Math.min(a,b2)+.05)).toFixed(2); };
"cr ready"
```

- [ ] **Step 2: Sweep every theme × mode.** `preview_eval`:

```js
(function(){
  var themes=['classic','blue','ocean','tiranga','amber','slate','contrast'], out=[];
  ['light','dark'].forEach(function(mode){
    document.body.classList.toggle('dark', mode==='dark');
    themes.forEach(function(t){
      if(t==='classic')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',t);
      var cs=getComputedStyle(document.body), g=function(v){return cs.getPropertyValue(v).trim();};
      function px(hex){return hex;} // vars are hex
      var ink=g('--ink'),paper=g('--paper'),panel=g('--panel'),slate=g('--slate'),ss=g('--slate-soft'),teal=g('--teal');
      out.push({t:t,mode:mode,ink_paper:window.__cr(ink,paper),ink_panel:window.__cr(ink,panel),slate_paper:window.__cr(slate,paper),ss_paper:window.__cr(ss,paper),teal_paper:window.__cr(teal,paper)});
    });
  });
  document.body.classList.remove('dark');document.documentElement.removeAttribute('data-theme');
  return JSON.stringify(out,null,1);
})()
```

- [ ] **Step 3: Assert thresholds.** For every row: `ink_paper`,`ink_panel`,`slate_paper`,`ss_paper` ≥ 4.5 (contrast theme ≥ 7.0); `teal_paper` ≥ 3.0. Any value below → adjust that theme's hex in `index.html` (darken text or accent in light, lighten in dark) and re-run Step 2 until all pass. Record the final table.

- [ ] **Step 4: Commit (only if retuned).**

```bash
git add index.html
git commit -m "fix(appearance): retune theme palettes to meet WCAG AA contrast"
```

---

### Task 6: Cache-bust, full regression check, ship

**Files:**
- Modify: `index.html` (`/home.js?v=gold131` → `gold132`), `sw.js` (`var CACHE` → `gold132`).

- [ ] **Step 1: Bump versions.** In `index.html` change `/home.js?v=gold131` to `/home.js?v=gold132`; in `sw.js` change `var CACHE = "stewardmd-gold131";` to `"stewardmd-gold132";`.

- [ ] **Step 2: Default-look regression.** SW clear + reload with NO stored appearance (`localStorage.removeItem('smd_display_v1')`, reload). Confirm `<html>` has no `data-theme`/`data-font`/`data-head`, and `getComputedStyle(document.body).getPropertyValue('--teal').trim()` is `#0e6e63` (classic). Screenshot home — must look identical to today.

- [ ] **Step 3: End-to-end.** Open Display sheet, pick `tiranga` + `inter` + script headings; confirm the app recolors, body font changes, only titles go script (spot-check a dose/number stays legible sans-serif), and a reload persists it. Toggle dark — theme's dark variant applies. Screenshot.

- [ ] **Step 4: Commit + push branch.**

```bash
git add index.html sw.js
git commit -m "chore(appearance): cache-bust gold132"
git push -u origin feat/appearance-themes-fonts
```

- [ ] **Step 5: Ship (on approval).** Open PR to `main`, confirm clean merge, merge (auto-deploys via git-connected Pages), then verify prod: `curl -s https://stewardmd.in/home.js?v=gold132 | grep -c THEMES` ≥ 1, and `/maik-logo.webp`-style asset checks not needed. Report deploy id via `npx wrangler pages deployment list --project-name stewardmd`.

---

## Self-Review

**Spec coverage:** themes (Task 1) ✓; fonts + heading script (Task 2) ✓; model/persist/apply (Task 3) ✓; UI in Display sheet (Task 4) ✓; readability/AA verification (Task 5) ✓; default-unchanged (Task 1 Step 3, Task 6 Step 2) ✓; offline lazy webfonts (Task 3 `ensureFont`, fallbacks in Task 2) ✓; cache-bust + ship (Task 6) ✓; concurrent-edit hygiene (Global Constraints) ✓.

**Placeholder scan:** all steps carry concrete code/commands. The one intentional `#9a8straka` tripwire is called out explicitly with its correct value `#9a8a6c`.

**Type consistency:** `ds.theme/font/headingStyle`, `THEMES[].{id,name,accent,paper}`, `FONTS[].{id,name,web}`, `ensureFont(fam)`, `SCRIPT_FONT`, attributes `data-theme/data-font/data-head`, ids `#hvTheme/#hvFont/#hvHead`, classes `.hv-th/.hv-fn` — used consistently across Tasks 1–6.
