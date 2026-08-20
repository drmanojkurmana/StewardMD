/* test/maik-engine.test.mjs — MaiK answer-engine chooser + SMD_AI router decorator.
 *
 * Covers the contract the offline feature depends on:
 *   • default is "cloud" (an untouched install must behave EXACTLY as before)
 *   • rag  → no paid call ever leaves; a real {text} notice is returned so home.js renders it
 *   • local→ SMD_MAIK_LOCAL.answer, with pkg/opts/onDelta passed through for replay()
 *   • a stale "local" pref (no gate / no runtime / no pack) degrades to KB-only, never dead-ends
 *   • ONLY rag forces KB-first (smd_maik_llm_first=0); local must reach the model, not the template
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const SRC = src("maik-engine.js");

function fakeLS() {
  const s = {};
  return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, _s: s };
}

// Build a window with a spy SMD_AI. `env` lets a test switch the gate/runtime/pack on.
function load(env = {}) {
  const calls = [];
  const win = {
    SMD_AI: {
      explain: (...a) => { calls.push(["explain", a]); return Promise.resolve({ text: "CLOUD explain" }); },
      explainGrounded: (...a) => { calls.push(["explainGrounded", a]); return Promise.resolve({ text: "CLOUD grounded" }); },
      explainGroundedStream: (...a) => { calls.push(["explainGroundedStream", a]); return Promise.resolve({ text: "CLOUD stream" }); },
      refine: (...a) => { calls.push(["refine", a]); return Promise.resolve({ topic: "CLOUD refine" }); },
      route: function (q) { return this.refine(q); }
    }
  };
  if (env.gate) win.SMD_XACCESS = { isActiveCached: (f) => f === "maik_local" };
  if (env.runtime) {
    win.SMD_MAIK_LOCAL = { answer: (...a) => { calls.push(["local", a]); return Promise.resolve({ text: "LOCAL answer" }); } };
  }
  // Model module stub shaped like the real SMD_MAIK_MODELS so the settings section renders.
  if (env.pack !== undefined || env.models) {
    const installed = env.pack !== false;
    let _active = env.active || "maik-local-v1";
    win.SMD_MAIK_MODELS = {
      PACKS: {
        "maik-local-v1": { label: "MAiK MxCore", actual: "MedGemma 1.5 4B (Q4_K_M)", tier: 1, nCtx: 4096 },
        "maik-local-e2b": { label: "MAiK Horizon", actual: "Gemma 4 E2B (Q4_K_M)", tier: 3, nCtx: 4096 }
      },
      packIds: () => ["maik-local-v1", "maik-local-e2b"],
      installedCached: (id) => installed && id === "maik-local-v1",
      sizeLabel: (id) => (id === "maik-local-v1" ? "2.49 GB" : "3.11 GB"),
      totalBytes: () => 2489894976,
      state: (id) => env.state || { downloading: false, frac: installed && id === "maik-local-v1" ? 1 : 0, done: installed && id === "maik-local-v1", err: null },
      subscribe: () => () => {},
      // stateful, like the real module: setActivePack must actually change activePack
      activePack: () => _active,
      setActivePack: (id) => { if (id in win.SMD_MAIK_MODELS.PACKS) _active = id; return _active; },
      cancel: () => {},
      ensure: () => Promise.resolve({ installed: true }),
      remove: () => Promise.resolve()
    };
  }
  const ls = fakeLS();
  new Function("window", "localStorage", SRC)(win, ls);
  return { win, ls, calls, E: win.SMD_MAIK_ENGINE };
}

// ── preference basics ──
{
  const { E, ls } = load();
  ok("exposes API", !!E && typeof E.getPref === "function" && typeof E.settingsHTML === "function");
  ok("default pref is cloud", E.getPref() === "cloud");
  ok("effective() is cloud by default", E.effective() === "cloud");
  ok("unknown stored value falls back to cloud", (ls.setItem("stewardmd.maikEngine", "bogus"), E.getPref() === "cloud"));
  E.setPref("rag"); ok("setPref rag persists", E.getPref() === "rag");
  ok("rag forces KB-first ON (llm_first=0)", ls._s.smd_maik_llm_first === "0");
  E.setPref("cloud"); ok("cloud restores llm_first default (key removed)", !("smd_maik_llm_first" in ls._s));
  E.setPref("local");
  ok("local does NOT force KB-first (the model must answer, not the KB template)", !("smd_maik_llm_first" in ls._s));
  E.setPref("nonsense"); ok("setPref sanitises unknown → cloud", E.getPref() === "cloud");
}

// ── install() decorates exactly once ──
{
  const { win, E } = load();
  const afterLoad = win.SMD_AI.explainGrounded;
  ok("install() ran at load (function replaced)", typeof afterLoad === "function");
  ok("second install() is a no-op", E.install() === false && win.SMD_AI.explainGrounded === afterLoad);
}

// ── cloud: pass-through, untouched ──
{
  const { win, E, calls } = load();
  E.setPref("cloud");
  await win.SMD_AI.explainGrounded({ q: 1 }, { depth: "concise" });
  await win.SMD_AI.explainGroundedStream({ q: 2 }, {}, () => {});
  await win.SMD_AI.refine("sepsis");
  ok("cloud: all three reach the original", calls.length === 3);
  ok("cloud: grounded args untouched", calls[0][0] === "explainGrounded" && calls[0][1][0].q === 1 && calls[0][1][1].depth === "concise");
  const r = await win.SMD_AI.explainGrounded({});
  ok("cloud: returns the original result", r.text === "CLOUD grounded");
}

// ── rag: nothing paid leaves, and a renderable notice comes back ──
{
  const { win, E, calls } = load();
  E.setPref("rag");
  const g = await win.SMD_AI.explainGrounded({ q: 1 });
  const s = await win.SMD_AI.explainGroundedStream({ q: 1 }, {}, () => {});
  const x = await win.SMD_AI.explain("summary", "question");
  const rf = await win.SMD_AI.refine("sepsis");
  ok("rag: ZERO paid calls made", calls.length === 0);
  ok("rag: grounded returns text, not an error", !!g.text && !g.error);
  ok("rag: stream returns text too", !!s.text && !s.error);
  ok("rag: plain explain returns text", !!x.text);
  ok("rag: refine returns null (callers treat null as no-refinement)", rf === null);
  ok("rag: notice names the setting to change", /Settings/.test(g.text) && /MaiK Cloud/.test(g.text));
  ok("rag: notice tagged engine=rag", g.engine === "rag");
  // must not trip maikRenderAnswer's "limited material" regex, which would swallow the notice
  const swallow = /\b(no (relevant |specific )?information|does not (cover|contain)|unable to (find|answer)|i (don'?t|do not) have (enough|any))\b/i;
  ok("rag: notice survives the render regex", !swallow.test(g.text));
}

// ── local: routes to the plugin, passes pkg/opts/onDelta through ──
{
  const { win, E, calls } = load({ gate: true, runtime: true, pack: true });
  ok("localReady() true when gate+runtime+pack present", E.localReady() === true);
  E.setPref("local");
  ok("effective() is local when ready", E.effective() === "local");
  const cb = () => {};
  const r = await win.SMD_AI.explainGroundedStream({ q: 7 }, { depth: "deep" }, cb);
  ok("local: answer() called", calls.length === 1 && calls[0][0] === "local");
  ok("local: pkg passed through", calls[0][1][0].q === 7);
  ok("local: opts passed through", calls[0][1][1].depth === "deep");
  ok("local: onDelta passed through (replay reuse)", calls[0][1][2] === cb);
  ok("local: returns the local text", r.text === "LOCAL answer");
  // plain explain has a (summary, question) signature — must be normalised into a pkg
  calls.length = 0;
  await win.SMD_AI.explain("SUM", "Q");
  ok("local: explain() normalised to a package", calls[0][1][0].summary === "SUM" && calls[0][1][0].question === "Q");
}

// ── local degrades to KB-only rather than dead-ending ──
{
  const noGate = load({ runtime: true, pack: true });
  noGate.E.setPref("local");
  ok("local without gate → effective rag", noGate.E.effective() === "rag");
  const r1 = await noGate.win.SMD_AI.explainGrounded({});
  ok("local without gate → KB-only notice, no paid call", !!r1.text && noGate.calls.length === 0);

  const noPack = load({ gate: true, runtime: true });
  noPack.E.setPref("local");
  ok("local without the model pack → effective rag", noPack.E.effective() === "rag");

  const noRt = load({ gate: true, pack: true });
  noRt.E.setPref("local");
  ok("local without the native runtime → effective rag", noRt.E.effective() === "rag");
}

// ── a throwing local engine surfaces an error instead of hanging the bubble ──
{
  const { win, E } = load({ gate: true, runtime: true, pack: true });
  win.SMD_MAIK_LOCAL.answer = () => Promise.reject(new Error("oom"));
  E.setPref("local");
  const r = await win.SMD_AI.explainGrounded({});
  ok("local: rejection becomes {error}", r.error === "oom");
}

// ── a DEV build opens the experimental gate; a release build does not ──
// Without this the feature is unreachable on a device: SMD_XACCESS needs a server-issued code and
// iOS has no JS console to set a bypass by hand.
{
  const dev = load({ runtime: true, pack: true });
  dev.win.SMD_MAIK_LOCAL.isDebugBuild = () => true;
  ok("debug build opens the gate", dev.E.gateActive() === true && dev.E.localReady() === true);

  const rel = load({ runtime: true, pack: true });
  rel.win.SMD_MAIK_LOCAL.isDebugBuild = () => false;
  ok("release build still requires a code", rel.E.gateActive() === false && rel.E.localReady() === false);

  const relWithCode = load({ gate: true, runtime: true, pack: true });
  relWithCode.win.SMD_MAIK_LOCAL.isDebugBuild = () => false;
  ok("release build WITH a valid code is allowed", relWithCode.E.gateActive() === true);

  const devBypass = load({ runtime: true, pack: true });
  devBypass.win.SMD_MAIK_LOCAL.isDebugBuild = () => false;
  devBypass.win.SMD_XACCESS = { isActiveCached: () => false, devBypass: () => true };
  ok("SMD_XACCESS.devBypass is also honoured", devBypass.E.gateActive() === true);
}

// ── owner/QA bypass unlocks the gate without a server deploy ──
{
  const { E, ls } = load({ runtime: true, pack: true });
  ok("gate closed without a code", E.localReady() === false);
  ls.setItem("smd_maik_local_bypass", "1");
  ok("bypass opens the gate", E.localReady() === true);
  E.setPref("local");
  ok("bypass makes local the effective engine", E.effective() === "local");
}

// ── settings markup ──
{
  const { E } = load();
  const h = E.settingsHTML();
  ok("settings: one .me-seg host", (h.match(/class="me-seg"/g) || []).length === 1);
  ok("settings: three engine options", (h.match(/data-me-opt="/g) || []).length === 3);
  ok("settings: labels present", /KB only/.test(h) && /MaiK Cloud/.test(h) && /On-device model/.test(h));
  ok("settings: cloud is checked by default", /data-me-opt="cloud" role="radio" aria-checked="true"/.test(h));
  ok("settings: local disabled without a gate", /data-me-opt="local"[^>]*aria-disabled="true"/.test(h));
  ok("settings: no model row without gate+runtime", !/data-me-model/.test(h));

  const ready = load({ gate: true, runtime: true, models: true, pack: false });
  const h2 = ready.E.settingsHTML();
  ok("settings: gated+runtime shows a download row", /data-me-model="download"/.test(h2));
  ok("settings: download copy promises resume", /resumes if interrupted/i.test(h2));
  ok("settings: no Wi-Fi-only restriction in the copy", /Wi-Fi or mobile data/.test(h2));
  ok("settings: download keeps going off-screen is stated", /keeps going/i.test(h2));

  const installed = load({ gate: true, runtime: true, pack: true });
  const h3 = installed.E.settingsHTML();
  ok("settings: installed shows a delete row", /data-me-model="delete"/.test(h3));
  ok("settings: local option enabled once ready", !/data-me-opt="local"[^>]*aria-disabled="true"/.test(h3));
}

// ── on-device model section: pack picker + live progress ──
{
  const { E } = load({ gate: true, runtime: true, models: true, pack: false });
  const h = E.settingsHTML();
  ok("model section: renders one row per pack", (h.match(/data-me-pack="/g) || []).length === 2);
  ok("model section: names both models", /MedGemma 1\.5 4B/.test(h) && /Gemma 4 E2B/.test(h));
  ok("model section: shows each size", /2\.49 GB/.test(h) && /3\.11 GB/.test(h));
  ok("model section: active pack is ticked", /data-me-pack="maik-local-v1" role="radio" aria-checked="true"/.test(h));
  ok("model section: inactive pack not ticked", /data-me-pack="maik-local-e2b" role="radio" aria-checked="false"/.test(h));
  ok("model section: per-pack download buttons carry the id", /data-me-model="download" data-me-id="maik-local-e2b"/.test(h));
  ok("model section: has a status line per pack", (h.match(/data-me-status="/g) || []).length === 2);
  ok("model section: not-downloaded state is stated", /Not downloaded/.test(h));
}

// mid-download rendering: progress bar, MB/s, ETA and a Pause button
{
  const { E } = load({ gate: true, runtime: true, models: true, pack: false,
                       state: { downloading: true, frac: 0.4213, bytes: 1e9, total: 2489894976, mbps: 2.35, etaS: 640, note: "Downloading", err: null, done: false } });
  const h = E.settingsHTML();
  ok("downloading: shows a percentage", /42\.1% of/.test(h));
  ok("downloading: shows throughput", /2\.4 MB\/s/.test(h));
  ok("downloading: shows an ETA", /11 min left/.test(h));
  ok("downloading: renders a progress bar at the right width", /width:42\.1%/.test(h));
  ok("downloading: offers Pause, not Download", /data-me-model="pause"/.test(h) && !/data-me-model="download" data-me-id="maik-local-v1"/.test(h));
  ok("downloading: no Delete next to Pause (avoids a mis-tap mid-transfer)", !/data-me-model="delete" data-me-id="maik-local-v1"/.test(h));
  ok("action buttons have a live-update hook", /data-me-actions="maik-local-v1"/.test(h));
}

// a stopped download must invite resume, not restart
{
  const { E } = load({ gate: true, runtime: true, models: true, pack: false,
                       state: { downloading: false, frac: 0.07, bytes: 1.7e8, total: 2489894976, mbps: 0, etaS: null, note: "Stopped", err: "Failed to fetch", done: false } });
  const h = E.settingsHTML();
  ok("stopped: tells the user to resume", /tap Download to resume/.test(h));
  ok("stopped: button says Resume", />Resume</.test(h));
  ok("stopped: keeps a Delete option for the partial file", /data-me-model="delete"/.test(h));
}

// a broken/older model module must not blank the settings panel
{
  const { win, E } = load({ gate: true, runtime: true });
  win.SMD_MAIK_MODELS = { installedCached: () => false };      // no PACKS/state/sizeLabel
  const h = E.settingsHTML();
  ok("degrades safely when the model module is incomplete", (h.match(/data-me-opt="/g) || []).length === 3 && !/data-me-pack/.test(h));
}

// ── ChatGPT-style inline picker ──
{
  const { E } = load({ gate: true, runtime: true, pack: true });
  const opts = E.options();
  ok("picker: cloud + KB + every on-device pack as flat rows", opts.length === 4);
  ok("picker: cloud first (it is the default)", opts[0].id === "cloud" && /PRO/.test(opts[0].badge));
  ok("picker: KB-only row is free", opts[1].id === "rag" && /FREE/.test(opts[1].badge));
  ok("picker: on-device rows are namespaced per pack", opts[2].id === "local:maik-local-v1" && opts[3].id === "local:maik-local-e2b");
  ok("picker: on-device rows badged OFFLINE", opts[2].badge === "OFFLINE");
  ok("picker: shows the MAiK brand name", opts[2].label === "MAiK MxCore");
  ok("picker: third tier is Horizon", opts[3].label === "MAiK Horizon");
  // The MAiK name is the brand; the REAL model must stay visible, because a clinician deciding
  // whether to trust an answer is entitled to know it came from MedGemma 4B.
  ok("picker: installed pack names the real model", /MedGemma 1\.5 4B/.test(opts[2].sub));
  ok("picker: installed pack says it works offline", /works offline/i.test(opts[2].sub));
  ok("picker: KB-only row claims citations", /cited/i.test(opts[1].sub));
  ok("picker: cloud row names Gemini + grounding", /Gemini/.test(opts[0].sub) && /grounded/i.test(opts[0].sub));
  ok("picker: uninstalled pack invites a download with its size", /Tap to download 3\.11 GB/.test(opts[3].sub));
  ok("picker: uninstalled pack flagged needsDownload", opts[3].needsDownload === true && !opts[2].needsDownload);

  ok("picker: chip reflects cloud by default", E.chipLabel() === "MaiK Cloud");
  ok("picker: currentOptionId is cloud by default", E.currentOptionId() === "cloud");
  // Selecting an INSTALLED pack switches the answering engine.
  E.selectOption("local:maik-local-v1");
  ok("picker: selecting an installed pack sets engine local", E.getPref() === "local");
  ok("picker: currentOptionId follows the pack", E.currentOptionId() === "local:maik-local-v1");
  E.selectOption("rag");
  ok("picker: selecting KB only switches engine", E.getPref() === "rag" && E.chipLabel() === "KB only");
  E.selectOption("cloud");
  ok("picker: back to cloud", E.getPref() === "cloud");

  const h = E.chipHTML();
  ok("picker: chip markup has the id home.js wires", /id="maikModelChip"/.test(h));
  ok("picker: chip has an accessible popup role", /aria-haspopup="listbox"/.test(h));
  ok("picker: chip label is escaped into its own span", /id="maikModelChipLbl"/.test(h));
}

// ── selecting a model that is NOT downloaded must not silently break answering ──
// This is the bug that presented as "I get no answer": tapping an undownloaded pack set the engine
// to local, localReady() went false, effective() fell back to rag, and the chip still showed the
// model name. Nothing told the clinician why.
{
  const { E } = load({ gate: true, runtime: true, pack: true });
  E.selectOption("local:maik-local-v1");
  ok("baseline: installed pack answers locally", E.effective() === "local");

  E.selectOption("local:maik-local-e2b");          // NOT installed in the stub
  ok("uninstalled pick keeps the WORKING model answering", E.activePack() === "maik-local-v1");
  ok("uninstalled pick does not break the engine", E.effective() === "local");
  ok("uninstalled pick is remembered as the request", E.pendingPack() === "maik-local-e2b");
  ok("chip still names what actually answers", E.chipLabel() === "MAiK MxCore");
  ok("picker marks the requested pack", E.options().filter((o) => o.requested).map((o) => o.pack)[0] === "maik-local-e2b");
  // switching away clears the pending request
  E.selectOption("cloud");
  ok("choosing cloud clears the pending request", E.pendingPack() === null);
}

// the chip must never imply a model is answering when it cannot
{
  const { E } = load({ gate: true, runtime: true, pack: false,
                       active: "maik-local-e2b",
                       state: { downloading: false, frac: 0, done: false, err: null } });
  E.setPref("local");
  ok("chip flags a not-ready model", /\(not ready\)/.test(E.chipLabel()));

  const dl = load({ gate: true, runtime: true, pack: false, active: "maik-local-e2b",
                    state: { downloading: true, frac: 0.37, done: false, err: null } });
  dl.E.setPref("local");
  ok("chip shows download progress instead of pretending", /\(37%\)/.test(dl.E.chipLabel()));
}

// the "no answer" message must name the real reason, not claim KB-only mode
{
  const notDl = load({ gate: true, runtime: true, pack: false, active: "maik-local-e2b",
                       state: { downloading: false, frac: 0, done: false, err: null } });
  notDl.E.setPref("local");
  const n1 = notDl.E.kbOnlyNotice();
  ok("notice: does NOT claim KB-only mode", !/KB-only mode is on/.test(n1.text));
  ok("notice: says the model is not downloaded", /not downloaded/.test(n1.text));
  ok("notice: tells them how to fix it", /select it to start the download/.test(n1.text));
  ok("notice: tagged local-unavailable", n1.engine === "local-unavailable");

  const mid = load({ gate: true, runtime: true, pack: false, active: "maik-local-e2b",
                     state: { downloading: true, frac: 0.42, done: false, err: null } });
  mid.E.setPref("local");
  ok("notice: mid-download says so with a percentage", /still downloading \(42%\)/.test(mid.E.kbOnlyNotice().text));

  const part = load({ gate: true, runtime: true, pack: false, active: "maik-local-e2b",
                      state: { downloading: false, frac: 0.19, done: false, err: "Failed to fetch" } });
  part.E.setPref("local");
  ok("notice: partial download offers resume", /partly downloaded \(19%\)/.test(part.E.kbOnlyNotice().text) && /resume/.test(part.E.kbOnlyNotice().text));

  // a genuine KB-only choice still gets the KB-only copy
  const kb = load({ gate: true, runtime: true, pack: true });
  kb.E.setPref("rag");
  ok("notice: real KB-only choice keeps its own copy", /KB-only mode is on/.test(kb.E.kbOnlyNotice().text));
}

// adopt the pack once it finishes downloading
{
  const { E } = load({ gate: true, runtime: true, pack: true });
  E.selectOption("local:maik-local-v1");
  E.setPref("cloud");
  ok("adopt: switches to local once the selected pack is installed", E.adoptPackWhenReady("maik-local-v1") === true && E.getPref() === "local");
  ok("adopt: refuses for a pack that is not installed", E.adoptPackWhenReady("maik-local-e2b") === false);
  ok("adopt: promotes the PENDING pack once it lands", (function () {
    const f = load({ gate: true, runtime: true, pack: true });
    f.E.selectOption("local:maik-local-e2b");                  // not installed -> pending
    f.win.SMD_MAIK_MODELS.installedCached = () => true;        // download finishes
    const okAdopt = f.E.adoptPackWhenReady("maik-local-e2b");
    return okAdopt === true && f.E.activePack() === "maik-local-e2b" && f.E.pendingPack() === null;
  })());
}

// on-device rows must NOT appear without the gate or the native runtime
{
  const nogate = load({ runtime: true, pack: true });
  ok("picker: no on-device rows without the access gate", nogate.E.options().length === 2);
  const nort = load({ gate: true, pack: true });
  ok("picker: no on-device rows without the native plugin", nort.E.options().length === 2);
}

// the chip is mounted in the MaiK sheet header, not just defined
{
  const home = src("home.js");
  ok("chip rendered in the MaiK header", /SMD_MAIK_ENGINE\.chipHTML\(\)/.test(home));
  ok("chip wired when the sheet is built", /SMD_MAIK_ENGINE\.wireChip\(sheet\)/.test(home));
}

// ── the section must be wired into the LIVE settings surface ──
// sidebar-redesign.js sets window.SMD_SBR, which makes home.js's old Settings group stand down.
// Wiring only home.js renders nothing on a real device (that is exactly what happened once).
{
  const sbr = src("sidebar-redesign.js");
  ok("wired into sidebar-redesign advBody()", /SMD_MAIK_ENGINE\s*&&\s*SMD_MAIK_ENGINE\.settingsHTML/.test(sbr));
  ok("wired into sidebar-redesign openSettingsPage()", /SMD_MAIK_ENGINE\.wireSettings\(ov\.querySelector/.test(sbr));
  ok("sidebar-redesign is the superseding surface (sets SMD_SBR)", /window\.SMD_SBR\s*=\s*true/.test(sbr));
  const home = src("home.js");
  ok("legacy home.js seam kept as a fallback", /SMD_MAIK_ENGINE\.wireSettings\(setBody\)/.test(home));
  const idx = src("index.html");
  ok("all three modules ship in index.html", /maik-engine\.js/.test(idx) && /maik-models\.js/.test(idx) && /maik-local\.js/.test(idx));
}

console.log(`\nmaik-engine: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
