/* The paid half of tools/prep-links.mjs confirm: one Message Batch on claude-haiku-5-5 (50% price), resumable (the
 * batch id is kept next to the output), every call logged in the spend ledger. Raw HTTP through the repo's Anthropic
 * client (functions/_prep-qgen.js: x-api-key, anthropic-version 2023-06-01, anthropic-workspace-id). The key is read
 * from ~/.config/stewardmd/anthropic.env into memory only; it is never printed or written. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as E from "../functions/_prep-qgen.js";

export const MODEL = "claude-haiku-5-5";
export function loadEnv(file = path.join(os.homedir(), ".config/stewardmd/anthropic.env")) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && (m[1] === "ANTHROPIC_API_KEY" || m[1] === "ANTHROPIC_WORKSPACE_ID")) env[m[1]] = m[2];
  }
  if (!env.ANTHROPIC_API_KEY) throw new Error("no key in the env file");
  return env;
}
async function retry(fn, n = 5) {
  for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= n - 1 || !e.retry) throw e; await new Promise((r) => setTimeout(r, 3000 * (i + 1))); } }
}
/* runConfirm({ reqs, outFile, ledger, tag }) -> { verdicts: { itemId: { "kb:id": bool } }, usd }. reqs carry pairs. */
export async function runConfirm({ reqs, outFile, ledger, tag = "links-confirm" }) {
  const env = loadEnv();
  const st = outFile.replace(/\.json$/, "") + ".batch.json";
  let id;
  if (fs.existsSync(st)) id = JSON.parse(fs.readFileSync(st, "utf8")).id;
  else {
    const b = await retry(() => E.batchCreate(env, reqs.map((r) => ({ custom_id: r.custom_id, params: r.params }))));
    id = b.id; fs.writeFileSync(st, JSON.stringify({ id, n: reqs.length, at: new Date().toISOString() }));
    console.log(`batch ${id}: ${reqs.length} requests submitted`);
  }
  let b;
  for (;;) {
    b = await retry(() => E.batchGet(env, id));
    if (b.processing_status === "ended") break;
    process.stderr.write(`[${tag}] ${id} ${JSON.stringify(b.request_counts)}\n`);
    await new Promise((r) => setTimeout(r, 30000));
  }
  const res = await retry(() => E.batchResults(env, b));
  const byId = new Map(reqs.map((r) => [r.custom_id, r]));
  const verdicts = {}, u = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let bad = 0;
  for (const r of res) {
    const q = byId.get(r.custom_id);
    if (!q || !r.ok) { bad++; continue; }
    for (const k of Object.keys(u)) u[k] += (r.message.usage && r.message.usage[k]) || 0;
    const m = E.readMessage(r.message, MODEL);
    const list = (m.json && Array.isArray(m.json.a)) ? m.json.a : null;
    if (!list || m.stop === "refusal") { bad++; continue; }
    for (const a of list) {
      const p = q.pairs[a.n - 1];
      if (!p) continue;
      (verdicts[p.id] || (verdicts[p.id] = {}))[p.key] = !!a.ok;
    }
  }
  const usd = E.usd(MODEL, u, true);
  const row = [new Date().toISOString().slice(0, 10), tag, MODEL, u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, u.output_tokens, usd.toFixed(4),
    `batch ${id}; ${reqs.length} requests; ${Object.keys(verdicts).length} items judged; errors ${bad}; tools/prep-links.mjs (knowledge links)`].join("\t");
  fs.appendFileSync(ledger, row + "\n");
  fs.writeFileSync(outFile, JSON.stringify(verdicts));
  console.log(JSON.stringify({ batch: id, requests: reqs.length, errors: bad, usage: u, usd: Number(usd.toFixed(4)) }));
  return { verdicts, usd };
}
