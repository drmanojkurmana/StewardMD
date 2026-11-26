/* test/research-phi-override-ui.test.mjs
 * Tests the interactive PHI override modal for POST /v1/projects/{id}/ai-draft in research.js.
 *
 * Synthetic data only. No em or en dashes.
 * Run:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-phi-override-ui.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PHI_INDIA_SRC = readFileSync(join(ROOT, "phi-india.js"), "utf8");
const RESEARCH_PHI_SRC = readFileSync(join(ROOT, "research-phi.js"), "utf8");
const RESEARCH_SRC = readFileSync(join(ROOT, "research.js"), "utf8");
const REASONING_SRC = readFileSync(join(ROOT, "reasoning.js"), "utf8");
const REDACT_FN_BODY = REASONING_SRC.slice(
  REASONING_SRC.indexOf("  function redactPHI(text) {"),
  REASONING_SRC.indexOf("  window.SMD_redactPHI = redactPHI;")
);

function parseAttrs(attrStr) {
  const attrs = {};
  const re = /([a-zA-Z0-9_:-]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : "");
  }
  return attrs;
}

function createMiniDom() {
  let activeElement = null;
  const docListeners = {};

  function makeNode(tagName) {
    const children = [];
    const listeners = {};
    const attrs = {};
    let _innerHTML = "";
    let _textContent = "";
    let _checked = false;
    let _disabled = false;

    const node = {
      tagName: String(tagName || "DIV").toUpperCase(),
      parentNode: null,
      children,
      style: {},
      get id() { return attrs.id || ""; },
      set id(v) { attrs.id = String(v); },
      get className() { return attrs.class || ""; },
      set className(v) { attrs.class = String(v); },
      get checked() { return _checked; },
      set checked(v) { _checked = Boolean(v); },
      get disabled() { return _disabled; },
      set disabled(v) {
        _disabled = Boolean(v);
        if (_disabled) attrs.disabled = "";
        else delete attrs.disabled;
      },
      get textContent() {
        if (children.length) {
          return children.map((c) => c.textContent).join(" ");
        }
        return _textContent;
      },
      set textContent(v) {
        _textContent = String(v == null ? "" : v);
        children.length = 0;
      },
      get innerHTML() {
        return _innerHTML;
      },
      set innerHTML(html) {
        _innerHTML = String(html == null ? "" : html);
        children.length = 0;
        parseHtmlInto(_innerHTML, node);
      },
      setAttribute(k, v) {
        attrs[k] = String(v);
        if (k === "disabled") _disabled = true;
      },
      getAttribute(k) {
        return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
      },
      appendChild(child) {
        if (child.parentNode && typeof child.parentNode.removeChild === "function") {
          child.parentNode.removeChild(child);
        }
        child.parentNode = node;
        children.push(child);
        return child;
      },
      removeChild(child) {
        const idx = children.indexOf(child);
        if (idx >= 0) {
          children.splice(idx, 1);
          child.parentNode = null;
        }
        return child;
      },
      addEventListener(type, fn) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener(type, fn) {
        if (!listeners[type]) return;
        listeners[type] = listeners[type].filter((f) => f !== fn);
      },
      dispatchEvent(ev) {
        const event = ev || {};
        if (!event.target) event.target = node;
        if (!event.preventDefault) event.preventDefault = () => {};
        if (!event.stopPropagation) event.stopPropagation = () => {};
        const list = (listeners[event.type] || []).slice();
        for (const fn of list) fn.call(node, event);
        if (event.type === "click" && typeof node.onclick === "function") {
          node.onclick.call(node, event);
        }
      },
      click() {
        if (node.tagName === "INPUT" && attrs.type === "checkbox") {
          _checked = !_checked;
          node.dispatchEvent({ type: "change", target: node });
        } else if (!node.disabled) {
          node.dispatchEvent({ type: "click", target: node });
        }
      },
      focus() {
        activeElement = node;
      },
      contains(target) {
        if (!target) return false;
        if (target === node) return true;
        return children.some((c) => c.contains(target));
      },
      querySelector(sel) {
        return node.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const out = [];
        function match(el) {
          if (sel.startsWith("#")) return el.id === sel.slice(1);
          if (sel.startsWith(".")) {
            return (" " + el.className + " ").includes(" " + sel.slice(1) + " ");
          }
          const m = /^\[([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?\]$/.exec(sel);
          if (m) {
            const val = el.getAttribute(m[1]);
            if (m[2] !== undefined) return val === m[2];
            return val !== null;
          }
          return el.tagName.toLowerCase() === sel.toLowerCase();
        }
        function walk(cur) {
          for (const ch of cur.children) {
            if (match(ch)) out.push(ch);
            walk(ch);
          }
        }
        walk(node);
        return out;
      }
    };
    return node;
  }

  function parseHtmlInto(html, parent) {
    // Simple tokenizer sufficient for research.js modal markup
    const stack = [parent];
    const tokenRe = /<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>|([^<]+)/g;
    let m;
    while ((m = tokenRe.exec(html)) !== null) {
      if (m[5] !== undefined) {
        const cur = stack[stack.length - 1];
        if (cur && m[5]) {
          const prev = cur._rawText || "";
          cur._rawText = prev + m[5];
          if (cur.children.length === 0) cur.textContent = cur._rawText;
        }
        continue;
      }
      const isClose = m[1] === "/";
      const tag = m[2].toLowerCase();
      const attrStr = m[3] || "";
      const selfClose = m[4] === "/" || tag === "input";
      if (isClose) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const el = makeNode(tag);
      const attrs = parseAttrs(attrStr);
      for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v);
      }
      stack[stack.length - 1].appendChild(el);
      if (!selfClose) {
        stack.push(el);
      }
    }
    // Propagate leaf text for elements with mixed children
    (function fillLeafText(el) {
      if (!el.children.length && el._rawText) {
        el.textContent = el._rawText;
      }
      for (const ch of el.children) fillLeafText(ch);
    })(parent);
  }

  const body = makeNode("body");
  const head = makeNode("head");
  const root = makeNode("div");
  root.id = "researchMD";
  body.appendChild(root);

  const triggerBtn = makeNode("button");
  triggerBtn.id = "triggerDraftBtn";
  body.appendChild(triggerBtn);
  activeElement = triggerBtn;

  const doc = {
    body,
    head,
    get activeElement() { return activeElement; },
    createElement(tag) { return makeNode(tag); },
    getElementById(id) { return body.querySelector("#" + id) || head.querySelector("#" + id); },
    querySelector(sel) { return body.querySelector(sel); },
    querySelectorAll(sel) { return body.querySelectorAll(sel); },
    addEventListener(type, fn) {
      docListeners[type] = docListeners[type] || [];
      docListeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (!docListeners[type]) return;
      docListeners[type] = docListeners[type].filter((f) => f !== fn);
    },
    dispatchEvent(ev) {
      const list = (docListeners[ev.type] || []).slice();
      for (const fn of list) fn(ev);
    }
  };

  return { doc, root, triggerBtn };
}

function createUiSandbox(opts) {
  const options = opts || {};
  const dom = createMiniDom();
  const fetchCalls = [];
  const capCalls = [];
  const store = new Map();

  const win = {
    document: dom.doc,
    location: { origin: "https://stewardmd.in", search: "" },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); }
    },
    Promise,
    Error,
    Object,
    Array,
    RegExp,
    String,
    JSON,
    setTimeout,
    clearTimeout,
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      if (typeof options.fetchImpl === "function") {
        return options.fetchImpl(url, init, fetchCalls.length);
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ draft: { ok: true }, model: "mock", costInr: 0 })
      };
    }
  };

  if (options.withCapacitor) {
    win.Capacitor = {
      Plugins: {
        CapacitorHttp: {
          request: async (reqOpts) => {
            capCalls.push(reqOpts);
            if (typeof options.capImpl === "function") {
              return options.capImpl(reqOpts, capCalls.length);
            }
            return { status: 200, data: { draft: { ok: true } } };
          }
        }
      }
    };
  }

  win.window = win;
  win.self = win;
  win.globalThis = win;

  const ctx = vm.createContext(win);
  vm.runInContext(PHI_INDIA_SRC, ctx);
  vm.runInContext(
    "(function (window) {\n" + REDACT_FN_BODY + "\n  window.SMD_redactPHI = redactPHI;\n})(window);",
    ctx
  );
  vm.runInContext(RESEARCH_PHI_SRC, ctx);
  vm.runInContext(RESEARCH_SRC, ctx);

  return { win, dom, fetchCalls, capCalls };
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("ResearchMD /ai-draft PHI override dialog", () => {
  test("legal review F-01: a client-side hit is a hard block (no dialog, no fetch, categories kept)", async () => {
    const sb = createUiSandbox();
    const secretPhone = "9876543210";
    let rejected = null;
    await sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", {
      task: "case_report_draft",
      input: { caseText: "Admitted on March 12, contact " + secretPhone + "." }
    }).then(function () { rejected = false; }, function (e) { rejected = e; });
    await flushMicrotasks();
    assert.ok(rejected && rejected.code === "phi_blocked", "rejects with phi_blocked");
    assert.ok(Array.isArray(rejected.categories) && rejected.categories.length > 0, "categories kept on the error");
    assert.equal(sb.fetchCalls.length, 0, "nothing sent");
    assert.equal(sb.dom.root.querySelector("#rmdPhiOverrideModal"), null, "no override dialog");
    assert.equal(JSON.stringify(rejected.categories).indexOf(secretPhone), -1, "flagged text never in the error");
  });

  test("server 422 overridable opens dialog with mapped categories, resends with phiOverride, resolves", async () => {
    const sb = createUiSandbox({
      fetchImpl: async (url, init, callNo) => {
        if (callNo === 1) {
          return {
            ok: false,
            status: 422,
            text: async () => JSON.stringify({
              error: { code: "phi_blocked", message: "Patient identifiers detected in case text.", requestId: "req-1" },
              categories: ["patient_name", "address", "abha", "mrn"],
              overridable: true
            })
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ draft: { sections: { abstract: "Ok" } } })
        };
      }
    });

    const callerBody = { task: "case_report_draft", input: { caseText: "Clean text after client redact" } };
    const reqPromise = sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", callerBody);
    await flushMicrotasks();

    assert.equal(sb.fetchCalls.length, 1);
    const modal = sb.dom.root.querySelector("#rmdPhiOverrideModal");
    assert.ok(modal, "dialog opened on server 422 overridable");
    assert.match(modal.innerHTML, /<li>Name<\/li>/);
    assert.match(modal.innerHTML, /<li>Address<\/li>/);
    assert.match(modal.innerHTML, /<li>ABHA health ID or address<\/li>/);
    assert.match(modal.innerHTML, /<li>Medical record or hospital ID number<\/li>/);

    modal.querySelector("input").click();
    modal.querySelector('[data-rmd-phi-send="1"]').click();

    const res = await reqPromise;
    assert.equal(res.draft.sections.abstract, "Ok");
    assert.equal(sb.fetchCalls.length, 2);
    const secondBody = JSON.parse(sb.fetchCalls[1].init.body);
    assert.deepEqual(secondBody.phiOverride, { accepted: true, termsVersion: "rmd-phi-override-v0" });
    assert.equal(callerBody.phiOverride, undefined, "caller body not mutated");
  });

  test("server 422 overridable + Edit my text rejects with single fetch", async () => {
    const sb = createUiSandbox({
      fetchImpl: async () => ({
        ok: false,
        status: 422,
        text: async () => JSON.stringify({
          error: { code: "phi_blocked", message: "Patient identifiers detected.", requestId: "req-2" },
          categories: ["patient_name"],
          overridable: true
        })
      })
    });

    const reqPromise = sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", {
      task: "protocol",
      input: { text: "Clean text" }
    });
    await flushMicrotasks();

    const editBtn = sb.dom.root.querySelector('[data-rmd-phi-edit="1"]');
    assert.ok(editBtn);
    editBtn.click();

    await assert.rejects(reqPromise, (err) => {
      assert.equal(err.code, "phi_blocked");
      assert.equal(err.status, 422);
      assert.deepEqual(Array.from(err.categories), ["patient_name"]);
      return true;
    });
    assert.equal(sb.fetchCalls.length, 1);
  });

  test("never loops: a second 422 overridable after override just rejects without reopening dialog", async () => {
    const sb = createUiSandbox({
      fetchImpl: async () => ({
        ok: false,
        status: 422,
        text: async () => JSON.stringify({
          error: { code: "phi_blocked", message: "Still blocked.", requestId: "req-loop" },
          categories: ["patient_name"],
          overridable: true
        })
      })
    });

    const reqPromise = sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", {
      task: "case_report_draft",
      input: { caseText: "Clean text" }
    });
    await flushMicrotasks();

    sb.dom.root.querySelector("input").click();
    sb.dom.root.querySelector('[data-rmd-phi-send="1"]').click();

    await assert.rejects(reqPromise, (err) => {
      assert.equal(err.code, "phi_blocked");
      assert.equal(err.status, 422);
      return true;
    });
    assert.equal(sb.fetchCalls.length, 2);
    assert.equal(sb.dom.root.querySelector("#rmdPhiOverrideModal"), null);
  });

  test("server 422 without overridable:true opens no dialog and rejects", async () => {
    for (const overridableVal of [undefined, false, "true"]) {
      const sb = createUiSandbox({
        fetchImpl: async () => ({
          ok: false,
          status: 422,
          text: async () => JSON.stringify({
            error: { code: "phi_blocked", message: "Blocked.", requestId: "req-no-ovr" },
            categories: ["mrn"],
            overridable: overridableVal
          })
        })
      });

      await assert.rejects(
        sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", {
          task: "case_report_draft",
          input: { caseText: "Clean text" }
        }),
        (err) => {
          assert.equal(err.code, "phi_blocked");
          assert.equal(err.status, 422);
          return true;
        }
      );
      assert.equal(sb.fetchCalls.length, 1);
      assert.equal(sb.dom.root.querySelector("#rmdPhiOverrideModal"), null);
    }
  });

  test("non /ai-draft paths never show override dialog even on 422 phi_blocked overridable:true", async () => {
    const paths = [
      ["POST", "/v1/projects/p1/jobs", { kind: "manuscript_draft" }],
      ["POST", "/v1/projects/p1/extraction/suggestions", { studyId: "s1" }],
      ["POST", "/v1/projects/p1/ai-draft/subpath", { input: { text: "Clean" } }],
      ["GET", "/v1/projects/p1/ai-draft", undefined]
    ];

    for (const [method, path, body] of paths) {
      const sb = createUiSandbox({
        fetchImpl: async () => ({
          ok: false,
          status: 422,
          text: async () => JSON.stringify({
            error: { code: "phi_blocked", message: "Blocked.", requestId: "req-other" },
            categories: ["patient_name"],
            overridable: true
          })
        })
      });

      await assert.rejects(
        sb.win.SMD_RESEARCH.api.request(method, path, body),
        (err) => {
          assert.equal(err.code, "phi_blocked", method + " " + path);
          assert.equal(err.status, 422, method + " " + path);
          return true;
        }
      );
      assert.equal(sb.fetchCalls.length, 1, method + " " + path);
      assert.equal(sb.dom.root.querySelector("#rmdPhiOverrideModal"), null, method + " " + path);
    }
  });

  test("CapacitorHttp 422 overridable opens dialog and sends phiOverride on confirm", async () => {
    const sb = createUiSandbox({
      withCapacitor: true,
      capImpl: async (reqOpts, callNo) => {
        if (callNo === 1) {
          return {
            status: 422,
            data: {
              error: { code: "phi_blocked", message: "Blocked.", requestId: "req-cap" },
              categories: ["phone"],
              overridable: true
            }
          };
        }
        return { status: 200, data: { draft: { capOk: true } } };
      }
    });

    const reqPromise = sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", {
      task: "polish",
      input: { text: "Clean" }
    });
    await flushMicrotasks();

    const modal = sb.dom.root.querySelector("#rmdPhiOverrideModal");
    assert.ok(modal);
    assert.match(modal.innerHTML, /<li>Phone number<\/li>/);
    modal.querySelector("input").click();
    modal.querySelector('[data-rmd-phi-send="1"]').click();

    const res = await reqPromise;
    assert.equal(res.draft.capOk, true);
    assert.equal(sb.capCalls.length, 2);
    assert.deepEqual(
      JSON.parse(JSON.stringify(sb.capCalls[1].data.phiOverride)),
      { accepted: true, termsVersion: "rmd-phi-override-v0" }
    );
  });

  test("docs and terms contain required headings, draft marker, and zero em/en dashes", () => {
    const terms = readFileSync(join(ROOT, "docs/research/PHI_OVERRIDE_TERMS.md"), "utf8");
    const runbook = readFileSync(join(ROOT, "docs/research/RUNBOOK_PAPERORCHESTRA.md"), "utf8");

    assert.ok(terms.startsWith("DRAFT - NEEDS LEGAL REVIEW\n"), "terms starts with DRAFT - NEEDS LEGAL REVIEW");
    assert.match(terms, /rmd-phi-override-v0/);
    assert.match(terms, /DPDP Act/);
    assert.match(terms, /ai_phi_override/);
    assert.equal(terms.indexOf("\u2014"), -1);
    assert.equal(terms.indexOf("\u2013"), -1);

    assert.match(runbook, /## Patient identifier override \(\/ai-draft only\)/);
    assert.match(runbook, /ai_phi_override/);
    assert.match(runbook, /PHI_OVERRIDE_TERMS\.md/);
    assert.match(runbook, /NEEDS LEGAL REVIEW/i);
    assert.equal(runbook.indexOf("\u2014"), -1);
    assert.equal(runbook.indexOf("\u2013"), -1);
  });
});
