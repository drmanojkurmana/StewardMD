// connect-agent/phone/index.mjs — orchestrates one phone discovery run end to end.
// See connect-agent/phone/CONTRACT.md. Loaded via dynamic import() in the app WebView.
import { createCollector, PHASE_AGENT_READ } from '../discovery.mjs';
import { explorePhone, probePhone } from './explore.mjs';
import { deepCrawlClinical, captureView, enrichView, GUIDE_SOURCES, TARGET_HINTS } from './deep-crawl.mjs';
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

/** Doctor-facing wording for each gap the auto crawl could not fill. No em-dash (app-facing text). */
export const GAP_PROMPTS = Object.freeze({
  worklist: 'I could not find your patient worklist. Tap where it lives, then tap Done.',
  patient: 'I could not find the patient details (name, age, sex). Tap where they live, then tap Done.',
  notes: 'I could not find the clinical or assessment notes. Tap where they live, then tap Done.',
  medications: 'I could not find the medication chart. Tap where it lives, then tap Done.',
  labs: 'I could not find the lab results. Tap where they live, then tap Done.',
  radiology: 'I could not find the radiology reports. Tap where they live, then tap Done.',
  discharge: 'I could not find the discharge summary. Tap where it lives, then tap Done.',
  history: 'I could not find the visit history. Tap where it lives, then tap Done.',
});
const MAX_ASKS = 4;

/* MANUAL MODE: the doctor drives, the agent reads over their shoulder. One ask per resource, in the
 * order a ward round reads a chart. Each ask has "Not in my EMR" in the browser header (the native
 * guideSkip event) so a hospital without, say, radiology never blocks the run. */
export const ASK_ORDER = Object.freeze(['worklist', 'patient', 'notes', 'labs', 'radiology', 'medications', 'discharge', 'history']);
export const ASK_PROMPTS = Object.freeze({
  worklist: 'Show me the list of all your patients (the whole ward or your own list), then tap Done.',
  patient: 'Open one patient and show me their details (name, age, sex, ward, bed), then tap Done.',
  notes: 'Show me the assessment or clinical notes for that patient, then tap Done.',
  labs: 'Show me the lab results for that patient, then tap Done.',
  radiology: 'Show me the radiology reports for that patient, then tap Done.',
  medications: 'Show me the medication chart or prescription for that patient, then tap Done.',
  discharge: 'Show me the discharge summary for that patient, then tap Done.',
  history: 'Show me the visit history for that patient, then tap Done.',
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
export async function runPhoneDiscovery({ plugin, api, session, deployment, startUrl, onProgress, askDoctor, stopSignal, caps, mode = 'auto', brain = null, compact = false } = {}) {
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
  const stopped = () => typeof stopSignal === 'function' && !!stopSignal();
  /* `compact` (auto mode with the game on screen): the hospital browser takes the top half only while
   * the agent drives, so the sheet's progress and game stay visible; a guided ask is always full size. */
  const setMode = async (m, banner) => { if (typeof plugin.setMode === 'function') await plugin.setMode({ mode: m, banner, origins, compact: !!compact && m === 'agent' }).catch(() => {}); };

  const collector = createCollector({ client: plugin, tabId: 'phone', userId: session?.id || 'phone-user', phase: PHASE_AGENT_READ, ownsTab: false, ownsSession: false });
  await collector.start();
  /* THE FIELD NAMES BEHIND EACH CLICK. The collector drains the page observer (method, path, query
   * keys, request field names, response type; never values). captureView asks for what arrived since
   * the last capture so a view's endpoints carry the names the runtime needs to replay a POST. */
  let observerMark = 0;
  if (typeof plugin.drainObserverEvents !== 'function') {
    plugin.drainObserverEvents = async () => { const all = collector.raw(); const events = all.slice(observerMark); observerMark = all.length; return { events }; };
  }
  notify('DISCOVERING', { steps: 0, events: 0 });
  if (typeof api.progress === 'function') await api.progress({ stage: 'DISCOVERING' }).catch(() => {});

  const planner = async (args) => api.plan(args);

  let observedViews = [];
  let found = [];
  const asked = [];
  const missing = [];
  const warnings = [];
  const looking = () => TARGET_HINTS.filter((h) => !found.includes(h));

  /* One guided ask: hand the screen to the doctor, wait for Done / Not in my EMR / Skip, capture what
   * they landed on. Shared by both modes. Returns 'captured' | 'missing' | 'skipped' | 'unreadable'. */
  const askOne = async (gap, text, step, total) => {
    notify('ASKING', { gap, text, step, total, found, looking: looking() });
    await setMode('guide', text);
    await plugin.evaluate({ expression: GUIDE_SOURCES.arm }).catch(() => {});
    await plugin.evaluate({ expression: GUIDE_SOURCES.armGuide }).catch(() => {});
    let answer = null;
    try { answer = await askDoctor({ gap, text, step, total, mode }); } catch { answer = null; }
    asked.push(gap);
    if (answer && answer.missing) { missing.push(gap); return 'missing'; }
    if (!answer || !answer.done) return 'skipped';
    let guidedPath = [];
    try { guidedPath = JSON.parse((await plugin.evaluate({ expression: GUIDE_SOURCES.guidePath }))?.result || '[]'); } catch { guidedPath = []; }
    let view = null;
    try { view = await captureView({ client: plugin, resourceHint: gap, blockOnly: gap === 'patient' }); } catch { view = null; }
    if (!view || !view.rowsSelector) {
      try { view = await captureView({ client: plugin, resourceHint: gap }); } catch { view = null; }
    }
    if (!view || !view.rowsSelector) { warnings.push('could not read a table or report block on the ' + gap + ' screen'); return 'unreadable'; }
    view.guided = true;
    if (Array.isArray(guidedPath) && guidedPath.length) view.guidedPath = guidedPath.slice(0, 20).map((s) => String(s).slice(0, 120));
    /* The brain checks the doctor's answer against the structure and maps the columns; the doctor's
     * word on WHAT the screen is stands, a strong disagreement is only reported. */
    const verdict = await enrichView(view, brain, { ask: gap, keepHint: true });
    if (verdict && verdict.resource && verdict.resource !== 'none' && verdict.resource !== gap && Number(verdict.confidence) >= 0.8) {
      warnings.push('the ' + gap + ' screen looks like ' + verdict.resource + ' to the model');
    }
    observedViews.push(view);
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
    explored = await explorePhone({ client: plugin, collector, planner, startUrl: url, caps, stopSignal });
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
        client: plugin, caps, stopSignal, brain,
        onProgress: (p) => notify('CRAWLING', { steps: explored.steps.length, events: collector.raw().length, opening: p.opening, found: p.found, looking: p.looking }),
      });
      observedViews = crawl.observedViews || [];
      found = crawl.found || [];
      crawlStop = crawl.stopReason;
      if (observedViews.length) notify('CRAWLED', { views: observedViews.length, found, looking: looking() });
    } catch { /* html discovery is best-effort; the JSON path still stands */ }
  }

  // Ask the doctor: in manual mode for every resource, in auto mode for what the crawl could not find.
  // The screen is handed back (guide mode: banner with the question, Done and Not in my EMR, NO touch
  // overlay); where they tap is recorded and the resulting view captured.
  if (typeof askDoctor === 'function' && crawlStop !== 'login-required' && crawlStop !== 'session-expired-or-shell') {
    const gaps = manual ? ASK_ORDER.slice() : looking().slice(0, MAX_ASKS);
    const prompts = manual ? ASK_PROMPTS : GAP_PROMPTS;
    for (let i = 0; i < gaps.length; i += 1) {
      if (stopped()) break;
      await askOne(gaps[i], prompts[gaps[i]], i + 1, gaps.length);
    }
    await setMode('agent');
  }

  const discoveryResult = await api.discovery({ spec, steps: explored.steps, nativeRequests, observedViews });
  notify('COMPILING', { steps: explored.steps.length, events: collector.raw().length, found });

  const probeList = Array.isArray(discoveryResult?.probes) ? discoveryResult.probes : [];
  const probed = await probePhone({ client: plugin, probes: probeList });
  notify('VALIDATING', { steps: explored.steps.length, events: collector.raw().length, found });

  const evidenceResult = await api.evidence({ probes: probed.probes });
  notify('DONE', { steps: explored.steps.length, events: collector.raw().length, found });

  await collector.detach().catch(() => {});

  return Object.freeze({
    spec, steps: explored.steps, stopReason: explored.stopReason, visitedUrls: explored.visitedUrls,
    candidateVersionId: discoveryResult?.candidateVersionId, manifest: discoveryResult?.manifest,
    observedViews, found, asked, missing, warnings, crawlStop, mode,
    probes: probed.probes, capabilities: evidenceResult?.capabilities, evidenceHash: evidenceResult?.evidenceHash,
    state: evidenceResult?.state,
  });
}
