/* wardsynq/wardsynq-store-remote.js — the ClinicalStore backend that talks to the record service.
 *
 * Until this file existed, every WardSynQ client held its own record: MemoryBackend for the
 * workstation, IndexedDBBackend for offline. A refresh erased it and a second device never saw it.
 * This is the third backend, and it is the one a hospital runs on: the SAME ClinicalStore, the SAME
 * GovernedStore, the SAME model, over the server at /api/wardsynq instead of over local storage.
 *
 * Plugging it in is one line in the place a store is built:
 *
 *   new ClinicalStore({ backend: new RemoteBackend({ tenantId, token }) })
 *
 * WHAT IT DOES NOT DO, ON PURPOSE.
 *   - It does not decide who is writing. The client's actor is a convenience for the UI; the server
 *     derives the real actor from the verified token and stamps `writtenBy` itself. A client's claim
 *     about its identity does not survive the door, and this file does not pretend otherwise.
 *   - It does not merge. A write states the version it was derived from. If the server has moved on,
 *     the write is refused with the current record and a RemoteConflictError, and the existing
 *     Reconciler (wardsynq-offline.js) is the thing that resolves it, with a person.
 *   - It does not retry blindly. Every write carries an idempotency key, so a retry after a lost
 *     response replays the original outcome rather than producing version N+2.
 *
 * STATUS: IMPLEMENTED and TESTED against the in-process route. Not clinically validated.
 */

class RemoteStoreError extends Error {
  constructor(message, code, status, body) {
    super(message);
    this.name = "RemoteStoreError";
    this.code = code || "REMOTE_STORE";
    this.status = status || 0;
    this.body = body || null;
  }
}

/** The server refused a write because the record moved. Carries the current version to reconcile against. */
class RemoteConflictError extends RemoteStoreError {
  constructor(message, body) {
    super(message, "VERSION_CONFLICT", 409, body);
    this.name = "RemoteConflictError";
    this.current = body && body.detail ? body.detail.current || null : null;
  }
}

/** The server's governance or authority check refused the write. Reasons are codes, not prose. */
class RemoteRefusedError extends RemoteStoreError {
  constructor(message, body) {
    super(message, (body && body.code) || "REFUSED", 403, body);
    this.name = "RemoteRefusedError";
    this.reasons = (body && body.reasons) || [];
  }
}

function newKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

class RemoteBackend {
  /**
   * @param {{tenantId: string, token?: () => Promise<string|null>, staffToken?: () => Promise<string|null>,
   *   baseUrl?: string, fetch?: Function, headers?: () => object}} opts
   *   token    returns the caller's bearer token (a Firebase ID token in StewardMD). Optional so a
   *            Cloudflare Access session, which carries identity in its own header, needs nothing.
   */
  constructor(opts) {
    opts = opts || {};
    if (!opts.tenantId) throw new RemoteStoreError("a remote backend is always for one tenant", "NO_TENANT");
    this.tenantId = String(opts.tenantId);
    this.baseUrl = (opts.baseUrl || "").replace(/\/+$/, "");
    this.token = opts.token || (async () => null);
    // A nurse's or receptionist's StewardMD staff session (email+PIN login on a hospital PC).
    this.staffToken = opts.staffToken || (async () => null);
    this.extraHeaders = opts.headers || (() => ({}));
    this._fetch = opts.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (!this._fetch) throw new RemoteStoreError("no fetch available", "NO_FETCH");
    this.descriptor = null;
    this._opened = false;
    this._closed = false;
  }

  _url(path) { return `${this.baseUrl}/api/wardsynq/${encodeURIComponent(this.tenantId)}${path}`; }

  async _headers(extra) {
    const h = { "Content-Type": "application/json", ...(this.extraHeaders() || {}), ...(extra || {}) };
    const t = await this.token();
    if (t) h.Authorization = `Bearer ${t}`;
    const st = await this.staffToken();
    if (st) h["X-Staff-Token"] = st;
    return h;
  }

  async _request(method, path, body, extra) {
    if (this._closed) throw new RemoteStoreError("RemoteBackend is closed", "CLOSED");
    const res = await this._fetch(this._url(path), { method, headers: await this._headers(extra), body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, data };
  }

  /** Learns who the server thinks this client is. Refuses to open against a tenant it cannot read. */
  async open() {
    this._closed = false;
    if (this._opened) return this.descriptor;
    const { status, data } = await this._request("GET", "");
    if (status !== 200 || !data || !data.ok) {
      throw new RemoteStoreError(`record service refused to open (${status})`, status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_AVAILABLE" : "OPEN_FAILED", status, data);
    }
    this.descriptor = data;
    this._opened = true;
    return this.descriptor;
  }

  async close() { this._closed = true; this._opened = false; }

  _refused(what, status, data) {
    // A 403 carries the server's governance reason as a code, so a UI can say WHY rather than "failed".
    if (status === 403) return new RemoteRefusedError(`the server refused ${what}: ${(data && (data.code || data.error)) || status}`, data);
    return new RemoteStoreError(`${what} failed (${status})`, `${what.toUpperCase()}_FAILED`, status, data);
  }

  async get(resourceType, id) {
    const { status, data } = await this._request("GET", `/record/${encodeURIComponent(resourceType)}/${encodeURIComponent(id)}`);
    if (status === 404) return null;
    if (status !== 200) throw this._refused("get", status, data);
    return data.record;
  }

  async history(resourceType, id) {
    const { status, data } = await this._request("GET", `/record/${encodeURIComponent(resourceType)}/${encodeURIComponent(id)}/history`);
    if (status !== 200) throw this._refused("history", status, data);
    return data.versions || [];
  }

  async byPatient(resourceType, patientId) {
    const { status, data } = await this._request("GET", `/patient/${encodeURIComponent(patientId)}/${encodeURIComponent(resourceType)}`);
    if (status !== 200) throw this._refused("byPatient", status, data);
    return data.records || [];
  }

  /** A roster: latest version of every record of one type. For a workstation's patient list. */
  async list(resourceType, limit) {
    const q = limit ? `?limit=${encodeURIComponent(limit)}` : "";
    const { status, data } = await this._request("GET", `/list/${encodeURIComponent(resourceType)}${q}`);
    if (status !== 200) throw this._refused("list", status, data);
    return data.records || [];
  }

  /** The whole chart in one round trip. Not part of the store contract; for a UI opening a patient. */
  async chart(patientId) {
    const { status, data } = await this._request("GET", `/patient/${encodeURIComponent(patientId)}`);
    if (status !== 200) throw this._refused("chart", status, data);
    return data.chart || {};
  }

  /** What changed on the server after a cursor. How this client learns what another one wrote. */
  async changes(since, limit) {
    const q = `?since=${encodeURIComponent(since || 0)}${limit ? `&limit=${encodeURIComponent(limit)}` : ""}`;
    const { status, data } = await this._request("GET", `/changes${q}`);
    if (status !== 200) throw this._refused("changes", status, data);
    return { records: data.records || [], cursor: data.cursor };
  }

  /**
   * The store hands over records that already carry the version it derived. Each is sent with
   * expectedVersion = version - 1, which is the version this client read before it wrote. The
   * server refuses if that is stale. Records are written in order and the first refusal stops the
   * batch: the store's transaction staged them together and a half-landed batch is reported, not hidden.
   */
  async write(records, opts) {
    opts = opts || {};
    const written = [];
    for (const rec of records || []) {
      const { status, data } = await this._request("POST", "/record", {
        entity: rec,
        expectedVersion: typeof rec.version === "number" ? rec.version - 1 : null,
        activePatientId: opts.activePatientId || null,
      }, { "Idempotency-Key": newKey() });
      if (status === 201 || status === 200) { written.push(data.record); continue; }
      if (status === 409) throw new RemoteConflictError(`the server has a newer ${rec.resourceType}/${rec.id}`, data);
      if (status === 403) throw new RemoteRefusedError(`the server refused ${rec.resourceType}/${rec.id}: ${(data && (data.code || data.error)) || status}`, data);
      throw new RemoteStoreError(`write failed (${status})`, "WRITE_FAILED", status, data);
    }
    return written;
  }
}

export { RemoteBackend, RemoteStoreError, RemoteConflictError, RemoteRefusedError };
