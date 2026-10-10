#!/usr/bin/env node
// Rebuilds subject search indexes for PrepNucleus (medicine, pathology, pharmacology, or any subject),
// combining bank topic files with any overlay items (medcov4, maik1, ...).
// Uploads search-<hash>.json to R2, updates the subject index.json and manifest.json.
// USAGE: node tools/prep-rebuild-search.mjs [--subjects medicine,pathology,pharmacology] [--upload]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildSearch } from "./tokos-build-mcq-search.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://stewardmd.in/api/prep/bank/";
const BUCKET = "stewardmd-offline";
const PUB_MAIK = path.join(process.env.HOME || "", "prep-data/qgen/publish");

async function fetchJSON(url) {
  for (let t = 1; ; t++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (t >= 4) throw e;
      await new Promise((res) => setTimeout(res, 1000 * t));
    }
  }
}

async function pool(list, n, fn) {
  let i = 0; const out = new Array(list.length);
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); }
  }));
  return out;
}

function runWrangler(args) {
  return new Promise((res, rej) => {
    const p = spawn("npx", args, { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(err.slice(-400)))));
  });
}

async function rebuildSubject(sid, doUpload = false) {
  const ixPath = path.join(ROOT, "prep/bank/v5", sid, "index.json");
  if (!fs.existsSync(ixPath)) throw new Error("No index.json for " + sid);
  const ix = JSON.parse(fs.readFileSync(ixPath, "utf8"));
  console.log(`Rebuilding search for ${sid} (${ix.topics.length} topics)...`);

  // Download bank topics and combine with overlays
  const topics = await pool(ix.topics, 10, async (t) => {
    const bankUrl = `${API}v5/${sid}/mcq/${t.id}.json`;
    const bankData = await fetchJSON(bankUrl);
    let items = (bankData && bankData.items) || [];

    // Overlay sets: medcov4 (if medicine), maik1 (if published)
    if (sid === "medicine") {
      const medcovUrl = `${API}overlay/medcov4/medicine/${t.id}.json`;
      const mc = await fetchJSON(medcovUrl);
      if (mc && mc.items) items = items.concat(mc.items);
    }

    // Check local or live maik1
    const maikLocal = path.join(PUB_MAIK, "maik1", sid, `${t.id}.json`);
    if (fs.existsSync(maikLocal)) {
      try {
        const mj = JSON.parse(fs.readFileSync(maikLocal, "utf8"));
        if (mj && mj.items) items = items.concat(mj.items);
      } catch (_) {}
    } else {
      const maikUrl = `${API}overlay/maik1/${sid}/${t.id}.json`;
      const mj = await fetchJSON(maikUrl);
      if (mj && mj.items) items = items.concat(mj.items);
    }

    return { id: t.id, items };
  });

  const validTopics = topics.filter((t) => t.items.length > 0);
  const searchObj = buildSearch(validTopics);
  const searchBody = JSON.stringify(searchObj);
  const hash = crypto.createHash("sha256").update(searchBody).digest("hex").slice(0, 8);
  const searchName = `search-${hash}.json`;

  console.log(`  ${sid}: items in index=${searchObj.n}, file=${searchName}, bytes=${searchBody.length}`);

  const stageDir = path.join(PUB_MAIK, "search", "v5", sid);
  fs.mkdirSync(stageDir, { recursive: true });
  const stageFile = path.join(stageDir, searchName);
  fs.writeFileSync(stageFile, searchBody);

  if (doUpload) {
    const key = `prep-bank/v5/${sid}/${searchName}`;
    console.log(`  Uploading ${key} to R2...`);
    for (let t = 1; ; t++) {
      try {
        await runWrangler([
          "wrangler", "r2", "object", "put", `${BUCKET}/${key}`,
          "--file", stageFile,
          "--content-type", "application/json",
          "--cache-control", "public, max-age=31536000, immutable",
          "--remote"
        ]);
        break;
      } catch (e) {
        if (t >= 4) throw e;
        await new Promise((r) => setTimeout(r, 2000 * t));
      }
    }
  }

  // Update subject index.json
  ix.search = searchName;
  fs.writeFileSync(ixPath, JSON.stringify(ix));
  const newIndexHash = crypto.createHash("sha256").update(fs.readFileSync(ixPath)).digest("hex");

  return { sid, searchName, newIndexHash };
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const subArg = arg("--subjects", "medicine,pathology,pharmacology");
  const subjects = subArg.split(",").map((s) => s.trim()).filter(Boolean);
  const doUpload = process.argv.includes("--upload");

  const results = [];
  for (const s of subjects) {
    results.push(await rebuildSubject(s, doUpload));
  }

  // Update manifest.json
  const manPath = path.join(ROOT, "prep/bank/v5/manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manPath, "utf8"));
  for (const r of results) {
    const entry = manifest.subjects.find((sub) => sub.id === r.sid);
    if (entry) {
      entry.index = r.newIndexHash;
    }
  }
  fs.writeFileSync(manPath, JSON.stringify(manifest));
  console.log("Updated prep/bank/v5/manifest.json");

  if (doUpload) {
    console.log("Uploading updated manifest.json to R2...");
    await runWrangler([
      "wrangler", "r2", "object", "put", `${BUCKET}/prep-bank/v5/manifest.json`,
      "--file", manPath,
      "--content-type", "application/json",
      "--cache-control", "public, max-age=300",
      "--remote"
    ]);
    console.log("Manifest uploaded.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
