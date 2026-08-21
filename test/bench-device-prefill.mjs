/* bench-device-prefill.mjs — sweep prefill settings on a REAL phone over ADB + CDP.
 *
 * Prefill dominated the measured latency: ~75 s to first token for a ~2000-token grounded prompt on
 * a Pixel 9. This sweeps the two knobs that actually change it (n_ubatch, n_threads_batch) plus the
 * prompt size, and reports prefill ms per config so the defaults are chosen by measurement.
 *
 * Needs a device with the model installed and the debug bridge forwarded:
 *   adb -s <serial> forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 *   node test/bench-device-prefill.mjs
 */
const PORT = process.env.CDP_PORT || 9333;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
if (!page) { console.log("no debuggable page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 1; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const call = (method, params) => { const i = id++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }); };

async function ev(expr, timeoutMs = 240000) {
  const p = call("Runtime.evaluate", {
    expression: `(async function(){try{${expr}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true, awaitPromise: true
  });
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ __to: 1 }), timeoutMs))]);
  if (r.__to) return { __timeout: true };
  if (!r.result || !r.result.result) return { __bad: JSON.stringify(r).slice(0, 200) };
  try { return JSON.parse(r.result.result.value); } catch { return { __raw: r.result.result.value }; }
}

// nUbatch, nThreadsBatch. n_batch is pinned to n_ctx-ish so the slicing loop is not the variable.
// Kept deliberately small: each row costs a 2.5 GB model reload plus a full prefill, so a wide
// sweep does not finish. These four answer the two questions that matter - does a bigger ubatch
// help, and do the little cores help a BATCH - plus what shrinking the prompt buys.
const CONFIGS = (process.env.BENCH_CONFIGS ? JSON.parse(process.env.BENCH_CONFIGS) : [
  { nUbatch: 512, nThreadsBatch: 4 },     // baseline: what shipped
  { nUbatch: 2048, nThreadsBatch: 8 }     // bigger batch + all cores
]);
const SIZES = (process.env.BENCH_SIZES ? JSON.parse(process.env.BENCH_SIZES) : [8000, 3000]);

console.log("cfg(ubatch/threadsBatch)  chars  promptTok  prefillMs  totalMs  tok/s");
const rows = [];
for (const c of CONFIGS) {
  for (const chars of SIZES) {
    const out = await ev(`
      var L = Capacitor.Plugins.Llama;
      await L.release();
      var path = await SMD_MAIK_MODELS.pathFor("maik-local-v1");
      await L.load({ path: path, nCtx: 4096, nThreads: 4, nBatch: 2048, nUbatch: ${c.nUbatch}, nThreadsBatch: ${c.nThreadsBatch} });
      // Synthetic grounding of a controlled size, shaped like the real package text.
      var chunk = "[management] Empiric therapy is guided by likely organisms and local resistance; adjust on culture. ";
      var g = ""; while (g.length < ${chars}) g += chunk;
      g = g.slice(0, ${chars});
      var prompt = "=== RETRIEVED STEWARDMD KNOWLEDGE (primary source) ===\\n" + g +
                   "\\n\\n=== QUESTION ===\\nEmpiric antibiotic for pyogenic liver abscess in an adult?";
      var t0 = Date.now();
      var r = await L.generate({ prompt: prompt, system: SMD_MAIK_LOCAL.SYSTEM, nPredict: 24, temperature: 0, stream: false });
      return JSON.stringify({ totalMs: Date.now() - t0, prefillMs: r.prefillMs, promptTokens: r.promptTokens, chars: ${chars} });
    `);
    if (out.__timeout || out.__err || out.__bad) {
      console.log(`  ${c.nUbatch}/${c.nThreadsBatch}\t${chars}\tFAILED ${JSON.stringify(out).slice(0, 90)}`);
      continue;
    }
    const decodeMs = out.totalMs - out.prefillMs;
    const tps = decodeMs > 0 ? (24 / (decodeMs / 1000)).toFixed(2) : "-";
    console.log(`  ${c.nUbatch}/${c.nThreadsBatch}\t\t${chars}\t${out.promptTokens}\t${out.prefillMs}\t${out.totalMs}\t${tps}`);
    rows.push({ ...c, ...out, tps: +tps });
  }
}

const best = rows.filter((r) => r.chars === 8000).sort((a, b) => a.prefillMs - b.prefillMs)[0];
if (best) console.log(`\nbest at 8000 chars: ubatch=${best.nUbatch} threadsBatch=${best.nThreadsBatch} -> prefill ${best.prefillMs}ms (${best.promptTokens} tok)`);
const byChars = {};
rows.forEach((r) => { if (!byChars[r.chars] || r.prefillMs < byChars[r.chars].prefillMs) byChars[r.chars] = r; });
Object.keys(byChars).sort((a, b) => b - a).forEach((k) => {
  const r = byChars[k];
  console.log(`  ${k} chars -> ${r.promptTokens} tok, best prefill ${r.prefillMs}ms (ubatch ${r.nUbatch}/tb ${r.nThreadsBatch})`);
});
ws.close();
process.exit(0);
