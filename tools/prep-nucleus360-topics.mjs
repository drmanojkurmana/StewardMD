#!/usr/bin/env node
/* Nucleus360 full expansion (owner 2026-10-15): one topic per high-yield cluster for
 * EVERY subject in prep/taxonomy.json, so every module belongs to at least one topic.
 *
 *   node tools/prep-nucleus360-topics.mjs --plan        subject table + topic targets ($0, offline)
 *   node tools/prep-nucleus360-topics.mjs --build [--subject <sid>] [--api <base>]
 *     writes prep/nucleus360/topics.json (v2), floor-map.json (every module),
 *     coverage-report.json; gaps -> ~/prep-data/assessment/handoff/nucleus-gaps.json
 *   node tools/prep-nucleus360-topics.mjs --report       coverage table from built files
 *
 * Rules honoured: existing signals only for ranking (size, bank counts, lesson/kb
 * presence; chapter-yield ranks where the old tool had them - never republished);
 * titles are real taxonomy module/section names; no question text in git (outlines,
 * item ids, honest counts); functions/api/prep/bank and the bank client untouched;
 * prep/taxonomy/crosslist.json is owned by the xlist job - sharing is encoded in
 * topics.json subjects[]/modules[] and never edits crosslist/topic-links in place.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const N = require(path.join(ROOT, "prep-nucleus360.js"));
const FLOOR = await import(path.join(ROOT, "tools", "prep-nucleus360-floor.mjs"));

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const API = arg("--api", "https://stewardmd.in/api/prep/bank/");
const GAP_PATH = path.join(os.homedir(), "prep-data", "assessment", "handoff", "nucleus-gaps.json");

const STOP = new Set("disease diseases disorder disorders syndrome syndromes general basics basic clinical introduction principles misc miscellaneous approach common and the with for from".split(" "));
function toks(s) { return String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []; }
function sig(s) { return new Set(toks(s).filter((w) => w.length > 2 && !STOP.has(w))); }
function overlap(a, b) {
  const A = sig(a), B = sig(b);
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n;
}
function jaccard(a, b) {
  const A = sig(a), B = sig(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
function slug(s) {
  return String(s || "topic").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "topic";
}
function normStem(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/* ---------- inputs (all read-only) ---------- */
function taxonomy() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "prep", "taxonomy.json"), "utf8"));
}
function bankIndex() {
  // subject -> Map(moduleId -> { title, count, all, usmle, size })
  const out = new Map();
  const vdir = path.join(ROOT, "prep", "bank");
  for (const v of fs.readdirSync(vdir).filter((x) => /^v\d+$/.test(x))) {
    for (const sid of fs.readdirSync(path.join(vdir, v))) {
      if (out.has(sid)) continue;
      const ixP = path.join(vdir, v, sid, "index.json");
      if (!fs.existsSync(ixP)) continue;
      try {
        const ix = JSON.parse(fs.readFileSync(ixP, "utf8"));
        const m = new Map();
        for (const t of ix.topics || []) {
          const title = t.title && typeof t.title === "object" ? t.title.en : t.title;
          m.set(t.id, { title: title || t.id, count: t.count || 0, all: t.all || 0, usmle: t.usmle || 0, size: t.size || "m" });
        }
        out.set(sid, m);
      } catch { /* broken index skipped, never guessed */ }
    }
  }
  return out;
}
function lessons() {
  try {
    const ix = JSON.parse(fs.readFileSync(path.join(ROOT, "prep", "lessons", "v1", "index.json"), "utf8"));
    return Object.entries(ix.modules || {}).map(([id, m]) => ({ id, title: (m && m.title) || id }));
  } catch { return []; }
}
function kbPages() {
  const dir = path.join(ROOT, "kb", "diseases");
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return []; }
  return files.map((f) => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      return { file: f, id: d.id || f.replace(/\.json$/, ""), name: d.name || d.id || f };
    } catch { return null; }
  }).filter(Boolean);
}
function oldTopics() {
  // Seeds are ALWAYS the last committed topics.json (the published list), never the
  // worktree file (a previous --build overwrites it, which would self-seed v2 output).
  const fromDoc = (d) => (d && Array.isArray(d.topics) ? d.topics : []);
  try {
    const cp = require("node:child_process");
    const r = cp.spawnSync("git", ["show", "HEAD:prep/nucleus360/topics.json"], { cwd: ROOT, encoding: "utf8" });
    if (r.status === 0) {
      const head = fromDoc(JSON.parse(r.stdout));
      if (head.length) return head;
    }
  } catch { /* no git history: fall through */ }
  try {
    const cur = fromDoc(JSON.parse(fs.readFileSync(path.join(ROOT, "prep", "nucleus360", "topics.json"), "utf8")));
    if (cur.some((t) => t.id === "pancreatic-adenocarcinoma")) return cur;
  } catch { /* nothing usable */ }
  return [];
}

/* ---------- per-module yield signals (existing signals only) ---------- */
const SIZE_W = { l: 3, m: 2, s: 1 };
function modScore(mod, bank, lessonHit, kbHit) {
  const sizeW = SIZE_W[mod.size] || 2;
  return 3 * sizeW + 2 * Math.log1p(bank ? bank.count : 0) + 1.5 * Math.log1p(bank ? bank.usmle : 0)
    + (lessonHit ? 1 : 0) + (kbHit ? 0.5 : 0);
}

/* ---------- candidate topics per subject (section chunks, titles are real names) ---------- */
function modTitle(m) {
  if (typeof m.title === "string") return m.title;
  if (m.name && typeof m.name.en === "string") return m.name.en;
  return m.id;
}
function secTitle(s) { return s.title || (s.name && s.name.en) || s.id; }

function planSubject(subj, bankBySubj, lessonList, claimed) {
  const bank = bankBySubj.get(subj.id) || new Map();
  const mods = []; // chunkable (unclaimed) modules drive topic count; all lists all modules
  const all = [];
  for (const sec of subj.sections || []) {
    for (const m of sec.modules || []) {
      const b = bank.get(m.id);
      const title = modTitle(m);
      const lessonHit = lessonList.some((l) => l.id === m.id) || lessonList.some((l) => overlap(title, l.title) >= 2);
      const rec = {
        subject: subj.id, module: m.id, title, size: m.size || (b && b.size) || "m",
        scope: m.scope || "", section: sec.id, sectionTitle: secTitle(sec),
        count: b ? b.count : 0, usmle: b ? b.usmle : 0, inBank: !!b,
        lessonHit, score: 0,
      };
      all.push(rec);
      if (!claimed || !claimed.has(subj.id + "/" + m.id)) mods.push(rec);
    }
  }
  for (const m of mods) m.score = modScore(m, { count: m.count, usmle: m.usmle }, m.lessonHit, false);
  // Chunk size: ~3 modules/topic, clamped so each subject lands 10-40 topics
  // (waiver below 10 modules: fewer topics than modules is honest).
  const target = Math.max(1, Math.min(40, Math.round(mods.length / 3) || 1));
  const chunk = Math.max(1, Math.ceil(mods.length / target));
  const cands = [];
  const mk = (members, sec) => {
    const whole = members.length === (mods.filter((m) => m.section === sec.id).length);
    const lead = [...members].sort((a, b) => b.score - a.score || b.count - a.count)[0];
    return {
      title: whole ? secTitle(sec) : lead.title,
      leadTitle: lead.title,
      subject: subj.id,
      members,
      score: members.reduce((a, m) => a + m.score, 0) / members.length
        + 0.5 * Math.log1p(members.reduce((a, m) => a + m.count, 0)),
    };
  };
  for (const sec of subj.sections || []) {
    const sm = mods.filter((m) => m.section === sec.id);
    for (let i = 0; i < sm.length; i += chunk) cands.push(mk(sm.slice(i, i + chunk), sec));
  }
  // Cap 40: merge smallest same-section neighbours first, then global smallest pair.
  while (cands.length > 40) {
    let bi = -1, bj = -1;
    for (let i = 0; i < cands.length - 1; i++) {
      if (cands[i].members[0].section !== cands[i + 1].members[0].section) continue;
      if (bi < 0 || cands[i].members.length + cands[i + 1].members.length < cands[bi].members.length + cands[bj].members.length) { bi = i; bj = i + 1; }
    }
    if (bi < 0) {
      let best = Infinity;
      for (let i = 0; i < cands.length; i++) {
        for (let j = i + 1; j < cands.length; j++) {
          const n = cands[i].members.length + cands[j].members.length;
          if (n < best) { best = n; bi = i; bj = j; }
        }
      }
    }
    const a = cands[bi], b = cands[bj];
    for (const m of b.members) {
      if (!a.members.some((x) => x.module === m.module)) a.members.push(m);
    }
    const lead = [...a.members].sort((x, y) => y.score - x.score)[0];
    a.title = a.members.length === mods.filter((m) => m.section === a.members[0].section).length
      ? (subj.sections.find((s) => s.id === a.members[0].section) || {}).title || lead.title : lead.title;
    a.leadTitle = lead.title;
    cands.splice(bj, 1);
  }
  // Floor 10 (only when the subject has >= 10 modules): split largest chunks in half.
  while (cands.length < 10 && all.length >= 10) {
    const big = [...cands].sort((a, b) => b.members.length - a.members.length)[0];
    if (!big || big.members.length < 2) break;
    const half = Math.ceil(big.members.length / 2);
    const sec = subj.sections.find((s) => s.id === big.members[0].section);
    const second = mk(big.members.slice(half), sec);
    big.members = big.members.slice(0, half);
    Object.assign(big, mk(big.members, sec), { subject: subj.id });
    cands.push(second);
  }
  return { mods, all, cands };
}

/* ---------- cross-subject sharing: ONE topic in every home subject hub ---------- */
function mergeShared(allCands) {
  // Locked (v1-anchored) candidates keep their id/title forever and never merge with
  // each other; unlocked candidates may join a locked host (union capped at 8).
  const topics = allCands.map((c) => (c.locked ? { ...c, homes: [...c.homes] } : { ...c, homes: [c.subject], id: slug(c.title) }));
  // Deterministic order: highest score first so the best title/id wins.
  topics.sort((a, b) => b.score - a.score);
  const out = [];
  for (const t of topics) {
    if (t.locked) { out.push(t); continue; }
    let host = null;
    for (const o of out) {
      if (o.homes.includes(t.subject)) continue;
      if (o.locked && o.members.length + t.members.length > 8) continue;
      if (!o.locked && o.members.length + t.members.length > 8) continue;
      if (o.id === t.id || jaccard(o.leadTitle, t.leadTitle) >= 0.6) { host = o; break; }
    }
    if (host) {
      for (const m of t.members) {
        if (!host.members.some((x) => x.subject === m.subject && x.module === m.module)) host.members.push(m);
      }
      if (!host.homes.includes(t.subject)) host.homes.push(t.subject);
      host.score = Math.max(host.score, t.score);
    } else {
      out.push(t);
    }
  }
  // Unique ids (locked ids win; suffix later collisions).
  const seen = new Set();
  for (const t of out.filter((x) => x.locked)) seen.add(t.id);
  for (const t of out.filter((x) => !x.locked)) {
    let id = t.id, k = 2;
    while (seen.has(id)) id = t.id + "-" + (k++);
    t.id = id;
    seen.add(id);
  }
  return out;
}

/* v1 seeds: each legacy topic becomes a locked candidate owning its module pairs,
 * so the published ids/titles survive the expansion. First claimant wins. */
function v1Seeds(v1, bankBySubj) {
  const claimed = new Set();
  const seeds = [];
  const ordered = [...v1].sort((a, b) => (a.id === "pancreatic-adenocarcinoma" ? -1 : b.id === "pancreatic-adenocarcinoma" ? 1 : 0));
  for (const o of ordered) {
    const members = [];
    for (const [s, m] of o.modules || []) {
      const key = s + "/" + m;
      claimed.add(key); // modules stay out of section chunking; seeds may share pairs
      const b = (bankBySubj.get(s) || new Map()).get(m);
      members.push({ subject: s, module: m, title: (b && b.title) || m, size: (b && b.size) || "m", count: (b && b.count) || 0, usmle: (b && b.usmle) || 0 });
    }
    if (!members.length) continue;
    const title = TITLE_FIX[o.title] || o.title;
    seeds.push({
      id: o.id, title, leadTitle: title, subject: o.subject, locked: true,
      homes: [...new Set(members.map((m) => m.subject))],
      members,
      score: members.reduce((a, m) => a + modScore(m, { count: m.count, usmle: m.usmle }, false, false), 0) / members.length
        + 0.5 * Math.log1p(members.reduce((a, m) => a + m.count, 0)),
    });
  }
  return { seeds, claimed };
}

/* ---------- live bank items: each unique module fetched once, then released ---------- */
async function fetchItems(pairs, conc = 8) {
  const got = new Map();
  const queue = [...pairs];
  async function worker() {
    while (queue.length) {
      const [s, m] = queue.shift();
      const key = s + "/" + m;
      try {
        const r = await fetch(API + "v5/" + s + "/mcq/" + m + ".json");
        if (!r.ok) { got.set(key, []); continue; }
        const j = await r.json();
        got.set(key, j.items || []);
      } catch { got.set(key, []); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, queue.length) }, worker));
  return got;
}
function dedupeItems(items) {
  const seen = new Set(), out = [];
  for (const it of items) {
    if (!it || !it.id) continue;
    const k = "id:" + it.id;
    if (seen.has(k)) continue;
    seen.add(k);
    // Second pass key: normalised stem catches re-banked duplicates across subjects.
    const sk = "stem:" + normStem(it.q);
    if (sk.length > 8 && seen.has(sk)) continue;
    seen.add(sk);
    out.push(it);
  }
  return out;
}

async function buildTopic(t, kbs, lessonList, itemCache) {
  const raw = [];
  for (const m of t.members) {
    const key = m.subject + "/" + m.module;
    if (!itemCache.has(key)) {
      const one = await fetchItems([[m.subject, m.module]], 1);
      for (const [k, v] of one) itemCache.set(k, v);
    }
    for (const it of itemCache.get(key) || []) raw.push(it);
  }
  const items = dedupeItems(raw);
  // KB + lesson by word overlap (same rule as the v1 tool: needs >= 2 shared words).
  let kb = null, kbScore = 0;
  for (const k of kbs) {
    const s = overlap(t.title, k.name);
    if (s > kbScore) { kbScore = s; kb = k; }
  }
  let lesson = null, lsScore = 0;
  const hay = t.title + " " + t.members.map((m) => m.title).join(" ");
  for (const l of lessonList) {
    const s = overlap(hay, l.title);
    if (s > lsScore) { lsScore = s; lesson = l; }
  }
  let kbObj = null;
  if (kb && kbScore >= 2) {
    try { kbObj = JSON.parse(fs.readFileSync(path.join(ROOT, "kb", "diseases", kb.file), "utf8")); } catch { kbObj = null; }
  }
  const outline = N.outlineOf({
    id: t.id, title: t.title, kb: kbObj,
    lesson: lsScore >= 2 && lesson ? { id: lesson.id, title: lesson.title } : null,
  });
  const type = N.typeOf({ title: t.title });
  const matched = N.matchConcepts(outline, items, type);
  const cov = N.coverage(outline, matched.assign);
  return {
    id: t.id,
    title: t.title,
    subject: t.subject,
    subjects: [...t.homes].sort(),
    modules: t.members.map((m) => [m.subject, m.module]),
    score: Math.round(t.score * 100) / 100,
    kb: kbScore >= 2 ? kb.id : null,
    kbTitle: kbScore >= 2 ? kb.name : null,
    lesson: lsScore >= 2 ? { id: lesson.id, title: lesson.title } : null,
    n: items.length,
    type,
    outline,
    match: Object.fromEntries(Object.entries(matched.assign).map(([k, v]) => [k, { n: v.length, items: v.slice(0, 20) }])),
    unassigned: matched.unassigned.length,
    fetched: raw.length,
    coverage: { total: cov.total, covered: cov.covered, gaps: cov.gaps },
  };
}

/* Obvious v1 title misspellings fixed, ids unchanged. */
const TITLE_FIX = { "Medicine: Arrythmias": "Medicine: Arrhythmias", "SPM: Repsiratory Infections": "SPM: Respiratory Infections" };

/* ---------- driver ---------- */
function allSubjects() {
  const t = taxonomy();
  return t.branches.flatMap((b) => (b.subjects || []).map((s) => ({ branch: b.id, ...s })));
}

function planAll(bankBySubj, lessonList) {
  const rows = [];
  for (const subj of allSubjects()) {
    const { mods, cands } = planSubject(subj, bankBySubj, lessonList);
    rows.push({ subject: subj.id, branch: subj.branch, modules: mods.length, cands: cands.length, inBank: mods.filter((m) => m.inBank).length });
  }
  return rows;
}

async function buildAll(outDir, onlySubjects) {
  const bankBySubj = bankIndex();
  const lessonList = lessons();
  const kbs = kbPages();
  const v1 = oldTopics();
  const subjects = allSubjects().filter((s) => !onlySubjects || onlySubjects.includes(s.id));

  const { seeds, claimed } = onlySubjects ? { seeds: [], claimed: new Set() } : v1Seeds(v1, bankBySubj);
  let allCands = [...seeds];
  const modsBySubject = new Map();
  for (const subj of subjects) {
    const { mods, all, cands } = planSubject(subj, bankBySubj, lessonList, claimed);
    modsBySubject.set(subj.id, all);
    allCands.push(...cands);
  }
  allCands = mergeShared(allCands);
  // Post-merge hub cap: sharing can push a hub past 40. Fold the lowest-score
  // single-home unlocked topic into its lowest-score hub-mate until <= 40.
  {
    const hubN = () => {
      const m = new Map();
      for (const c of allCands) for (const h of c.homes) m.set(h, (m.get(h) || 0) + 1);
      return m;
    };
    for (const [h, n] of hubN()) {
      let over = n - 40;
      while (over > 0) {
        const solo = allCands.filter((c) => c.homes.length === 1 && c.homes[0] === h && !c.locked).sort((a, b) => a.score - b.score);
        if (!solo.length) break;
        const vic = solo[0];
        const mate = allCands.filter((c) => c.id !== vic.id && c.homes.includes(h)).sort((a, b) => a.score - b.score)[0];
        if (!mate) break;
        for (const m of vic.members) {
          if (!mate.members.some((x) => x.subject === m.subject && x.module === m.module)) mate.members.push(m);
        }
        mate.score = Math.max(mate.score, vic.score);
        allCands.splice(allCands.indexOf(vic), 1);
        over--;
      }
    }
  }

  // Yield tiers per home subject: top 30% core, next 40% high, rest extra.
  const tierOf = new Map();
  const byHome = new Map();
  for (const c of allCands) {
    for (const h of c.homes) {
      if (!byHome.has(h)) byHome.set(h, []);
      byHome.get(h).push(c);
    }
  }
  for (const [h, list] of byHome) {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    sorted.forEach((c, i) => {
      const f = sorted.length <= 1 ? 0 : i / (sorted.length - 1);
      const prev = tierOf.get(c.id);
      const tier = f < 0.3 ? "core" : f < 0.7 ? "high" : "extra";
      if (!prev || (prev === "extra") || (prev === "high" && tier === "core")) tierOf.set(c.id, tier);
    });
  }

  // Build per primary-subject batch: prefetch each unique module once, release after.
  const byPrimary = new Map();
  for (const c of allCands) {
    if (!byPrimary.has(c.subject)) byPrimary.set(c.subject, []);
    byPrimary.get(c.subject).push(c);
  }
  const topics = [];
  for (const [sid, list] of byPrimary) {
    const pairs = new Map();
    for (const c of list) for (const m of c.members) pairs.set(m.subject + "/" + m.module, [m.subject, m.module]);
    const itemCache = await fetchItems([...pairs.values()], 8);
    for (const c of list) {
      const t = await buildTopic(c, kbs, lessonList, itemCache);
      t.yieldTier = tierOf.get(t.id) || "extra";
      topics.push(t);
      console.log(t.id + " | homes:" + t.subjects.join(",") + " | mods:" + t.modules.length + " | n:" + t.n + " | cov:" + t.coverage.covered + "/" + t.coverage.total);
    }
  }
  const panc = topics.filter((t) => t.id === "pancreatic-adenocarcinoma");
  const rest = topics.filter((t) => t.id !== "pancreatic-adenocarcinoma").sort((a, b) => b.score - a.score);
  topics.length = 0;
  topics.push(...panc, ...rest);

  fs.mkdirSync(outDir, { recursive: true });
  const subjNames = {};
  for (const s of allSubjects()) subjNames[s.id] = (s.title || (s.name && s.name.en) || s.id);
  fs.writeFileSync(path.join(outDir, "topics.json"), JSON.stringify({ v: 2, tool: "tools/prep-nucleus360-topics.mjs", gen: new Date().toISOString().slice(0, 10), subjects: subjNames, topics }, null, 1));

  // Floor map over EVERY taxonomy module (direct membership only).
  const entries = [];
  for (const subj of subjects) {
    for (const m of modsBySubject.get(subj.id) || []) entries.push({ mid: m.module, sid: m.subject });
  }
  const topicsDoc = { topics };
  const { map, uncovered } = FLOOR.buildFloorMap(entries, topicsDoc);
  fs.writeFileSync(path.join(outDir, "floor-map.json"), JSON.stringify({ v: 1, gen: new Date().toISOString().slice(0, 10), topics: topics.length, map }, null, 1));

  // Coverage report + gap handoff (no question text anywhere here).
  const gaps = [];
  const repSubjects = {};
  for (const subj of subjects) {
    const st = (byHome.get(subj.id) || []);
    const swo = st.map((c) => topics.find((t) => t.id === c.id)).filter(Boolean);
    const unc = entries.filter((e) => e.sid === subj.id && !map[e.mid]).map((e) => e.mid);
    let g = 0;
    for (const t of swo) {
      const lead = t.modules[0] || [t.subject, ""];
      for (const [cid, mm] of Object.entries(t.match || {})) {
        if (mm.n < 3) {
          const concept = (t.outline || []).find((c) => c.id === cid);
          gaps.push({ topic: t.id, subject: t.subject, module: lead[1], concept: (concept && concept.title) || cid, missing: 3 - mm.n });
          g += 3 - mm.n;
        }
      }
    }
    repSubjects[subj.id] = {
      branch: subj.branch, modules: (modsBySubject.get(subj.id) || []).length,
      topics: swo.length, uncovered: unc, minUnionN: swo.reduce((a, t) => Math.min(a, t.n), swo.length ? Infinity : 0),
      gaps: g,
    };
  }
  fs.writeFileSync(path.join(outDir, "coverage-report.json"), JSON.stringify({ v: 1, gen: new Date().toISOString().slice(0, 10), subjects: repSubjects }, null, 1));
  if (!onlySubjects) {
    const gapDest = arg("--gaps-out", GAP_PATH);
    fs.mkdirSync(path.dirname(path.resolve(gapDest)), { recursive: true });
    fs.writeFileSync(gapDest, JSON.stringify({ v: 1, gen: new Date().toISOString().slice(0, 10), gaps }, null, 1));
    console.log("gaps -> " + gapDest);
  }
  console.log("topics:" + topics.length + " uncovered:" + uncovered.length + " gaps:" + gaps.length);
  return { topics, uncovered, gaps: gaps.length };
}

const cmd = argv[0] || "--plan";
if (cmd === "--seeds") {
  const v1 = oldTopics();
  console.log("v1 topics read:", v1.length);
  const { seeds } = v1Seeds(v1, bankIndex());
  console.log("seeds:", seeds.length);
  for (const s of seeds) console.log("-", s.id, "locked:" + !!s.locked, "members:" + s.members.length);
} else if (cmd === "--plan") {
  const bankBySubj = bankIndex();
  const lessonList = lessons();
  const rows = planAll(bankBySubj, lessonList);
  let totM = 0, totC = 0;
  for (const r of rows) { totM += r.modules; totC += r.cands; console.log(r.branch + "/" + r.subject + ": " + r.modules + " mods -> " + r.cands + " topics (" + r.inBank + " in bank)"); }
  console.log("subjects:" + rows.length + " modules:" + totM + " candidate topics:" + totC);
} else if (cmd === "--build") {
  const only = arg("--subject", null) ? arg("--subject", "").split(",").filter(Boolean) : null;
  const out = arg("--out", path.join(ROOT, "prep", "nucleus360"));
  await buildAll(out, only);
} else if (cmd === "--gaps") {
  // Fetch-free: recompute gaps + coverage report from an existing topics.json.
  const dir = arg("--out", path.join(ROOT, "prep", "nucleus360"));
  const j = JSON.parse(fs.readFileSync(path.join(dir, "topics.json"), "utf8"));
  const topics = j.topics || [];
  const gaps = [];
  for (const t of topics) {
    const lead = (t.modules || [])[0] || [t.subject, ""];
    for (const [cid, mm] of Object.entries(t.match || {})) {
      if (mm.n < 3) {
        const concept = (t.outline || []).find((c) => c.id === cid);
        gaps.push({ topic: t.id, subject: t.subject, module: lead[1], concept: (concept && concept.title) || cid, missing: 3 - mm.n });
      }
    }
  }
  const gapDest = arg("--gaps-out", GAP_PATH);
  fs.mkdirSync(path.dirname(path.resolve(gapDest)), { recursive: true });
  fs.writeFileSync(gapDest, JSON.stringify({ v: 1, gen: new Date().toISOString().slice(0, 10), gaps }, null, 1));
  console.log("gaps:" + gaps.length + " -> " + gapDest);
} else if (cmd === "--report") {
  const dir = arg("--out", path.join(ROOT, "prep", "nucleus360"));
  const j = JSON.parse(fs.readFileSync(path.join(dir, "topics.json"), "utf8"));
  const rep = JSON.parse(fs.readFileSync(path.join(dir, "coverage-report.json"), "utf8"));
  console.log("topics:" + j.topics.length + " shared:" + j.topics.filter((t) => (t.subjects || []).length > 1).length);
  for (const [sid, r] of Object.entries(rep.subjects)) {
    console.log("- " + sid + ": " + r.topics + " topics, " + r.modules + " modules, uncovered:" + r.uncovered.length + ", minUnionN:" + r.minUnionN + ", gaps:" + r.gaps);
  }
}

