/* MaiK "Faster iPhone engine" (MLX) settings row - real headless-browser test.
 *
 * Loads the REAL maik-models.js and maik-engine.js into Chromium with a stubbed iOS Capacitor bridge
 * (no network, no /api), renders the real Settings markup with the real wiring, and drives it by
 * clicking. Proves what the unit tests cannot: the row's markup, its buttons and the live patcher
 * work together in a browser.
 *
 *   1. Flag off (default): no MLX row.              2. Android with the flag on: no MLX row.
 *   3. iPhone + flag on + MAiK Prime: row with a Download button and the exact size.
 *   4. Download: every MLX file goes through the native downloader, weights last, and the row flips
 *      to Pause at once, then to Ready when the last file verifies.
 *   5. Remove: every MLX file is deleted, the GGUF is untouched, and the row offers Download again.
 *   6. A pack without an MLX build: a plain "not available" line, no button.
 *
 * USAGE: node test/run-maik-mlx-ui.mjs      (CHROME=/path/to/chrome to override the binary)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTTP = 8996, CDP = 9396;
const BASE = `http://127.0.0.1:${HTTP}/`;
const CHROME = process.env.CHROME || ["/opt/pw-browsers/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => existsSync(p));

const serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), String(HTTP)], { stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { await fetch(BASE + "maik-models.js"); break; } catch { await sleep(100); } }

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "mlx-ui-"))}`, "--no-first-run", "--disable-gpu",
  "--no-sandbox", "about:blank"], { stdio: "ignore" });

let ws, msgId = 1; const pending = new Map();
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    const page = list.find((t) => t.type === "page");
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    }
  } catch { ws = null; }
  if (!ws) await sleep(150);
}
const pageErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const call = (method, params = {}) => new Promise((r) => { const id = msgId++; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await call("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __err: JSON.stringify(r.result.exceptionDetails).slice(0, 400) };
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

/** A fresh document on the served origin with the stub bridge, then the real scripts. */
async function boot({ platform, flag, pack }) {
  await call("Page.navigate", { url: BASE + "googlefee613d97f77b414.html?" + Math.random() });
  await sleep(300);
  return ev(`
    document.documentElement.innerHTML = '<head></head><body><div id="host"></div></body>';
    localStorage.clear();
    if (${JSON.stringify(flag)} !== null) localStorage.setItem("smd_maik_mlx", ${JSON.stringify(flag)});
    localStorage.setItem("stewardmd.maikPack", ${JSON.stringify(pack)});
    // The GGUF for the pack is already installed: the MLX row is an add-on to it.
    const log = window.__log = [];
    const size = (n) => { const M = window.SMD_MAIK_MODELS; for (const id of M.packIds()) for (const f of M.mlxFiles(id).concat(M.PACKS[id].files)) if (f.name === n) return f; return null; };
    const started = new Set();
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => ${JSON.stringify(platform)}, Plugins: {
      Filesystem: {},
      Llama: {
        available: async () => ({ available: true, availableMemory: 0 }),
        modelPath: async ({ name }) => ({ path: "/docs/maik-models/" + name, bytes: started.has(name) ? size(name).bytes : 0, partial: false, freeBytes: 60e9 }),
        downloadStart: async ({ name }) => { log.push("start " + name); started.add(name); return { id: "d-" + name }; },
        downloadStatus: async ({ name }) => { await new Promise((r) => setTimeout(r, 60));
          return started.has(name) ? { state: "done", bytes: size(name).bytes, onDisk: size(name).bytes, total: size(name).bytes, live: false } : { state: "none" }; },
        downloadCancel: async ({ name }) => { log.push("cancel " + name); },
        modelVerify: async ({ name }) => ({ sha256: size(name).sha256, bytes: size(name).bytes }),
        modelDelete: async ({ name }) => { log.push("delete " + name); started.delete(name); return { ok: true }; },
        excludeFromBackup: async () => ({ ok: true })
      } } };
    window.toast = (m) => log.push("toast " + m);
    for (const src of ["/maik-models.js", "/maik-local.js", "/maik-engine.js"]) {
      await new Promise((res, rej) => { const s = document.createElement("script"); s.charset = "utf-8"; s.src = src + "?t=" + Date.now(); s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    }
    const M = window.SMD_MAIK_MODELS;
    const gguf = M.PACKS[${JSON.stringify(pack)}].files[0];
    localStorage.setItem("smd_maik_pack_" + ${JSON.stringify(pack)}, "1");
    localStorage.setItem("smd_maik_packsha_" + ${JSON.stringify(pack)}, gguf.sha256);
    window.__render = () => { const h = document.getElementById("host"); h.innerHTML = window.SMD_MAIK_ENGINE.settingsHTML(); window.SMD_MAIK_ENGINE.wireSettings(h); };
    window.__render();
    const adv = document.querySelector('[data-mk-grp="advanced"]'); if (adv) adv.open = true;
    return true;
  `);
}
const rowText = () => ev(`const b = [...document.querySelectorAll('[data-mk-grp="advanced"] div')].find(d => /Faster iPhone engine/.test(d.textContent) && d.querySelector('div')); return b ? b.textContent : "";`);
const btn = (sel) => ev(`const b = document.querySelector(${JSON.stringify(sel)}); return b ? b.textContent : null;`);

try {
  await call("Page.enable"); await call("Runtime.enable");

  // 1. Flag off (default).
  const b1 = await boot({ platform: "ios", flag: null, pack: "bonsai-ternary-8b" }); ok(b1 === true, "booted real scripts (flag off): " + JSON.stringify(b1));
  ok(!/Faster iPhone engine/.test(await ev(`return document.body.textContent`)), "flag off: no MLX row");

  // 2. Android, flag on.
  await boot({ platform: "android", flag: "1", pack: "bonsai-ternary-8b" });
  ok(!/Faster iPhone engine/.test(await ev(`return document.body.textContent`)), "Android: no MLX row even with the flag");

  // 3. iPhone, flag on, MAiK Prime.
  await boot({ platform: "ios", flag: "1", pack: "bonsai-ternary-8b" });
  const t3 = await rowText();
  ok(/Faster iPhone engine \(Labs\)/.test(t3), "iPhone + flag: row rendered");
  ok(/2\.32 GB/.test(await btn('[data-me-mlx="get"]') || ""), "Download button shows the exact MLX size (2.32 GB): " + await btn('[data-me-mlx="get"]'));
  ok(!/\u2014/.test(t3), "no em-dash in the row text");

  // 4. Download.
  await ev(`document.querySelector('[data-me-mlx="get"]').click(); return true;`);
  await sleep(30);
  ok(await btn('[data-me-mlx="pause"]') === "Pause", "row flips to Pause at once");
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) { await sleep(100); ready = /Ready\. Answers on this phone use the faster engine/.test(await rowText()); }
  ok(ready, "row reads Ready once every file verified");
  const log = await ev(`return window.__log`);
  const starts = log.filter((l) => l.startsWith("start "));
  ok(starts.length === 6, "all 6 MLX files downloaded natively: " + starts.length);
  ok(starts[starts.length - 1] === "start tb8-mlx--model.safetensors", "weights last");
  ok(await ev(`return window.SMD_MAIK_MODELS.mlxReady("bonsai-ternary-8b")`) === true, "mlxReady true");
  ok(log.includes("toast Faster iPhone engine ready."), "ready toast");

  // 5. Remove.
  await ev(`window.__render(); document.querySelector('[data-mk-grp="advanced"]').open = true; document.querySelector('[data-me-mlx="remove"]').click(); return true;`);
  await sleep(400);
  const log2 = await ev(`return window.__log`);
  const dels = log2.filter((l) => l.startsWith("delete "));
  ok(dels.length === 6 && dels.every((d) => d.includes("tb8-mlx--")), "Remove deletes the 6 MLX files only: " + dels.length);
  ok(!dels.some((d) => /\.gguf$/.test(d)), "the GGUF is untouched");
  ok(/Download/.test(await btn('[data-me-mlx="get"]') || ""), "row offers Download again");
  ok(await ev(`return window.SMD_MAIK_MODELS.mlxReady("bonsai-ternary-8b")`) === false, "mlxReady false after Remove");

  // 6. A pack without an MLX build.
  await boot({ platform: "ios", flag: "1", pack: "maik-lite" });
  const t6 = await rowText();
  ok(/Not available for the selected model/.test(t6), "pack without MLX: plain note");
  ok(await btn('[data-me-mlx="get"]') === null, "pack without MLX: no Download button");
} catch (e) {
  ok(false, "harness error: " + (e && e.stack || e));
} finally {
  try { chrome.kill("SIGKILL"); } catch {}
  try { serveProc.kill("SIGKILL"); } catch {}
}
if (pageErrors.length) { console.log("page errors:"); pageErrors.forEach((x) => console.log("  " + x)); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
