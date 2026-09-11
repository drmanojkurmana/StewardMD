// connect-agent/phone/index.mjs — orchestrates one phone discovery run end to end.
// See connect-agent/phone/CONTRACT.md. Loaded via dynamic import() in the app WebView.
import { createCollector, PHASE_AGENT_READ } from '../discovery.mjs';
import { explorePhone, probePhone } from './explore.mjs';
import { deepCrawlClinical, captureView, GUIDE_SOURCES, TARGET_HINTS } from './deep-crawl.mjs';
// NB: HTML operation inference (infer-html.mjs) runs SERVER-SIDE in the broker's discovery route, not
// on the phone. The phone only crawls and sends the observed view STRUCTURE; the server infers the
// adapter from it (same split as compile/validate). Keeping the manifest modules off the phone bundle.

function browserOf(plugin) {
  if (plugin && plugin.platform === 'android') return 'phone-android';
  if (plugin && plugin.platform === 'ios') return 'phone-ios';
  return 'phone-ios';
}

/** Doctor-facing wording for each gap the crawl could not fill. No em-dash (app-facing text). */
export const GAP_PROMPTS = Object.freeze({
  worklist: 'I could not find your patient worklist. Tap where it lives, then tap Done.',
  patient: 'I could not find the patient details (name, age, sex). Tap where they live, then tap Done.',
  medications: 'I could not find the medication chart. Tap where it lives, then tap Done.',
  labs: 'I could not find the lab results. Tap where they live, then tap Done.',
  radiology: 'I could not find the radiology reports. Tap where they live, then tap Done.',
  discharge: 'I could not find the discharge summary. Tap where it lives, then tap Done.',
  history: 'I could not find the visit history. Tap where it lives, then tap Done.',
});
const MAX_ASKS = 4;

/**
 * runPhoneDiscovery({ plugin, api, session, deployment, startUrl, onProgress, askDoctor, stopSignal, caps })
 * -> final view
 *
 * `plugin` is a client from createPluginClient() (or anything implementing the same six methods).
 * `api` is `{ plan, progress, discovery, evidence }` — async functions the UI implements over fetch
 * against the broker routes in CONTRACT.md. `onProgress({phase, ...})` is an optional caller callback
 * for UI feedback; it never throws into the discovery loop. `askDoctor({ gap, text })` (optional)
 * hands the screen to the doctor for one gap and resolves `{ done: true }` when they tap Done (or a
 * falsy `done` to skip); the plugin is switched to `guide` mode around it. `stopSignal()` true ends
 * the crawl and the guided step early.
 */
export async function runPhoneDiscovery({ plugin, api, session, deployment, startUrl, onProgress, askDoctor, stopSignal, caps } = {}) {
  if (!plugin) throw new Error('runPhoneDiscovery requires a plugin client');
  if (!api || typeof api.plan !== 'function' || typeof api.discovery !== 'function' || typeof api.evidence !== 'function') {
    throw new Error('runPhoneDiscovery requires api.plan, api.discovery and api.evidence');
  }
  const origins = deployment?.origins;
  if (!Array.isArray(origins) || origins.length === 0) throw new Error('runPhoneDiscovery requires deployment.origins');
  const url = startUrl || origins[0];

  const notify = (phase, extra = {}) => { try { onProgress?.({ phase, ...extra }); } catch { /* never let UI feedback break discovery */ } };
  const stopped = () => typeof stopSignal === 'function' && !!stopSignal();
  const setMode = async (mode, banner) => { if (typeof plugin.setMode === 'function') await plugin.setMode({ mode, banner, origins }).catch(() => {}); };

  const collector = createCollector({ client: plugin, tabId: 'phone', userId: session?.id || 'phone-user', phase: PHASE_AGENT_READ, ownsTab: false, ownsSession: false });
  await collector.start();
  notify('DISCOVERING', { steps: 0, events: 0 });
  if (typeof api.progress === 'function') await api.progress({ stage: 'DISCOVERING' }).catch(() => {});

  const planner = async (args) => api.plan(args);

  // Native enforcement belt: agent mode blocks any main-frame navigation outside `origins` and shows
  // the doctor a Stop banner. This is the primary gate (see local-plugins/capacitor-connect-browser/
  // README.md "Deterministic native policy"); the in-page observer config is never enforce:true here.
  // The touch overlay is armed ONLY while the agent clicks autonomously (here and in the crawl), never
  // while waiting for the doctor.
  await setMode('agent');

  const explored = await explorePhone({
    client: plugin, collector, planner, startUrl: url, caps, stopSignal,
  });
  notify('EXPLORED', { steps: explored.steps.length, events: collector.raw().length });

  const nativeRequests = typeof plugin.drainRequests === 'function' ? (await plugin.drainRequests().catch(() => null))?.requests : undefined;

  // collect() freezes its result, so the phone browser tag is set by building a fresh object rather
  // than mutating it in place.
  const spec = { ...collector.collect({ allowedOrigins: origins }), browser: browserOf(plugin) };

  // Server-rendered EMRs (e.g. GHIS) hand back HTML, not JSON, so the JSON observer above sees little.
  // Walk the patient's clinical sub-views for their table / report-block STRUCTURE (labels only, no
  // values) and infer responseFormat:'html' operations from it. Never breaks the run: any failure
  // yields no html ops.
  let observedViews = [];
  let found = [];
  let crawlStop = null;
  try {
    const crawl = await deepCrawlClinical({
      client: plugin, caps, stopSignal,
      onProgress: (p) => notify('CRAWLING', { steps: explored.steps.length, events: collector.raw().length, opening: p.opening, found: p.found, looking: p.looking }),
    });
    observedViews = crawl.observedViews || [];
    found = crawl.found || [];
    crawlStop = crawl.stopReason;
    if (observedViews.length) notify('CRAWLED', { views: observedViews.length, found, looking: TARGET_HINTS.filter((h) => !found.includes(h)) });
  } catch { /* html discovery is best-effort; the JSON path still stands */ }

  // Ask the doctor for what the crawl could not find: hand the screen back (guide mode: banner with the
  // question, Done button, NO touch overlay), record where they tap, capture the resulting view.
  const asked = [];
  if (typeof askDoctor === 'function' && crawlStop !== 'login-required' && crawlStop !== 'session-expired-or-shell') {
    const gaps = TARGET_HINTS.filter((h) => !found.includes(h)).slice(0, MAX_ASKS);
    for (const gap of gaps) {
      if (stopped()) break;
      const text = GAP_PROMPTS[gap];
      notify('ASKING', { gap, text, found, looking: TARGET_HINTS.filter((h) => !found.includes(h)) });
      await setMode('guide', text);
      await plugin.evaluate({ expression: GUIDE_SOURCES.arm }).catch(() => {});
      await plugin.evaluate({ expression: GUIDE_SOURCES.armGuide }).catch(() => {});
      let answer = null;
      try { answer = await askDoctor({ gap, text }); } catch { answer = null; }
      asked.push(gap);
      if (!answer || !answer.done) continue;
      let guidedPath = [];
      try { guidedPath = JSON.parse((await plugin.evaluate({ expression: GUIDE_SOURCES.guidePath }))?.result || '[]'); } catch { guidedPath = []; }
      let view = null;
      try { view = await captureView({ client: plugin, resourceHint: gap }); } catch { view = null; }
      if (view && view.rowsSelector) {
        view.guided = true;
        if (Array.isArray(guidedPath) && guidedPath.length) view.guidedPath = guidedPath.slice(0, 20).map((s) => String(s).slice(0, 120));
        observedViews.push(view);
        found = [...found, gap];
      }
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
    observedViews, found, asked, crawlStop,
    probes: probed.probes, capabilities: evidenceResult?.capabilities, evidenceHash: evidenceResult?.evidenceHash,
    state: evidenceResult?.state,
  });
}
