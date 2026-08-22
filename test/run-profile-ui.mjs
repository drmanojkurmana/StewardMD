/* The profile page: StewardMD ID + the full professional profile.
 *
 * Two regressions this pins:
 *  1) the StewardMD ID was nowhere in the account sheet, so a doctor had no way to read their own
 *     ID except by opening ICU's Team screen;
 *  2) Reg no / hospital / city / phone were appended ONLY after a successful Firestore read, so a
 *     slow, signed-out or offline read rendered a SHORT profile that looked like "I never filled
 *     this in". Every row must render in every state, with an explicit loading/retry message.
 *
 * Drives the real More → Profile sheet with a stubbed account + Firestore doc. No PHI, no network.
 * USAGE: node test/run-profile-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE || "http://localhost:8916/").replace(/\/?$/, "/");
const PORT = 9435, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/profile-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };
let serveProc = null;
async function ensureServer() { try { await fetch(BASE); return; } catch {} const port = (BASE.match(/:(\d+)/) || [, "8916"])[1]; serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, port], { stdio: "ignore" }); for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } } }
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
const J = async (e) => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };

// Stub a signed-in doctor with a filled profile, plus a minimal Firestore double.
const STUB = `
  window.__saved = {};
  var PROFILE = { regNo: "APMC-44821", hospital: "GIMSR, Visakhapatnam", city: "Visakhapatnam", phone: "+91 90000 00000" };
  window.__profileDoc = PROFILE;
  window.SMD_AUTH = { currentUser: { uid: "u-doc-1", displayName: "Dr Asha Rao", email: "asha@hospital.org", photoURL: "" } };
  window.SMD_DB = { collection: function () { return { doc: function () { return {
    collection: function () { return { doc: function () { return {
      get: function () { return window.__failRead ? Promise.reject(new Error("offline")) : Promise.resolve({ exists: true, data: function () { return window.__profileDoc; } }); },
      set: function (obj) { Object.assign(window.__saved, obj); Object.assign(window.__profileDoc, obj); return Promise.resolve(); }
    }; } }; }
  }; } }; } };
  window.SMD_ACCOUNT = { profile: function () { return { signedIn: true, name: "Dr Asha Rao", email: "asha@hospital.org", picture: "", provider: "google" }; }, onChange: function () {} };
  window.SMD_STEWARD_ID = { my: function () { return "SMD-QT7K42"; }, ensure: function (d, cb) { cb("SMD-QT7K42"); } };
  window.SMD_VERIFY = { isVerified: function () { return Promise.resolve(true); } };
  try { localStorage.setItem("stewardmd_account", JSON.stringify({ name: "Dr Asha Rao", email: "asha@hospital.org", type: "google" })); } catch (e) {}
  return 1;`;

// Open the profile the way a user does: sidebar → tap your own photo/name.
const OPEN = `
  var m = document.querySelector('[data-act="menu"]'); if (m) m.click();`;

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!document.querySelector('[data-act="menu"]')`) === true) { ready = true; break; } }
  if (!ready) throw new Error("home shell not rendered");
  await ev(STUB);

  // The sidebar identity block: your own photo + name must be a way IN to the profile.
  const drawer = await J(`
    ${OPEN}
    return JSON.stringify({ open: 1 });
  `);
  ok(drawer.open === 1, `the sidebar opens`);
  await sleep(700);
  const entry = await J(`
    var btn = document.getElementById("smdSbProfile");
    return JSON.stringify({ found: !!btn, label: btn ? btn.textContent.replace(/\\s+/g," ").trim().slice(0,80) : "" });
  `);
  ok(entry.found === true, `your photo + name in the sidebar is a button`);
  ok(/View profile/.test(entry.label), `it says what it does (\"${entry.label}\")`);

  // Tapping a CHILD of that button (the photo, as a thumb would) must still open the profile.
  // Re-apply the stubs first: the app loads the real Firebase SDK on idle, which replaces
  // window.SMD_AUTH / SMD_DB partway through this run.
  await ev(STUB);
  await J(`
    var btn = document.getElementById("smdSbProfile");
    var child = btn.querySelector(".smd-sba-pic") || btn.firstChild;
    child.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return JSON.stringify({ clicked: 1 });
  `);
  await sleep(500);
  const pf = await J(`
    var s = document.getElementById("hvSheet");
    var rows = [].map.call(s.querySelectorAll("#pfPro .hv-pf-row"), function (r) {
      return { k: r.querySelector(".hv-pf-k").textContent.trim(), v: (r.querySelector("[data-val]")||{}).textContent };
    });
    return JSON.stringify({
      page: !!s.querySelector(".hv-pf"),
      id: (s.querySelector("#pfIdCode")||{}).textContent,
      copy: !!(s.querySelector("#pfIdCopy") && !s.querySelector("#pfIdCopy").hidden),
      rows: rows,
      name: (s.querySelector(".hv-pf-nm")||{}).textContent
    });
  `);
  ok(pf.page === true, `the profile page renders`);
  ok(pf.id === "SMD-QT7K42", `the StewardMD ID is shown on it (got "${pf.id}")`);
  ok(pf.copy === true, `with a Copy button`);
  ok(pf.name === "Dr Asha Rao", `identity header shows the doctor's name`);
  const byKey = Object.fromEntries((pf.rows || []).map(r => [r.k, r.v]));
  ok(byKey["Medical reg. no"] === "APMC-44821", `Reg no is filled from the profile doc (got "${byKey["Medical reg. no"]}")`);
  ok(byKey["Hospital / college"] === "GIMSR, Visakhapatnam", `Hospital / college is shown (got "${byKey["Hospital / college"]}")`);
  ok(byKey["City"] === "Visakhapatnam", `City is shown (got "${byKey["City"]}")`);
  ok(byKey["Phone"] === "+91 90000 00000", `Phone is shown (got "${byKey["Phone"]}")`);

  // Verification badge
  await sleep(200);
  const badge = await ev(`var b=[].map.call(document.querySelectorAll("#pfBadges .hv-pf-badge"),function(x){return x.textContent}); return b.join("|");`);
  ok(/Verified doctor/.test(badge || ""), `verification state is on the page (badges: ${badge})`);

  // Inline edit — City. No window.prompt (which a mobile shell shouldn't be using).
  const edited = await J(`
    var r = document.querySelector('#pfPro [data-row="city"]');
    r.querySelector(".hv-pf-edit").click();
    var input = r.querySelector("input.hv-pf-in");
    if (!input) return JSON.stringify({ inline: false });
    input.value = "Hyderabad";
    r.querySelector("[data-save]").click();
    return JSON.stringify({ inline: true });
  `);
  ok(edited.inline === true, `editing a row happens in place, not through window.prompt`);
  await sleep(250);
  const after = await J(`
    var r = document.querySelector('#pfPro [data-row="city"]');
    return JSON.stringify({ shown: r.querySelector("[data-val]").textContent, saved: window.__saved.city });
  `);
  ok(after.saved === "Hyderabad" && after.shown === "Hyderabad", `the edit is saved and reflected (${JSON.stringify(after)})`);

  // Settings → Account must reach the SAME page (window.SMD_openProfile is the shared seam).
  const seam = await J(`
    return JSON.stringify({ exported: typeof window.SMD_openProfile === "function" });
  `);
  ok(seam.exported === true, `window.SMD_openProfile is exported for the Settings → Profile row`);

  // THE BUG: an unreadable profile must still render every row + say so, never a short profile.
  const offline = await J(`
    window.__failRead = true;
    window.SMD_openProfile();
    return JSON.stringify({ opened: true });
  `);
  ok(offline.opened === true, `reopened the profile with the profile read failing`);
  await sleep(350);
  const off = await J(`
    var rows = document.querySelectorAll("#pfPro .hv-pf-row");
    var txt = document.querySelector("#pfPro").textContent;
    return JSON.stringify({ n: rows.length, retry: !!document.querySelector("#pfPro [data-retry]"), txt: txt.slice(0, 200) });
  `);
  ok(off.n >= 4, `all professional rows still render when the read fails (${off.n} rows)`);
  ok(off.retry === true, `and the page says so with a Retry, instead of silently showing less`);

  console.log(fails === 0 ? "\nALL GREEN — profile page shows the StewardMD ID and the full professional profile" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
