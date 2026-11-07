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
  // (eligible and not locked for the role), never one Home already offers above the grid, at most 8 of those.
  // Kardia is then put on top of that set below, so it never takes one of those 8 slots.
  function starter(r, kit, usable) {
    r = r === undefined ? role() : r; kit = kit === undefined ? specialty() : kit;
    var want = (PACKS[kit] || []).concat(STARTER[r] || STARTER.none), out = [];
    for (var i = 0; i < want.length && out.length < MAX_STARTER; i++) {
      var a = want[i];
      if (out.indexOf(a) >= 0 || ON_HOME_ALREADY.indexOf(a) >= 0) continue;
      if (usable && !usable(a)) continue;
      out.push(a);
    }
    /* Kardia leads every starter set on top of it, never taking a role or specialty tool's slot (owner 2026-10-26: Kardia open for everyone). */
    if (out.indexOf("kardia") < 0 && ON_HOME_ALREADY.indexOf("kardia") < 0 && (!usable || usable("kardia"))) out.unshift("kardia");
    else if (out.indexOf("kardia") > 0) { out.splice(out.indexOf("kardia"), 1); out.unshift("kardia"); }
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


  /* ---- Home tabs (owner 2026-11-07): [For you] [Learn] [Bedside] [Practice] [<branch> v] above the tool grid ----
   * Grouped by what the doctor wants to do, not by job title. "For you" is the grid as before (pinned or starter
   * tools, drag to reorder). Learn, Bedside and Practice list EVERY tool of that kind, pinned or not, so nothing is
   * hidden. The last tab is one specialty ("branch"): named after the user's kit, switchable from its picker.
   * Every Home tool that is not already above the grid sits in exactly one task tab (unit test).
   * Flag: smd_home_tabs, default ON; "0" (localStorage) or ?hometabs=0 restores the single grid. */
  var TASKS = [
    { id: "learn", tt: "Learn", sub: "Study, practise and prepare for exams",
      acts: ["prep", "kxlearn", "kardia", "clinix", "atlas", "ophthalmos", "tokos", "narke", "guidelines"] },
    { id: "bedside", tt: "Bedside", sub: "For the patient in front of you",
      acts: ["dosecalc", "icu", "neo", "codeblue", "insulin", "electrolytes", "interactions", "speckit", "surgx", "oncohome", "oncotree",
        "staging", "kardiox", "thorex", "sknx", "retinalscan", "docs", "dictate", "icdsearch"] },
    { id: "practice", tt: "Practice", sub: "Your patients, clinic and records",
      acts: ["queue", "followcare", "maitri", "ward", "kxinbox", "pglog", "govschemes", "agentconnect", "review"] }
  ];
  // Branches for the specialty tab. `kits` are specialty-kits.js ids (smd_my_specialty) that open this branch.
  // `acts` are its tools, best first; ineligible ones (flag off, ONCQIS hiding OncoTree) drop out in home.js.
  // Every branch also offers its Specialty Kit (the speckit tile, named after the kit).
  var BRANCHES = [
    { id: "medicine", tt: "Medicine", kits: ["diabetes-endocrine", "nephrology-urology", "gastro-hepatology", "rheumatology", "geriatrics"],
      acts: ["kardia", "insulin", "electrolytes", "dosecalc", "kxlearn", "guidelines"] },
    { id: "surgery", tt: "Surgery", kits: ["general-surgery"], acts: ["surgx", "staging", "atlas", "codeblue"] },
    { id: "oncology", tt: "Oncology", kits: ["cancer-screening"], acts: ["oncohome", "oncotree", "staging", "surgx"] },
    { id: "obgyn", tt: "O&G", kits: ["obgyn"], acts: ["tokos", "neo", "docs"] },
    { id: "paediatrics", tt: "Paediatrics", kits: ["paediatrics"], acts: ["neo", "dosecalc", "codeblue"] },
    { id: "anaesthesia", tt: "Anaesthesia", kits: ["anaesthesia"], acts: ["narke", "icu", "electrolytes", "codeblue"] },
    { id: "emergency", tt: "Emergency", kits: ["emergency"], acts: ["codeblue", "icu", "kardiox", "dosecalc", "electrolytes"] },
    { id: "cardiology", tt: "Cardiology", kits: ["cardiology"], acts: ["kardia", "kardiox", "kxlearn", "codeblue"] },
    { id: "respiratory", tt: "Respiratory", kits: ["pulmonology"], acts: ["thorex", "icu"] },
    { id: "ophthalmology", tt: "Eye", kits: ["ophthalmology"], acts: ["ophthalmos", "retinalscan"] },
    { id: "dermatology", tt: "Skin", kits: ["dermatology"], acts: ["sknx"] },
    { id: "orthopaedics", tt: "Orthopaedics", kits: ["orthopaedics"], acts: ["surgx", "atlas"] },
    { id: "neurology", tt: "Neurology", kits: ["neurology"], acts: ["atlas"] },
    { id: "community", tt: "Community medicine", kits: ["community-medicine"], acts: ["govschemes", "followcare"] },
    { id: "ent", tt: "ENT", kits: ["ent"], acts: ["atlas"] },
    { id: "psychiatry", tt: "Psychiatry", kits: ["psychiatry"], acts: ["docs"] },
    { id: "dental", tt: "Dental", kits: ["dental"], acts: ["atlas"] },
    { id: "palliative", tt: "Palliative care", kits: ["palliative"], acts: ["followcare", "maitri", "docs"] },
    { id: "rehabilitation", tt: "Rehabilitation", kits: ["rehabilitation"], acts: ["maitri", "followcare"] },
    { id: "forensic", tt: "Forensic medicine", kits: ["forensic"], acts: ["docs", "atlas"] }
  ];
  var TAB_KEY = "smd_home_tab", BRANCH_KEY = "smd_home_branch", SEEN_KEY = "smd_tools_seen", TRY_HIDE_KEY = "smd_tools_try_hide";
  function tabsOn() {
    try { var q = ((G.location && G.location.search) || "").match(/[?&]hometabs=([^&]+)/); if (q) return q[1] === "1" || q[1] === "on" || q[1] === "true"; } catch (e) {}
    return ls("smd_home_tabs") !== "0";
  }
  function task(id) { for (var i = 0; i < TASKS.length; i++) if (TASKS[i].id === id) return TASKS[i]; return null; }
  function taskOf(act) { for (var i = 0; i < TASKS.length; i++) if (TASKS[i].acts.indexOf(act) >= 0) return TASKS[i].id; return ""; }
  function branchById(id) { for (var i = 0; i < BRANCHES.length; i++) if (BRANCHES[i].id === id) return BRANCHES[i]; return null; }
  function branchForKit(kit) { for (var i = 0; i < BRANCHES.length; i++) if (BRANCHES[i].kits.indexOf(kit) >= 0) return BRANCHES[i]; return null; }
  // The branch the specialty tab shows: the one the user last picked there, else the one their kit maps to, else none.
  function branch() { return branchById(ls(BRANCH_KEY) || "") || branchForKit(specialty()); }
  function setBranch(id) { if (branchById(id)) ls(BRANCH_KEY, id); }
  // The tab Home opens on: the last one used, else by role (students Learn, consultants Practice, the rest For you).
  var TAB_IDS = ["foryou", "learn", "bedside", "practice", "branch"];
  function tab() {
    var t = ls(TAB_KEY); if (TAB_IDS.indexOf(t) >= 0) return t;
    var r = role(); return r === "student" ? "learn" : "foryou";
  }
  function setTab(t) { if (TAB_IDS.indexOf(t) >= 0) ls(TAB_KEY, t); }

  /* ---- Discovery: tools the user has never opened get a small "New" dot, and one of them is offered at a time
   * ("Try something new"), a different one each week. Tool ids only, never patient data. */
  function seenList() {
    try { var a = JSON.parse(ls(SEEN_KEY) || "null"); return Array.isArray(a) ? a.filter(function (x) { return typeof x === "string" && /^[a-z0-9_-]{1,40}$/.test(x); }) : null; } catch (e) { return null; }
  }
  // First run: everything already on the user's Home and in Recently used counts as known, so long-time users
  // do not see a dot on every tile they use daily.
  function seedSeen(acts) {
    if (seenList()) return;
    var a = []; (acts || []).concat(recent()).forEach(function (x) { if (typeof x === "string" && /^[a-z0-9_-]{1,40}$/.test(x) && a.indexOf(x) < 0) a.push(x); });
    ls(SEEN_KEY, JSON.stringify(a));
  }
  function isNew(act) { var a = seenList(); return !!a && a.indexOf(act) < 0; }
  function markSeen(act) {
    if (!act || !/^[a-z0-9_-]{1,40}$/.test(act)) return;
    var a = seenList() || []; if (a.indexOf(act) >= 0) return; a.push(act); ls(SEEN_KEY, JSON.stringify(a));
  }
  function weekNo(now) { return Math.floor(((now || Date.now()) / 864e5 + 3) / 7); }   // Monday-based week number
  // One never-opened tool from `acts` (eligible, not locked), picked by the week so it changes once a week;
  // "" when every tool has been tried or the user said "Not now" this week.
  function tryNext(acts, now) {
    var w = weekNo(now); if (String(ls(TRY_HIDE_KEY)) === String(w)) return "";
    var pool = (acts || []).filter(function (a) { return isNew(a) && ON_HOME_ALREADY.indexOf(a) < 0; });
    return pool.length ? pool[w % pool.length] : "";
  }
  function hideTry(now) { ls(TRY_HIDE_KEY, String(weekNo(now))); }

  /* ---- Problem search: what a doctor types ("dose for a child", "sodium 122", "stage breast cancer") -> the tool.
   * Each phrase is matched on word starts ("neonat" hits "neonatal"); phrases of 3 letters or fewer only as whole words. */
  var PROBLEMS = {
    dosecalc: ["dose", "dosage", "how much", "mg/kg", "paediatric dose", "child dose", "renal dose", "weight based"],
    electrolytes: ["sodium", "hyponatr", "hypernatr", "potassium", "hypokal", "hyperkal", "calcium", "magnesium", "phosphate", "electrolyte"],
    insulin: ["insulin", "sugar", "glucose", "dka", "sliding scale", "diabetes", "basal bolus"],
    staging: ["stage", "staging", "tnm", "ajcc"],
    oncohome: ["cancer", "tumour", "tumor", "carcinoma", "chemo", "oncology", "metasta", "lymphoma", "malignan"],
    oncotree: ["cancer workup", "cancer pathway", "suspected cancer"],
    codeblue: ["cardiac arrest", "arrest", "cpr", "code blue", "resuscitat", "acls", "pulseless", "vf", "asystole"],
    neo: ["newborn", "neonat", "nicu", "preterm", "jaundice baby", "bilirubin", "baby"],
    icu: ["icu", "critical", "ventilat", "shock", "sepsis", "vasopressor", "noradrenaline"],
    interactions: ["interaction", "prescription photo", "scan prescription", "drug combination", "together"],
    icdsearch: ["icd", "diagnosis code", "coding", "claim code"],
    docs: ["certificate", "consent", "fitness", "sick leave", "medical certificate", "mlc", "death certificate", "handout", "mccd"],
    dictate: ["dictate", "voice", "speak", "note", "discharge summary"],
    kxlearn: ["ecg learn", "ecg quiz", "read ecg", "ecg practice"],
    kardia: ["echo", "echocardiog", "ecg", "heart sound"],
    kardiox: ["ecg read", "ecg ai", "ecg report"],
    thorex: ["x-ray", "xray", "cxr", "chest film", "radiograph"],
    sknx: ["skin", "rash", "lesion", "mole", "melanoma", "derm"],
    retinalscan: ["fundus", "retina", "retinopathy", "diabetic eye"],
    ophthalmos: ["eye", "oct", "slit lamp", "glaucoma", "cataract"],
    tokos: ["pregnan", "ctg", "labour", "labor", "obstetric", "antenatal", "gynae", "pph"],
    narke: ["anaesthe", "anesthe", "airway", "intubat", "capnog", "nerve block", "spinal", "ventilator"],
    prep: ["neet", "inicet", "ini-cet", "usmle", "mcq", "exam", "question bank", "pyq", "fmge", "next exam"],
    clinix: ["osce", "viva", "examination skill", "clinical exam", "case presentation", "history taking"],
    atlas: ["anatomy", "ct", "mri", "radiology"],
    guidelines: ["guideline", "protocol", "management of"],
    surgx: ["surgery", "operation", "op note", "operative", "post-op", "checklist", "surgical"],
    pglog: ["logbook", "log case", "nmc", "thesis", "residency"],
    queue: ["opd", "token", "queue", "appointment", "clinic"],
    followcare: ["follow up", "follow-up", "discharge", "review visit", "recall patient"],
    maitri: ["recovery", "rehab", "patient support", "after discharge"],
    ward: ["ward", "inpatient", "ghis", "admitted"],
    kxinbox: ["refer", "referral", "handover", "colleague", "second opinion"],
    govschemes: ["scheme", "pmjay", "ayushman", "arogyasri", "package", "insurance"],
    agentconnect: ["emr", "his", "hospital system"],
    speckit: ["specialty kit", "paeds", "ent", "psychiatry", "dental"],
    review: ["approve", "review content"]
  };
  function normQ(q) { return " " + String(q || "").toLowerCase().replace(/[^a-z0-9/+-]+/g, " ").replace(/\s+/g, " ").trim() + " "; }
  // Tools that fit a free-text problem, best first: [{act, hits}], most phrase hits first, longer phrases breaking ties.
  function suggest(q, max) {
    var t = normQ(q), out = [];
    if (t.length < 4) return out;
    for (var act in PROBLEMS) {
      if (!Object.prototype.hasOwnProperty.call(PROBLEMS, act)) continue;
      var hits = 0, len = 0;
      PROBLEMS[act].forEach(function (p) { var k = p.length <= 3 ? normQ(p) : normQ(p).replace(/ $/, ""); if (t.indexOf(k) >= 0) { hits++; len += k.length; } });
      if (hits) out.push({ act: act, hits: hits, len: len });
    }
    out.sort(function (a, b) { return (b.hits - a.hits) || (b.len - a.len) || (a.act < b.act ? -1 : 1); });
    return out.slice(0, max || 3).map(function (x) { return { act: x.act, hits: x.hits }; });
  }
  function keywords(act) { return (PROBLEMS[act] || []).join(" "); }

  G.SMD_TOOL_GROUPS = { on: on, role: role, specialty: specialty, groupOf: groupOf, sections: sections, starter: starter,
    recent: recent, pushRecent: pushRecent, desc: desc, GROUPS: GROUPS, DESC: DESC, STARTER: STARTER, PACKS: PACKS,
    ON_HOME_ALREADY: ON_HOME_ALREADY, MAX_STARTER: MAX_STARTER, MAX_RECENT: MAX_RECENT,
    tabsOn: tabsOn, TASKS: TASKS, BRANCHES: BRANCHES, task: task, taskOf: taskOf, branch: branch, branchById: branchById,
    branchForKit: branchForKit, setBranch: setBranch, tab: tab, setTab: setTab, TAB_IDS: TAB_IDS,
    seedSeen: seedSeen, isNew: isNew, markSeen: markSeen, tryNext: tryNext, hideTry: hideTry, weekNo: weekNo,
    PROBLEMS: PROBLEMS, suggest: suggest, keywords: keywords };
})(typeof window !== "undefined" ? window : globalThis);
