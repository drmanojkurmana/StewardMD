import { readFileSync, writeFileSync } from "node:fs";
const ROOT="/Users/diwakarkumar/Developer/StewardMD";
const txt = readFileSync(ROOT+"/pglog-sources/PGMER-2023.txt","utf8");
function section(startMark, endMark){
  const a=txt.indexOf(startMark); const b=txt.indexOf(endMark, a);
  return txt.slice(a, b>a?b:undefined);
}
// Annexure-1: broad specialty MD/MS.  Annexure-2: super specialty DM/MCh.
const a1 = section("LIST OF RECOGNISED POST-GRADUATE BROAD SPECIALITY QUALIFICATIONS", "Annexure-2");
const a2 = section("LIST OF RECOGNISED POST-GRADUATE SUPER SPECIALITY QUALIFICATIONS", "Annexure-3");
const grab = (block, re) => [...block.matchAll(re)].map(m=>m[1].replace(/\s+/g," ").trim());
const md  = grab(a1, /^\s*\d+\.\s+M\.?D\.?\s*\(([^)]+)\)/gm);
const ms  = grab(a1, /^\s*\d+\.\s+M\.?S\.?\s*\(([^)]+)\)/gm);
const dm  = grab(a2, /^\s*\d+\.\s+D\.?M\.?\s*\(([^)]+)\)/gm);
const mch = grab(a2, /^\s*\d+\.\s+M\.?\s?Ch\.?\s*\(([^)]+)\)/gmi);
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const PACKS = JSON.parse(readFileSync(ROOT+"/pglog/curricula/index.json","utf8")).packs;
// map a specialty name to a real pack when we have one
// Gazette spellings -> our pack ids. Taken from Annexure-1 of the PUBLISHED gazette, which spells
// several of these differently from the pre-publication draft ("Radio-diagnosis", "Obstetrics and
// Gynaecology", "Otorhinolaryngology", "Immuno Haematology"). Anything not listed resolves to
// generic-pg, which is the honest answer rather than a mis-mapped pack.
const ALIAS = {
  "general medicine":"general-medicine",
  "general surgery":"general-surgery",
  "obstetrics and gynaecology":"obstetrics-gynaecology",
  "paediatrics":"paediatrics",
  "anaesthesiology":"anaesthesiology",
  "orthopaedics":"orthopaedics",
  "radio-diagnosis":"radiodiagnosis",
  "pathology":"pathology",
  "psychiatry":"psychiatry",
  "dermatology, venereology and leprosy":"dermatology",
  "ophthalmology":"ophthalmology",
  "otorhinolaryngology":"ent",
  "community medicine":"community-medicine",
  "emergency medicine":"emergency-medicine",
  "respiratory medicine":"respiratory-medicine"
};
const known = new Set(PACKS.map(p=>p.id));
const mk = (name, degree) => {
  const packId = ALIAS[name.toLowerCase()] || (known.has(slug(name)) ? slug(name) : "generic-pg");
  return { id: slug(degree+"-"+name), name, degree, packId, hasSpecialtyPack: packId !== "generic-pg" };
};
const out = {
  version: "2026-08-27",
  source: {
    title: "Post-Graduate Medical Education Regulations, 2023 (PUBLISHED GAZETTE, CG-DL-E-03012024-251108, 29 Dec 2023) — Annexure-1 (broad specialty) and Annexure-2 (super specialty)",
    publisher: "National Medical Commission", url:"https://www.nmc.org.in/MCIRest/open/getDocument?path=/Documents/Public/Portal/LatestNews/PGMER%202023.pdf",
    retrieved: "2026-08-27",
    note: "Extracted mechanically from pglog-sources/PGMER-2023.txt so the picker cannot drift from the gazette's own list."
  },
  readMe: "Every qualification PGMER-2023 recognises, so a resident in ANY specialty can be enrolled. "
        + "hasSpecialtyPack=false means only the PGMER-2023 requirements apply and the UI says so — it does NOT mean the specialty is unsupported.",
  broad: [...md.map(n=>mk(n,"MD")), ...ms.map(n=>mk(n,"MS"))],
  super: [...dm.map(n=>mk(n,"DM")), ...mch.map(n=>mk(n,"MCh"))]
};
writeFileSync(ROOT+"/pglog/specialties.json", JSON.stringify(out,null,2)+"\n");
console.log("broad:",out.broad.length,"(with a pack:",out.broad.filter(x=>x.hasSpecialtyPack).length+")");
console.log("super:",out.super.length);
