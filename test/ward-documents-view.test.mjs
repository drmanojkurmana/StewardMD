/* Patient documents on the ward chart, rendered for real. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return sb.window.WARD;
}
const SEL = { patientId: "p1", name: "Asha Rao" };
const view = (W, docs, extra) => W._render({ ...W._st, view: "documents", sel: SEL, docs, ...extra });
const DOC = { id: "d1", version: 2, docType: "consent", title: "Consent for central line", status: "current", uploadedBy: "dr.a", uploadedAt: "2026-09-13T10:00:00.000Z", sizeBytes: 20480 };

test("loading, failed, storage off and none on file read as four different things", () => {
  const W = loadWard();
  assert.match(view(W, null), /Loading this patient's documents/);
  const failed = view(W, { failed: true });
  assert.match(failed, /Do not read this as none on file/);
  assert.ok(!failed.includes("No documents on file"));
  const off = view(W, { ok: true, storageConfigured: false, documents: [] });
  assert.match(off, /Document storage is not set up for this hospital yet/);
  assert.ok(!off.includes('id="wDocFile"'), "no upload form when nothing could be stored");
  const none = view(W, { ok: true, storageConfigured: true, documents: [] });
  assert.match(none, /No documents on file for this patient/);
  assert.ok(none.includes('id="wDocFile"') && none.includes('data-w-act="docupload"'));
});

test("a current document can be opened, versioned and withdrawn; a withdrawn one shows why and cannot be withdrawn again", () => {
  const W = loadWard();
  const html = view(W, { ok: true, storageConfigured: true, documents: [DOC, { ...DOC, id: "d2", version: 1, title: "Wrong scan", status: "entered-in-error", withdrawnReason: "Scanned under the wrong patient", withdrawnBy: "dr.b" }] });
  assert.ok(html.includes('data-w-act="docopen:d1~2"'));
  assert.ok(html.includes('data-w-act="docversions:d1"'));
  assert.ok(html.includes('data-w-act="docnewversion:d1~2"'));
  assert.ok(html.includes('data-w-act="docwithdraw:d1"'));
  assert.match(html, /<s>Wrong scan<\/s>/);
  assert.match(html, /Withdrawn: Scanned under the wrong patient \(dr\.b\)/);
  assert.ok(!html.includes('data-w-act="docwithdraw:d2"'));
  assert.ok(html.includes('data-w-act="docopen:d2~1"'), "a withdrawn file can still be opened: it is part of the record");
});

test("uploading a new version says the earlier one is kept; versions list newest first and each opens", () => {
  const W = loadWard();
  const html = view(W, { ok: true, storageConfigured: true, documents: [DOC] }, {
    docNewVersion: { id: "d1", version: 2 },
    docVersions: { id: "d1", versions: [{ ...DOC, version: 1, title: "v1" }, { ...DOC, version: 2, title: "v2" }] },
  });
  assert.match(html, /Upload a new version/);
  assert.match(html, /The earlier version is kept/);
  assert.ok(html.indexOf("Version 2") < html.indexOf("Version 1"));
  assert.ok(html.includes('data-w-act="docopen:d1~1"'));
  assert.match(view(W, { ok: true, storageConfigured: true, documents: [DOC] }, { docVersions: { id: "d1", failed: true } }), /Could not load the earlier versions/);
});

test("delete-file is offered only after the retention date, and never for an already deleted file", () => {
  const W = loadWard();
  const past = view(W, { ok: true, storageConfigured: true, documents: [{ ...DOC, retainUntil: "2020-01-01T00:00:00.000Z" }] });
  assert.ok(past.includes('data-w-act="docpurge:d1"'));
  const future = view(W, { ok: true, storageConfigured: true, documents: [{ ...DOC, retainUntil: "2099-01-01T00:00:00.000Z" }] });
  assert.ok(!future.includes('data-w-act="docpurge:'));
  const gone = view(W, { ok: true, storageConfigured: true, documents: [{ ...DOC, status: "purged", purgedAt: "2026-09-13T10:00:00.000Z", retainUntil: "2020-01-01T00:00:00.000Z" }] });
  assert.ok(!gone.includes('data-w-act="docpurge:') && !gone.includes('data-w-act="docopen:'));
  assert.match(gone, /File deleted after its retention period/);
});

test("the chart has a Documents button, and opening a file asks the server for a link rather than building one", () => {
  const src = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
  assert.match(src, /data-w-act="documents"/);
  assert.match(src, /apiPost\("\/ward\/document-link"/);
  assert.ok(!/document-file\?t=/.test(src), "the screen never constructs a file address itself");
});
