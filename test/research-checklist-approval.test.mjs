/* BUG-09: checklist approval is persisted and a missing manuscript is not an error.
 *
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite test/research-checklist-approval.test.mjs
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function makeContainer() {
  let html = "";
  const c = {
    _nodes: [],
    get innerHTML() { return html; },
    set innerHTML(v) {
      html = String(v);
      this._nodes = [];
      const re = /<button\s+([^>]*?)>/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        const attrs = {};
        const are = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
        let am;
        while ((am = are.exec(m[1])) !== null) attrs[am[1]] = am[2] !== undefined ? am[2] : true;
        this._nodes.push({
          tagName: "BUTTON",
          attrs,
          getAttribute(k) { return attrs[k] !== undefined ? String(attrs[k]) : null; },
          setAttribute(k, v) { attrs[k] = String(v); },
          removeAttribute(k) { delete attrs[k]; },
          disabled: attrs.disabled !== undefined,
          onclick: null
        });
      }
    },
    querySelector(sel) {
      if (sel === "[data-rmd-approve]") return this._nodes.find((n) => n.attrs["data-rmd-approve"] !== undefined) || null;
      return null;
    },
    querySelectorAll() { return []; }
  };
  return c;
}

const CHECKLIST = {
  id: "care",
  name: "CARE",
  version: "1",
  sections: [
    { title: "Case", items: [{ number: "1", topic: "Patient details", text: "Say the details.", section: "Case", projectField: "manual" }] }
  ]
};

describe("BUG-09: checklist approval persists to the project", () => {
  let calls, entries, container, checklistMissingCalls;

  beforeEach(() => {
    globalThis.window = globalThis;
    globalThis.innerWidth = 1024;
    globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    globalThis.document = {
      head: { appendChild: () => {} },
      body: { contains: () => true },
      getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute: () => {} })
    };
    globalThis.SMD_RESEARCH_DOC = null;
    calls = [];
    entries = { "1": "Reported in the case." };
    checklistMissingCalls = 0;

    const engine = require("../research-checklist.js");
    globalThis.SMD_RESEARCH = {
      screens: {},
      esc: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
      preferredChecklist: () => "care",
      store: {
        getActiveProject: () => ({ id: "prj_cl", serverId: "prj_cl_srv", title: "A case", studyType: "Case Report" }),
        getProject: () => ({ id: "prj_cl", serverId: "prj_cl_srv", title: "A case", studyType: "Case Report" })
      },
      p2: { flashNotice: () => {}, errHtml: (e) => '<div class="err">' + (e && e.message) + '</div>' },
      api: {
        request: async (method, path, body) => {
          calls.push({ method, path, body });
          if (method === "GET" && path === "/v1/checklists") return { checklists: [{ id: "care", name: "CARE", version: "1" }] };
          if (method === "GET" && path === "/v1/checklists/care") return CHECKLIST;
          if (method === "GET" && /\/checklist-snapshot$/.test(path)) return { snapshot: {} };
          if (method === "GET" && /\/checklist-manual\/care$/.test(path)) return { entries: Object.assign({}, entries) };
          if (method === "PUT" && /\/checklist-manual\/care$/.test(path)) {
            entries[String(body.num)] = body.text;
            return { entries: Object.assign({}, entries) };
          }
          if (method === "GET" && /\/manuscript$/.test(path)) {
            checklistMissingCalls += 1;
            const e = new Error("Manuscript not found");
            e.status = 404;
            e.code = "manuscript_not_found";
            throw e;
          }
          throw new Error("Unexpected " + method + " " + path);
        }
      }
    };
    globalThis.SMD_RESEARCH_CHECKLIST = engine;
    const src = require("node:fs").readFileSync(new URL("../research-screen-checklist.js", import.meta.url), "utf8");
    new Function("window", "global", src)(globalThis, globalThis);
    container = makeContainer();
  });

  test("Approve saves the approval marker and the screen reloads as approved", async () => {
    const screen = globalThis.SMD_RESEARCH.screens.checklist;
    screen.render(container);
    for (let i = 0; i < 40 && !/Manual 1/.test(container.innerHTML); i++) await new Promise((r) => setTimeout(r, 5));
    assert.match(container.innerHTML, /Manual 1\. Missing 0\./, "the filled manual item is counted");

    const approve = container.querySelector("[data-rmd-approve]");
    assert.ok(approve, "Approve control rendered");
    assert.equal(approve.disabled, false, "Approve is enabled when nothing is missing");
    approve.onclick();

    for (let i = 0; i < 40 && !/Approved and saved to your project/.test(container.innerHTML); i++) await new Promise((r) => setTimeout(r, 5));
    assert.match(container.innerHTML, /Approved and saved to your project/, "server approval is confirmed in the UI");

    const put = calls.find((c) => c.method === "PUT" && /\/checklist-manual\/care$/.test(c.path));
    assert.ok(put, "approval is written to the project");
    assert.equal(put.path, "/v1/projects/prj_cl_srv/checklist-manual/care", "server project id is used");
    assert.equal(put.body.num, "checklist_approval", "approval marker is a reserved checklist entry");
    assert.match(put.body.text, /"approved":true/, "marker records the approval");

    /* Reload: the marker comes back from the server and keeps the state. */
    screen.render(container);
    for (let i = 0; i < 40 && !/Approved and saved to your project/.test(container.innerHTML); i++) await new Promise((r) => setTimeout(r, 5));
    assert.match(container.innerHTML, /Approved and saved to your project/, "approval survives a reload");
    assert.equal(container.querySelector("[data-rmd-approve]").disabled, true, "Approve stays disabled after reload");
  });

  test("the project snapshot field the server now returns fills the checklist for Submit", () => {
    const engine = globalThis.SMD_RESEARCH_CHECKLIST;
    const filled = engine.fill(CHECKLIST, { checklistManual: { care: { "1": "Reported in the case." } } });
    assert.equal(filled.counts.manual, 1, "snapshot.checklistManual[guideline] is read by the same fill call Submit uses");
    assert.equal(filled.counts.missing, 0, "no item is missing when the manual entry is present");
  });

  test("a 404 manuscript is treated as nothing yet and is requested only once", async () => {
    const screen = globalThis.SMD_RESEARCH.screens.checklist;
    screen.render(container);
    for (let i = 0; i < 40 && !/Manual 1/.test(container.innerHTML); i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(checklistMissingCalls, 1, "first load asks for the manuscript once");
    assert.doesNotMatch(container.innerHTML, /rmd-banner-error/, "404 does not render an error banner");

    screen.render(container);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(checklistMissingCalls, 1, "a known-missing manuscript is not fetched again");
  });

  test("batched approval saves every multi-item doc entry before the approval marker", async () => {
    const items = [];
    const itemSub = {};
    const subheadings = [];
    for (let k = 1; k <= 10; k++) {
      const n = String(k);
      items.push({ number: n, topic: "Item " + n, text: "Req " + n, section: "Case", projectField: "manual" });
      itemSub[n] = "sub_" + n;
      subheadings.push({ id: "sub_" + n, html: "Doc text for item " + n });
    }
    const bigChecklist = { id: "care", name: "CARE", version: "1", sections: [{ title: "Case", items }] };
    const order = [];
    let inflight = 0;
    let maxInflight = 0;
    const oldReq = globalThis.SMD_RESEARCH.api.request;
    globalThis.SMD_RESEARCH.api.request = async (method, path, body) => {
      if (method === "GET" && path === "/v1/checklists/care") return bigChecklist;
      if (method === "PUT" && /\/checklist-manual\/care$/.test(path)) {
        inflight++;
        if (inflight > maxInflight) maxInflight = inflight;
        await new Promise((r) => setTimeout(r, 5));
        inflight--;
        order.push(String(body.num));
      }
      return oldReq(method, path, body);
    };
    globalThis.SMD_RESEARCH_DOC = {
      outlineFor: () => ({ itemSub, sections: [{ id: "sec_1", title: "Case", subheadings }] }),
      htmlToText: (h) => String(h || ""),
      countWords: (t) => (String(t || "").trim() ? String(t).trim().split(/\s+/).length : 0),
      render: () => ({
        getDoc: () => ({ sections: [{ id: "sec_1", subheadings }] }),
        destroy: () => {}
      })
    };
    const origQs = container.querySelector.bind(container);
    container.querySelector = (sel) => {
      if (sel === "#rmdChecklistDoc") return { innerHTML: "" };
      return origQs(sel);
    };
    const screen = globalThis.SMD_RESEARCH.screens.checklist;
    screen.render(container);
    let approve = null;
    for (let i = 0; i < 60; i++) {
      approve = container.querySelector("[data-rmd-approve]");
      if (approve && !approve.disabled) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(approve && !approve.disabled, "Approve enabled when all 10 doc items are filled");
    approve.onclick();
    for (let i = 0; i < 80 && !/Approved and saved to your project/.test(container.innerHTML); i++) await new Promise((r) => setTimeout(r, 10));
    assert.match(container.innerHTML, /Approved and saved to your project/, "approval completed");
    assert.equal(order.length, 11, "all 10 doc entries plus approval marker written");
    assert.equal(order[10], "checklist_approval", "approval marker written strictly last after all batched puts");
    assert.ok(maxInflight > 1 && maxInflight <= 6, "puts ran in bounded parallel batches (maxInflight=" + maxInflight + ")");
  });
});