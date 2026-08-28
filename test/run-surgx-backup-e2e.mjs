/* SURGX encrypted backup — END TO END, the scenario the feature exists for.
 *
 * Everything else about this feature is tested against a stubbed `fetch`. This one is the real
 * thing as far as it can be taken without a phone:
 *   - the REAL app code in a REAL browser, using the browser's own WebCrypto
 *   - a REAL HTTP round trip to a Drive-shaped server that keeps the bytes it is given
 *   - a REAL wipe: localStorage cleared and the page reloaded, which is what a reinstall does to
 *     the app's storage — including the per-device secret the notes were encrypted with
 *   - then restore, and the note must be readable again
 *
 * The one thing faked is `SMD_getDriveToken`, which is native-only auth, and the googleapis.com
 * host, which is rewritten to the local server. The request itself — method, headers, multipart
 * body, query — is the one the app really builds.
 *
 * The leakage check runs SERVER-SIDE, on the bytes that actually crossed the wire.
 *
 * USAGE: node test/run-surgx-backup-e2e.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:8991/";
const DRIVE_PORT = 8891;
const PORT = 9407, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/surgx-e2e-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const PW = "steady-hands-2026";
const SECRETS = ["Laparoscopic cholecystectomy", "Ramesh Kumar", "UHID-77421", "Calot", "Dr Manoj"];

/* ── a Drive-shaped server that keeps what it is given ─────────────────────── */
const drive = { file: null, puts: 0, patches: 0, gets: 0 };
const driveSrv = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  if (!/^Bearer /.test(req.headers.authorization || "")) { res.writeHead(401, cors); res.end("{}"); return; }

  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const j = (o, code) => { res.writeHead(code || 200, Object.assign({ "content-type": "application/json" }, cors)); res.end(JSON.stringify(o)); };
    // find-or-create the folder, and look up the backup file
    if (url.pathname === "/drive/v3/files" && req.method === "GET") {
      const q = url.searchParams.get("q") || "";
      // Match on the folder MIME type, not the substring "folder": the backup lookup also contains
      // it, via "'folder-1' in parents", and answering that as the folder made the app PATCH a file
      // that did not exist yet.
      if (q.includes("vnd.google-apps.folder")) return j({ files: [{ id: "folder-1" }] });
      return j({ files: drive.file ? [{ id: "bk-1", modifiedTime: "2026-08-26T00:00:00Z" }] : [] });
    }
    if (url.pathname === "/drive/v3/files" && req.method === "POST") return j({ id: "folder-1" });
    if (url.pathname === "/upload/drive/v3/files" && req.method === "POST") {
      drive.file = body; drive.puts++; return j({ id: "bk-1" });
    }
    if (url.pathname.startsWith("/upload/drive/v3/files/") && req.method === "PATCH") {
      drive.file = body; drive.patches++; return j({ id: "bk-1" });
    }
    if (url.pathname.startsWith("/drive/v3/files/") && url.searchParams.get("alt") === "media") {
      drive.gets++;
      if (!drive.file) { res.writeHead(404, cors); res.end("{}"); return; }
      // hand back just the envelope out of the multipart body the app uploaded
      const i = drive.file.lastIndexOf('{"format"');
      res.writeHead(200, Object.assign({ "content-type": "application/octet-stream" }, cors));
      res.end(drive.file.slice(i, drive.file.lastIndexOf("}") + 1));
      return;
    }
    res.writeHead(404, cors); res.end("{}");
  });
});
await new Promise((r) => driveSrv.listen(DRIVE_PORT, r));

let serveProc = null;
try { await fetch(BASE); } catch {
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), "8991"], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true, awaitPromise: false }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

/* Re-applied after every load: native Drive auth, and googleapis.com -> the local server. */
const INSTALL = `
  window.SMD_getDriveToken = function () { return "test-token"; };
  window.SMD_VERIFY = { isVerified: function(){ return Promise.resolve(true); }, openPanel: function(){} };
  if (!window.__origFetch) {
    window.__origFetch = window.fetch;
    window.fetch = function (u, i) {
      var s = String(u && u.url ? u.url : u);
      if (s.indexOf("https://www.googleapis.com/") === 0) {
        s = "http://localhost:${DRIVE_PORT}/" + s.slice("https://www.googleapis.com/".length);
        return window.__origFetch(s, i);
      }
      return window.__origFetch(u, i);
    };
  }
  return 1;`;

async function boot(label) {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE + "?surgx=1" });
  for (let i = 0; i < 120; i++) {
    await sleep(400);
    if (await ev(`return !!(window.SURGX && window.SMD_SURGX_BACKUP && window.SMD_SURGX_STORE && window.SMD_CLINIC_CRYPTO)`) === true) {
      await ev(INSTALL);
      await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
      return true;
    }
  }
  ok(false, label + ": the app never finished loading");
  return false;
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

  // ── 1. a real note, written through the real encrypted store ──
  ok(await boot("first run"), "the app loads with SURGX, the store and WebCrypto");
  await ev(`try { localStorage.clear(); } catch (e) {} return 1;`);          // start from a clean device
  await ev(`if (SMD_SURGX_STORE._reset) SMD_SURGX_STORE._reset(); return 1;`);
  ok(await ev(`return SMD_SURGX_STORE.cryptoAvailable();`) === true, "the browser provides real WebCrypto (not a stub)");

  await ev(`
    window.__w = 0;
    SMD_SURGX_STORE.saveNote({
      type: "operative", label: ${JSON.stringify(SECRETS[0] + " — " + SECRETS[1])},
      values: { surgeon: ${JSON.stringify(SECRETS[4])}, patientRef: ${JSON.stringify(SECRETS[2])},
                findings: ${JSON.stringify("dense adhesions at " + SECRETS[3] + " triangle")} },
      provenance: {}
    }).then(function (r) { window.__w = r && r.ok ? r.id : -1; });
    return 1;`);
  for (let i = 0; i < 30; i++) { await sleep(250); if (await ev(`return window.__w;`) !== 0) break; }
  const noteId = await ev(`return window.__w;`);
  ok(typeof noteId === "string" && noteId.length > 0, "a note is written to the encrypted device store");
  ok(await ev(`return SMD_SURGX_STORE.listNotes().length;`) === 1, "and the device lists exactly one note");

  // The row on disk must already be ciphertext, before any backup happens.
  const onDisk = await ev(`
    var hit = "";
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf("smd_surgx_note_") === 0) hit = localStorage.getItem(k); }
    return hit;`);
  ok(onDisk.length > 0 && SECRETS.every((s) => onDisk.indexOf(s) === -1),
    "the note is already encrypted AT REST on the device (no plaintext in localStorage)");

  // ── 2. back it up, for real, over HTTP ──
  await ev(`window.__bk = 0; SMD_SURGX_BACKUP.backupNow({ confirmed: true, password: ${JSON.stringify(PW)} }).then(function (r) { window.__bk = r; }); return 1;`);
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`return window.__bk ? 1 : 0;`) === 1) break; }
  const bk = await ev(`return JSON.stringify(window.__bk);`);
  ok(/"ok":true/.test(bk), "the backup completed against a real HTTP Drive endpoint (" + bk + ")");
  ok(drive.puts === 1 && drive.file, "the Drive server actually received and stored a file");

  // THE check, on the bytes that crossed the wire.
  const leaked = SECRETS.filter((s) => String(drive.file).indexOf(s) >= 0);
  ok(leaked.length === 0, "NOTHING readable crossed the wire" + (leaked.length ? " — LEAKED: " + leaked.join(", ") : ""));
  ok(String(drive.file).indexOf(noteId) === -1, "not even the note id");
  /* Parsed defensively: if encryption ever regresses, this must FAIL with a readable message
   * rather than throw and abort the run - a crash is a worse signal than a failed assertion. */
  let env = null;
  try {
    const raw = String(drive.file);
    env = JSON.parse(raw.slice(raw.lastIndexOf('{"format"'), raw.lastIndexOf("}") + 1));
  } catch (e) { env = null; }
  ok(!!env && env.format === 2 && env.enc === "password" && !!env.salt && !!env.payload,
    "what landed is a password envelope");
  ok(!!(env && env.kdf) && env.kdf.iterations === 200000 && env.kdf.hash === "SHA-256",
    "with 200k PBKDF2-SHA256 recorded in it");

  // ── 3. THE REINSTALL: wipe the device, including the secret the notes were encrypted with ──
  await ev(`try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} return 1;`);
  ok(await boot("after wipe"), "the app reloads on a wiped device");
  ok(await ev(`return SMD_SURGX_STORE.listNotes().length;`) === 0, "the notes are GONE, exactly as after a reinstall");

  // A wrong password must not open it.
  await ev(`window.__bad = 0; SMD_SURGX_BACKUP.restoreNow({ confirmed: true, password: "wrong-password-x" }).then(function (r) { window.__bad = r; }); return 1;`);
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`return window.__bad ? 1 : 0;`) === 1) break; }
  ok(/"error":"wrong_password"/.test(await ev(`return JSON.stringify(window.__bad);`)), "the wrong password is rejected against the real file");
  ok(await ev(`return SMD_SURGX_STORE.listNotes().length;`) === 0, "and nothing was half-restored");

  // ── 4. restore with the real password ──
  await ev(`window.__rs = 0; SMD_SURGX_BACKUP.restoreNow({ confirmed: true, password: ${JSON.stringify(PW)} }).then(function (r) { window.__rs = r; }); return 1;`);
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`return window.__rs ? 1 : 0;`) === 1) break; }
  const rs = await ev(`return JSON.stringify(window.__rs);`);
  ok(/"ok":true/.test(rs) && /"added":1/.test(rs), "the restore succeeded (" + rs + ")");
  ok(await ev(`return SMD_SURGX_STORE.listNotes().length;`) === 1, "the note is back on the device");

  // and it is READABLE — decrypted with the NEW device secret, content intact
  await ev(`window.__rd = 0; SMD_SURGX_STORE.loadNote(SMD_SURGX_STORE.listNotes()[0].id).then(function (n) { window.__rd = n || -1; }); return 1;`);
  for (let i = 0; i < 30; i++) { await sleep(250); if (await ev(`return window.__rd ? 1 : 0;`) === 1) break; }
  const back = await ev(`return JSON.stringify(window.__rd);`);
  ok(SECRETS.every((s) => back.indexOf(s) >= 0),
    "every field survived the round trip and is readable again under the NEW device key");
  ok(await ev(`return window.__rd.id;`) === noteId, "and it is the same note, same id");

  // restoring again must change nothing
  await ev(`window.__rs2 = 0; SMD_SURGX_BACKUP.restoreNow({ confirmed: true, password: ${JSON.stringify(PW)} }).then(function (r) { window.__rs2 = r; }); return 1;`);
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`return window.__rs2 ? 1 : 0;`) === 1) break; }
  ok(/"added":0/.test(await ev(`return JSON.stringify(window.__rs2);`)), "restoring a second time writes nothing");

  console.log(fails === 0
    ? "\nALL GREEN — a note survived a full device wipe, and only the password brought it back"
    : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally {
  try { ws && ws.close(); } catch {}
  chrome.kill(); if (serveProc) serveProc.kill(); driveSrv.close();
  process.exit(fails === 0 ? 0 : 1);
}
