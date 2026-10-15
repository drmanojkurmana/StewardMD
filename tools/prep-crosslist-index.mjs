#!/usr/bin/env node
// PrepNucleus cross-listing index patch. Dev-only, never shipped.
//
// Writes the union-count virtual rows for prep/taxonomy/crosslist.json into the COMMITTED bank indexes the app
// actually serves (each subject's bank version: taxonomy `bv`, else the bank VER in prep.js). A rerun upserts the
// same rows, so it is safe to run after any bank rebuild. Runtime behaviour is unchanged for subjects and modules
// outside every group: only group:"xlist" rows are added or replaced.
//
// RUN
//   node tools/prep-crosslist-index.mjs [--check]
//   --check verifies without writing (non-zero exit when a file would change).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { overlaysOf } from "./prep-overlay-counts.mjs";
import { crosslistRows } from "./prep-build-bank.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
// The committed indexes keep their own serialisation (some pretty-printed, some single-line): detect the file's
// indent and trailing newline once, so the patch only adds rows and never reformats.
const fmtOf = (raw) => {
  const line = (raw.split("\n")[1] || "");
  const indent = (/^ */.exec(line) || [""])[0].length;
  return { indent: indent || 0, nl: raw.endsWith("\n") ? "\n" : "" };
};
const writeJson = (p, o) => {
  const raw = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  const f = raw ? fmtOf(raw) : { indent: 0, nl: "" };
  fs.writeFileSync(p, JSON.stringify(o, null, f.indent || undefined) + f.nl);
};
const shaFile = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

const tax = readJson(path.join(ROOT, "prep", "taxonomy.json"));
const bvBySubject = {};
for (const b of tax.branches) for (const s of b.subjects) if (s.bv) bvBySubject[s.id] = s.bv;
const prepSrc = fs.readFileSync(path.join(ROOT, "prep.js"), "utf8");
const VER = (/VER = G\.SMD_PREP_BANK_VER \|\| "(v\d+)"/.exec(prepSrc) || [])[1] || "v5";
const bvOf = (sid) => bvBySubject[sid] || VER;

const xlist = readJson(path.join(ROOT, "prep", "taxonomy", "crosslist.json"));
const oc = readJson(path.join(ROOT, "prep", "bank", "overlay-counts.json"));
const setsOf = overlaysOf(prepSrc);
const ovFor = (sid, mid) => (setsOf[sid] || []).reduce((n, set) => n + ((((oc.sets || {})[set] || {})[sid] || {})[mid] || 0), 0);

// Served member rows, with the static overlay counts the committed indexes do not carry (the app adds them at
// load; dynamic MaiK waves land on top at runtime and the exact union is written back once a group is opened).
const ixCache = new Map();
const ixOf = (sid) => {
  if (!ixCache.has(sid)) {
    const p = path.join(ROOT, "prep", "bank", bvOf(sid), sid, "index.json");
    ixCache.set(sid, fs.existsSync(p) ? { p, ix: readJson(p) } : null);
  }
  return ixCache.get(sid);
};
const getRow = (sid, mid) => {
  const e = ixOf(sid);
  const t = e && (e.ix.topics || []).find((t) => t.id === mid);
  return t ? { count: t.count || 0, all: t.all || 0, usmle: t.usmle || 0, ov: ovFor(sid, mid) } : null;
};

const check = process.argv.includes("--check");
const rows = crosslistRows(xlist, getRow);
let changed = 0;
for (const [sid, rs] of rows) {
  const e = ixOf(sid);
  if (!e) continue;
  const before = (e.ix.topics || []).filter((t) => t.group === "xlist").map((t) => t.id);
  const next = (e.ix.topics || []).filter((t) => !rs.some((r) => r.id === t.id)).concat(rs);
  if (JSON.stringify((e.ix.topics || []).filter((t) => t.group === "xlist")) === JSON.stringify(rs)) continue;
  changed++;
  console.log(`${sid}: xlist rows [${before.join(", ") || "none"}] -> [${rs.map((r) => `${r.id}=${r.count}+${r.ov}`).join(", ")}]`);
  if (check) continue;
  e.ix.topics = next; writeJson(e.p, e.ix);
  // The version manifest pins each index's sha: refresh it (item and byte counts are untouched, so bank stamps
  // and the offline cache stay valid).
  const mp = path.join(ROOT, "prep", "bank", bvOf(sid), "manifest.json");
  if (fs.existsSync(mp)) {
    const m = readJson(mp);
    const me = (m.subjects || []).find((s) => s && s.id === sid);
    if (me && me.index) { me.index = shaFile(e.p); writeJson(mp, m); }
  }
}
console.log(`${changed} subject index${changed === 1 ? "" : "es"} ${check ? "would change" : "updated"} (bank VER ${VER})`);
process.exitCode = check && changed ? 1 : 0;
