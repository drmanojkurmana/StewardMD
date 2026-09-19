// Shared fake Camofox client for connect-agent unit tests. Test-harness only.
// It answers the two expression shapes discovery.mjs sends: the observer install (returns the
// install receipt the real main-world script returns) and the drain (returns a batch once, then
// empty, mirroring the real `events.splice(0, n)`).

export function fakeCamofoxClient({ events = [], drainMode = 'once', snapshots = [] } = {}) {
  const calls = [];
  let drains = 0;
  let snapshotIndex = 0;
  const client = {
    calls,
    async createTab(x) { calls.push(['createTab', x]); return { tabId: 'tab-1' }; },
    async evaluate(x) {
      calls.push(['evaluate', x]);
      const expression = String(x.expression);
      if (expression.startsWith('mw:JSON.stringify(window.__SMD_CONNECT_OBSERVER__')) {
        drains += 1;
        if (drainMode === 'gone-then-fresh' && drains === 1) return { result: 'null' };
        if (drains === 1 || (drainMode === 'gone-then-fresh' && drains === 2)) return { result: JSON.stringify(events) };
        return { result: '[]' };
      }
      if (expression.startsWith('mw:(function SMD_CONNECT_OBSERVER')) {
        return { result: JSON.stringify({ installed: true, fresh: true, installId: `install-${calls.length}` }) };
      }
      if (expression === 'mw:location.href') return { result: 'https://emr.example/worklist' };
      return { result: '' };
    },
    async wait(x) { calls.push(['wait', x]); },
    async snapshot(x) { calls.push(['snapshot', x]); return { snapshot: snapshots[Math.min(snapshotIndex++, snapshots.length - 1)] ?? '' }; },
    async click(x) { calls.push(['click', x]); },
    async closeTab(x) { calls.push(['closeTab', x]); },
  };
  return client;
}
