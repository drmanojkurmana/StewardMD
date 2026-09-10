// connect-agent/manifest/interpret.mjs — restricted interpreter for a validated adapter manifest.
//
// It can do exactly one thing: issue the declared GET/HEAD reads of the declared operations, through an
// injected transport, within declared limits. There is no eval, no `new Function`, no dynamic import, no
// template string compiled from manifest text, and nothing model-generated is ever executed. The manifest
// is data that is *read*, never code that is *run*.
//
// Transport contract (wired by the broker/runner track):
//   exec.request({ method, url, headers? }) -> { status, headers?, body?, bodyText? }
// The interpreter never sets a cookie or an authorization header itself; the session lives in the runner's
// browser context and the transport attaches it.
import { assertValidManifest, templatePlaceholders } from './schema.mjs';

export class ManifestPolicyError extends Error { constructor(m) { super(m); this.name = 'ManifestPolicyError'; } }
export class ResourceLimitError extends Error { constructor(m) { super(m); this.name = 'ResourceLimitError'; } }
export class SessionExpiredError extends Error { constructor(m) { super(m); this.name = 'SessionExpiredError'; } }

export const DEFAULT_LIMITS = Object.freeze({ maxCalls: 8, maxBytes: 512 * 1024, maxMs: 15000 });

const PLACEHOLDER_PATTERN = {
  id: /^[A-Za-z0-9._~-]{1,64}$/,
  int: /^[0-9]{1,12}$/,
  token: /^[A-Za-z0-9._~-]{1,128}$/,
};

function findOperation(manifest, operationType) {
  const op = manifest.operations.find((o) => o.type === operationType);
  if (!op) throw new ManifestPolicyError(`operation '${operationType}' is not declared by this manifest`);
  return op;
}

/**
 * Build the one URL an operation is allowed to request. Everything not derived from the manifest is
 * refused here: an unknown placeholder, a badly typed id, a query key outside the allowlist, or any
 * attempt to change host/scheme/path through a parameter value.
 */
export function buildUrl(manifest, op, { params = {}, query = {} } = {}) {
  const originEntry = manifest.origins.find((o) => o.id === op.originId);
  if (!originEntry) throw new ManifestPolicyError(`operation '${op.type}' references an unapproved origin`);

  const needed = templatePlaceholders(op.pathTemplate);
  for (const key of Object.keys(params)) if (!needed.includes(key)) throw new ManifestPolicyError(`parameter '${key}' is not a placeholder of '${op.type}'`);
  let path = op.pathTemplate;
  for (const name of needed) {
    const spec = op.placeholders[name];
    const raw = params[name];
    if (raw === undefined || raw === null) throw new ManifestPolicyError(`missing value for placeholder '${name}'`);
    const value = String(raw);
    const pattern = PLACEHOLDER_PATTERN[spec.type];
    if (!pattern || !pattern.test(value)) throw new ManifestPolicyError(`value for '${name}' is not a valid ${spec.type}`);
    path = path.replace(`{${name}}`, encodeURIComponent(value));
  }

  const url = new URL(originEntry.origin);
  url.pathname = path;
  for (const key of Object.keys(query).sort()) {
    if (!op.allowedQueryKeys.includes(key)) throw new ManifestPolicyError(`query key '${key}' is not allowed for '${op.type}'`);
    url.searchParams.set(key, String(query[key]));
  }
  // Belt and braces: whatever the substitutions did, the result must still sit on the approved origin.
  if (url.origin !== new URL(originEntry.origin).origin) throw new ManifestPolicyError('constructed URL left the approved origin');
  return url.toString();
}

function bodyTextOf(response) {
  if (typeof response?.bodyText === 'string') return response.bodyText;
  if (typeof response?.body === 'string') return response.body;
  if (response?.body && typeof response.body === 'object') return JSON.stringify(response.body);
  return '';
}

function isExpired(op, response) {
  if (op.sessionExpiry.statusCodes.includes(Number(response?.status))) return true;
  const location = response?.headers?.location || response?.headers?.Location || '';
  const patterns = op.sessionExpiry.redirectPatterns || [];
  return Boolean(location) && patterns.some((p) => String(location).includes(p));
}

/**
 * executeOperation({ manifest, operationType, exec, params, query, limits })
 *   -> { operationType, url, pages, itemCount, partial, bytes, calls, warnings }
 *
 * `partial: true` means the operation stopped early (a page failed, or a limit was reached). A partial
 * result is reported as partial; it is never presented as a complete read.
 */
export async function executeOperation({
  manifest, operationType, exec, params = {}, query = {}, limits = {}, now = () => Date.now(), validate = true,
}) {
  if (validate) assertValidManifest(manifest);
  if (!exec || typeof exec.request !== 'function') throw new ManifestPolicyError('exec.request is required');
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const op = findOperation(manifest, operationType);
  const started = now();
  const state = { calls: 0, bytes: 0 };
  const warnings = [];
  const pages = [];
  let partial = false;
  let itemCount = 0;

  const pageCount = op.pagination.style === 'none' ? 1 : op.pagination.maxPages;
  const startAt = op.pagination.startAt ?? (op.pagination.style === 'offset' ? 0 : 1);

  let firstUrl = null;
  for (let i = 0; i < pageCount; i += 1) {
    if (state.calls >= lim.maxCalls) { partial = true; warnings.push(`call limit (${lim.maxCalls}) reached`); break; }
    if (now() - started > lim.maxMs) { partial = true; warnings.push(`time limit (${lim.maxMs}ms) reached`); break; }

    const pageQuery = { ...query };
    if (op.pagination.style === 'page') pageQuery[op.pagination.param] = startAt + i;
    if (op.pagination.style === 'offset') pageQuery[op.pagination.param] = startAt + i * (op.pagination.pageSize || 50);
    if (op.pagination.sizeParam && op.pagination.pageSize) pageQuery[op.pagination.sizeParam] = op.pagination.pageSize;

    const url = buildUrl(manifest, op, { params, query: pageQuery });
    if (!firstUrl) firstUrl = url;
    state.calls += 1;
    let response;
    try {
      response = await exec.request({ method: op.method, url });
    } catch (err) {
      partial = true;
      warnings.push(`page ${i + 1} request failed: ${String(err && err.message ? err.message : err).slice(0, 120)}`);
      break;
    }
    if (isExpired(op, response)) throw new SessionExpiredError(`session expired during '${operationType}'`);
    const status = Number(response?.status);
    if (!(status >= 200 && status < 300)) {
      partial = true;
      warnings.push(`page ${i + 1} returned status ${status}`);
      break;
    }
    const text = bodyTextOf(response);
    state.bytes += Buffer.byteLength(text, 'utf8');
    if (state.bytes > lim.maxBytes) throw new ResourceLimitError(`byte limit (${lim.maxBytes}) exceeded during '${operationType}'`);

    let payload;
    try { payload = text ? JSON.parse(text, (k, v) => (k === '__proto__' ? undefined : v)) : null; } catch {
      partial = true;
      warnings.push(`page ${i + 1} was not valid JSON`);
      break;
    }
    const items = selectItems(op, payload);
    pages.push({ index: i, url, payload, items });
    itemCount += items.length;
    if (itemCount >= op.pagination.maxItems) { partial = true; warnings.push(`item limit (${op.pagination.maxItems}) reached`); break; }
    if (op.pagination.style !== 'none' && items.length === 0) break; // exhausted
  }

  if (now() - started > lim.maxMs) { partial = true; warnings.push(`time limit (${lim.maxMs}ms) reached`); }
  return { operationType, url: firstUrl, pages, itemCount, partial, bytes: state.bytes, calls: state.calls, warnings };
}

/** Resolve the declared items selector. A single-object resource yields a one-element list. */
export function selectItems(op, payload) {
  const sel = op.mapping.itemsSelector;
  let node = payload;
  if (sel) {
    for (const seg of sel.split('.')) {
      if (!node || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, seg)) return [];
      node = node[seg];
    }
  }
  if (op.mapping.resource === 'patient') return node && typeof node === 'object' && !Array.isArray(node) ? [node] : [];
  return Array.isArray(node) ? node : [];
}
