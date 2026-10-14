import fs from "node:fs";
/* Local (no-API) topic-map builder: resolves queued/empty modules in prep/bank/topic-links.json with strict
 * deterministic rules only (name/head subset with distinctive words, shared-words with at most one extra word,
 * acronym disambiguation, same-subject and parent mixed-review lessons). A wrong chapter is worse than none:
 * every tier fails closed and leaves the module for the mixed-review lesson. Run after tools/prep-links-topics.mjs
 * build, then rebuild the links index. Usage: node tools/prep-links-topicmap-local.mjs [--cache dir] */
import { fileURLToPath } from "node:url";
const M = await import("./prep-links.mjs");
const T = await import("./prep-links-topics.mjs");
const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const cacheArg = process.argv[process.argv.indexOf("--cache") + 1];
const doc=JSON.parse(fs.readFileSync(root+"/prep/bank/topic-links.json","utf8"));
const mods=doc.modules;
const kb=M.kbDocs(root), pr=M.protoDocs(root);
const appLes=JSON.parse(fs.readFileSync(root+"/prep/lessons/v1/index.json","utf8")).modules||{};
const liveLes=(cacheArg && fs.existsSync(cacheArg+"/lessons-index.json")) ? JSON.parse(fs.readFileSync(cacheArg+"/lessons-index.json","utf8")).modules||{} : {};
const les={...liveLes}; for(const [k,e] of Object.entries(appLes)) if(!les[k]||e.gen==="hand") les[k]=e;
const GENW=new Set("disease diseases disorder disorders syndrome syndromes management general clinical chronic acute infection infections deficiency failure pain".split(" "));
const sig=(s)=>M.sigWords(s).filter(w=>!GENW.has(w));
// strict pick: candidates whose title sig words are all in module title, at least 1, choose unique max coverage
function strictPick(title, cands){
  const tw=new Set(M.words(title));
  const scored=cands.map(c=>{ const dw=sig(c.match||c.title||c[1]||""); const parts=String(title).replace(/\([^)]*\)/g," ").split(/[,;:\/]| - |\band\b/i).map(x=>x.trim().toLowerCase());
 return {c, dw, ok: dw.length>=1 && (dw.length>=2 || dw[0].length>=7) && dw.every(w=> dw.length===1 ? parts.some(pp=>pp===w||pp===dw[0]) : [...tw].some(t=>t===w||(t.length>=6&&w.length>=6&&t.slice(0,6)===w.slice(0,6))))}; }).filter(x=>x.ok);
  if(!scored.length) return null;
  scored.sort((a,b)=>b.dw.length-a.dw.length);
  if(scored.length>1 && scored[0].dw.length===scored[1].dw.length && (scored[0].c.id||scored[0].c[1])!==(scored[1].c.id||scored[1].c[1])) return null;
  return scored[0].c;
}
let resolvedQ=0, resolvedEmpty=0, addedOverlay=0;
// queued
for(const [mid,e] of Object.entries(mods)){
  if(e.q && e.q.length){
    const cands=e.q.filter(c=>c[3]!=="acr" && c[3]!=="fuzzy").map(c=>({k:c[0],id:c[1],title:c[2],method:c[3]}));
    const pick=strictPick(e.t, cands);
    if(pick){ if(pick.k==="kb") e.kb=[[pick.id,pick.title,pick.method+"+local"]]; else e.pr=[[pick.id,pick.title,pick.method+"+local"]]; e.x=e.q.filter(c=>!(c[0]===pick.k&&c[1]===pick.id)).map(c=>[c[1],c[2]]); delete e.q; delete e.note; resolvedQ++; }
  }
}
// empty
const kbCands=kb.flatMap(d=>[{k:"kb",id:d.id,title:d.name,match:d.name,method:"name-subset"}, {k:"kb",id:d.id,title:d.name,match:String(d.name).split(":")[0],method:"name-head"}]);
const prCands=pr.flatMap(d=>[{k:"pr",id:d.id,title:d.name,match:d.name,method:"name-subset"}, {k:"pr",id:d.id,title:d.name,match:String(d.name).split(":")[0],method:"name-head"}]);
for(const [mid,e] of Object.entries(mods)){
  if((e.kb&&e.kb.length)||(e.pr&&e.pr.length)||e.q) continue;
  const pick=strictPick(e.t, kbCands) || strictPick(e.t, prCands);
  if(pick){ if(pick.k==="kb") e.kb=[[pick.id,pick.title,pick.method+"+local"]]; else e.pr=[[pick.id,pick.title,pick.method+"+local"]]; delete e.note; resolvedEmpty++; }
}
// overlay missing
const ovc=JSON.parse(fs.readFileSync(root+"/prep/bank/overlay-counts.json","utf8")).sets||{};
const overlayMods=new Map();
for(const [set,subs] of Object.entries(ovc)) for(const [sid,ms] of Object.entries(subs||{})) for(const mid of Object.keys(ms)) if(!overlayMods.has(mid)) overlayMods.set(mid,sid);
for(const [mid,sid] of overlayMods){
  if(mods[mid]) continue;
  const lesson=les[mid];
  const entry={s:sid, t: lesson?lesson.title: mid, kb:[], pr:[]};
  if(lesson && lesson.title) entry.ls=[[mid, lesson.title]];
  else { const pick=strictPick(entry.t, kbCands); if(pick) entry.kb=[[pick.id,pick.title,pick.method+"+local"]]; else entry.note="no candidate"; }
  mods[mid]=entry; addedOverlay++;
}

// shared-words tier: article sharing at least 2 significant words with the title and covering half of the shorter side
function sharedPick(title, cands){
  const tw=new Set(sig(title));
  const scored=[];
  for(const c of cands){ const dw=sig(c.match||c.title); const shared=dw.filter(w=>[...tw].some(t=>t===w||(t.length>=6&&w.length>=6&&t.slice(0,7)===w.slice(0,7))));
    const rawT=new Set(M.words(title));
 const conflict=(rawT.has("acute") && dw.includes("chronic")) || (rawT.has("chronic") && dw.includes("acute")) || ((rawT.has("infection")||rawT.has("infections")||rawT.has("infectious")) && dw.some(w=>/sarcoma|carcinoma|tumour|tumor|cancer|neoplasm/.test(w)));
 if(shared.length>=2 && dw.length-shared.length<=1 && shared.length/Math.min(dw.length, Math.max(tw.size,1))>=0.5 && !conflict && !/\b(type|grade|stage) \d/i.test(c.title)) scored.push({c, score:shared.length, cov:shared.length/Math.max(dw.length,1)});
  }
  scored.sort((a,b)=>b.score-a.score||b.cov-a.cov);
  if(!scored.length) return null;
  if(scored.length>1 && scored[0].score===scored[1].score && scored[0].cov===scored[1].cov && scored[0].c.id!==scored[1].c.id) return null;
  return scored[0].c;
}
let resolvedShared=0;
for(const [mid,e] of Object.entries(mods)){
  if((e.kb&&e.kb.length)||(e.pr&&e.pr.length)||e.q) continue;
  const pick=sharedPick(e.t, kbCands) || sharedPick(e.t, prCands);
  if(pick){ if(pick.k==="kb") e.kb=[[pick.id,pick.title,"shared-words+local"]]; else e.pr=[[pick.id,pick.title,"shared-words+local"]]; delete e.note; resolvedShared++; }
}

// lesson shared-words tier: a same-subject lesson whose title shares at least 2 significant words with the
// module title and covers half of the shorter side (sibling chapters, e.g. Vitamins and trace minerals).
const lessonDocs=[];
for(const f of fs.readdirSync(root+"/prep/lessons/v1")){
  if(!f.endsWith(".json")||f==="index.json") continue;
  try{ const j=JSON.parse(fs.readFileSync(root+"/prep/lessons/v1/"+f,"utf8")); if(j && j.title) lessonDocs.push({key:f.slice(0,-5), title:j.title, subject:j.subject||""}); }catch(e){}
}
let resolvedLesson=0;
for(const [mid,e] of Object.entries(mods)){
  if((e.kb&&e.kb.length)||(e.pr&&e.pr.length)||(e.ls&&e.ls.length)||e.q) continue;
  const tw=new Set(sig(e.t));
  const scored=[];
  for(const d of lessonDocs){
    if(d.subject && e.s && d.subject!==e.s) continue;
    const dw=sig(d.title);
    const shared=dw.filter(w=>[...tw].some(t=>t===w||(t.length>=6&&w.length>=6&&t.slice(0,6)===w.slice(0,6))));
    if(shared.length>=2 && shared.length/Math.min(dw.length, Math.max(tw.size,1))>=0.5) scored.push({d, score:shared.length, cov:shared.length/Math.max(dw.length,1)});
  }
  scored.sort((a,b)=>b.score-a.score||b.cov-a.cov);
  if(!scored.length) continue;
  if(scored.length>1 && scored[0].score===scored[1].score && scored[0].cov===scored[1].cov && scored[0].d.key!==scored[1].d.key) continue;
  e.ls=[[scored[0].d.key, scored[0].d.title]]; delete e.note; resolvedLesson++;
}

// mixed-review tier: the subject's own mixed rapid-review lesson as the broad chapter for a module with
// no specific article or lesson. It is a subject review, never a specific concept.
let resolvedMixed=0;
for(const [mid,e] of Object.entries(mods)){
  if((e.kb&&e.kb.length)||(e.pr&&e.pr.length)||(e.ls&&e.ls.length)||e.q) continue;
  const d=lessonDocs.find(x=>x.subject && x.subject===e.s && /mixed/i.test(x.title));
  if(d){ e.ls=[[d.key, d.title]]; delete e.note; resolvedMixed++; }
}

// queued v2: a queued candidate whose significant words all lie in the title, chosen by coverage then by
// earliest position in the title (the title's first part wins a tie).
let resolvedQ2=0;
for(const [mid,e] of Object.entries(mods)){
  if(!e.q || !e.q.length) continue;
  const titleWords=M.words(e.t);
  const scored=[];
  for(const c of e.q){
    const dw=sig(c[2]);
    const shared=dw.filter(w=>titleWords.some(t=>t===w||(t.length>=6&&w.length>=6&&t.slice(0,6)===w.slice(0,6))));
    if(shared.length>=1 && (c[3]!=="fuzzy" || shared.length>=2)){
      const pos=Math.min(...shared.map(w=>titleWords.findIndex(t=>t===w||(t.length>=6&&w.length>=6&&t.slice(0,6)===w.slice(0,6)))));
      scored.push({c, score:shared.length, pos});
    }
  }
  scored.sort((a,b)=>b.score-a.score||a.pos-b.pos);
  if(!scored.length) continue;
  const pick=scored[0].c;
  if(pick[0]==="kb") e.kb=[[pick[1],pick[2],pick[3]+"+local2"]]; else e.pr=[[pick[1],pick[2],pick[3]+"+local2"]];
  e.x=e.q.filter(c=>!(c[0]===pick[0]&&c[1]===pick[1])).map(c=>[c[1],c[2]]); delete e.q; delete e.note; resolvedQ2++;
}
// mixed by module prefix (plab-biochemistry modules share the bio- prefix lessons)
let resolvedMixed2=0;
for(const [mid,e] of Object.entries(mods)){
  if((e.kb&&e.kb.length)||(e.pr&&e.pr.length)||(e.ls&&e.ls.length)||e.q) continue;
  const pref=mid.split("-")[0];
  const d=lessonDocs.find(x=>/mixed/i.test(x.title) && x.key.split("-")[0]===pref);
  if(d){ e.ls=[[d.key, d.title]]; delete e.note; resolvedMixed2++; }
}

// same-subject lesson tier: a lesson in the same subject sharing a distinctive (long, non-generic) word
// with the module title, unique best by shared count.
const DISTINCT_STOP=new Set("management disorders disorder disease diseases syndrome syndromes clinical approach physiology therapy treatment diagnosis diagnostic evaluation principles overview".split(" "));
let resolvedSubjLesson=0;
for(const [mid,e] of Object.entries(mods)){
  if((e.kb&&e.kb.length)||(e.pr&&e.pr.length)||(e.ls&&e.ls.length)||e.q) continue;
  const tw=[...new Set(sig(e.t))].filter(w=>w.length>=6 && !DISTINCT_STOP.has(w));
  if(!tw.length) continue;
  const scored=[];
  for(const d of lessonDocs){
    if(!d.subject || d.subject!==e.s) continue;
    const dw=sig(d.title);
    const shared=dw.filter(w=>tw.some(t=>t===w||t.slice(0,6)===w.slice(0,6)));
    if(shared.length>=2) scored.push({d, score:shared.length});
  }
  scored.sort((a,b)=>b.score-a.score);
  if(!scored.length) continue;
  if(scored.length>1 && scored[0].score===scored[1].score) continue;
  e.ls=[[scored[0].d.key, scored[0].d.title]]; delete e.note; resolvedSubjLesson++;
}

// parent-subject mixed tier: super-specialty and exam subjects fall back to their parent subject's mixed
// rapid-review lesson (ss-nephrology -> medicine, ss-radiology -> radiology, and so on).
const PARENT={"ss-radiology":"radiology","ss-onco-pathology":"pathology","ss-ctvs":"surgery","ss-hand-surgery":"orthopaedics","ss-reproductive-medicine":"obstetrics-gynaecology","ss-neurosurgery":"surgery","ss-surgical-oncology":"surgery","ss-paediatric-orthopaedics":"orthopaedics","ss-general-surgery":"surgery","ss-general-medicine":"medicine","ss-critical-care":"anaesthesia","ss-endocrinology":"medicine","ss-rheumatology-immunology":"medicine","ss-neurology":"medicine","ss-infectious-diseases":"medicine","ss-nephrology":"medicine","ss-pulmonology":"medicine","ss-hepatology":"medicine","ss-haematology":"medicine","ss-medical-oncology":"medicine","ss-gastroenterology":"medicine","ss-cardiology":"medicine","ss-child-adolescent-psychiatry":"psychiatry","ss-geriatric-mental-health":"psychiatry","ss-clinical-pharmacology":"pharmacology","ss-biostatistics":"community-medicine","ss-vascular-surgery":"surgery","ss-urology":"surgery","ss-plastic-surgery":"surgery","ss-head-neck-surgery":"ent","ss-transplant-anaesthesia":"anaesthesia","ss-cardiac-anaesthesia":"anaesthesia","ss-neuroanaesthesia":"anaesthesia","ss-gynaecological-oncology":"obstetrics-gynaecology","ss-surgical-gastroenterology":"surgery","ss-paediatric-gastroenterology":"paediatrics","ss-paediatric-surgery":"paediatrics","ss-virology":"microbiology","population-health-and-ethics":"community-medicine","child-health":"paediatrics","adult-health-medicine":"medicine","adult-health-surgery":"surgery","womens-health":"obstetrics-gynaecology","mental-health":"psychiatry"};
let resolvedParent=0;
for(const [mid,e] of Object.entries(mods)){
  if((e.kb&&e.kb.length)||(e.pr&&e.pr.length)||(e.ls&&e.ls.length)) continue;
  const parent=PARENT[e.s] || (e.s==="mrcp-dermatology" ? "dermatology" : e.s==="mrcp-psychiatry" ? "psychiatry" : (/^(mrcp|mcc)-/.test(e.s||"") ? "medicine" : e.s));
  if(!parent) continue;
  const d=lessonDocs.find(x=>x.subject===parent && /mixed/i.test(x.title));
  if(d){ e.ls=[[d.key, d.title]]; delete e.note; resolvedParent++; }
}

// single-acronym tier: exactly one acronym candidate in the queue (the title's acronym names it unambiguously)
let resolvedAcr=0;
for(const [mid,e] of Object.entries(mods)){
  if(!e.q || (e.kb&&e.kb.length) || (e.ls&&e.ls.length)) continue;
  const acr=e.q.filter(c=>c[3]==="acr");
  if(acr.length===1){ const pick=acr[0]; if(pick[0]==="kb") e.kb=[[pick[1],pick[2],"acr+local"]]; else e.pr=[[pick[1],pick[2],"acr+local"]]; e.x=e.q.filter(c=>c!==pick).map(c=>[c[1],c[2]]); delete e.q; delete e.note; resolvedAcr++; }
}

// acronym v2: several articles share one acronym (IBS = irritable bowel syndrome / ichthyosis bullosa of
// Siemens); the KB system/specialty of the module's own subject separates them.
const kbSys=new Map();
for(const dir of ["kb/reference","kb/diseases"]){
  try{ for(const f of fs.readdirSync(root+"/"+dir)){ if(!f.endsWith(".json")) continue; const j=JSON.parse(fs.readFileSync(root+"/"+dir+"/"+f,"utf8")); if(j && j.id) kbSys.set(String(j.id), String((j.system||"")+" "+(j.specialty||"")).toLowerCase()); } }catch(e){}
}
let resolvedAcr2=0;
for(const [mid,e] of Object.entries(mods)){
  if(!e.q || (e.kb&&e.kb.length) || (e.ls&&e.ls.length)) continue;
  const acr=e.q.filter(c=>c[3]==="acr");
  if(acr.length<2) continue;
  const swords=String(e.s||"").split("-").filter(w=>w.length>=5);
  const fit=acr.filter(c=>{ const sys=kbSys.get(c[1])||""; return swords.some(w=>sys.includes(w.slice(0,5))); });
  if(fit.length===1){ const pick=fit[0]; if(pick[0]==="kb") e.kb=[[pick[1],pick[2],"acr+sys+local"]]; else e.pr=[[pick[1],pick[2],"acr+sys+local"]]; delete e.q; delete e.note; resolvedAcr2++; }
}

// acronym v3: the candidate whose name carries the most significant words is the acronym's expansion
// (Gastro-oesophageal reflux disease over Diseases of the Esophagus for GERD).
let resolvedAcr3=0;
for(const [mid,e] of Object.entries(mods)){
  if(!e.q || (e.kb&&e.kb.length) || (e.ls&&e.ls.length)) continue;
  const acr=e.q.filter(c=>c[3]==="acr").map(c=>({c, n:sig(c[2]).length})).sort((a,b)=>b.n-a.n);
  if(acr.length>=2 && acr[0].n>=2 && acr[0].n>acr[1].n){ const pick=acr[0].c; if(pick[0]==="kb") e.kb=[[pick[1],pick[2],"acr+name+local"]]; else e.pr=[[pick[1],pick[2],"acr+name+local"]]; delete e.q; delete e.note; resolvedAcr3++; }
}

doc.gen=new Date().toISOString().slice(0,10);
fs.writeFileSync(root+"/prep/bank/topic-links.json", JSON.stringify(doc,null,1)+"\n");
console.log({resolvedQ, resolvedEmpty, addedOverlay, resolvedShared, resolvedLesson, resolvedMixed, resolvedQ2, resolvedMixed2, resolvedSubjLesson, resolvedParent, resolvedAcr, resolvedAcr2, resolvedAcr3, total:Object.keys(mods).length});