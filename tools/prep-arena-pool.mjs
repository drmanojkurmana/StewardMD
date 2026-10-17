#!/usr/bin/env node
/* PrepNucleus Arena question pool: questions drawn from the overlays too, so every exam can fill a 7-question battle.
 *
 * The Arena Worker draws battle questions from the bank's module files. Subjects whose questions live only in overlays
 * (most NEET-SS subjects) have none there, so a pairing found "no questions" and both players were told nobody was
 * there (owner 2026-10-17: two phones, same stream, the 1v1 never started). The Worker now falls back to
 * prep-bank/arena/pool-<exam>.json, built here from the live overlay files.
 *
 *   node tools/prep-arena-pool.mjs --out /tmp/pool          build the four pools into a folder (no upload)
 *   node tools/prep-arena-pool.mjs --out /tmp/pool --apply  also upload them to R2 (needs ~/.stewardmd-secrets/r2-s3.env)
 *
 * Reads the overlay files through the live bank with the tools credential. Only usable text questions go in: four
 * options, a valid key, no image, a sensible length. At most PER_SUBJECT per subject, spread over several modules. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMS, SUBJECTS } from "../functions/_prep-arena.js";
import { mulberry32, seedFrom } from "../functions/_prep-core.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg("--out", ""), APPLY = argv.includes("--apply");
const PER_SUBJECT = 70, FILES_PER_SUBJECT = 16, PER_FILE = 6;
const tokenFile = path.join(os.homedir(), ".config/stewardmd/tool-token");
const TOKEN = process.env.SMD_TOOL_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, "utf8").trim() : "");
const BASE = (process.env.BASE || "https://stewardmd.in") + "/api/prep/bank/";

export const usable = (it) => !!it && typeof it.q === "string" && it.q.length >= 30 && it.q.length <= 700 && Array.isArray(it.o) && it.o.length === 4 && it.o.every((x) => typeof x === "string" && x.length > 0 && x.length <= 200) &&
  Number.isInteger(it.a) && it.a >= 0 && it.a < 4 && !it.img && !it.im && !it.image && !/\b(image|figure|photograph|shown|ECG|X-ray|CT scan|MRI)\b/i.test(it.q) && !(it.vh === true);

async function get(key) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(BASE + key, { headers: { "X-SMD-Tool": TOKEN, Origin: "https://stewardmd.in" } }); if (r.status === 404) return null; if (r.ok) return await r.json(); } catch (e) {}
    await new Promise((s) => setTimeout(s, 400 * (i + 1)));
  }
  return null;
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); })); }

if (!(import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith("prep-arena-pool.mjs"))) { /* imported for tests */ }
else {
  if (!TOKEN) { console.error("no tools credential"); process.exit(2); }
  const counts = JSON.parse(fs.readFileSync(path.join(ROOT, "prep/bank/overlay-counts.json"), "utf8")).sets;
  const files = {};   // subject -> [{ set, mid }]
  for (const [set, subs] of Object.entries(counts)) for (const [sid, mods] of Object.entries(subs)) for (const mid of Object.keys(mods)) (files[sid] = files[sid] || []).push({ set, mid });
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const cache = new Map();   // sid -> items, shared by exams that list the same subject
  for (const exam of EXAMS) {
    const rnd = mulberry32(seedFrom("arena-pool:" + exam));
    const items = [];
    for (const sid of SUBJECTS[exam]) {
      if (!cache.has(sid)) {
        const pick = (files[sid] || []).slice().sort(() => rnd() - 0.5).slice(0, FILES_PER_SUBJECT), got = [];
        await pool(pick, 8, async (f) => {
          const d = await get(`overlay/${f.set}/${sid}/${f.mid}.json`);
          const ok = ((d && d.items) || []).filter(usable).slice(0, PER_FILE);
          for (const it of ok) got.push({ id: it.id, q: it.q, o: it.o, a: it.a, s: sid, m: f.mid });
        });
        cache.set(sid, got.slice(0, PER_SUBJECT));
      }
      items.push(...cache.get(sid));
    }
    const doc = { v: 1, exam, built: new Date().toISOString(), items };
    console.log(`${exam}: ${items.length} questions from ${new Set(items.map((x) => x.s)).size} subjects`);
    if (OUT) fs.writeFileSync(path.join(OUT, `pool-${exam}.json`), JSON.stringify(doc));
    if (APPLY) { const { putR2Object } = await import("./prep-r2-s3.mjs"); await putR2Object(`prep-bank/arena/pool-${exam}.json`, Buffer.from(JSON.stringify(doc)), "application/json", "public, max-age=3600"); console.log("  uploaded"); }
  }
}
