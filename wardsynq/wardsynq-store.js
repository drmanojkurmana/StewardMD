/* wardsynq/wardsynq-store.js - WardSynQ P0: append-only clinical store.
 *
 * Persistence layer for WardSynQ clinical data models. Provides an append-only,
 * bi-temporal-ready record store where entities are never overwritten. Every write
 * increments an integer version field and preserves full history.
 *
 * Exports ClinicalStore and two swappable backends: MemoryBackend for in-memory
 * execution and Node testing, and IndexedDBBackend for browser and offline-first
 * PWA persistence.
 *
 * node --test test/wardsynq-store.test.mjs
 */

function deepClone(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

class MemoryBackend {
  constructor() {
    /** @type {Map<string, Map<string, Array<any>>>} resourceType -> id -> records */
    this._stores = new Map();
    this._opened = false;
    this._closed = false;
  }

  async open() {
    this._closed = false;
    this._opened = true;
  }

  async close() {
    this._closed = true;
    this._opened = false;
  }

  async get(resourceType, id) {
    if (this._closed) {
      throw new Error("MemoryBackend is closed");
    }
    const store = this._stores.get(resourceType);
    if (!store) return null;
    const versions = store.get(id);
    if (!versions || versions.length === 0) return null;
    return deepClone(versions[versions.length - 1]);
  }

  async history(resourceType, id) {
    if (this._closed) {
      throw new Error("MemoryBackend is closed");
    }
    const store = this._stores.get(resourceType);
    if (!store) return [];
    const versions = store.get(id);
    if (!versions || versions.length === 0) return [];
    return versions.map(deepClone);
  }

  async byPatient(resourceType, patientId) {
    if (this._closed) {
      throw new Error("MemoryBackend is closed");
    }
    const store = this._stores.get(resourceType);
    if (!store) return [];
    const results = [];
    for (const versions of store.values()) {
      if (!versions || versions.length === 0) continue;
      const latest = versions[versions.length - 1];
      const matches =
        latest.patientId === patientId ||
        (latest.resourceType === "Patient" &&
          (latest.patientId === patientId || latest.id === patientId));
      if (matches) {
        results.push(deepClone(latest));
      }
    }
    return results;
  }

  async write(records) {
    if (this._closed) {
      throw new Error("MemoryBackend is closed");
    }
    for (const record of records) {
      let store = this._stores.get(record.resourceType);
      if (!store) {
        store = new Map();
        this._stores.set(record.resourceType, store);
      }
      let versions = store.get(record.id);
      if (!versions) {
        versions = [];
        store.set(record.id, versions);
      }
      versions.push(deepClone(record));
    }
  }
}

class IndexedDBBackend {
  constructor(opts = {}) {
    this.dbName = opts.dbName || "wardsynq-store";
    this.dbVersion = opts.version || 1;
    this.resourceTypes = Array.isArray(opts.resourceTypes)
      ? [...opts.resourceTypes]
      : [
          "Patient",
          "Encounter",
          "Condition",
          "AllergyIntolerance",
          "Observation",
          "MedicationOrder",
          "MedicationAdministration",
          "ServiceRequest",
          "DiagnosticReport",
          "CarePlan",
          "ClinicalNote",
        ];
    this.db = null;
    this._opened = false;
    this._closed = false;
  }

  _getIdb() {
    const idb =
      typeof globalThis !== "undefined" && globalThis.indexedDB
        ? globalThis.indexedDB
        : typeof window !== "undefined"
          ? window.indexedDB
          : undefined;
    if (!idb) {
      throw new Error("IndexedDB is not available in this environment");
    }
    return idb;
  }

  _getKeyRange() {
    const kr =
      typeof globalThis !== "undefined" && globalThis.IDBKeyRange
        ? globalThis.IDBKeyRange
        : typeof window !== "undefined"
          ? window.IDBKeyRange
          : undefined;
    if (!kr) {
      throw new Error("IDBKeyRange is not available in this environment");
    }
    return kr;
  }

  async open() {
    this._closed = false;
    if (this._opened && this.db) return;
    const idb = this._getIdb();

    return new Promise((resolve, reject) => {
      const req = idb.open(this.dbName, this.dbVersion);

      req.onupgradeneeded = () => {
        const db = req.result;
        for (const type of this.resourceTypes) {
          if (!db.objectStoreNames.contains(type)) {
            const store = db.createObjectStore(type, { keyPath: ["id", "version"] });
            store.createIndex("patientId", "patientId", { unique: false });
          }
        }
      };

      req.onsuccess = () => {
        this.db = req.result;
        this.dbVersion = this.db.version;
        this._opened = true;
        resolve();
      };

      req.onerror = () => {
        reject(req.error || new Error("Failed to open IndexedDB"));
      };

      req.onblocked = () => {
        reject(new Error("IndexedDB open request was blocked"));
      };
    });
  }

  async close() {
    this._closed = true;
    this._opened = false;
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async _ensureStore(resourceType) {
    if (!this.db) {
      await this.open();
    }
    if (this.db.objectStoreNames.contains(resourceType)) {
      return;
    }
    if (!this.resourceTypes.includes(resourceType)) {
      this.resourceTypes.push(resourceType);
    }
    const newVersion = (this.db.version || 1) + 1;
    this.db.close();
    this.db = null;
    this.dbVersion = newVersion;
    this._opened = false;
    await this.open();
  }

  async get(resourceType, id) {
    if (this._closed) throw new Error("IndexedDBBackend is closed");
    if (!this.db) await this.open();
    if (!this.db.objectStoreNames.contains(resourceType)) {
      return null;
    }

    const KeyRange = this._getKeyRange();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(resourceType, "readonly");
      const store = tx.objectStore(resourceType);
      const range = KeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
      const req = store.openCursor(range, "prev");

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          resolve(deepClone(cursor.value));
        } else {
          resolve(null);
        }
      };

      req.onerror = () => {
        reject(req.error || new Error("IndexedDB get failed"));
      };
    });
  }

  async history(resourceType, id) {
    if (this._closed) throw new Error("IndexedDBBackend is closed");
    if (!this.db) await this.open();
    if (!this.db.objectStoreNames.contains(resourceType)) {
      return [];
    }

    const KeyRange = this._getKeyRange();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(resourceType, "readonly");
      const store = tx.objectStore(resourceType);
      const range = KeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
      const req = store.getAll(range);

      req.onsuccess = () => {
        const list = req.result || [];
        resolve(list.map(deepClone));
      };

      req.onerror = () => {
        reject(req.error || new Error("IndexedDB history failed"));
      };
    });
  }

  async byPatient(resourceType, patientId) {
    if (this._closed) throw new Error("IndexedDBBackend is closed");
    if (!this.db) await this.open();
    if (!this.db.objectStoreNames.contains(resourceType)) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(resourceType, "readonly");
      const store = tx.objectStore(resourceType);
      if (!store.indexNames.contains("patientId")) {
        return resolve([]);
      }
      const index = store.index("patientId");
      const req = index.getAll(patientId);

      req.onsuccess = async () => {
        const records = req.result || [];
        const byId = new Map();
        for (const rec of records) {
          const existing = byId.get(rec.id);
          if (!existing || rec.version > existing.version) {
            byId.set(rec.id, rec);
          }
        }
        let list = Array.from(byId.values());
        if (resourceType === "Patient" && list.length === 0) {
          const direct = await this.get("Patient", patientId);
          if (direct) {
            list = [direct];
          }
        }
        resolve(list.map(deepClone));
      };

      req.onerror = () => {
        reject(req.error || new Error("IndexedDB byPatient failed"));
      };
    });
  }

  async write(records) {
    if (this._closed) throw new Error("IndexedDBBackend is closed");
    if (!this.db) await this.open();
    if (!records || records.length === 0) return;

    const types = Array.from(new Set(records.map((r) => r.resourceType)));
    for (const type of types) {
      if (!this.db.objectStoreNames.contains(type)) {
        await this._ensureStore(type);
      }
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(types, "readwrite");

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));

      for (const rec of records) {
        const store = tx.objectStore(rec.resourceType);
        store.put(deepClone(rec));
      }
    });
  }
}

class ClinicalStore {
  constructor(backendOrOpts = {}, maybeOpts = {}) {
    let backend;
    let opts;
    if (
      backendOrOpts &&
      (typeof backendOrOpts.write === "function" ||
        typeof backendOrOpts.open === "function")
    ) {
      backend = backendOrOpts;
      opts = maybeOpts || {};
    } else {
      opts = backendOrOpts || {};
      backend = opts.backend || new MemoryBackend();
    }

    this.backend = backend;
    this.bus = opts.bus || null;
    this._opened = false;
    this._closed = false;
    this._txQueue = Promise.resolve();
  }

  async open() {
    this._closed = false;
    if (this._opened) return;
    await this.backend.open();
    this._opened = true;
  }

  async close() {
    this._closed = true;
    this._opened = false;
    await this.backend.close();
  }

  async _ensureOpen() {
    if (this._closed) {
      throw new Error("ClinicalStore is closed");
    }
    if (!this._opened) {
      await this.open();
    }
  }

  async get(resourceType, id) {
    await this._ensureOpen();
    if (
      !resourceType ||
      !id ||
      typeof resourceType !== "string" ||
      typeof id !== "string"
    ) {
      return null;
    }
    const record = await this.backend.get(resourceType, id);
    return record ? deepClone(record) : null;
  }

  async history(resourceType, id) {
    await this._ensureOpen();
    if (
      !resourceType ||
      !id ||
      typeof resourceType !== "string" ||
      typeof id !== "string"
    ) {
      return [];
    }
    const records = await this.backend.history(resourceType, id);
    return (records || []).map(deepClone);
  }

  async byPatient(resourceType, patientId) {
    await this._ensureOpen();
    if (
      !resourceType ||
      !patientId ||
      typeof resourceType !== "string" ||
      typeof patientId !== "string"
    ) {
      return [];
    }
    const records = await this.backend.byPatient(resourceType, patientId);
    return (records || []).map(deepClone);
  }

  async put(entity) {
    return await this.transaction(async (tx) => {
      return await tx.put(entity);
    });
  }

  async transaction(fn) {
    if (typeof fn !== "function") {
      throw new TypeError("transaction requires a function");
    }
    await this._ensureOpen();

    const run = async () => {
      await this._ensureOpen();
      const staged = [];

      const txHandle = {
        put: async (entity) => {
          if (!entity || typeof entity !== "object") {
            throw new TypeError("entity must be an object");
          }
          if (
            typeof entity.resourceType !== "string" ||
            entity.resourceType.trim() === ""
          ) {
            throw new TypeError(
              "entity.resourceType is required and must be a non-empty string"
            );
          }
          if (typeof entity.id !== "string" || entity.id.trim() === "") {
            throw new TypeError(
              "entity.id is required and must be a non-empty string"
            );
          }

          const cloned = deepClone(entity);

          let currentVersion = 0;
          for (let i = staged.length - 1; i >= 0; i--) {
            if (
              staged[i].resourceType === cloned.resourceType &&
              staged[i].id === cloned.id
            ) {
              currentVersion = staged[i].version;
              break;
            }
          }
          if (currentVersion === 0) {
            const existing = await this.backend.get(
              cloned.resourceType,
              cloned.id
            );
            if (existing && typeof existing.version === "number") {
              currentVersion = existing.version;
            }
          }

          cloned.version = currentVersion + 1;
          staged.push(cloned);
          return deepClone(cloned);
        },

        get: async (resourceType, id) => {
          for (let i = staged.length - 1; i >= 0; i--) {
            if (staged[i].resourceType === resourceType && staged[i].id === id) {
              return deepClone(staged[i]);
            }
          }
          const rec = await this.backend.get(resourceType, id);
          return rec ? deepClone(rec) : null;
        },

        history: async (resourceType, id) => {
          const committed = await this.backend.history(resourceType, id);
          const stagedMatches = staged.filter(
            (r) => r.resourceType === resourceType && r.id === id
          );
          return [...committed, ...stagedMatches].map(deepClone);
        },

        byPatient: async (resourceType, patientId) => {
          const committed = await this.backend.byPatient(
            resourceType,
            patientId
          );
          const byId = new Map();
          for (const rec of committed) {
            byId.set(rec.id, rec);
          }
          for (const rec of staged) {
            const matches =
              rec.resourceType === resourceType &&
              (rec.patientId === patientId ||
                (rec.resourceType === "Patient" &&
                  (rec.patientId === patientId || rec.id === patientId)));
            if (matches) {
              const existing = byId.get(rec.id);
              if (!existing || rec.version > existing.version) {
                byId.set(rec.id, rec);
              }
            }
          }
          return Array.from(byId.values()).map(deepClone);
        },
      };

      const result = await fn(txHandle);

      if (staged.length > 0) {
        await this.backend.write(staged);
        if (this.bus && typeof this.bus.emit === "function") {
          for (const record of staged) {
            await this.bus.emit("store.put", deepClone(record));
          }
        }
      }

      return result;
    };

    const previousQueue = this._txQueue;
    let resolveQueue;
    this._txQueue = new Promise((resolve) => {
      resolveQueue = resolve;
    });

    try {
      await previousQueue.catch(() => {});
      return await run();
    } finally {
      resolveQueue();
    }
  }
}

export { ClinicalStore, MemoryBackend, IndexedDBBackend };
