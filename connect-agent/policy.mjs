/**
 * StewardMD Connect - deterministic action policy.
 *
 * Pure data plus pure functions. A decision is a function of (policy, phase, method, url) ONLY.
 * Nothing observed inside the EMR page is ever an input: page text, DOM attributes, JSON bodies and
 * "instructions" embedded in an EMR cannot widen the allowlist, add a template, change the phase or
 * change which tools exist. Callers pass a policy built from server-side configuration.
 *
 * Two phases:
 *   clinician-login  the doctor is driving. Navigation (GET/HEAD) anywhere inside an approved origin
 *                    is allowed and form POSTs to approved login endpoint templates are allowed, so
 *                    a real login keeps working. Every other method is blocked.
 *   agent-read       the agent is driving. Only GET/HEAD to an approved endpoint template on an
 *                    approved origin, plus navigation to an approved navigation template. Everything
 *                    else is blocked: mutations, exports, GraphQL POSTs, cross-origin requests and
 *                    any endpoint with no template. There is no "probably safe" branch - unknown
 *                    endpoint semantics require a known template, so the default is deny.
 */

export const PHASE_CLINICIAN_LOGIN = 'clinician-login';
export const PHASE_AGENT_READ = 'agent-read';
const KNOWN_PHASES = new Set([PHASE_CLINICIAN_LOGIN, PHASE_AGENT_READ]);

const READ_METHODS = new Set(['GET', 'HEAD']);
const LOGIN_METHODS = new Set(['GET', 'HEAD', 'POST']);

// Typed placeholders. A template segment is either a literal or one of these; nothing else.
const PLACEHOLDER_TYPES = {
  id: '[A-Za-z0-9._~-]{1,128}',
  int: '\\d{1,18}',
  uuid: '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
};

function escapeLiteral(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Compile a path template such as `/api/patients/{id}/medications` to an anchored regex source. */
export function compileTemplatePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('template path must start with /');
  if (/[?#]/.test(path)) throw new Error('template path must not contain a query or fragment');
  const source = path.split('/').map((segment, index) => {
    if (index === 0) return '';
    const match = /^\{([a-z]+)\}$/.exec(segment);
    if (!match) return escapeLiteral(segment);
    const type = PLACEHOLDER_TYPES[match[1]];
    if (!type) throw new Error(`unknown placeholder type {${match[1]}}`);
    return type;
  }).join('/');
  return `^${source}$`;
}

export function normalizeOrigin(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('origin must be http(s)');
  return url.origin;
}

function compileEndpoints(list, allowedMethods, origins, label) {
  return (list || []).map((entry) => {
    const method = String(entry?.method || 'GET').toUpperCase();
    if (!allowedMethods.has(method)) throw new Error(`${label} template method ${method} is not permitted`);
    const scoped = entry?.origins ? entry.origins.map(normalizeOrigin) : origins;
    for (const origin of scoped) {
      if (!origins.includes(origin)) throw new Error(`${label} template origin ${origin} is not approved`);
    }
    return Object.freeze({ method, re: compileTemplatePath(entry.path), origins: Object.freeze([...scoped]) });
  });
}

function matches(rules, method, origin, pathname) {
  return rules.some((rule) => rule.method === method && rule.origins.includes(origin) && new RegExp(rule.re).test(pathname));
}

/**
 * @param {object} spec
 * @param {string[]} spec.approvedOrigins  exact origins; matching is exact-origin, never suffix.
 * @param {{method?:string,path:string,origins?:string[]}[]} spec.readEndpoints   GET/HEAD templates the agent may call.
 * @param {{method?:string,path:string,origins?:string[]}[]} spec.loginEndpoints  templates the clinician's login form may POST to.
 * @param {string[]} spec.navigationPaths  document-level path templates the agent may navigate to.
 */
export function createPolicy({ approvedOrigins = [], readEndpoints = [], loginEndpoints = [], navigationPaths = [] } = {}) {
  const origins = [...new Set(approvedOrigins.map(normalizeOrigin))];
  if (!origins.length) throw new Error('at least one approved origin is required');
  const read = compileEndpoints(readEndpoints, READ_METHODS, origins, 'read');
  const login = compileEndpoints(loginEndpoints, LOGIN_METHODS, origins, 'login');
  const navigation = (navigationPaths || []).map((path) => Object.freeze({
    method: 'GET', re: compileTemplatePath(path), origins: Object.freeze([...origins]),
  }));
  return Object.freeze({
    origins: Object.freeze(origins),
    read: Object.freeze(read),
    login: Object.freeze(login),
    navigation: Object.freeze(navigation),
  });
}

function parseUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { return { reason: 'unparsable-url' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { reason: 'scheme-not-allowed' };
  if (url.username || url.password) return { reason: 'userinfo-in-url' };
  return { url };
}

function assertPhase(phase) {
  if (!KNOWN_PHASES.has(phase)) throw new Error(`unknown policy phase: ${String(phase)}`);
}

const DENY = (reason) => Object.freeze({ allowed: false, reason });
const ALLOW = (reason) => Object.freeze({ allowed: true, reason });

/** Decide a single network request. Fail closed. */
export function decideRequest(policy, phase, { method, url } = {}) {
  assertPhase(phase);
  const parsed = parseUrl(url);
  if (parsed.reason) return DENY(parsed.reason);
  const target = parsed.url;
  const verb = String(method || 'GET').toUpperCase();
  if (!policy.origins.includes(target.origin)) return DENY('origin-not-approved');

  if (phase === PHASE_CLINICIAN_LOGIN) {
    if (READ_METHODS.has(verb)) return ALLOW('login-phase-navigation');
    if (verb !== 'POST') return DENY('method-not-allowed');
    return matches(policy.login, 'POST', target.origin, target.pathname)
      ? ALLOW('login-template') : DENY('no-login-template-match');
  }

  if (!READ_METHODS.has(verb)) return DENY('method-not-allowed');
  return matches(policy.read, verb, target.origin, target.pathname)
    ? ALLOW('read-template') : DENY('no-template-match');
}

/** Decide a document-level navigation (address-bar level, not a subresource). */
export function decideNavigation(policy, phase, { url } = {}) {
  assertPhase(phase);
  const parsed = parseUrl(url);
  if (parsed.reason) return DENY(parsed.reason);
  const target = parsed.url;
  if (!policy.origins.includes(target.origin)) return DENY('origin-not-approved');
  if (phase === PHASE_CLINICIAN_LOGIN) return ALLOW('login-phase-navigation');
  if (matches(policy.navigation, 'GET', target.origin, target.pathname)) return ALLOW('navigation-template');
  if (matches(policy.read, 'GET', target.origin, target.pathname)) return ALLOW('read-template');
  return DENY('no-template-match');
}

/**
 * Decide an agent action. `evaluate` is never exposed to the agent as an action. `click` is honestly
 * reported as opaque: the transport gives no target URL before the click happens, so the policy
 * cannot decide it statically. Callers must bound clicks (step and time caps) and rely on the
 * in-page guard plus post-hoc observation for the actual network effect.
 */
export function decideAction(policy, phase, action = {}) {
  assertPhase(phase);
  switch (action.type) {
    case 'request': return decideRequest(policy, phase, action);
    case 'navigate': return decideNavigation(policy, phase, action);
    case 'snapshot': return ALLOW('read-only-observation');
    case 'wait': return ALLOW('read-only-observation');
    case 'click': return Object.freeze({ allowed: true, reason: 'click-opaque-bounded', opaque: true });
    default: return DENY('unknown-action');
  }
}

/**
 * Serializable configuration for the in-page guard: same templates, same origins, one source of
 * truth. `enforce` is only true in the agent phase - during clinician login the guard observes and
 * never blocks, so a real login is never broken by it.
 */
export function guardConfig(policy, phase, extra = {}) {
  assertPhase(phase);
  const enforce = phase === PHASE_AGENT_READ;
  const allow = enforce
    ? policy.read.flatMap((rule) => rule.origins.map((origin) => ({ method: rule.method, re: rule.re, origin })))
    : [];
  return { phase, enforce, origins: [...policy.origins], allow, ...extra };
}
