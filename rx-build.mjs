/* StewardMD — Prescription safety core (pure, unit-tested).
 *
 * Maps a regimen (drug names, optionally with a dose) to prescription lines, taking
 * doses/brands from the deterministic Drug Index FIRST. It NEVER silently invents a
 * dose: a drug not in the Index (and without a caller-supplied dose) gets a null dose
 * and `unverified:true` so the UI flags it "⚠ confirm" and the doctor fills it in.
 * The prescriber reviews, edits and signs — this only assembles a safe draft.
 *
 * Node + browser: ESM. The browser controller dynamic-imports it (`import('/rx-build.mjs')`).
 */

// Brand lists in the Drug Index include class abbreviations ("ppi","h2","laxative"…) as
// search aliases — never print those as a brand.
const CLASS_TOKENS = new Set([
  "ppi", "h2", "h2 blocker", "antiemetic", "laxative", "bulk-forming laxative", "prokinetic",
  "nsaid", "ssri", "snri", "opioid", "statin", "arb", "acei", "ccb", "beta blocker",
  "antibiotic", "antifungal", "antiviral", "antihistamine", "anticoagulant", "steroid"
]);

function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }

export function pickBrand(entry) {
  const brands = (entry && entry.brands) || [];
  const cls = norm(entry && entry.cls);
  const good = brands.find((b) => { const x = norm(b); return x && !CLASS_TOKENS.has(x) && cls.indexOf(x) < 0; });
  return good || brands[0] || null;
}

function findMatch(name, db) {
  const n = norm(name); if (!n) return null;
  return db.find((e) => norm(e.generic) === n)
    || db.find((e) => (e.brands || []).some((b) => norm(b) === n))
    || db.find((e) => norm(e.generic).split(" ")[0] === n)
    || null;
}

const ADVICE_RE = /lifestyle|dietary|\bdiet\b|advice|counsel|hydration|exercise|reassur|fluid intake|fibre|fiber/i;

/* regimen: [{ name|generic, dose?, freq?, duration?, source?('kb'|'ai'), isAdvice? }]
 * db: Drug Index entries [{ generic, cls, brands[], dose }]
 * → [{ drug, brand, dose, freq, duration, source, unverified, isAdvice }] */
export function buildRxLines(regimen, db) {
  if (!Array.isArray(regimen)) return [];
  db = Array.isArray(db) ? db : [];
  return regimen.map((line) => {
    if (!line) return null;
    if (line.isAdvice || ADVICE_RE.test(line.name || "")) {
      return { drug: line.name || "Advice", brand: null, dose: null, freq: null, duration: null, source: "advice", unverified: false, isAdvice: true };
    }
    const match = findMatch(line.name || line.generic, db);
    const hasDose = line.dose != null && line.dose !== "";
    const dose = hasDose ? line.dose : (match ? match.dose : null);
    const brand = match ? pickBrand(match) : (line.brand || null);
    let source, unverified;
    if (match && !hasDose) { source = "db"; unverified = false; }
    else if (hasDose && line.source) { source = line.source; unverified = (line.source === "ai"); }
    else if (hasDose && match) { source = "db"; unverified = false; }
    else if (hasDose) { source = "ai"; unverified = true; }
    else { source = "none"; unverified = true; }
    return {
      drug: match ? match.generic : (line.name || line.generic || ""),
      brand: brand, dose: dose, freq: line.freq || null, duration: line.duration || null,
      source: source, unverified: unverified, isAdvice: false
    };
  }).filter(Boolean);
}

/* ==========================================================================\n * RxChoice™ — prescription cost-choice layer\n *\n * This module is deliberately attached to the prescription builder rather than\n * replacing it. The existing prescription pad remains the source of truth for\n * drug, dose, frequency, duration, verification and signing. RxChoice only\n * presents product/brand choices for the already-written therapy.\n *\n * Browser only. Node imports receive no DOM side effects.\n * ========================================================================== */

function installRxChoice() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.SMD_RXCHOICE) return;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>\"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;"}[c]));
  const cssId = "rxChoiceCss";
  const MODE_KEY = "smd_rxchoice_mode";

  function injectCss() {
    if (document.getElementById(cssId)) return;
    const s = document.createElement("style");
    s.id = cssId;
    s.textContent = `
      .rxchoice-modebar{display:flex;gap:6px;padding:7px;margin:0 0 10px;border:1px solid var(--hbd,#e2e8f0);border-radius:12px;background:var(--paper,#f8faf9)}
      .rxchoice-mode{flex:1;border:0;border-radius:9px;padding:9px 8px;background:transparent;color:var(--hmut,#64748b);font:800 12px var(--hfont,system-ui);cursor:pointer}
      .rxchoice-mode.active{background:var(--hpanel,#fff);color:var(--teal,#0e6e63);box-shadow:0 1px 4px rgba(0,0,0,.09)}
      .rxchoice-ov{position:absolute;inset:0;background:rgba(15,23,42,.42);display:flex;align-items:flex-end;justify-content:center;z-index:20;border-radius:16px}
      .rxchoice-panel{background:var(--hpanel,#fff);color:var(--hink,#0f172a);width:100%;max-height:88%;overflow:auto;border-radius:16px 16px 0 0;padding:15px}
      .rxchoice-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:3px;font:800 16px var(--hfont,system-ui)}
      .rxchoice-sub{font:600 11.5px/1.45 var(--hfont,system-ui);color:var(--hmut,#64748b);margin-bottom:11px}
      .rxchoice-close{border:0;background:transparent;color:var(--hmut,#64748b);font-size:20px;cursor:pointer}
      .rxchoice-item{border:1px solid var(--hbd,#e2e8f0);border-radius:13px;padding:10px;margin:9px 0;background:var(--hpanel,#fff)}
      .rxchoice-drug{font:800 14px var(--hfont,system-ui);color:var(--hink);margin-bottom:8px}
      .rxchoice-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}
      .rxchoice-card{border:1px solid var(--hbd,#e2e8f0);border-radius:10px;padding:8px;min-width:0;background:var(--paper,#f8faf9)}
      .rxchoice-card.bal{border-color:var(--teal,#0e6e63);background:var(--teal-soft,#e3f1ee)}
      .rxchoice-label{font:800 9.5px/1.15 var(--hfont,system-ui);text-transform:uppercase;letter-spacing:.03em;color:var(--hmut,#64748b)}
      .rxchoice-card.bal .rxchoice-label{color:var(--teal,#0e6e63)}
      .rxchoice-brand{font:800 12px/1.2 var(--hfont,system-ui);margin-top:5px;word-break:break-word;color:var(--hink)}
      .rxchoice-mf{font:500 10px/1.25 var(--hfont,system-ui);color:var(--hmut,#64748b);margin-top:3px;min-height:24px}
      .rxchoice-price{font:800 13px var(--hfont,system-ui);margin-top:5px;color:var(--teal,#0e6e63)}
      .rxchoice-use{width:100%;margin-top:6px;border:0;border-radius:7px;padding:6px 5px;background:var(--teal,#0e6e63);color:#fff;font:800 10px var(--hfont,system-ui);cursor:pointer}
      .rxchoice-use.secondary{background:rgba(100,116,139,.12);color:var(--hink)}
      .rxchoice-empty{padding:10px;border-radius:9px;background:rgba(245,158,11,.1);color:#8a5a00;font:600 11.5px/1.4 var(--hfont,system-ui)}
      .rxchoice-total{border-top:1px solid var(--hbd,#e2e8f0);margin-top:11px;padding-top:10px;font:700 12px var(--hfont,system-ui);color:var(--hmut,#64748b)}
      .rxchoice-note{font:600 10.5px/1.45 var(--hfont,system-ui);color:var(--hmut,#64748b);margin-top:8px}
      @media(max-width:560px){.rxchoice-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.rxchoice-panel{max-height:92%}}
      @media print{.rxchoice-modebar,.rxchoice-ov{display:none!important}}
    `;
    document.head.appendChild(s);
  }

  function activeLineData() {
    const sheet = document.getElementById("rxSheet");
    if (!sheet) return [];
    return Array.from(sheet.querySelectorAll("#rxLines .rx-line")).filter((ln) => !ln.classList.contains("adv") && ln.style.display !== "none").map((ln) => ({
      line: ln,
      drug: String((ln.querySelector('[data-f="drug"]') || {}).value || "").trim(),
      brand: String((ln.querySelector('[data-f="brand"]') || {}).value || "").trim(),
      dose: String((ln.querySelector('[data-f="dose"]') || {}).value || "").trim(),
      freq: String((ln.querySelector('[data-f="freq"]') || {}).value || "").trim(),
      duration: String((ln.querySelector('[data-f="duration"]') || {}).value || "").trim()
    })).filter((x) => x.drug);
  }

  function priceNum(b) { const n = Number(b && b.mrp); return Number.isFinite(n) ? n : null; }
  function cleanBrands(arr) {
    const seen = new Set();
    return (arr || []).filter((b) => {
      if (!b || b.discontinued || priceNum(b) == null || !String(b.brand || "").trim()) return false;
      const k = String(b.brand).trim().toLowerCase();
      if (seen.has(k)) return false; seen.add(k); return true;
    }).sort((a,b) => priceNum(a) - priceNum(b));
  }

  function chooseTiers(brands, prescribed) {
    const arr = cleanBrands(brands);
    if (!arr.length) return { generic:null, balanced:null, premium:null, prescribed:null, all:[] };
    const generic = arr[0];
    const premium = arr[arr.length - 1];
    // Balanced is not simply "the second cheapest": use a middle price point while preferring a
    // different manufacturer when the dataset contains one. This is a transparent MVP heuristic;
    // a future verified quality score can replace it without changing the UI contract.
    const uniqueMfr = [];
    const seenM = new Set();
    arr.forEach((b) => { const m=String(b.manufacturer||"").trim().toLowerCase(); if(m && !seenM.has(m)){seenM.add(m);uniqueMfr.push(b);} });
    const pool = uniqueMfr.length >= 2 ? uniqueMfr : arr;
    const balanced = pool[Math.min(pool.length - 1, Math.max(0, Math.round((pool.length - 1) * 0.45)))];
    const prescribedName = String(prescribed || "").trim().toLowerCase();
    const prescribedRow = prescribedName ? arr.find((b) => String(b.brand||"").trim().toLowerCase() === prescribedName) : null;
    return { generic, balanced: balanced || generic, premium, prescribed: prescribedRow, all:arr };
  }

  function apiComposition(drug) {
    try {
      if (!(window.MEDAPI && MEDAPI.searchCompositions && MEDAPI.composition)) return Promise.resolve(null);
      return MEDAPI.searchCompositions(drug, 6).then((d) => {
        const comp = ((d && d.results) || []).map((r) => r && r.composition).filter(Boolean)[0];
        if (!comp) return null;
        return MEDAPI.composition(comp, "price", "all", 80, 0).then((c) => ({ composition:comp, brands:(c && c.brands) || [] }));
      });
    } catch (e) { return Promise.resolve(null); }
  }

  function fmtPrice(b) { return b && priceNum(b) != null ? "₹" + priceNum(b) : "—"; }
  function meta(b) { return [b && b.manufacturer, b && b.form].filter(Boolean).join(" · ") || "Manufacturer not listed"; }

  function setBrand(line, brand) {
    const input = line && line.querySelector('[data-f="brand"]');
    if (!input || !brand) return;
    input.value = brand.brand || "";
    input.dispatchEvent(new Event("input", { bubbles:true }));
    input.dispatchEvent(new Event("change", { bubbles:true }));
  }

  function card(label, b, line, cls, prescribed) {
    if (!b) return `<div class="rxchoice-card ${cls||""}"><div class="rxchoice-label">${esc(label)}</div><div class="rxchoice-empty">No verified product found</div></div>`;
    return `<div class="rxchoice-card ${cls||""}">
      <div class="rxchoice-label">${esc(label)}</div>
      <div class="rxchoice-brand">${esc(b.brand)}</div>
      <div class="rxchoice-mf">${esc(meta(b))}</div>
      <div class="rxchoice-price">${fmtPrice(b)}</div>
      <button type="button" class="rxchoice-use ${prescribed?"secondary":""}" data-rxchoice-use="1">${prescribed?"Keep prescribed":"Use this"}</button>
    </div>`;
  }

  function openChoice() {
    const sheet = document.getElementById("rxSheet");
    if (!sheet) return;
    injectCss();
    const old = sheet.querySelector(".rxchoice-ov"); if (old) old.remove();
    const items = activeLineData();
    const ov = document.createElement("div"); ov.className="rxchoice-ov";
    ov.innerHTML = `<div class="rxchoice-panel" role="dialog" aria-modal="true" aria-label="RxChoice">
      <div class="rxchoice-head"><span>RxChoice™</span><button type="button" class="rxchoice-close" aria-label="Close">&times;</button></div>
      <div class="rxchoice-sub">Same prescribed therapy. Four product choices: Generic, Balanced, Premium and the Doctor Prescribed brand. Alternatives are shown only when the medicine composition can be verified from the connected medicine database.</div>
      <div class="rxchoice-list"><div class="rxchoice-empty">Loading current brand and price data…</div></div>
      <div class="rxchoice-total">Choose an option per medicine. The final prescription remains under the prescriber's control.</div>
      <div class="rxchoice-note">Price is market-data dependent and may change. RxChoice does not imply that a higher-priced brand is clinically superior. The existing prescription dose, route, frequency and duration are not changed by this feature.</div>
    </div>`;
    sheet.appendChild(ov);
    ov.querySelector(".rxchoice-close").addEventListener("click",()=>ov.remove());
    ov.addEventListener("click",(e)=>{if(e.target===ov)ov.remove();});
    const list=ov.querySelector(".rxchoice-list");
    if (!items.length) { list.innerHTML='<div class="rxchoice-empty">Add at least one medicine to use RxChoice.</div>'; return; }
    Promise.all(items.map((it)=>apiComposition(it.drug).then((r)=>({it,r})).catch(()=>({it,r:null})))).then((results)=>{
      let any=false;
      list.innerHTML=results.map(({it,r})=>{
        const tiers=chooseTiers(r && r.brands,it.brand); if(tiers.all.length)any=true;
        const prescribed=tiers.prescribed || (it.brand ? {brand:it.brand} : null);
        const composition=r && r.composition ? r.composition : "";
        return `<section class="rxchoice-item" data-rxchoice-line="1">
          <div class="rxchoice-drug">${esc(it.drug)}${composition?`<span style="display:block;font:600 10.5px var(--hfont);color:var(--hmut,#64748b);margin-top:2px">Verified composition: ${esc(composition)}</span>`:""}</div>
          <div class="rxchoice-grid">
            ${card("Generic · Lowest Cost",tiers.generic,it.line,"",false)}
            ${card("Balanced · Best Value",tiers.balanced,it.line,"bal",false)}
            ${card("Premium · Top Branded",tiers.premium,it.line,"",false)}
            ${card("Doctor Prescribed",prescribed,it.line,"",true)}
          </div>
        </section>`;
      }).join("");
      if(!any) list.innerHTML='<div class="rxchoice-empty">No verified product/price alternatives could be loaded for the medicines in this prescription. The Simple Prescription remains unchanged.</div>';
      Array.from(list.querySelectorAll("[data-rxchoice-use]")).forEach((btn)=>btn.addEventListener("click",()=>{
        const item=btn.closest(".rxchoice-item"); const index=Array.from(list.querySelectorAll(".rxchoice-item")).indexOf(item); const res=results[index];
        if(!res)return; const tiers=chooseTiers(res.r && res.r.brands,res.it.brand); const cards=Array.from(item.querySelectorAll(".rxchoice-card")); const ci=cards.indexOf(btn.closest(".rxchoice-card"));
        const chosen=[tiers.generic,tiers.balanced,tiers.premium,tiers.prescribed || (res.it.brand?{brand:res.it.brand}:null)][ci];
        if(chosen && chosen.brand) setBrand(res.it.line,chosen);
        btn.textContent="Selected"; setTimeout(()=>{try{btn.textContent=(ci===3?"Keep prescribed":"Use this");}catch(e){}},800);
      }));
    });
  }

  function installModeBar(sheet) {
    if (!sheet || sheet.querySelector(".rxchoice-modebar") || !sheet.querySelector("#rxLines")) return;
    injectCss();
    const head=sheet.querySelector(".rx-head"); if(!head)return;
    const bar=document.createElement("div"); bar.className="rxchoice-modebar";
    const saved=localStorage.getItem(MODE_KEY)||"simple";
    bar.innerHTML=`<button type="button" class="rxchoice-mode ${saved==="simple"?"active":""}" data-rxchoice-mode="simple">Simple Prescription</button><button type="button" class="rxchoice-mode ${saved==="choice"?"active":""}" data-rxchoice-mode="choice">RxChoice™</button>`;
    head.insertAdjacentElement("afterend",bar);
    const simple=bar.querySelector('[data-rxchoice-mode="simple"]'), choice=bar.querySelector('[data-rxchoice-mode="choice"]');
    function setMode(mode){
      localStorage.setItem(MODE_KEY,mode); simple.classList.toggle("active",mode==="simple"); choice.classList.toggle("active",mode==="choice");
      if(mode==="choice") openChoice();
    }
    simple.addEventListener("click",()=>setMode("simple")); choice.addEventListener("click",()=>setMode("choice"));
    // A new prescription always opens in the conventional Simple Prescription view, so a previous
    // RxChoice session can never unexpectedly alter the doctor's next prescription.
    simple.classList.add("active"); choice.classList.remove("active"); localStorage.setItem(MODE_KEY,"simple");
  }

  function observe() {
    const target=document.body; if(!target)return;
    const mo=new MutationObserver(()=>{
      const sheet=document.getElementById("rxSheet");
      if(sheet && sheet.classList.contains("on") && sheet.querySelector("#rxLines")) installModeBar(sheet);
    });
    mo.observe(target,{childList:true,subtree:true});
  }

  window.SMD_RXCHOICE={open:openChoice,version:"1.0.0"};
  injectCss(); observe();
}

installRxChoice();
