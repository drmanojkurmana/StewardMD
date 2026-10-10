#!/usr/bin/env node
/* PrepNucleus MaiK questions from the command line: the same engine as the app (functions/_prep-qgen.js), for bulk jobs
 * from a source folder with the owner's own Anthropic key. DRY RUN BY DEFAULT: without --run nothing is sent and the
 * cost is estimated from token counts first.
 *
 *   node tools/prep-qgen.mjs --source <dir|file> --topic "Thyroid" --count 60 [--exam neet-pg] [--diff mix] [--subject s --module m]
 *        prints the estimate (Batch and direct prices) and exits. Add --run to submit (Message Batches, half price), or
 *        --run --direct for the interactive API (rounds of 5, full price, results at once). Add --bank <path>[,<path>]
 *        (bank file paths as the app names them, read from R2 with wrangler) for the duplicate check.
 *   node tools/prep-qgen.mjs --resume <job>          poll a submitted job (re-run until it says done; safe to repeat)
 *   node tools/prep-qgen.mjs publish --stage <id>    the Author screen's staged set (R2 prep-qgen/staging/<id>.json)
 *   node tools/prep-qgen.mjs publish --items <file> --subject s --module m [--set maik1]
 *        builds overlay/<set>/<subject>/<module>.json (only items that passed or were approved) under
 *        ~/prep-data/qgen/publish/ and prints the remaining steps; add --upload to upload it with prep-upload-bank.mjs.
 *
 * Key: env ANTHROPIC_API_KEY and ANTHROPIC_WORKSPACE_ID, or --env <file> (KEY=value lines, e.g. ~/.config/stewardmd/anthropic.env).
 * The key is never printed. Work files (with question text) live in ~/prep-data/qgen/<job>/, outside the repo: the repo
 * is public and no generated item text goes into git. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const E = await import(pathToFileURL(path.join(ROOT, "functions/_prep-qgen.js")).href);
const WORK = process.env.PREP_QGEN_WORK || path.join(os.homedir(), "prep-data", "qgen");

const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };

/* ---------- pure helpers (tested) ---------- */
/* readSource(p) -> text of a file or of every .txt/.md file in a folder (sorted). */
export function readSource(p) {
  if (!p) return "";
  const st = fs.statSync(p);
  if (st.isFile()) return fs.readFileSync(p, "utf8");
  return fs.readdirSync(p).filter((f) => /\.(txt|md)$/i.test(f)).sort().map((f) => fs.readFileSync(path.join(p, f), "utf8")).join("\n\n");
}
/* chunks(text, max) -> pieces of at most max chars, cut at paragraph ends where possible. */
export function chunks(text, max) {
  const out = [];
  let t = String(text || "").trim();
  while (t.length > max) {
    let cut = t.lastIndexOf("\n\n", max);
    if (cut < max * 0.5) cut = t.lastIndexOf(". ", max) + 1;
    if (cut < max * 0.5) cut = max;
    out.push(t.slice(0, cut).trim()); t = t.slice(cut).trim();
  }
  if (t) out.push(t);
  return out;
}
/* split(n, k) -> k counts summing to n, as even as possible. */
export function split(n, k) { const out = []; for (let i = 0; i < k; i++) out.push(Math.floor(n / k) + (i < n % k ? 1 : 0)); return out; }
/* plan({ text, n, chunkChars }) -> [{ ground, n }] */
export function plan(o) {
  const parts = o.text ? chunks(o.text, o.chunkChars || 40000) : [""];
  const k = Math.min(parts.length, Math.max(1, Math.ceil(o.n / E.QGEN.perCall)));
  const use = parts.slice(0, k), ns = split(o.n, use.length);
  return use.map((g, i) => ({ ground: g, n: ns[i] })).filter((x) => x.n > 0);
}
/* estimateJob(parts, cfg) -> { batch, direct, perQuestion } in USD */
export function estimateJob(parts, cfg) {
  let b = 0, d = 0, n = 0;
  for (const p of parts) { b += E.estimate({ n: p.n, groundChars: p.ground.length, batch: true }, cfg).usd; d += E.estimate({ n: p.n, groundChars: p.ground.length }, cfg).usd; n += p.n; }
  const r = (x) => Math.round(x * 10000) / 10000;
  return { questions: n, batch: r(b), direct: r(d), perQuestionBatch: r(b / Math.max(1, n)), perQuestionDirect: r(d / Math.max(1, n)) };
}
/* toOverlay(items, { subject, module, set }) -> { topic, set, v, items } in the overlay shape prep.js loads. */
export function toOverlay(items, o) {
  const keep = (items || []).filter((it) => it && it.q && Array.isArray(it.o) && it.o.length === 4 && Number.isInteger(it.a) && (!it.qg || it.qg.v === "ok" || it.qg.approved));
  return { topic: o.module, set: o.set, v: 1, items: keep.map((it) => {
    const id = "mk-" + String(it.id || "").replace(/^q_/, "");
    const out = { id, q: it.q, o: it.o, a: it.a, exp: it.exp || "", r: it.r || [], kp: it.kp || "", t: o.module, d: it.d || 2, cog: it.cog || "recall", prov: "SMD", gen: "AI", set: o.set };
    if (it.tg && it.tg.length) out.tg = it.tg;
    return out;
  }) };
}
function loadEnv(file) {
  if (!file) return;
  for (const l of fs.readFileSync(file.replace(/^~/, os.homedir()), "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=["']?(.*?)["']?\s*$/.exec(l);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const say = (...a) => console.log(...a);
const usdFmt = (x) => "$" + Number(x).toFixed(4);

async function main() {
  if (argv[0] === "publish") return publish();
  if (has("--resume")) { loadEnv(arg("--env")); return resume(arg("--resume")); }
  const src = arg("--source"), topic = arg("--topic"), n = Number(arg("--count", "20"));
  if (!topic || !(n > 0)) { say("Usage: node tools/prep-qgen.mjs --source <dir|file> --topic \"...\" --count N [--run [--direct]]"); process.exit(2); }
  const exam = arg("--exam", "neet-pg"), diff = arg("--diff", "mix");
  const text = src ? readSource(src) : "";
  const parts = plan({ text, n, chunkChars: Number(arg("--chunk", "40000")) });
  const cfg = E.qgenConfig({ ANTHROPIC_API_KEY: "x".repeat(20), PREP_QGEN_ON: "1", PREP_QGEN_MODEL: arg("--model"), PREP_QGEN_VERIFY_MODEL: arg("--verify-model") });
  const est = estimateJob(parts, cfg);
  say("Topic: " + topic + " · exam " + exam + " · " + n + " questions in " + parts.length + " source part" + (parts.length === 1 ? "" : "s") + (text ? " (" + text.length + " chars)" : " (no source: general knowledge, marked not from the library)"));
  say("Models: " + cfg.genModel + " writes, " + cfg.verifyModel + " checks blind. Prices from the claude-api skill table.");
  say("Estimate: Batch " + usdFmt(est.batch) + " (" + usdFmt(est.perQuestionBatch) + " a question), direct " + usdFmt(est.direct) + " (" + usdFmt(est.perQuestionDirect) + " a question).");
  if (!has("--run")) { say("DRY RUN: nothing was sent. Add --run to submit (Batch), or --run --direct."); return; }
  loadEnv(arg("--env"));
  if (!process.env.ANTHROPIC_API_KEY) { say("ANTHROPIC_API_KEY is not set (env or --env <file>)."); process.exit(2); }
  const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID: process.env.ANTHROPIC_WORKSPACE_ID, PREP_QGEN_ON: "1", PREP_QGEN_MODEL: arg("--model"), PREP_QGEN_VERIFY_MODEL: arg("--verify-model") };
  const id = "c" + Date.now().toString(36), dir = path.join(WORK, id);
  fs.mkdirSync(dir, { recursive: true });
  const mod = "gen_" + E.stemHash(id + topic);
  const bankStems = readBank(arg("--bank"));
  const base = { id, topic: topic.slice(0, 150), exam, diff, mod, subject: arg("--subject", ""), module: arg("--module", ""), bankStems };
  if (has("--direct")) {
    let items = [], dropped = [], usage = E.addUsage(null, cfg.genModel, null), round = 0;
    for (const p of parts) {
      let left = p.n;
      while (left > 0) {
        const k = Math.min(E.QGEN.perCall, left); round++;
        const r = await E.runRound(env, { mod, topic: base.topic, ground: p.ground, exam, diff, n: k, round, avoid: items.map((x) => x.q).slice(-60) }, { keepFlagged: true, bankStems, prov: "SMD" });
        items = items.concat(r.items); dropped = dropped.concat(r.dropped);
        ["inTok", "outTok", "thinkTok", "cacheRead", "cacheWrite"].forEach((x) => { usage[x] += r.usage[x]; }); usage.usd += r.usage.usd;
        left -= k; say("round " + round + ": " + r.items.length + " made (" + r.items.filter((x) => x.qg.v === "ok").length + " passed), " + r.dropped.length + " dropped, " + usdFmt(r.usage.usd));
      }
    }
    fs.writeFileSync(path.join(dir, "items.json"), JSON.stringify({ ...base, bankStems: undefined, stage: "done", items, dropped, usage }, null, 1));
    say("Done: " + items.length + " items (" + items.filter((x) => x.qg.v === "ok").length + " passed every check), real cost " + usdFmt(usage.usd) + ". " + path.join(dir, "items.json"));
    return;
  }
  const requests = [];
  parts.forEach((p, k) => E.batchGenRequests({ n: p.n, topic: base.topic, ground: p.ground, exam, diff, avoid: [] }, cfg).forEach((r) => requests.push({ custom_id: "p" + k + r.custom_id, params: r.params })));
  const bt = await E.batchCreate(env, requests);
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify({ ...base, parts, stage: "gen", genBatch: bt.id }, null, 1));
  say("Submitted " + requests.length + " requests as batch " + bt.id + ". Job " + id + ". Check with: node tools/prep-qgen.mjs --resume " + id + (arg("--env") ? " --env " + arg("--env") : ""));
}
function readBank(list) {
  if (!list) return [];
  const out = [];
  for (const p of String(list).split(",").filter(Boolean)) {
    const tmp = path.join(os.tmpdir(), "qgen-bank-" + process.pid + ".json");
    const r = spawnSync("npx", ["wrangler", "r2", "object", "get", "stewardmd-offline/prep-bank/" + p, "--file", tmp, "--remote"], { stdio: "ignore" });
    if (r.status !== 0 || !fs.existsSync(tmp)) { say("Could not read " + p + " from R2 (skipped)."); continue; }
    try { const j = JSON.parse(fs.readFileSync(tmp, "utf8")); (Array.isArray(j) ? j : j.items || []).forEach((it) => it && it.q && out.push(it.q)); } catch (e) {}
    fs.rmSync(tmp, { force: true });
  }
  if (out.length) say("Duplicate check against " + out.length + " bank stems.");
  return out;
}
async function resume(id) {
  const dir = path.join(WORK, String(id || "")), f = path.join(dir, "job.json");
  if (!id || !fs.existsSync(f)) { say("No job " + id + " in " + WORK); process.exit(2); }
  const job = JSON.parse(fs.readFileSync(f, "utf8")), env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID: process.env.ANTHROPIC_WORKSPACE_ID, PREP_QGEN_ON: "1" };
  const cfg = E.qgenConfig(env);
  if (job.stage === "done") { say("Done already: " + path.join(dir, "items.json")); return; }
  const bt = await E.batchGet(env, job.stage === "gen" ? job.genBatch : job.verBatch);
  say("Batch " + bt.id + ": " + bt.processing_status + " " + JSON.stringify(bt.request_counts || {}));
  if (bt.processing_status !== "ended") return;
  const results = await E.batchResults(env, bt);
  if (job.stage === "gen") {
    let items = [], dropped = [], usage = E.addUsage(null, cfg.genModel, null);
    job.parts.forEach((p, k) => {
      const mine = results.filter((r) => String(r.custom_id).startsWith("p" + k + "g")).map((r) => ({ ...r, custom_id: String(r.custom_id).slice(String(k).length + 1) }));
      const g = E.batchGenToItems(mine, { mod: job.mod, ground: p.ground, exam: job.exam, avoid: items.map((x) => x.q), bankStems: job.bankStems }, cfg);
      items = items.concat(g.items.map((it) => Object.assign(it, { _p: k }))); dropped = dropped.concat(g.dropped);
      ["inTok", "outTok", "thinkTok", "cacheRead", "cacheWrite"].forEach((x) => { usage[x] += g.usage[x]; }); usage.usd += g.usage.usd;
    });
    const vreq = [];
    job.parts.forEach((p, k) => E.batchVerifyRequests(items.filter((it) => it._p === k), p.ground, cfg).forEach((r) => vreq.push({ custom_id: "p" + k + r.custom_id, params: r.params })));
    job.items = items; job.dropped = dropped; job.usage = usage;
    if (vreq.length) { const vb = await E.batchCreate(env, vreq); job.verBatch = vb.id; job.stage = "verify"; say("Generated " + items.length + " (dropped " + dropped.length + "). Verify batch " + vb.id + " submitted; resume again later."); }
    else job.stage = "done";
  } else {
    let out = [], usage = job.usage;
    job.parts.forEach((p, k) => {
      const mine = results.filter((r) => String(r.custom_id).startsWith("p" + k + "v")).map((r) => ({ ...r, custom_id: String(r.custom_id).slice(String(k).length + 1) }));
      const v = E.batchApplyVerify(job.items.filter((it) => it._p === k), mine, !!p.ground, cfg);
      ["inTok", "outTok", "thinkTok", "cacheRead", "cacheWrite"].forEach((x) => { usage[x] += v.usage[x]; }); usage.usd += v.usage.usd;
      out = out.concat(v.items.map((it) => { if (!p.ground) it.qg.u = 1; delete it._p; return it; }));
    });
    job.items = out; job.stage = "done";
    fs.writeFileSync(path.join(dir, "items.json"), JSON.stringify({ topic: job.topic, exam: job.exam, subject: job.subject, module: job.module, items: out, dropped: job.dropped, usage }, null, 1));
    say("Done: " + out.length + " items, " + out.filter((x) => x.qg.v === "ok").length + " passed every check. Real cost " + usdFmt(usage.usd) + ". " + path.join(dir, "items.json"));
  }
  fs.writeFileSync(f, JSON.stringify(job, null, 1));
}
async function publish() {
  let items, subject = arg("--subject"), module = arg("--module");
  const stage = arg("--stage");
  if (stage) {
    if (!/^s\d{8}-[a-z0-9]+$/.test(stage)) { say("Bad stage id."); process.exit(2); }
    const tmp = path.join(WORK, "stage-" + stage + ".json");
    fs.mkdirSync(WORK, { recursive: true });
    const r = spawnSync("npx", ["wrangler", "r2", "object", "get", "stewardmd-offline/prep-qgen/staging/" + stage + ".json", "--file", tmp, "--remote"], { stdio: "inherit" });
    if (r.status !== 0) process.exit(1);
    const j = JSON.parse(fs.readFileSync(tmp, "utf8"));
    items = j.items.map((it) => Object.assign(it, { qg: Object.assign({}, it.qg, { approved: 1 }) })); subject = subject || j.subject; module = module || j.module;
  } else {
    const f = arg("--items"); if (!f) { say("publish needs --stage <id> or --items <file>"); process.exit(2); }
    const j = JSON.parse(fs.readFileSync(f, "utf8")); items = j.items || j; subject = subject || j.subject; module = module || j.module;
  }
  const set = arg("--set", "maik1");
  if (!/^maik[1-9]\d{0,2}$/.test(set) || !/^[a-z0-9-]{2,60}$/.test(subject || "") || !/^[a-z0-9-]{2,80}$/.test(module || "")) { say("Need --subject, --module (bank ids) and --set maik<n>."); process.exit(2); }
  const ov = toOverlay(items, { subject, module, set });
  const out = path.join(WORK, "publish", set, subject);
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, module + ".json");
  if (fs.existsSync(file)) { say("Exists: " + file + ". Overlay files are immutable once uploaded: use the next set number (--set maik" + (Number(set.slice(4)) + 1) + ")."); process.exit(1); }
  fs.writeFileSync(file, JSON.stringify(ov));
  say("Wrote " + ov.items.length + " items to " + file);
  say("Next (in order):");
  say("  1. prep.js OVERLAYS: add \"" + set + "\" to " + subject + "'s list (and the module, if new, to prep/taxonomy), bump the loader token, ship by OTA.");
  say("  2. Upload: node tools/prep-upload-bank.mjs --dir " + path.join(WORK, "publish", set) + " --as overlay/" + set + " --yes   (also rebuilds the share ID index)");
  say("  3. node tools/prep-overlay-counts.mjs, rebuild the subject's search file, then verify: node tools/prep-ids.mjs verify");
  if (has("--upload")) {
    const r = spawnSync("node", [path.join(ROOT, "tools/prep-upload-bank.mjs"), "--dir", path.join(WORK, "publish", set), "--as", "overlay/" + set, "--yes"], { stdio: "inherit" });
    process.exit(r.status || 0);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("prep-qgen: " + (e && e.code ? e.code + (e.status ? " " + e.status : "") : (e && e.message) || e)); process.exit(1); });
}
