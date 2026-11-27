/* test/research-project-rename.test.mjs
 * Live BUG-11: renaming a project. The project card exposes a Rename action
 * that opens a small dialog, saves the title to the server
 * (PATCH /v1/projects/{id} with { title }) and to the local store.
 *
 * Synthetic data only. No em or en dashes.
 * Run:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-project-rename.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

function makeEl(attrs) {
  const el = {
    onclick: null,
    onsubmit: null,
    onchange: null,
    oninput: null,
    value: "",
    disabled: false,
    textContent: "",
    innerHTML: "",
    focusCount: 0,
    attrs: attrs || {},
    getAttribute: function (k) { return this.attrs[k] != null ? this.attrs[k] : null; },
    setAttribute: function (k, v) { this.attrs[k] = v; },
    focus: function () { this.focusCount++; },
    select: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
  return el;
}

function createSandbox(opts) {
  const options = opts || {};
  const ls = options.localStorage || new Map();
  const calls = [];
  const failPatch = !!options.failPatch;
  const win = {
    document: {
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {},
      removeEventListener: function () {},
      createElement: function () { return makeEl(); },
      getElementById: function () { return null; },
      head: { appendChild: function () {} }
    },
    location: { origin: "https://stewardmd.in", search: "" },
    localStorage: {
      getItem: function (k) { return ls.has(k) ? ls.get(k) : null; },
      setItem: function (k, v) { ls.set(k, String(v)); },
      removeItem: function (k) { ls.delete(k); }
    },
    Promise: Promise, Error: Error, Object: Object, Array: Array, RegExp: RegExp,
    String: String, JSON: JSON, Math: Math, Date: Date,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    addEventListener: function () {},
    navigator: { onLine: true },
    fetch: async function (url, init) {
      calls.push({ url: decodeURIComponent(String(url)), init: init, method: (init && init.method) || "GET" });
      if (failPatch) {
        return {
          ok: false,
          status: 403,
          text: async function () { return JSON.stringify({ error: { code: "not_member", message: "Project access denied" } }); }
        };
      }
      return {
        ok: true,
        status: 200,
        text: async function () { return JSON.stringify({ ok: true }); }
      };
    }
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read("research-store.js"), ctx);
  vm.runInContext(read("research.js"), ctx);
  vm.runInContext(read("research-screen-projects.js"), ctx);
  return { win: win, ctx: ctx, calls: calls, ls: ls };
}

function createProjectsContainer() {
  const renameBtn = makeEl({ "data-rmd-rename-project": "PRJ" });
  const titleInput = makeEl();
  const errBox = makeEl();
  const submitBtn = makeEl();
  const form = makeEl();
  form.querySelector = function (sel) {
    if (sel === "#rmd_rename_title") return titleInput;
    if (sel === "#rmdRenameErr") return errBox;
    if (sel === '[data-rmd="rename-submit"]') return submitBtn;
    return null;
  };
  const container = {
    innerHTML: "",
    els: { renameBtn: renameBtn, titleInput: titleInput, errBox: errBox, submitBtn: submitBtn, form: form },
    querySelector: function (sel) {
      if (sel === "#rmdRenameForm") return form;
      if (sel === "#rmd_rename_title") return titleInput;
      return null;
    },
    querySelectorAll: function (sel) {
      if (sel === "[data-rmd-rename-project]") return [renameBtn];
      return [];
    }
  };
  return container;
}

const sleep = (ms) => new Promise(function (r) { setTimeout(r, ms); });

async function createRenamedProject(sb, container, pid, title) {
  const store = sb.win.SMD_RESEARCH.store;
  const proj = store.createProject({ title: "Old title", discipline: "medicine", specialty: "", studyType: "Case Report", researchQuestion: "" });
  // Give it a server id so the rename PATCHes; PRJ matches the container stub id.
  const st = store.getState();
  for (let i = 0; i < st.projects.length; i++) {
    if (st.projects[i].id === proj.id) {
      st.projects[i].id = pid;
      st.projects[i].serverId = pid;
    }
  }
  sb.win.SMD_RESEARCH.screens.projects.render(container);
  return proj;
}

describe("Rename project (BUG-11)", () => {
  test("card shows a Rename button; the dialog opens and PATCHes the server, then updates the store", async () => {
    const sb = createSandbox();
    const container = createProjectsContainer();
    await createRenamedProject(sb, container, "PRJ", "Old title");

    assert.ok(container.innerHTML.indexOf('data-rmd-rename-project="PRJ"') >= 0, "card has a Rename button");

    container.els.renameBtn.onclick.call(container.els.renameBtn, {});
    assert.ok(container.innerHTML.indexOf('id="rmdRenameModal"') >= 0, "rename dialog opens");
    assert.ok(container.innerHTML.indexOf('value="Old title"') >= 0, "dialog prefills the current title");
    assert.ok(container.els.titleInput.focusCount >= 1, "title input gets focus");

    container.els.titleInput.value = "Renamed sepsis project";
    container.els.form.onsubmit.call(container.els.form, { preventDefault: function () {} });
    await sleep(20);

    const patch = sb.calls.find((c) => c.method === "PATCH");
    assert.ok(patch, "a PATCH request was sent");
    assert.equal(patch.url, "/api/research/v1/projects/PRJ");
    assert.equal(JSON.parse(patch.init.body).title, "Renamed sepsis project");

    assert.equal(sb.win.SMD_RESEARCH.store.getProject("PRJ").title, "Renamed sepsis project", "store title updated");
    assert.ok(container.innerHTML.indexOf('id="rmdRenameModal"') < 0, "dialog closes after saving");
    assert.ok(container.innerHTML.indexOf("Renamed sepsis project") >= 0, "card shows the new name");
  });

  test("rename survives a reload: setSyncState persisted the store state", async () => {
    const ls = new Map();
    const sb = createSandbox({ localStorage: ls });
    const container = createProjectsContainer();
    await createRenamedProject(sb, container, "PRJ", "Old title");
    container.els.renameBtn.onclick.call(container.els.renameBtn, {});
    container.els.titleInput.value = "Kept after reload";
    container.els.form.onsubmit.call(container.els.form, { preventDefault: function () {} });
    await sleep(20);

    const sb2 = createSandbox({ localStorage: ls });
    assert.equal(sb2.win.SMD_RESEARCH.store.getProject("PRJ").title, "Kept after reload", "title persisted to localStorage");
  });

  test("server failure keeps the dialog open, shows the error, and does not change the title", async () => {
    const sb = createSandbox({ failPatch: true });
    const container = createProjectsContainer();
    await createRenamedProject(sb, container, "PRJ", "Old title");
    container.els.renameBtn.onclick.call(container.els.renameBtn, {});
    container.els.titleInput.value = "Should not save";
    container.els.form.onsubmit.call(container.els.form, { preventDefault: function () {} });
    await sleep(20);

    assert.ok(container.innerHTML.indexOf('id="rmdRenameModal"') >= 0, "dialog stays open");
    assert.ok(String(container.els.errBox.innerHTML).length > 0, "error banner shown");
    assert.equal(sb.win.SMD_RESEARCH.store.getProject("PRJ").title, "Old title", "store title unchanged");
    assert.equal(container.els.submitBtn.disabled, false, "submit re-enabled");
  });

  test("local-only project renames without any network call", async () => {
    const sb = createSandbox();
    const container = createProjectsContainer();
    const store = sb.win.SMD_RESEARCH.store;
    store.createProject({ title: "Phone only", discipline: "medicine", specialty: "", studyType: "Cohort study", researchQuestion: "" });
    const st = store.getState();
    st.projects[st.projects.length - 1].id = "PRJ";
    sb.win.SMD_RESEARCH.screens.projects.render(container);

    container.els.renameBtn.onclick.call(container.els.renameBtn, {});
    container.els.titleInput.value = "Phone only v2";
    container.els.form.onsubmit.call(container.els.form, { preventDefault: function () {} });
    await sleep(20);

    assert.ok(!sb.calls.some((c) => c.method === "PATCH"), "no PATCH for a phone-only project");
    assert.equal(store.getProject("PRJ").title, "Phone only v2", "local title updated");
  });

  test("empty title is rejected before any request", async () => {
    const sb = createSandbox();
    const container = createProjectsContainer();
    await createRenamedProject(sb, container, "PRJ", "Old title");
    container.els.renameBtn.onclick.call(container.els.renameBtn, {});
    container.els.titleInput.value = "   ";
    container.els.form.onsubmit.call(container.els.form, { preventDefault: function () {} });
    await sleep(20);

    assert.ok(!sb.calls.some((c) => c.method === "PATCH"), "no PATCH on invalid title");
    assert.ok(container.els.errBox.innerHTML.indexOf("180 characters") >= 0, "validation message shown");
    assert.equal(sb.win.SMD_RESEARCH.store.getProject("PRJ").title, "Old title");
  });
});
