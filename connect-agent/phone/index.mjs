// connect-agent/phone/index.mjs — orchestrates one phone discovery run end to end.
// See connect-agent/phone/CONTRACT.md. Loaded via dynamic import() in the app WebView.
import { createCollector, PHASE_AGENT_READ } from '../discovery.mjs';
import { explorePhone, probePhone } from './explore.mjs';

function browserOf(plugin) {
  if (plugin && plugin.platform === 'android') return 'phone-android';
  if (plugin && plugin.platform === 'ios') return 'phone-ios';
  return 'phone-ios';
}

/**
 * runPhoneDiscovery({ plugin, api, session, deployment, startUrl, onProgress }) -> final view
 *
 * `plugin` is a client from createPluginClient() (or anything implementing the same six methods).
 * `api` is `{ plan, progress, discovery, evidence }` — async functions the UI implements over fetch
 * against the broker routes in CONTRACT.md. `onProgress({phase, steps, events})` is an optional
 * caller callback for UI feedback; it never throws into the discovery loop.
 */
export async function runPhoneDiscovery({ plugin, api, session, deployment, startUrl, onProgress, caps } = {}) {
  if (!plugin) throw new Error('runPhoneDiscovery requires a plugin client');
  if (!api || typeof api.plan !== 'function' || typeof api.discovery !== 'function' || typeof api.evidence !== 'function') {
    throw new Error('runPhoneDiscovery requires api.plan, api.discovery and api.evidence');
  }
  const origins = deployment?.origins;
  if (!Array.isArray(origins) || origins.length === 0) throw new Error('runPhoneDiscovery requires deployment.origins');
  const url = startUrl || origins[0];

  const notify = (phase, extra = {}) => { try { onProgress?.({ phase, ...extra }); } catch { /* never let UI feedback break discovery */ } };

  const collector = createCollector({ client: plugin, tabId: 'phone', userId: session?.id || 'phone-user', phase: PHASE_AGENT_READ, ownsTab: false, ownsSession: false });
  await collector.start();
  notify('DISCOVERING', { steps: 0, events: 0 });
  if (typeof api.progress === 'function') await api.progress({ stage: 'DISCOVERING' }).catch(() => {});

  const planner = async (args) => api.plan(args);

  // Native enforcement belt: agent mode blocks any main-frame navigation outside `origins` and shows
  // the doctor a Stop banner. This is the primary gate (see local-plugins/capacitor-connect-browser/
  // README.md "Deterministic native policy"); the in-page observer config is never enforce:true here.
  if (typeof plugin.setMode === 'function') await plugin.setMode({ mode: 'agent', origins }).catch(() => {});

  const explored = await explorePhone({
    client: plugin, collector, planner, startUrl: url, caps,
  });
  notify('EXPLORED', { steps: explored.steps.length, events: collector.raw().length });

  const nativeRequests = typeof plugin.drainRequests === 'function' ? (await plugin.drainRequests().catch(() => null))?.requests : undefined;

  // collect() freezes its result, so the phone browser tag is set by building a fresh object rather
  // than mutating it in place.
  const spec = { ...collector.collect({ allowedOrigins: origins }), browser: browserOf(plugin) };

  const discoveryResult = await api.discovery({ spec, steps: explored.steps, nativeRequests });
  notify('COMPILING', { steps: explored.steps.length, events: collector.raw().length });

  const probeList = Array.isArray(discoveryResult?.probes) ? discoveryResult.probes : [];
  const probed = await probePhone({ client: plugin, probes: probeList });
  notify('VALIDATING', { steps: explored.steps.length, events: collector.raw().length });

  const evidenceResult = await api.evidence({ probes: probed.probes });
  notify('DONE', { steps: explored.steps.length, events: collector.raw().length });

  await collector.detach().catch(() => {});

  return Object.freeze({
    spec, steps: explored.steps, stopReason: explored.stopReason, visitedUrls: explored.visitedUrls,
    candidateVersionId: discoveryResult?.candidateVersionId, manifest: discoveryResult?.manifest,
    probes: probed.probes, capabilities: evidenceResult?.capabilities, evidenceHash: evidenceResult?.evidenceHash,
    state: evidenceResult?.state,
  });
}
