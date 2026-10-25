/* tool-groups.js - window.SMD_TOOL_GROUPS: how the clinical tools are arranged (owner, 2026-10-13: "there are
 * many clinical tools ... many find it difficult to categorise and arrange them").
 *
 * Owner's choices (2026-10-13):
 *   - Categories live in the All tools sheet only; Home keeps its look (Decisions 2026-10-12 "Home page look stays").
 *   - Grouped BY ROLE: every tool sits in exactly one section, the earliest role it is mainly for. The ladder matches
 *     role-features.js LOCKED: a tool locked for a role never sits in that role's own section.
 *   - Home shows a starter set of 6 to 8 tools picked from the role and the specialty kit, until the user pins or
 *     hides a tool themselves (then their own choice wins, as before).
 *   - A "Recently used" row (tool ids only, never patient data) and a one-line description for every tool.
 * Flag: smd_tool_groups, default ON; "0" (localStorage) or ?toolgroups=0 restores the flat list and the old defaults.
 * ES5, no dependencies; home.js reads it when present and falls back to its own flat behaviour when it is not. */
(function (G) {
  "use strict";
  var ROLE_ORDER = ["student", "intern", "resident", "doctor"];
  var GROUPS = [
    { role: "student", tt: "Students", sub: "Learn and practise",
      acts: ["clinix", "prep", "kxlearn", "atlas", "ophthalmos", "tokos", "narke", "guidelines", "codeblue"] },
    { role: "intern", tt: "Interns", sub: "Bedside and ward work",
      acts: ["startcase", "reasoning", "askai", "drugmenu", "calculators", "dosecalc", "dosing", "insulin", "electrolytes",
        "interactions", "syndromes", "antibiogram", "neo", "icu", "speckit", "docs", "dictate", "icdsearch"] },
    { role: "resident", tt: "Residents", sub: "Specialty and training",
      acts: ["pglog", "surgx", "staging", "oncohome", "oncotree", "retinalscan", "kardia", "kardiox", "thorex", "sknx", "ward", "hospital", "kxinbox"] },
    { role: "doctor", tt: "Doctors", sub: "Practice and clinic",
      acts: ["followcare", "maitri", "queue", "agentconnect", "review", "govschemes"] }
  ];
  // What each tool does, in one line, for the All tools list. Plain words, no dashes.
  var DESC = {
    retinalscan: "AI reading of a retinal photo. Beta, not yet validated.",
    kardia: "Echo and ECG learning with a simulator, atlas and cases.",
    kardiox: "AI reading of an ECG. Beta, not yet validated.",
    thorex: "AI reading of a chest X-ray. Beta, not yet validated.",
    sknx: "AI look at a skin lesion photo. Beta, not yet validated.",
    kxlearn: "ECG atlas with worked examples and a quiz.",
    clinix: "Clinical skills and examination, step by step.",
    surgx: "Surgical protocols, notes and checklists.",
    pglog: "NMC PG logbook: log cases and get them verified.",
    followcare: "Follow up your patients after discharge.",
    maitri: "Recovery support for your patients.",
    queue: "Run your OPD queue and patient flow.",
    oncohome: "The cancer library: diseases and treatment.",
    oncotree: "Step through a cancer's work-up and treatment pathway.",
    staging: "AJCC TNM staging for 32 cancer sites.",
    speckit: "Bedside tools for your specialty: O&G, paeds, eye, ENT and more.",
    docs: "Certificates, consent forms, handouts and MLC drafts.",
    review: "Approve or comment on AI-drafted protocols and kits.",
    kxinbox: "Referrals, handovers and case rooms with colleagues.",
    dictate: "Speak a note and get it written up.",
    interactions: "Photograph medicines and check their interactions.",
    guidelines: "Clinical protocols and guidelines to read.",
    atlas: "Radiological anatomy atlas.",
    ophthalmos: "Eye imaging clinic trainer.",
    tokos: "Obstetrics and gynaecology: learn, CTG clinic, drills.",
    prep: "NEET-PG, INI-CET, NEET-SS and USMLE question bank.",
    narke: "Anaesthesia learning with working equipment models.",
    electrolytes: "Correct sodium, potassium and other electrolytes.",
    hospital: "Your hospital's OPD, ICU and ward in one place.",
    govschemes: "Government scheme package codes and rates.",
    icdsearch: "Search ICD-10 and ICD-11 diagnosis codes.",
    icu: "Critical care tools for ICU and ward patients.",
    codeblue: "Cardiac arrest timer with spoken cues, plus practice cases.",
    ward: "Inpatient list synced with your hospital's GHIS.",
    agentconnect: "Connect StewardMD to your hospital's EMR.",
    startcase: "Start a structured patient assessment.",
    reasoning: "Build a differential diagnosis from the findings.",
    askai: "Ask MaiK a clinical question.",
    drugmenu: "Drug database and interaction checker.",
    calculators: "Clinical scores and calculators.",
    dosecalc: "Work out a drug dose for one patient.",
    neo: "NICU dosing, infusions, fluids, growth and bilirubin.",
    dosing: "Bedside insulin and electrolyte dosing.",
    insulin: "Insulin doses and conversions.",
    syndromes: "Infectious syndromes and empirical treatment.",
    antibiogram: "Local antibiotic resistance patterns."
  };
  // Starter tools for Home, best first. Never the tools Home already offers outside the grid (quick actions: Start
  // Case, Dx Patient, Drugs, Calculators; chips: Syndromes, Antibiogram, Dosing, Hospital; the Ask MaiK tab), so the grid adds to them.
  var ON_HOME_ALREADY = ["startcase", "reasoning", "drugmenu", "calculators", "syndromes", "antibiogram", "dosing", "hospital", "askai"];
  var STARTER = {
    student: ["clinix", "prep", "kxlearn", "askai", "codeblue", "atlas", "guidelines", "ophthalmos", "tokos", "narke"],
    intern: ["askai", "dosecalc", "icu", "docs", "interactions", "speckit", "dictate", "neo", "icdsearch"],
    resident: ["pglog", "askai", "speckit", "kxinbox", "docs", "dictate", "ward", "dosecalc", "icdsearch"],
    doctor: ["askai", "speckit", "docs", "followcare", "kxinbox", "dictate", "maitri", "govschemes", "icdsearch"],
    none: ["askai", "speckit", "clinix", "docs", "interactions", "guidelines", "dosecalc", "kxlearn"]
  };
  // Specialty starter packs, by specialty-kits.js kit id (smd_my_specialty). They go in front of the role's tools.
  var PACKS = {
    obgyn: ["tokos"], paediatrics: ["neo"], ophthalmology: ["ophthalmos", "retinalscan"], anaesthesia: ["narke", "electrolytes"],
    emergency: ["icu", "kardiox"], "general-surgery": ["surgx", "staging"], orthopaedics: ["surgx", "atlas"],
    cardiology: ["kardia", "kardiox", "kxlearn"], pulmonology: ["thorex"], dermatology: ["sknx"], "cancer-screening": ["oncotree", "staging"],
    "diabetes-endocrine": ["insulin", "electrolytes"], "nephrology-urology": ["electrolytes", "dosecalc"], neurology: ["atlas"],
    "community-medicine": ["govschemes"]
  };
  var MAX_STARTER = 8, MAX_RECENT = 4, RECENT_KEY = "smd_tools_recent";

  function ls(k, v) {
    try { var s = G.localStorage; if (!s) return null; if (v === undefined) return s.getItem(k); s.setItem(k, v); } catch (e) {}
    return null;
  }
  function on() {
    try { var q = ((G.location && G.location.search) || "").match(/[?&]toolgroups=([^&]+)/); if (q) return q[1] === "1" || q[1] === "on" || q[1] === "true"; } catch (e) {}
    return ls("smd_tool_groups") !== "0";
  }
  function role() {
    try { if (G.SMD_ROLE && G.SMD_ROLE.current) { var r = G.SMD_ROLE.current(); if (r) return r; } } catch (e) {}
    var d = String(ls("smd_role") || "").toLowerCase();   // home.js can render before role-features.js runs
    return ROLE_ORDER.indexOf(d) >= 0 ? d : "";
  }
  function specialty() {
    try { if (G.SMD_KITS && G.SMD_KITS.mySpecialty) return G.SMD_KITS.mySpecialty() || ""; } catch (e) {}
    return ls("smd_my_specialty") || "";
  }
  function groupOf(act) {
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].acts.indexOf(act) >= 0) return GROUPS[i].role;
    return "";
  }
  // Sections for the All tools sheet: the user's own role first, then the rest in ladder order. `tools` is the list
  // home.js would show (already filtered for eligibility); tools no section names go in "More tools" at the end.
  function sections(tools, r) {
    r = r === undefined ? role() : r;
    var order = GROUPS.slice(), out = [], seen = {};
    if (r) order.sort(function (a, b) { return (a.role === r ? 0 : 1) - (b.role === r ? 0 : 1); });
    order.forEach(function (g) {
      var list = [];
      g.acts.forEach(function (a) { for (var i = 0; i < tools.length; i++) if (tools[i].act === a) { list.push(tools[i]); seen[a] = 1; } });
      if (list.length) out.push({ role: g.role, tt: g.tt, sub: g.sub, mine: g.role === r, tools: list });
    });
    var rest = tools.filter(function (t) { return !seen[t.act]; });
    if (rest.length) out.push({ role: "", tt: "More tools", sub: "", mine: false, tools: rest });
    return out;
  }
  // The starter set for Home: the specialty pack, then the role's list, keeping only tools `usable(act)` allows
  // (eligible and not locked for the role), never one Home already offers above the grid, at most 8.
  function starter(r, kit, usable) {
    r = r === undefined ? role() : r; kit = kit === undefined ? specialty() : kit;
    /* Kardia leads every starter set (owner 2026-10-26: Kardia open for everyone). */
    var want = ["kardia"].concat(PACKS[kit] || [], STARTER[r] || STARTER.none), out = [];
    for (var i = 0; i < want.length && out.length < MAX_STARTER; i++) {
      var a = want[i];
      if (out.indexOf(a) >= 0 || ON_HOME_ALREADY.indexOf(a) >= 0) continue;
      if (usable && !usable(a)) continue;
      out.push(a);
    }
    return out;
  }
  function recent() {
    try { var a = JSON.parse(ls(RECENT_KEY) || "[]"); return Array.isArray(a) ? a.filter(function (x) { return typeof x === "string" && /^[a-z0-9_-]{1,40}$/.test(x); }).slice(0, MAX_RECENT) : []; } catch (e) { return []; }
  }
  function pushRecent(act) {
    if (!act || !/^[a-z0-9_-]{1,40}$/.test(act)) return;
    var a = recent().filter(function (x) { return x !== act; }); a.unshift(act);
    ls(RECENT_KEY, JSON.stringify(a.slice(0, MAX_RECENT)));
  }
  function desc(act) { return DESC[act] || ""; }

  G.SMD_TOOL_GROUPS = { on: on, role: role, specialty: specialty, groupOf: groupOf, sections: sections, starter: starter,
    recent: recent, pushRecent: pushRecent, desc: desc, GROUPS: GROUPS, DESC: DESC, STARTER: STARTER, PACKS: PACKS,
    ON_HOME_ALREADY: ON_HOME_ALREADY, MAX_STARTER: MAX_STARTER, MAX_RECENT: MAX_RECENT };
})(typeof window !== "undefined" ? window : globalThis);
