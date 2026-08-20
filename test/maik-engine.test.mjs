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
    let _active = env.active || "maik-mxcore";
    win.SMD_MAIK_MODELS = {
      PACKS: {
        "maik-mxcore": { label: "MAiK MxCore", actual: "MedGemma 1.5 4B (Q4_K_M)", tier: 1, nCtx: 4096,
          guide: { speed: 3, medical: 2, general: 1,
                   bestFor: "Everyday clinical questions on any supported phone.",
                   why: "Medically tuned, and the lightest of the three on memory.",
                   pick: "Start here. If you install only one, install this one." } },
        "maik-neural": { label: "MAiK Neural", actual: "MedGemma 1.5 4B (Q5_K_M)", tier: 2, nCtx: 4096,
          guide: { speed: 2, medical: 3, general: 1,
                   bestFor: "When you want the most dependable medical detail.",
                   why: "Same medical tuning held at higher precision.",
                   pick: "Choose this if you have the storage to spare." } },
        "maik-horizon": { label: "MAiK Horizon", actual: "Gemma 4 E2B (Q4_K_M)", tier: 3, nCtx: 4096,
          guide: { speed: 1, medical: 1, general: 3,
                   bestFor: "Broader reasoning and topics at the edges of clinical work.",
                   why: "A newer general-purpose base with wider world knowledge.",
                   pick: "Not medically tuned. Prefer MxCore or Neural for clinical answers." } },
        "maik-apex": { label: "MAiK Apex", actual: "MedPsy 4B (Q5_K_M, imatrix)", tier: 4, nCtx: 4096,
          flagship: true, noThink: true,
          guide: { speed: 1, medical: 3, general: 3,
                   bestFor: "Flagship phones, when you want the best on-device answer.",
                   why: "A medical fine-tune on a newer, stronger base.",
                   pick: "Best quality here, slowest of the four. On an older phone prefer MxCore." } }
      },
      DEVICE_WARNING: "Built for flagship, AI-enabled phones: iPhone 18 Pro, 17 Pro, 16 Pro. Samsung Galaxy Fold 7, 6, 5 or S24, S25, S26 Ultra. On any other phone this is at your own risk. It may hang or crash the phone.",
      GUIDE_INTRO: [
        "Answers come from a model stored on your phone. No internet, no AI tokens.",
        "It answers from its own training, not from StewardMD's knowledge base, so there are no sources or citations and it can be wrong. Verify against local protocol.",
        "You can keep more than one downloaded and switch between them. Only the selected one runs.",
        "Downloading needs the space shown plus room to run it. Wi-Fi is easier, mobile data works, and a download resumes if it is interrupted."
      ],
      packIds: () => ["maik-mxcore", "maik-neural", "maik-horizon", "maik-apex"],
      installedCached: (id) => installed && id === "maik-mxcore",
      sizeLabel: (id) => (id === "maik-mxcore" ? "2.49 GB" : id === "maik-neural" ? "2.83 GB" : id === "maik-apex" ? "3.16 GB" : "3.11 GB"),
      totalBytes: () => 2489894976,
      state: (id) => env.state || { downloading: false, frac: installed && id === "maik-mxcore" ? 1 : 0, done: installed && id === "maik-mxcore", err: null },
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
  ok("model section: renders one row per pack", (h.match(/data-me-pack="/g) || []).length === 4);
  ok("model section: names the MAiK tiers, not the upstream models",
     /MAiK MxCore/.test(h) && /MAiK Horizon/.test(h) && !/MedGemma|Gemma 4/i.test(h));
  ok("model section: shows each size", /2\.49 GB/.test(h) && /3\.11 GB/.test(h));
  ok("model section: active pack is ticked", /data-me-pack="maik-mxcore" role="radio" aria-checked="true"/.test(h));
  ok("model section: inactive pack not ticked", /data-me-pack="maik-horizon" role="radio" aria-checked="false"/.test(h));
  ok("model section: per-pack download buttons carry the id", /data-me-model="download" data-me-id="maik-horizon"/.test(h));
  ok("model section: has a status line per pack", (h.match(/data-me-status="/g) || []).length === 4);
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
  ok("downloading: offers Pause, not Download", /data-me-model="pause"/.test(h) && !/data-me-model="download" data-me-id="maik-mxcore"/.test(h));
  ok("downloading: no Delete next to Pause (avoids a mis-tap mid-transfer)", !/data-me-model="delete" data-me-id="maik-mxcore"/.test(h));
  ok("action buttons have a live-update hook", /data-me-actions="maik-mxcore"/.test(h));
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

// ── the header disclaimer must match the engine that will answer ──
// Saying "Grounded" while the on-device model answers from its own weights, with no StewardMD
// sources, is untrue - and it appeared on screen exactly that way.
{
  const { E } = load({ gate: true, runtime: true, pack: true });
  E.setPref("cloud");
  ok("cloud says grounded", /Grounded/.test(E.discLabel()));
  E.setPref("rag");
  ok("KB-only names the knowledge base", /knowledge base/i.test(E.discLabel()) && !/^Grounded/.test(E.discLabel()));
  E.selectOption("local:maik-mxcore");
  const d = E.discLabel();
  ok("on-device does NOT claim grounded", !/Grounded/i.test(d));
  ok("on-device says it is on-device with no sources", /On-device/i.test(d) && /no sources/i.test(d));
  ok("every variant still tells the clinician to verify", /verify independently/i.test(d));
}

// ── no upstream model name anywhere the clinician can see ──
{
  const { E } = load({ gate: true, runtime: true, pack: true });
  const settings = E.settingsHTML();
  ok("settings never prints MedGemma/Gemma", !/MedGemma|Gemma/i.test(settings));
  ok("settings shows the MAiK brand instead", /MAiK MxCore/.test(settings));
  const chipH = E.chipHTML();
  ok("chip never prints MedGemma/Gemma", !/MedGemma|Gemma/i.test(chipH));
}

// ── ChatGPT-style inline picker ──
{
  const { E } = load({ gate: true, runtime: true, pack: true });
  const opts = E.options();
  ok("picker: cloud + KB + every on-device pack as flat rows", opts.length === 6);
  ok("picker: cloud first (it is the default)", opts[0].id === "cloud" && /PRO/.test(opts[0].badge));
  ok("picker: KB-only row is free", opts[1].id === "rag" && /FREE/.test(opts[1].badge));
  ok("picker: on-device rows are namespaced per pack",
     opts[2].id === "local:maik-mxcore" && opts[3].id === "local:maik-neural" && opts[4].id === "local:maik-horizon");
  ok("picker: on-device rows badged OFFLINE", opts[2].badge === "OFFLINE");
  ok("picker: shows the MAiK brand name", opts[2].label === "MAiK MxCore");
  ok("picker: tiers appear in recommended order",
     opts[2].label === "MAiK MxCore" && opts[3].label === "MAiK Neural" && opts[4].label === "MAiK Horizon");
  // Owner decision: the upstream model name must NOT appear in the UI - clinicians see the MAiK
  // tier only. `actual` stays in the registry for logs and bug reports.
  ok("picker: no upstream model name leaks into the row", !/MedGemma|Gemma/i.test(opts[2].sub) && !/MedGemma|Gemma/i.test(opts[2].label));
  ok("picker: installed pack says it works offline", /works offline/i.test(opts[2].sub));
  ok("picker: KB-only row claims citations", /cited/i.test(opts[1].sub));
  ok("picker: cloud row names Gemini + grounding", /Gemini/.test(opts[0].sub) && /grounded/i.test(opts[0].sub));
  ok("picker: uninstalled pack invites a download with its size", /Tap to download 3\.11 GB/.test(opts[4].sub));
  ok("picker: uninstalled pack flagged needsDownload", opts[3].needsDownload === true && !opts[2].needsDownload);

  ok("picker: chip reflects cloud by default", E.chipLabel() === "MaiK Cloud");
  ok("picker: currentOptionId is cloud by default", E.currentOptionId() === "cloud");
  // Selecting an INSTALLED pack switches the answering engine.
  E.selectOption("local:maik-mxcore");
  ok("picker: selecting an installed pack sets engine local", E.getPref() === "local");
  ok("picker: currentOptionId follows the pack", E.currentOptionId() === "local:maik-mxcore");
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
  E.selectOption("local:maik-mxcore");
  ok("baseline: installed pack answers locally", E.effective() === "local");

  E.selectOption("local:maik-horizon");          // NOT installed in the stub
  ok("uninstalled pick keeps the WORKING model answering", E.activePack() === "maik-mxcore");
  ok("uninstalled pick does not break the engine", E.effective() === "local");
  ok("uninstalled pick is remembered as the request", E.pendingPack() === "maik-horizon");
  ok("chip still names what actually answers", E.chipLabel() === "MAiK MxCore");
  ok("picker marks the requested pack", E.options().filter((o) => o.requested).map((o) => o.pack)[0] === "maik-horizon");
  // switching away clears the pending request
  E.selectOption("cloud");
  ok("choosing cloud clears the pending request", E.pendingPack() === null);
}

// the chip must never imply a model is answering when it cannot
{
  const { E } = load({ gate: true, runtime: true, pack: false,
                       active: "maik-horizon",
                       state: { downloading: false, frac: 0, done: false, err: null } });
  E.setPref("local");
  ok("chip flags a not-ready model", /\(not ready\)/.test(E.chipLabel()));

  const dl = load({ gate: true, runtime: true, pack: false, active: "maik-horizon",
                    state: { downloading: true, frac: 0.37, done: false, err: null } });
  dl.E.setPref("local");
  ok("chip shows download progress instead of pretending", /\(37%\)/.test(dl.E.chipLabel()));
}

// the "no answer" message must name the real reason, not claim KB-only mode
{
  const notDl = load({ gate: true, runtime: true, pack: false, active: "maik-horizon",
                       state: { downloading: false, frac: 0, done: false, err: null } });
  notDl.E.setPref("local");
  const n1 = notDl.E.kbOnlyNotice();
  ok("notice: does NOT claim KB-only mode", !/KB-only mode is on/.test(n1.text));
  ok("notice: says the model is not downloaded", /not downloaded/.test(n1.text));
  ok("notice: tells them how to fix it", /select it to start the download/.test(n1.text));
  ok("notice: tagged local-unavailable", n1.engine === "local-unavailable");

  const mid = load({ gate: true, runtime: true, pack: false, active: "maik-horizon",
                     state: { downloading: true, frac: 0.42, done: false, err: null } });
  mid.E.setPref("local");
  ok("notice: mid-download says so with a percentage", /still downloading \(42%\)/.test(mid.E.kbOnlyNotice().text));

  const part = load({ gate: true, runtime: true, pack: false, active: "maik-horizon",
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
  E.selectOption("local:maik-mxcore");
  E.setPref("cloud");
  ok("adopt: switches to local once the selected pack is installed", E.adoptPackWhenReady("maik-mxcore") === true && E.getPref() === "local");
  ok("adopt: refuses for a pack that is not installed", E.adoptPackWhenReady("maik-horizon") === false);
  ok("adopt: promotes the PENDING pack once it lands", (function () {
    const f = load({ gate: true, runtime: true, pack: true });
    f.E.selectOption("local:maik-horizon");                  // not installed -> pending
    f.win.SMD_MAIK_MODELS.installedCached = () => true;        // download finishes
    const okAdopt = f.E.adoptPackWhenReady("maik-horizon");
    return okAdopt === true && f.E.activePack() === "maik-horizon" && f.E.pendingPack() === null;
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


// ── "Which one should I download?" guide ────────────────────────────────────────────────────────
// A clinician is asked to spend 2.5-3.1 GB and choose between three invented names. The picker rows
// only fit a size and a one-liner, so the reasoning lives in an expandable guide.
{
  const { E } = load({ gate: true, runtime: true, pack: true });
  const h = E.settingsHTML();

  ok("settings offers the guide", /data-me-guide\b/.test(h) && /Which one should I download\?/.test(h));
  ok("the guide panel ships collapsed", /data-me-guide-panel hidden/.test(h));
  ok("the toggle reports its state to a screen reader", /data-me-guide aria-expanded="false"/.test(h));

  // The whole point of the owner's instruction: tier names only.
  ok("guide never prints an upstream model name", !/MedGemma|Gemma|Q4_K_M|Q5_K_M|quant/i.test(h));
  ok("guide names all three tiers", /MAiK MxCore/.test(h) && /MAiK Neural/.test(h) && /MAiK Horizon/.test(h));

  // No emoji anywhere: the house rule is a custom icon set, and the ratings are CSS pips.
  const panel = (h.match(/<div data-me-guide-panel[\s\S]*$/) || [""])[0];
  ok("guide panel was rendered", panel.length > 400);
  ok("guide uses no emoji", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(panel));

  // It must say what on-device mode CANNOT do. Easy to omit, and it is the part that matters.
  ok("guide states there are no sources or citations", /no sources or citations/i.test(h));
  ok("guide states it can be wrong", /can be wrong/i.test(h));
  // esc() renders the apostrophe as &#39;, so match around it rather than through it.
  ok("guide says answers do not come from the knowledge base", /not from StewardMD.{0,6}s knowledge base/i.test(h));
  ok("guide states no tokens are used", /No internet, no AI tokens/i.test(h));
  ok("guide explains resumable download", /resumes if it is interrupted/i.test(h));
  ok("guide explains you can keep several and switch", /switch between them/i.test(h));

  // Ratings are comparative, not absolute - claiming otherwise would overstate a 4B.
  ok("guide scopes its ratings comparatively, not absolutely", /compare these options with each other, nothing else/i.test(h));
  ok("guide rates all three axes", /Speed/.test(h) && /Medical depth/.test(h) && /General knowledge/.test(h));
  ok("guide tells a first-timer where to start and why", /Start with MAiK MxCore/.test(h) && /Apex on a flagship phone/.test(h));
  ok("guide tells a first-timer where to start", /install only one/i.test(h));
  ok("guide warns Horizon is not medically tuned", /Not medically tuned/i.test(h));
  ok("pips are labelled for assistive tech", /role="img" aria-label="Speed: \d of 3"/.test(h));
}



// ── Hardware warning, in every surface a clinician can commit from ─────────────────────────────
// These are 2.5-3.2 GB models held in memory while answering. On a phone without the RAM and the AI
// accelerator the app does not degrade gracefully, it stalls or gets killed. The owner asked for the
// warning at BOTH download and selection, so it is asserted in both plus the guide.
{
  const { E } = load({ gate: true, runtime: true, pack: true });
  const h = E.settingsHTML();

  ok("warning shows in the download section", /Built for flagship, AI-enabled phones/.test(h));
  ok("warning appears BEFORE the on-device model list, not after",
     h.indexOf("Built for flagship") < h.indexOf('aria-label="On-device model"'));
  ok("warning names the supported iPhones", /iPhone 18 Pro, 17 Pro, 16 Pro/.test(h));
  ok("warning names the supported Samsungs", /Fold 7, 6, 5 or S24, S25, S26 Ultra/.test(h));
  ok("warning states the risk plainly", /at your own risk/.test(h) && /hang or crash the phone/.test(h));
  ok("warning is styled as a caution, not a footnote", /role="note"/.test(h));
  ok("guide sheet repeats it under a plain question", /Will it run on my phone\?/.test(h));
  ok("warning appears in both the section and the guide",
     (h.match(/Built for flagship, AI-enabled phones/g) || []).length >= 2);
  ok("no em-dash in the warning (app-facing text)", !/Built for flagship[^<]*\u2014/.test(h));

  // Selection surface: the picker row itself must carry the hardware flag.
  const opts = E.options();
  const apex = opts.filter((o) => o.pack === "maik-apex")[0];
  ok("picker exposes the flagship tier", !!apex);
  ok("flagship tier is badged FLAGSHIP, not OFFLINE", apex.badge === "FLAGSHIP");
  ok("flagship tier carries the warning text for the confirm step", /hang or crash/.test(apex.warn || ""));
  ok("flagship flag is exposed to the picker", apex.flagship === true);
  const mx = opts.filter((o) => o.pack === "maik-mxcore")[0];
  ok("non-flagship tiers keep the OFFLINE badge", mx.badge === "OFFLINE" && mx.flagship === false);
  ok("picker still never prints the upstream model name",
     !/MedPsy|MedGemma|Gemma|Qwen/i.test(apex.label + " " + apex.sub));
}

console.log(`\nmaik-engine: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);