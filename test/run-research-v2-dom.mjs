// Run: node test/run-research-v2-dom.mjs (needs the jsdom package: npm i --no-save jsdom).
// No real browser was available in the cloud build session; this drives the plan v2 screens in jsdom.
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
const repo = process.argv[2] || new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const dom = new JSDOM('<!doctype html><body><div id="c"></div></body>', { runScripts: "outside-only", url: "https://localhost/" });
const w = dom.window;
const errors = [];
w.addEventListener("error", (e) => errors.push(String(e.message)));
Object.defineProperty(w, "crypto", { value: globalThis.crypto, configurable: true }); w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
const files = ["research-contracts.js", "research-idb.js", "research-stats.js", "research-samplesize.js", "research-randomise.js", "research-phi.js", "research-backup.js",
  "research.js", "research-screen-kit.js", "research-screen-casefile.js", "research-screen-novelty.js", "research-screen-iec.js", "research-screen-pubconsent.js",
  "research-screen-images.js", "research-screen-ctri.js", "research-screen-randomise.js", "research-screen-consort.js", "research-screen-backup.js",
  "research-screen-masterchart.js"];
for (const f of files) w.eval(readFileSync(repo + "/" + f, "utf8"));
w.RMDStore._setBackend(w.RMDStore._memoryBackend(), true);
let proj = { id: "p1", serverId: "p1", studyType: "Case Report", title: "T" };
const calls = [];
w.SMD_RESEARCH.store = { getActiveProject: () => proj, getProjects: () => [proj] };
w.SMD_RESEARCH.navigate = (s) => calls.push("nav:" + s);
w.SMD_RESEARCH.api = { request: (m, p, b) => { calls.push(m + " " + p + " " + (b && b.task || "")); 
  if (/find-studies/.test(p)) return Promise.resolve({ results: [{ pmid: "1", title: "Zinc phosphide heart", journal: "J", year: 2020 }] });
  if (b && b.task === "case_report_draft") return Promise.resolve({ draft: { sections: [{ id: "title", heading: "Title", text: "K was 2.9 on Day 0" }, { id: "timeline", heading: "Timeline", text: "Day 0: Troponin I 2.4 ng/mL" }] } });
  return Promise.resolve({ draft: {} }); } };
w.SMD_RESEARCH.appendManuscriptResults = (pid, t) => { calls.push("append " + t.slice(0, 20)); return Promise.resolve({}); };
const c = w.document.getElementById("c");
const tick = () => new Promise((r) => setTimeout(r, 30));
const click = (sel) => { const el = c.querySelector(sel); if (!el) throw new Error("missing " + sel); el.click(); };
const set = (sel, v) => { const el = c.querySelector(sel); if (!el) throw new Error("missing " + sel); if (el.type === "checkbox") { el.checked = v; el.dispatchEvent(new w.Event("change")); } else el.value = v; };
const S = w.SMD_RESEARCH.screens;
function check(name) { if (/[–—]/.test(c.innerHTML)) throw new Error(name + ": dash in screen"); }

// Case file
S.casefile.render(c, {}); await tick();
set('[data-k="age"]', "92"); set('[data-k="presenting"]', "Chest pain"); set('[data-k="presentationDate"]', "2026-03-01");
set('[data-inv="date"]', "2026-03-03"); set('[data-inv="test"]', "Troponin I"); set('[data-inv="value"]', "2.4"); set('[data-inv="unit"]', "ng/mL");
click('[data-rmd-cf="save"]'); await tick();
if (!/Day 2/.test(c.textContent)) throw new Error("timeline missing");
click('[data-rmd-cd="prep"]'); await tick();
if (!/90 or older/.test(c.textContent)) throw new Error("age not de-identified");
set('[data-k="cd_ok"]', true); await tick();
click('[data-rmd-ai="ask"]'); await tick(); await tick();
if (!/<mark/.test(c.innerHTML) || !/2\.9/.test(c.textContent)) throw new Error("number not flagged");
check("casefile");
// Novelty
S.novelty.render(c); await tick(); set('[data-k="q"]', 'zinc phosphide myocarditis'); click('[data-rmd-nv="go"]'); await tick();
if (!/We found 1 similar published case\./.test(c.textContent)) throw new Error("novelty count");
click('[data-rmd-nv-add="0"]'); await tick(); if (!/In your references/.test(c.textContent)) throw new Error("ref not added"); check("novelty");
// Ethics, CTRI
S.iec.render(c); await tick(); set('[data-k="status"]', "approved"); click('[data-rmd-iec="save"]'); await tick(); check("iec");
proj = { id: "p2", serverId: "p2", studyType: "Randomized Controlled Trial", title: "R" };
S.ctri.render(c); await tick(); if (!/Register on CTRI before/.test(c.textContent)) throw new Error("ctri banner");
set('[data-k="number"]', "CTRI/26/1"); click('[data-rmd-ctri="save"]'); await tick(); if (!/looks like/.test(c.textContent)) throw new Error("ctri format");
set('[data-k="number"]', "ctri/2026/01/012345"); click('[data-rmd-ctri="save"]'); await tick();
if (/Register on CTRI before/.test(c.textContent) || !/prospectively/.test(c.textContent)) throw new Error("ctri save"); check("ctri");
// Randomise
S.randomise.render(c); await tick(); if (!/Ask your guide or statistician/.test(c.textContent)) throw new Error("keeper line");
set('[data-k="keeper"]', true); await tick();
set('[data-k="n"]', "20"); set('[data-k="seed"]', "thesis-2026"); click('[data-rmd-rz="make"]'); await tick(); await tick();
if (!/Your list: 22 places/.test(c.textContent)) throw new Error("list not made: " + c.textContent.slice(300, 900));
click('[data-rmd-rz="done"]'); await tick(); await tick();
if (!/Only its fingerprint is kept/.test(c.textContent)) throw new Error("fingerprint");
if (await w.RMDStore.get("p2", "randomlist", "main")) throw new Error("list kept");
set('[data-k="b_participants"]', true); click('[data-rmd-rz="blind"]'); await tick();
if (!/Participants did not know/.test(c.textContent)) throw new Error("blinding"); check("randomise");
// CONSORT
S.consort.render(c); await tick(); set('[data-k="assessed"]', "10"); set('[data-k="randomised"]', "5"); set('[data-k="notMeeting"]', "1");
click('[data-rmd-cs="save"]'); await tick(); if (!/Assessed \(10\) should equal/.test(c.textContent)) throw new Error("consort check"); check("consort");
// Consent, images, backup
S.pubconsent.render(c); await tick(); click('[data-rmd-ai="manual"]'); await tick(); if (!/thumb impression/.test(c.textContent)) throw new Error("consent template"); check("pubconsent");
S.images.render(c); await tick(); if (!c.querySelector('[data-rmd-img="pick"]')) throw new Error("images"); check("images");
S.backup.render(c); await tick(); set('[data-k="p1"]', "short"); set('[data-k="p2"]', "short"); click('[data-rmd-bk="go"]'); await tick();
if (!/at least 8 characters/.test(c.textContent)) throw new Error("backup pass"); check("backup");
// Case series
proj = { id: "p3", serverId: "p3", studyType: "Case Series", title: "S" };
S.casefile.render(c, {}); await tick(); click('[data-rmd-cf-open="1"]'); await tick(); set('[data-k="age"]', "40"); click('[data-rmd-cf="save"]'); await tick();
click('[data-rmd-cf="back"]'); await tick(); click('[data-rmd-cf-open="2"]'); await tick(); set('[data-k="age"]', "50"); click('[data-rmd-cf="save"]'); await tick();
click('[data-rmd-cf="back"]'); await tick(); click('[data-rmd-cf="chart"]'); await tick();
const mc = await w.RMDStore.get("p3", "masterchart", "main");
if (!mc || mc.rows.length !== 2) throw new Error("series chart");
// Master chart survival card on survival::lung (R: median 310, 95% CI 285 to 363; log-rank by sex chi2 10.3)
const lung = JSON.parse(readFileSync(repo + "/test/fixtures/research/survival/lung.json", "utf8"));
proj = { id: "p4", serverId: "p4", studyType: "Cohort", title: "Lung" };
await w.RMDStore.put("p4", "masterchart", "main", { fileName: "lung.csv", columns: ["time", "status", "sex", "age"],
  rows: lung.time.map((t, i) => [t, lung.status[i] ? "Yes" : "No", lung.sex[i] === 1 ? "Male" : "Female", lung.age[i]]),
  types: { time: "numeric", status: "binary", sex: "binary", age: "numeric" } });
S.masterchart.render(c, { reload: true }); await tick(); await tick();
click('[data-rmd-mc="continue-identifiers"]'); await tick(); click('[data-rmd-mc="continue-columns"]'); await tick();
click('[data-rmd-mc-choice="survival"]'); await tick();
const g = c.querySelector("#rmdMcGroup"); if (!/No groups \(one curve\)/.test(g.innerHTML)) throw new Error("no-group option");
c.querySelector("#rmdMcTime").value = "time"; c.querySelector("#rmdMcTime").dispatchEvent(new w.Event("change"));
c.querySelector("#rmdMcEvent").value = "status"; c.querySelector("#rmdMcEvent").dispatchEvent(new w.Event("change"));
click('[data-rmd-mc="run"]'); await tick();
if (!/310\.0 \(95% CI 285\.0 to 363\.0\)/.test(c.textContent)) throw new Error("km median: " + c.textContent.slice(0, 400));
if (!c.querySelector("svg.rmd-mc-km path")) throw new Error("km svg");
click('[data-rmd-mc="ask-another"]'); await tick(); click('[data-rmd-mc-choice="survival"]'); await tick();
const g2 = c.querySelector("#rmdMcGroup"); g2.value = "sex"; g2.dispatchEvent(new w.Event("change"));
set('.rmd-mc-check-input[value="age"]', true); click('[data-rmd-mc="run"]'); await tick();
if (!/Log-rank chi-square = 10\.33, df = 1/.test(c.textContent)) throw new Error("log-rank: " + c.textContent.slice(0, 600));
if (!/HR \(95% CI\)/.test(c.textContent) || c.querySelectorAll("svg.rmd-mc-km path").length !== 2) throw new Error("cox or curves");
check("masterchart survival");
if (errors.length) throw new Error("page errors: " + errors.join("; "));
console.log("DOM smoke OK", calls.filter((x) => /POST/.test(x)).length, "API calls;", calls.filter((x) => /nav:/.test(x)).join(","));
