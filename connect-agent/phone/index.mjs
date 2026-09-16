// connect-agent/phone/index.mjs — orchestrates one phone discovery run end to end.
// See connect-agent/phone/CONTRACT.md. Loaded via dynamic import() in the app WebView.
import { createCollector, PHASE_AGENT_READ } from '../discovery.mjs';
import { guidedPrompt, REASSURANCE } from './onboard.mjs';
import { explorePhone, probePhone } from './explore.mjs';
import { deepCrawlClinical, captureView, enrichView, exploreDetailOf, GUIDE_SOURCES, TARGET_HINTS } from './deep-crawl.mjs';
import { verifyViews } from './verify.mjs';
import { createProofBook, navToReplayEntries, INJECT_REPLAY_SRC } from './prove.mjs';
import { PATIENT_KEY, VISIT_KEY } from './adapter-runtime.mjs';
/* THE CLIENT THE CRAWL ACTUALLY NEEDS, re-exported from the one module the app imports.
 * connect-agent-onboarding.js calls engine.createPluginClient(); it lived only in plugin-client.mjs
 * and was never re-exported here, so that call returned undefined, the RAW Capacitor plugin was
 * handed to runPhoneDiscovery, and discovery sat at zero pages forever after a successful sign-in:
 * the raw plugin has no evaluate/snapshot/click. Found on the device 2026-09-12. */
export { createPluginClient } from './plugin-client.mjs';
// NB: HTML operation inference (infer-html.mjs) runs SERVER-SIDE in the broker's discovery route, not
// on the phone. The phone only crawls and sends the observed view STRUCTURE; the server infers the
// adapter from it (same split as compile/validate). Keeping the manifest modules off the phone bundle.

function browserOf(plugin) {
  if (plugin && plugin.platform === 'android') return 'phone-android';
  if (plugin && plugin.platform === 'ios') return 'phone-ios';
  return 'phone-ios';
}

/* Doctor-facing wording for each gap the auto crawl could not fill. No em-dash (app-facing text).
 * Every fallback names what to tap and ends with the onboard reassurance (onboard.mjs): the
 * doctor shows the screen once and the AI learns the layout from it. */
export const GAP_PROMPTS = Object.freeze({
  worklist: 'I could not find your patient worklist. Open it and tap inside it so it turns green, then tap Done. ' + REASSURANCE,
  patient: 'I could not find the patient details (name, age, sex). Open them and tap inside so they turn green, then tap Done. ' + REASSURANCE,
  notes: 'I could not find the clinical or assessment notes. Open them and tap inside so they turn green, then tap Done. ' + REASSURANCE,
  medications: 'I could not find the medication chart. Open it and tap inside it so it turns green, then tap Done. ' + REASSURANCE,
  labs: 'I could not find the lab results. Open them and tap inside so they turn green, then tap Done. ' + REASSURANCE,
  radiology: 'I could not find the radiology reports. Open them and tap inside so they turn green, then tap Done. ' + REASSURANCE,
  discharge: 'I could not find the discharge summary. Open it and tap inside it so it turns green, then tap Done. ' + REASSURANCE,
  history: 'I could not find the visit history. Open it and tap inside it so it turns green, then tap Done. ' + REASSURANCE,
});
const MAX_ASKS = 4;
const GAP_NAMES = Object.freeze({ worklist: 'patient list', patient: 'patient details', notes: 'clinical notes', labs: 'lab results', radiology: 'radiology reports', medications: 'medication chart', discharge: 'discharge summary', history: 'visit history' });
const LOGIN_FORM_PRESENT = "(function(){return document.querySelector('input[type=\"password\"]')?'1':'0'})()";

/* MANUAL MODE: the doctor drives, the agent reads over their shoulder. One ask per resource, in the
 * order a ward round reads a chart. Each ask has "Not in my EMR" in the browser header (the native
 * guideSkip event) so a hospital without, say, radiology never blocks the run. */
export const ASK_ORDER = Object.freeze(['worklist', 'patient', 'notes', 'labs', 'radiology', 'medications', 'discharge', 'history']);

/* A SECOND LOOK MAY ONLY ADD. "Look again" used to assign the new walk's views straight over the old
 * list, so a walk that came back with less silently destroyed the screens the doctor had just
 * demonstrated - on GHIS a run with labs and radiology proven came back with both "absent", because
 * neither is reachable by the walk alone (owner's iPhone, 2026-09-16). Keyed on resource + path so a
 * genuinely better capture of the SAME view still replaces nothing and simply is not duplicated. */
/* Same resource+path proven twice with different patient keys (GHIS ver_b27ed367, 2026-09-17): the
 * crawl's Administration > Lab reports click proved OTLabPrintsSecretary/?id=undefined (a page-side JS
 * bug -- paramsOf recorded the id as {constant:'undefined'}) while the doctor's own guided walk proved
 * the same path with id traced to the worklist row. Keying merge on resource+path alone kept whichever
 * arrived first, which on that run was the crawl's wrong constant-id view -- every patient's labs read
 * would have replayed id=undefined. A view whose data call's patient/visit key is traced to a row now
 * beats one whose key is {constant}/{empty}/{unmapped}; when neither or both are traced, first still wins. */
const tracedPatientKey = (v) => (Array.isArray(v && v.endpoints) ? v.endpoints : []).some((e) => e && e.role === 'data' && e.params &&
  Object.keys(e.params).some((k) => (PATIENT_KEY.test(k) || VISIT_KEY.test(k)) && e.params[k] && e.params[k].from));
export function mergeObservedViews(existing, incoming) {
  const keyOf = (v) => String((v && (v.resourceHint || v.resource)) || '') + '|' + String((v && v.pathTemplate) || '');
  const merged = Array.isArray(existing) ? existing.slice() : [];
  const indexOf = new Map(merged.map((v, i) => [keyOf(v), i]));
  for (const v of (Array.isArray(incoming) ? incoming : [])) {
    const k = keyOf(v);
    if (!indexOf.has(k)) { indexOf.set(k, merged.length); merged.push(v); continue; }
    const i = indexOf.get(k);
    if (!tracedPatientKey(merged[i]) && tracedPatientKey(v)) merged[i] = v;
  }
  return merged;
}
/* MANUAL MODE: the doctor drives using the universal 6-tap script (onboard.mjs: the six steps
 * plus the three follow-up screens). One plain sentence per ask, each ending with the reassurance
 * that the AI learns the layout automatically. The sentences themselves live in onboard.mjs so
 * both modes and the sheet share one script. */
export const ASK_PROMPTS = Object.freeze({
  worklist: guidedPrompt('worklist'),
  patient: guidedPrompt('patient'),
  notes: guidedPrompt('notes'),
  labs: guidedPrompt('labs'),
  radiology: guidedPrompt('radiology'),
  medications: guidedPrompt('medications'),
  discharge: guidedPrompt('discharge'),
  history: guidedPrompt('history'),
});

/**
 * runPhoneDiscovery({ plugin, api, session, deployment, startUrl, onProgress, askDoctor, stopSignal, caps, mode, brain })
 * -> final view
 *
 * `plugin` is a client from createPluginClient() (or anything implementing the same six methods).
 * `api` is `{ plan, progress, discovery, evidence }` — async functions the UI implements over fetch
 * against the broker routes in CONTRACT.md. `onProgress({phase, ...})` is an optional caller callback
 * for UI feedback; it never throws into the discovery loop. `askDoctor({ gap, text, step, total })`
 * (optional) hands the screen to the doctor for one gap and resolves `{ done: true }` when they tap
 * Done, `{ done: false, missing: true }` when they tap "Not in my EMR", or a falsy `done` to skip; the
 * plugin is switched to `guide` mode around it. `stopSignal()` true ends the crawl and the guided step
 * early. `mode` is 'auto' (default: explore, crawl, then ask for what is missing) or 'manual' (ask for
 * every resource in ASK_ORDER, no autonomous clicking). `compact` asks the browser for its top-half
 * layout whenever the agent drives. `brain` (optional) is `{ classify, mapColumns,
 * next }`: async advisors answering from screen STRUCTURE only (see functions/_connect/agent/brain.js);
 * any of them may reject or return null and the deterministic rules stand.
 */
export async function runPhoneDiscovery({ plugin, api, session, deployment, startUrl, onProgress, askDoctor, stopSignal, finishSignal, skipSignal, redoSignal, caps, mode = 'auto', brain = null, compact = false } = {}) {
  if (!plugin) throw new Error('runPhoneDiscovery requires a plugin client');
  if (!api || typeof api.plan !== 'function' || typeof api.discovery !== 'function' || typeof api.evidence !== 'function') {
    throw new Error('runPhoneDiscovery requires api.plan, api.discovery and api.evidence');
  }
  const origins = deployment?.origins;
  if (!Array.isArray(origins) || origins.length === 0) throw new Error('runPhoneDiscovery requires deployment.origins');
  const manual = mode === 'manual';
  /* START WHERE THE DOCTOR ALREADY IS, NOT AT THE ADDRESS THEY TYPED.
   *
   * `startUrl` is the hospital address entered on the first screen, which for a real EMR is the
   * LOGIN page (GHIS: gimsrlogin.gitam.edu). Navigating back to it after sign-in returns the doctor
   * to the login form - on GHIS it ends the session outright - so the crawl explored a logged-out
   * page, found nothing, and the doctor watched "Pages visited 0" while being signed out. Found on
   * the device 2026-09-12. The post-login landing page is where the worklist lives, so the browser's
   * own current URL wins whenever it is inside an allowed origin. */
  let url = startUrl || origins[0];
  try {
    const cur = typeof plugin.currentUrl === 'function' ? await plugin.currentUrl() : null;
    const curUrl = typeof cur === 'string' ? cur : cur?.url;
    if (curUrl && origins.some((o) => typeof curUrl === 'string' && curUrl.indexOf(o) === 0)) url = curUrl;
  } catch { /* no current URL: fall back to the typed address */ }

  const notify = (phase, extra = {}) => { try { onProgress?.({ phase, mode, ...extra }); } catch { /* never let UI feedback break discovery */ } };
  /* SAVE WHAT YOU HAVE. A run that stalls late (a verify call that never returns) used to leave the
   * doctor a frozen bar and one button that THREW THE WHOLE CRAWL AWAY, so a run that had already
   * learned the EMR looked identical to one that had failed (owner, iPhone, 2026-09-15). `finishSignal`
   * is the doctor saying "stop looking, keep what you found": every stop check below honours it, so the
   * crawl, the verification and the guided asks all break out and the run falls THROUGH to the
   * discovery/evidence save with whatever was learned. Distinct from `stopSignal`, which is the
   * destructive Stop and tears the session down. */
  const finishing = () => typeof finishSignal === 'function' && !!finishSignal();
  const stopped = () => (typeof stopSignal === 'function' && !!stopSignal()) || finishing();
  /* The doctor's two mid-run controls, as counts rather than flags so one tap means one step:
   * `skipAt` abandons the step being worked on, `redoAt` asks for another walk of the hospital. */
  const skipAt = () => (typeof skipSignal === 'function' ? Number(skipSignal()) || 0 : 0);
  const redoAt = () => (typeof redoSignal === 'function' ? Number(redoSignal()) || 0 : 0);
  let redoMark = redoAt();
  /* `compact` (auto mode with the game on screen): the hospital browser takes the top half only while
   * the agent drives, so the sheet's progress and game stay visible; a guided ask is always full size. */
  const setMode = async (m, banner) => { if (typeof plugin.setMode === 'function') await plugin.setMode({ mode: m, banner, origins, compact: !!compact && m === 'agent' }).catch(() => {}); };

  const collector = createCollector({ client: plugin, tabId: 'phone', userId: session?.id || 'phone-user', phase: PHASE_AGENT_READ, ownsTab: false, ownsSession: false });
  await collector.start();
  /* THE FIELD NAMES BEHIND EACH CLICK. The collector drains the page observer (method, path, query
   * keys, request field names, response type; never values). captureView asks for what arrived since
   * the last capture so a view's endpoints carry the names the runtime needs to replay a POST. */
  let observerMark = 0;
  /* The real client is frozen (plugin-client.mjs), so the drain is added on a wrapper, never on it. */
  if (typeof plugin.drainObserverEvents !== 'function') {
    const base = plugin;
    // Drain the page observer first: raw() alone is whatever the collector last pulled, which on the
    // phone lost every POST field name (live GHIS run, 2026-09-13).
    const drainObserverEvents = async () => { try { await collector.ensureInstalled(); } catch { /* keep what we have */ } const all = collector.raw(); const events = all.slice(observerMark); observerMark = all.length; return { events }; };
    plugin = Object.assign(Object.create(base), { drainObserverEvents });
  }
  notify('DISCOVERING', { steps: 0, events: 0 });
  if (typeof api.progress === 'function') await api.progress({ stage: 'DISCOVERING' }).catch(() => {});

  const planner = async (args) => api.plan(args);
  /* EXPLORE -> OBSERVE -> GEMINI -> EXECUTE -> VERIFY -> LEARN: every captured screen's data call is
   * proven against what the screen shows before it is kept (prove.mjs). */
  const book = createProofBook({ brain });

  let observedViews = [];
  let found = [];
  const asked = [];
  const missing = [];
  const warnings = [];
  const looking = () => TARGET_HINTS.filter((h) => !found.includes(h));

  /* One guided ask: hand the screen to the doctor, wait for Done / Not in my EMR / Skip, capture what
   * they landed on. Shared by both modes. Returns 'captured' | 'missing' | 'skipped' | 'unreadable'. */
  const askOne = async (gap, text, step, total) => {
    /* ASK UNTIL IT IS PROVEN (owner, 2026-09-13). The doctor opens the screen and taps Done; every
     * request fired between the ask and Done is replayed and must carry what the screen shows, and
     * Gemini must agree the reply is that resource. When none does, the doctor is asked again (up to
     * three times) instead of saving a guess. */
    let prompt = text;
    let last = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      notify('ASKING', { gap, text: prompt, step, total, found, looking: looking(), attempt: attempt + 1 });
      await setMode('guide', prompt);
      await plugin.evaluate({ expression: GUIDE_SOURCES.arm }).catch(() => {});
      await plugin.evaluate({ expression: GUIDE_SOURCES.armGuide }).catch(() => {});
      let answer = null;
      try { answer = await askDoctor({ gap, text: prompt, step, total, mode }); } catch { answer = null; }
      /* SIGNED OUT DURING THE ASK: the screen the doctor tapped Done on is the login page. Ask them to
       * sign in again and show the same screen, up to twice, instead of capturing a login form. */
      for (let tries = 0; tries < 2 && answer && answer.done; tries += 1) {
        let onLogin = false;
        try { onLogin = /1/.test(String((await plugin.evaluate({ expression: LOGIN_FORM_PRESENT }))?.result)); } catch { onLogin = false; }
        if (!onLogin) break;
        const again = 'You were signed out. Sign in again, then ' + text.charAt(0).toLowerCase() + text.slice(1);
        notify('ASKING', { gap, text: again, step, total, found, looking: looking(), signedOut: true });
        await setMode('guide', again);
        try { answer = await askDoctor({ gap, text: again, step, total, mode }); } catch { answer = null; }
      }
      if (attempt === 0) asked.push(gap);
      if (answer && answer.missing) { missing.push(gap); return 'missing'; }
      if (!answer || !answer.done) break;
      let guidedPath = [];
      try { guidedPath = JSON.parse((await plugin.evaluate({ expression: GUIDE_SOURCES.guidePath }))?.result || '[]'); } catch { guidedPath = []; }
      let view = null;
      try { view = await captureView({ client: plugin, resourceHint: gap, blockOnly: gap === 'patient' }); } catch { view = null; }
      if (!view || !view.rowsSelector) {
        try { view = await captureView({ client: plugin, resourceHint: gap }); } catch { view = null; }
      }
      if (!view || !view.rowsSelector) {
        await plugin.evaluate({ expression: GUIDE_SOURCES.clearPoint }).catch(() => {});
        prompt = 'I could not read a table on that screen. Open the ' + GAP_NAMES[gap] + ' for a patient, tap inside the list so it turns green, then tap Done.';
        continue;
      }
      view.guided = true;
      if (Array.isArray(guidedPath) && guidedPath.length) view.guidedPath = guidedPath.slice(0, 20).map((s) => String(s).slice(0, 120));
      const verdict = await enrichView(view, brain, { ask: gap, keepHint: true });
      if (typeof plugin.drainRequests === 'function') {
        try {
          const drained = await plugin.drainRequests();
          let pageOrigin = null; try { const cur = await plugin.currentUrl(); pageOrigin = new URL(typeof cur === 'string' ? cur : cur && cur.url).origin; } catch { pageOrigin = null; }
          const nav = navToReplayEntries(drained, { pageOrigin, allowedOrigins: origins });
          if (nav.length) await plugin.evaluate({ expression: '(' + INJECT_REPLAY_SRC + ')(' + JSON.stringify(nav) + ')' }).catch(() => {});
        } catch { /* best effort */ }
      }
      await book.prove({ client: plugin, view, label: 'the doctor showed the ' + gap + ' screen' });
      /* ONE LEVEL DEEPER ON WHAT THE DOCTOR SHOWED. The crawl opens a row of every list it finds, but a
       * screen that only arrived because the doctor demonstrated it never got that treatment, so its
       * detail call stayed unknown and the completeness gate reported "<kind>-detail: absent" forever.
       * GHIS radiology is the case that forces this: its module is not linked from the patient chart,
       * so the crawl can never see it and the ask is the ONLY way radiology-detail can be learned. */
      await plugin.evaluate({ expression: GUIDE_SOURCES.clearPoint }).catch(() => {});
      if (view.proof && view.proof.status === 'proven') {
        try {
          const deeper = await exploreDetailOf({ client: plugin, view, book, origins, waitMs: caps?.verifyWaitMs ?? 1200 });
          if (deeper) { observedViews.push(deeper); notify('CAPTURED', { gap: gap + '-detail', step, total, found, looking: looking() }); }
        } catch { /* the list itself still counts; a detail we could not open is not a failed ask */ }
      }
      if (verdict && verdict.resource && verdict.resource !== 'none' && verdict.resource !== gap && Number(verdict.confidence) >= 0.8) {
        warnings.push('the ' + gap + ' screen looks like ' + verdict.resource + ' to the model');
      }
      last = view;
      if (view.proof && view.proof.status === 'proven') break;
      prompt = 'None of the requests from that screen returned the ' + GAP_NAMES[gap] + '. Open the ' + GAP_NAMES[gap] + ' for a patient again (the list itself, not a menu), tap inside it so it turns green, then tap Done.';
    }
    if (!last) { warnings.push('could not read a table or report block on the ' + gap + ' screen'); return 'unreadable'; }
    if (!(last.proof && last.proof.status === 'proven')) warnings.push('no request was proven for the ' + gap + ' screen; it will be read from its page');
    observedViews.push(last);
    found = [...found, gap];
    notify('CAPTURED', { gap, step, total, found, looking: looking() });
    return 'captured';
  };

  let explored = { steps: [], stopReason: manual ? 'manual' : null, visitedUrls: [] };
  let crawlStop = null;
  if (!manual) {
    // Native enforcement belt: agent mode blocks any main-frame navigation outside `origins` and shows
    // the doctor a Stop banner. This is the primary gate (see local-plugins/capacitor-connect-browser/
    // README.md "Deterministic native policy"); the in-page observer config is never enforce:true here.
    // The touch overlay is armed ONLY while the agent clicks autonomously (here and in the crawl), never
    // while waiting for the doctor.
    await setMode('agent');
    explored = await explorePhone({ client: plugin, collector, planner, startUrl: url, caps, stopSignal: stopped });
    notify('EXPLORED', { steps: explored.steps.length, events: collector.raw().length });
  }

  const nativeRequests = typeof plugin.drainRequests === 'function' ? (await plugin.drainRequests().catch(() => null))?.requests : undefined;

  // collect() freezes its result, so the phone browser tag is set by building a fresh object rather
  // than mutating it in place.
  const spec = { ...collector.collect({ allowedOrigins: origins }), browser: browserOf(plugin) };

  if (!manual) {
    // Server-rendered EMRs (e.g. GHIS) hand back HTML, not JSON, so the JSON observer above sees little.
    // Walk the patient's clinical sub-views for their table / report-block STRUCTURE (labels only, no
    // values) and infer responseFormat:'html' operations from it. Never breaks the run: any failure
    // yields no html ops.
    try {
      const crawl = await deepCrawlClinical({
        client: plugin, caps: Object.assign({ exploreDetails: true, origins }, caps || {}), stopSignal: stopped, skipSignal: skipAt, brain, book,
        onProgress: (p) => notify('CRAWLING', { steps: explored.steps.length, events: collector.raw().length, opening: p.opening, found: p.found, looking: p.looking }),
      });
      observedViews = crawl.observedViews || [];
      found = crawl.found || [];
      crawlStop = crawl.stopReason;
      if (observedViews.length) notify('CRAWLED', { views: observedViews.length, found, looking: looking() });
    } catch { /* html discovery is best-effort; the JSON path still stands */ }
  }

  /* PROVE THE MAP BEFORE ASKING FOR HELP OR APPROVAL. Every view with a discovered call is replayed
   * for real patients from the ward list, inside this session, and the brain judges what came back.
   * A view that fails joins the guided asks below, so the doctor is asked only for what the agent
   * could not prove on its own. */
  let verification = { patients: [], checks: [], failed: [] };
  const runVerification = async () => {
    if (!observedViews.length || crawlStop === 'login-required' || crawlStop === 'session-expired-or-shell') return;
    /* The doctor asked to keep what was found: skip proving it rather than sit in a verify call that
     * is not returning. The views are still saved; they are saved UNPROVEN, and say so. */
    if (finishing()) { warnings.push('saved at your request before every screen was double-checked'); return; }
    notify('VERIFYING', { found, looking: looking(), checking: 'worklist' });
    try {
      /* VERIFICATION MAY NEVER COST THE RUN. Proving endpoints is worth doing and worth abandoning:
       * on a real hospital one slow screen (GHIS medications) never came back, and because the save
       * happens AFTER this, nothing was ever written - every job of 2026-09-15 ended with phone_state
       * 0 bytes and no adapter. verifyViews records each view's result on the view as it goes, so
       * whatever finished inside the budget is kept; the rest stay unproven and are read from their
       * page. Abandoning the wait does not cancel the in-flight call, and does not need to: the run
       * moves on to write the adapter. */
      /* 150s proved far too tight on a real hospital: GHIS has nine resources to check and the cap fired
       * before a single endpoint was proven, so the run saved an adapter that could read nothing
       * (owner's iPhone, 2026-09-15). The cap exists to stop a hang, not to rush the proving. */
      const budgetMs = caps?.verifyBudgetMs ?? 420000;
      let timer = null;
      const budget = new Promise((resolve) => { timer = setTimeout(() => resolve('__timeout__'), budgetMs); });
      const outcome = await Promise.race([
        verifyViews({ plugin, origin: origins[0], views: observedViews, brain, book, stopped, skipAt, waitMs: caps?.verifyWaitMs ?? 6000, notify: (phase, extra) => notify(phase, { found, looking: looking(), ...extra }) }),
        budget,
      ]);
      if (timer) clearTimeout(timer);
      if (outcome === '__timeout__') {
        warnings.push('checking the endpoints took too long, so what was not checked will be read from its page');
        return;
      }
      verification = outcome;
    } catch (e) {
      if (e && e.name === 'NotSignedIn') { crawlStop = 'login-required'; warnings.push(e.message); return; }
      warnings.push('verification could not run: ' + String((e && e.message) || e).slice(0, 120));
    }
  };
  /* NOT ON THE EMR YET. Sign-in is detected when the password box goes, which on a single-sign-on
   * hospital is the app chooser, not the EMR: the crawl then read a login or shell page, found nothing,
   * and an empty draft was filed (owner, Pixel, 2026-09-13). Ask the doctor to open their patient list
   * and crawl again, up to twice. */
  for (let tries = 0; !manual && tries < 2 && (crawlStop === 'login-required' || crawlStop === 'session-expired-or-shell') && typeof askDoctor === 'function' && !stopped(); tries += 1) {
    const text = 'Open your patient list in the hospital (for example the Doctor module), then tap Done.';
    notify('ASKING', { gap: 'worklist', text, found, looking: looking() });
    await setMode('guide', text);
    let a = null;
    try { a = await askDoctor({ gap: 'worklist', text, mode }); } catch { a = null; }
    if (!a || !a.done) break;
    await setMode('agent');
    try {
      const again = await deepCrawlClinical({
        client: plugin, caps: Object.assign({ exploreDetails: true, origins }, caps || {}), stopSignal: stopped, skipSignal: skipAt, brain, book,
        onProgress: (p) => notify('CRAWLING', { steps: explored.steps.length, events: collector.raw().length, opening: p.opening, found: p.found, looking: p.looking }),
      });
      observedViews = again.observedViews || [];
      found = again.found || [];
      crawlStop = again.stopReason;
    } catch { break; }
  }
  if (!manual) await runVerification();

  // Ask the doctor: in manual mode for every resource, in auto mode for what the crawl could not find
  // or could not prove. The screen is handed back (guide mode: banner with the question, Done and Not
  // in my EMR, NO touch overlay); where they tap is recorded and the resulting view captured.
  if (typeof askDoctor === 'function' && crawlStop !== 'login-required' && crawlStop !== 'session-expired-or-shell') {
    const unproven = verification.failed.filter((r) => r !== 'worklist' || !verification.patients.length);
    // What the agent found but could not prove comes first: the doctor's tap there is worth most.
    const gaps = manual ? ASK_ORDER.slice() : [...new Set([...unproven, ...looking()])].slice(0, MAX_ASKS + unproven.length);
    const prompts = manual ? ASK_PROMPTS : GAP_PROMPTS;
    for (let i = 0; i < gaps.length; i += 1) {
      if (stopped()) break;
      await askOne(gaps[i], prompts[gaps[i]], i + 1, gaps.length);
    }
    await setMode('agent');
  }
  // What the doctor showed (or manual mode captured) is proven the same way, once.
  if (manual || asked.length) await runVerification();

  /* LOOK AGAIN. The doctor can send the agent back over the hospital when the first walk missed
   * something (a tab that needed a moment, a screen they have since opened). Bounded to two extra
   * walks so a stuck finger cannot loop the run, and anything already found survives a walk that
   * comes back with less. */
  for (let redos = 0; redos < 2 && !manual && redoAt() > redoMark && !stopped(); redos += 1) {
    redoMark = redoAt();
    await setMode('agent');
    try {
      const again = await deepCrawlClinical({
        client: plugin, caps: Object.assign({ exploreDetails: true, origins }, caps || {}), stopSignal: stopped, skipSignal: skipAt, brain, book,
        onProgress: (p) => notify('CRAWLING', { steps: explored.steps.length, events: collector.raw().length, opening: p.opening, found: p.found, looking: p.looking }),
      });
      /* MERGE, NEVER REPLACE. "Look again" used to overwrite observedViews with whatever the new walk
       * returned, which threw away every screen the DOCTOR had just demonstrated in the guided asks:
       * on GHIS a run that had labs + radiology proven came back with both "absent" because the walk
       * cannot reach them on its own (owner's iPhone, 2026-09-16). A second look may only ADD. */
      if (Array.isArray(again.observedViews) && again.observedViews.length) {
        observedViews = mergeObservedViews(observedViews, again.observedViews);
        found = [...new Set([...(found || []), ...(again.found || [])])];
        crawlStop = again.stopReason;
      }
    } catch { break; }
    await runVerification();
  }

  // Nothing discovered is a failure with its reason, never an "adapter created".
  if (!observedViews.length) {
    await collector.detach().catch(() => {});
    throw new Error('nothing was discovered (' + (crawlStop === 'login-required' || crawlStop === 'session-expired-or-shell' ? 'the browser was not on the EMR after sign-in' : (crawlStop || 'no clinical screen found')) + ')');
  }
  /* SCRUB THE HUMAN-READABLE REASON BEFORE IT LEAVES THE PHONE. verify.mjs writes sentences like
   * "127 rows through the page"; the server's PHI gate rejects any verified.reason with a 3+ digit run
   * or an @ (it cannot tell a row count from a patient id), so a ward list of 100+ patients failed the
   * whole save with "verified reason invalid" (owner, iPhone GHIS, 2026-09-15). The count is not lost:
   * the server keeps it as the integer `rows`. Digits -> #, any address -> [email]. */
  const scrubReason = (r) => typeof r === 'string' ? r.replace(/\S+@\S+/g, '[email]').replace(/\d{3,}/g, '#').slice(0, 200) : r;
  for (const v of observedViews) { if (v && v.verified && typeof v.verified.reason === 'string') v.verified.reason = scrubReason(v.verified.reason); }
  /* THE SERVER REFUSES MORE THAN 40 VIEWS OUTRIGHT (cleanObservedViews, functions/api/connect/agent),
   * and mergeObservedViews only ever ADDS ("look again" may not delete a demonstrated view), so a long
   * run with several redo walks can grow past that cap. api.discovery is not wrapped in a try below, so
   * an unhandled throw there loses the ENTIRE run. Trim to 40 first: proven views are worth the most,
   * so they are kept ahead of everything else, and each group otherwise keeps its original order. */
  if (observedViews.length > 40) {
    const proven = observedViews.filter((v) => v && v.proof && v.proof.status === 'proven');
    const rest = observedViews.filter((v) => !(v && v.proof && v.proof.status === 'proven'));
    observedViews = proven.concat(rest).slice(0, 40);
  }
  const discoveryResult = await api.discovery({ spec, steps: explored.steps, nativeRequests, observedViews, proofs: book.trace });
  notify('COMPILING', { steps: explored.steps.length, events: collector.raw().length, found });

  const probeList = Array.isArray(discoveryResult?.probes) ? discoveryResult.probes : [];
  const probed = await probePhone({ client: plugin, probes: probeList });
  notify('VALIDATING', { steps: explored.steps.length, events: collector.raw().length, found });

  const evidenceResult = await api.evidence({ probes: probed.probes });
  notify('DONE', { steps: explored.steps.length, events: collector.raw().length, found });

  await collector.detach().catch(() => {});

  return Object.freeze({
    spec, steps: explored.steps, stopReason: explored.stopReason, visitedUrls: explored.visitedUrls,
    // The version row is created by the evidence call, not discovery: without this the phone's Approve
    // posted /versions/undefined/approve and said "Could not approve" (live GHIS run, 2026-09-13).
    candidateVersionId: evidenceResult?.candidateVersionId || discoveryResult?.candidateVersionId, manifest: discoveryResult?.manifest,
    observedViews, found, asked, missing, warnings, crawlStop, mode,
    verification: { patients: verification.patients.length, checks: verification.checks, failed: verification.failed },
    proofs: book.trace,
    probes: probed.probes, capabilities: evidenceResult?.capabilities, evidenceHash: evidenceResult?.evidenceHash,
    state: evidenceResult?.state,
  });
}
