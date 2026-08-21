/* drive-device-llama.mjs — drive the on-device MaiK engine on a REAL phone over ADB + CDP.
 *
 * Not part of `npm test` (it needs a connected device). Usage:
 *   adb -s <serial> forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 *   node test/drive-device-llama.mjs <step>
 *
 * Steps: probe | download | infer | mem
 */
const PORT = process.env.CDP_PORT || 9333;
const STEP = process.argv[2] || "probe";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
if (!page) { console.log("no debuggable page"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 1; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const call = (method, params) => { const i = id++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }); };

async function ev(expr, awaitPromise = true, timeoutMs = 0) {
  const p = call("Runtime.evaluate", {
    expression: `(async function(){try{${expr}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true, awaitPromise
  });
  const r = timeoutMs
    ? await Promise.race([p, new Promise((res) => setTimeout(() => res({ __timeout: true }), timeoutMs))])
    : await p;
  if (r.__timeout) return "__TIMEOUT__";
  if (r.result && r.result.exceptionDetails) return "__EXC__ " + JSON.stringify(r.result.exceptionDetails).slice(0, 300);
  return r.result && r.result.result ? r.result.result.value : null;
}

const P = (o) => console.log(typeof o === "string" ? o : JSON.stringify(o, null, 2));

if (STEP === "probe") {
  P(await ev(`
    var C = window.Capacitor || {};
    var L = C.Plugins && C.Plugins.Llama;
    var out = {
      native: !!(C.isNativePlatform && C.isNativePlatform()),
      plugins: Object.keys((C.Plugins)||{}).sort(),
      hasLlama: !!L,
      engineModule: !!window.SMD_MAIK_ENGINE,
      modelsModule: !!window.SMD_MAIK_MODELS,
      localModule: !!window.SMD_MAIK_LOCAL,
      localAvailable: window.SMD_MAIK_LOCAL ? window.SMD_MAIK_LOCAL.available() : null,
      pref: window.SMD_MAIK_ENGINE ? SMD_MAIK_ENGINE.getPref() : null,
      packs: window.SMD_MAIK_MODELS ? Object.keys(SMD_MAIK_MODELS.PACKS) : null
    };
    if (L) { out.available = await L.available(); }
    return JSON.stringify(out);
  `));
}

if (STEP === "download") {
  // Fire and forget: the 2.49 GB pull is far longer than any CDP call should block on. Progress is
  // parked on window.__dl so `mem`/`probe` can poll it.
  P(await ev(`
    window.__dl = { started: Date.now(), frac: 0, note: "starting", done: false, err: null };
    localStorage.setItem("smd_maik_local_bypass", "1");
    SMD_MAIK_MODELS.ensure("maik-local-v1", function (f, n) {
      window.__dl.frac = f; if (n) window.__dl.note = n;
    }).then(function () { window.__dl.done = true; window.__dl.note = "ready"; })
      .catch(function (e) { window.__dl.err = String(e && e.message || e); });
    return JSON.stringify({ kicked: true });
  `, false));
}

if (STEP === "poll") {
  // Reads the MODULE's own progress state (SMD_MAIK_MODELS.state) - the same source the Settings
  // UI subscribes to, so this poll sees exactly what the phone shows.
  P(await ev(`
    var id = SMD_MAIK_MODELS.activePack();
    var st = SMD_MAIK_MODELS.state(id);
    return JSON.stringify({
      pack: id,
      pct: (st.frac * 100).toFixed(1),
      gotGB: ((st.bytes || 0)/1e9).toFixed(2),
      totalGB: ((st.total || SMD_MAIK_MODELS.totalBytes(id))/1e9).toFixed(2),
      mbps: st.mbps ? st.mbps.toFixed(2) : "0",
      etaMin: st.etaS != null ? Math.round(st.etaS/60) : null,
      downloading: st.downloading, note: st.note, done: st.done, err: st.err
    });
  `));
}

if (STEP === "infer") {
  const q = process.argv[3] || "First-line empiric antibiotic for severe community-acquired pneumonia in an adult, and the duration?";
  P(await ev(`
    var t0 = Date.now();
    var toks = 0;
    var L = Capacitor.Plugins.Llama;
    var sub = await L.addListener("llamaToken", function(){ toks++; });
    var loadT0 = Date.now();
    var path = await SMD_MAIK_MODELS.pathFor("maik-local-v1");
    var lr = await L.load({ path: path, nCtx: 4096 });
    var loadMs = Date.now() - loadT0;
    var genT0 = Date.now();
    var r = await L.generate({
      prompt: ${JSON.stringify(q)},
      system: SMD_MAIK_LOCAL.SYSTEM,
      nPredict: 320, temperature: 0, stream: true
    });
    var genMs = Date.now() - genT0;
    try { sub.remove(); } catch(e){}
    return JSON.stringify({
      loadMs: loadMs, loadInfo: lr, genMs: genMs, tokens: toks,
      tokPerSec: (toks / (genMs/1000)).toFixed(2),
      answer: r.text
    });
  `, true, 600000));
}

if (STEP === "mem") {
  P(await ev(`
    var L = Capacitor.Plugins.Llama;
    var a = await L.available();
    return JSON.stringify({ available: a, jsHeapMB: (performance.memory ? (performance.memory.usedJSHeapSize/1048576).toFixed(1) : null) });
  `));
}

ws.close();
