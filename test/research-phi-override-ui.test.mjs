/* test/research-phi-override-ui.test.mjs
 * Tests the interactive PHI override modal for POST /v1/projects/{id}/ai-draft in research.js.
 * Owner decision 27 Nov 2026: the override is ONE action, the doctor confirming
 * that the flag is a false detection. No radio list, no consent evidence fields.
 * A never-overridable hit (name, ID number, phone) shows the block with no
 * override button and the never note.
 *
 * Synthetic data only. No em or en dashes except inside the quoted legal copy.
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

/* Owner decision 27 Nov 2026. Verbatim legal copy shown in the dialog. */
const TITLE = "Before you send \u2014 patient information check";
const BODY = "This text was flagged because it may contain patient identifiers. If you have checked it and it does not identify any patient, you can continue. Otherwise remove the identifiers first.";
const CONFIRM = "By continuing, you confirm that the flagged text does not identify any patient. The text will be sent to our AI providers: Runware, which passes it to an OpenAI GPT model, and Google Vertex AI (Gemini), whose servers may be outside India. StewardMD logs this override (your user ID, the time, the type of identifier flagged and these terms version) but never the text itself.";
const BUTTON = "False detection, ignore and go ahead";
const NEVER_NOTE = "Names, ID numbers and phone numbers can never be sent. Remove them before drafting.";

/* Counsel wording, 2026-11-27. No em or en dashes in any of it (asserted below). */
const T32_OPENING = "ResearchMD is a drafting and documentation aid for registered medical practitioners. It is not a medical device and is not intended for diagnosis, prevention, monitoring, treatment or alleviation of any disease or disorder, and it does not give patient-specific diagnostic or treatment directions. AI-generated output is a draft only. It may be inaccurate, incomplete or biased. You must review, edit and verify every citation, number and patient-consent position before use or submission, exercise your independent clinical judgment, and you remain solely responsible as author for anything you submit. You own AI-assisted text you produce in the app to the extent copyright subsists in it under Indian law; StewardMD does not warrant that such text is copyrightable or that it does not infringe third-party rights. You must not use ResearchMD to create deepfakes or other synthetically generated information that impersonates a person, to fabricate data or results, or to identify a patient without that patient's consent.";
const T32_REVIEW_STEP = "ResearchMD drafts from your own analyses and sources, requires a review step, and only accepts citations with a real DOI or PMID.";
const T32_TAKEDOWN = "We acknowledge every grievance within 24 hours. We resolve general grievances within 7 days. We act within 36 hours on removal requests for content in the categories the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules 2021 specify, within 2 hours on complaints about intimate images or impersonation, and within 3 hours on a court order or an authorised Government officer's reasoned direction to remove unlawful content. Grievances about personal data are also handled under our privacy policy and are redressed within one month.";
const T32_LIABILITY = "Section 21 applies: our total liability is limited to the greater of the amount you paid us in the 12 months before the claim or INR 5,000. Nothing in this clause limits liability for death or personal injury caused by negligence, for fraud, or for wilful misconduct. The cap in this clause applies to the aggregate of all claims in the 12 months before the claim, and does not exclude liability for deficiency in service, which is capped as above.";
const P27_PROVIDERS = "Your drafting text is processed by Runware, which passes it to an OpenAI GPT model, and by Google Vertex AI (Gemini). Their servers may be outside India, including in the United States and the European Union. We do not send patient identifiers to Runware on its standard plan. A full list of our processors and sub-processors, the data shared with each, and the countries in which they process it, is available on request and is kept up to date on our data-sources page.";
const P28_OVERRIDE = "Override records are retained for at least one year for audit and breach investigation, and erased thereafter unless another law requires longer retention. They are erased on withdrawal of consent or when the purpose for which they were kept is spent, subject to that one-year hold.";
const P28_LITERATURE = "Literature search sends only your search words or article identifiers (such as a DOI, PMID or trial number) to PubMed, Europe PMC, Crossref, ClinicalTrials.gov and OpenAlex, which are mostly hosted in the United States. It never sends patient data. Do not type patient information into the search box.";
const P28_LOG = "What we log. When you override the patient-information block by confirming a false detection, we log your user ID, the time, the type of identifier flagged and the terms version, but never the text itself. We keep this log to show that the override was made lawfully.";
const P28_DELETION = "Deletion. On withdrawal of consent or deletion of your account, we erase your operational personal data within 30 days, and we require our processors to do the same. Data held in backups is suppressed from processing and erased on the backup cycle. We retain only the records the law requires us to keep, processing logs for one year, and erase those when that period ends.";
const P14_CLOUDFLARE = "Project data is served through Cloudflare's global network. Personal data may be cached or stored on Cloudflare edge servers outside India, including in the United States, the European Union and Singapore; where it is, that is a transfer outside India, which is permitted under the Digital Personal Data Protection Act 2023. Encrypted personal data in transit through Cloudflare's network is not stored or accessed in transit. Public, non-personal content may be cached on Cloudflare's global network.";

function istToday() {
  return new Date(Date.now() + 19800000).toISOString().slice(0, 10);
}
/* docs/research/PHI_OVERRIDE_TERMS.md still carries the settled v1 wording;
 * that file is outside this change, so the docs assertions below keep v1. */
const V1_OPT_CONSENT = "I have the patient's valid consent to share this text for this purpose, with institutional approval where required, and I can evidence it if asked.";
const V1_CONFIRM_2 = "The text will be sent to our AI providers \u2014 Runware and Google Vertex AI (Gemini) \u2014 whose servers may be outside India. StewardMD acts only as a Data Processor on your instructions. StewardMD logs this override (your user ID, the time, the type of identifier flagged and these terms version) but never the text itself. Always check AI output before use \u2014 it may be inaccurate, incomplete or biased.";
const V1_NOTE = "Note: overrides are not available for Aadhaar/ID numbers or phone numbers unless you have selected the third option (patient consent with institutional approval). If you are unsure, keep the block and remove the identifiers before drafting.";

function sliceBetween(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert.ok(start !== -1, "start marker not found: " + startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(end !== -1, "end marker not found: " + endMarker);
  return html.slice(start, end);
}

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
    let _value = "";

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
      get value() { return _value; },
      set value(v) { _value = String(v == null ? "" : v); },
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
        if (k === "value") _value = String(v);
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
        if (node.disabled) return;
        node.dispatchEvent({ type: "click", target: node });
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

function blocked422(categories, overridable, allowedConditions) {
  const body = {
    error: { code: "phi_blocked", message: "Patient identifiers detected.", requestId: "req-1" },
    categories
  };
  if (overridable !== undefined) body.overridable = overridable;
  if (allowedConditions !== undefined) body.allowedConditions = allowedConditions;
  return { ok: false, status: 422, text: async () => JSON.stringify(body) };
}

describe("ResearchMD /ai-draft PHI override dialog (one action: false detection)", () => {
  test("a client-side hit is a hard block (no dialog, no fetch, categories kept)", async () => {
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

  test("low-risk 422 renders the verbatim one-action copy and the exact single button label, then resends the exact override", async () => {
    const sb = createUiSandbox({
      fetchImpl: async (url, init, callNo) => {
        if (callNo === 1) return blocked422(["address"], true, ["false_positive"]);
        return { ok: true, status: 200, text: async () => JSON.stringify({ draft: { sections: { abstract: "Ok" } } }) };
      }
    });

    const callerBody = { task: "case_report_draft", input: { caseText: "Clean text after client redact" } };
    const reqPromise = sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", callerBody);
    await flushMicrotasks();

    assert.equal(sb.fetchCalls.length, 1);
    const modal = sb.dom.root.querySelector("#rmdPhiOverrideModal");
    assert.ok(modal, "dialog opened on server 422 overridable");
    assert.ok(modal.innerHTML.includes(TITLE), "title verbatim");
    assert.ok(modal.innerHTML.includes(BODY), "body verbatim");
    assert.ok(modal.innerHTML.includes(CONFIRM), "confirmation line verbatim");
    assert.match(modal.innerHTML, /<li>Address<\/li>/);

    assert.equal(modal.querySelectorAll("[data-rmd-phi-condition]").length, 0, "no radio list");
    assert.equal(modal.querySelector('[data-rmd-phi-consent-date="1"]'), null, "no consent date field");
    assert.equal(modal.querySelector('[data-rmd-phi-consent-ref="1"]'), null, "no consent reference field");
    assert.ok(!modal.innerHTML.includes("Date consent was given"));
    assert.ok(!modal.innerHTML.includes("Consent reference"));

    const send = modal.querySelector('[data-rmd-phi-send="1"]');
    assert.ok(send, "one override button");
    assert.equal(send.textContent, BUTTON, "the single button label is exact");
    assert.ok(modal.innerHTML.includes(">" + BUTTON + "</button>"), "the single button label renders verbatim");
    assert.equal(modal.querySelectorAll('[data-rmd-phi-send="1"]').length, 1, "exactly one override button");
    assert.equal(send.disabled, false, "the single action is available immediately");
    assert.ok(modal.querySelector('[data-rmd-phi-edit="1"]'), "the cancel button is kept");

    send.click();

    const res = await reqPromise;
    assert.equal(res.draft.sections.abstract, "Ok");
    assert.equal(sb.fetchCalls.length, 2);
    const secondBody = JSON.parse(sb.fetchCalls[1].init.body);
    assert.deepEqual(secondBody.phiOverride, {
      accepted: true,
      termsVersion: "rmd-phi-override-v2",
      condition: "false_positive"
    });
    assert.equal(secondBody.phiOverride.consentEvidence, undefined);
    assert.equal(callerBody.phiOverride, undefined, "caller body not mutated");
  });

  test("a phone hit shows the block with no override button and the never note", async () => {
    const sb = createUiSandbox({
      fetchImpl: async () => blocked422(["phone"], false, [])
    });

    const reqPromise = sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", {
      task: "case_report_draft",
      input: { caseText: "Clean text after client redact" }
    });
    await flushMicrotasks();

    const modal = sb.dom.root.querySelector("#rmdPhiOverrideModal");
    assert.ok(modal, "the block dialog opens for a never-overridable hit");
    assert.ok(modal.innerHTML.includes(TITLE), "title verbatim");
    assert.match(modal.innerHTML, /<li>Phone number<\/li>/);
    assert.ok(modal.innerHTML.includes(NEVER_NOTE), "never note verbatim");
    assert.equal(modal.querySelector('[data-rmd-phi-send="1"]'), null, "no override button");
    assert.equal(modal.querySelectorAll("[data-rmd-phi-condition]").length, 0, "no radio list");
    assert.ok(!modal.innerHTML.includes(BODY), "the continue copy is not shown");
    assert.ok(!modal.innerHTML.includes(CONFIRM), "the confirmation line is not shown");
    assert.ok(modal.querySelector('[data-rmd-phi-edit="1"]'), "the cancel button is kept");

    modal.querySelector('[data-rmd-phi-edit="1"]').click();
    await assert.rejects(reqPromise, (err) => err.code === "phi_blocked" && err.status === 422);
    assert.equal(sb.fetchCalls.length, 1, "no resend without an override action");
  });

  test("name, aadhaar, abha, mrn and phone show the never block even when a stale server says overridable", async () => {
    for (const category of ["patient_name", "aadhaar", "abha", "mrn", "phone"]) {
      const sb = createUiSandbox({
        fetchImpl: async () => blocked422([category], true, ["false_positive"])
      });

      const reqPromise = sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", {
        task: "case_report_draft",
        input: { caseText: "Clean text after client redact" }
      });
      await flushMicrotasks();

      const modal = sb.dom.root.querySelector("#rmdPhiOverrideModal");
      assert.ok(modal, "the block dialog opens for " + category);
      assert.ok(modal.innerHTML.includes(NEVER_NOTE), "never note verbatim for " + category);
      assert.equal(modal.querySelector('[data-rmd-phi-send="1"]'), null, "no override button for " + category);
      assert.ok(!modal.innerHTML.includes(CONFIRM), "no confirmation line for " + category);

      modal.querySelector('[data-rmd-phi-edit="1"]').click();
      await assert.rejects(reqPromise, (err) => {
        assert.equal(err.code, "phi_blocked");
        assert.equal(err.status, 422);
        assert.deepEqual(Array.from(err.categories), [category]);
        return true;
      });
      assert.equal(sb.fetchCalls.length, 1, "no resend for " + category);
    }
  });

  test("server 422 without overridable for a low-risk hit (switch off) opens no dialog and rejects", async () => {
    for (const overridableVal of [undefined, false, "true"]) {
      const sb = createUiSandbox({
        fetchImpl: async () => blocked422(["dates"], overridableVal, [])
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
      assert.equal(sb.dom.root.querySelector("#rmdPhiOverrideModal"), null,
        "no dialog while the server switch is off (" + String(overridableVal) + ")");
    }
  });

  test("server 422 overridable + Edit my text rejects with single fetch", async () => {
    const sb = createUiSandbox({
      fetchImpl: async () => blocked422(["address"], true, ["false_positive"])
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
      assert.deepEqual(Array.from(err.categories), ["address"]);
      return true;
    });
    assert.equal(sb.fetchCalls.length, 1);
  });

  test("never loops: a second 422 overridable after the override just rejects without reopening dialog", async () => {
    const sb = createUiSandbox({
      fetchImpl: async () => blocked422(["address"], true, ["false_positive"])
    });

    const reqPromise = sb.win.SMD_RESEARCH.api.request("POST", "/v1/projects/p1/ai-draft", {
      task: "case_report_draft",
      input: { caseText: "Clean text" }
    });
    await flushMicrotasks();

    sb.dom.root.querySelector('[data-rmd-phi-send="1"]').click();

    await assert.rejects(reqPromise, (err) => {
      assert.equal(err.code, "phi_blocked");
      assert.equal(err.status, 422);
      return true;
    });
    assert.equal(sb.fetchCalls.length, 2);
    assert.equal(sb.dom.root.querySelector("#rmdPhiOverrideModal"), null);
  });

  test("paths other than /ai-draft and POST /jobs never show override dialog even on 422 phi_blocked overridable:true", async () => {
    const paths = [
      ["POST", "/v1/projects/p1/extraction/suggestions", { studyId: "s1" }],
      ["POST", "/v1/projects/p1/ai-draft/subpath", { input: { text: "Clean" } }],
      ["GET", "/v1/projects/p1/ai-draft", undefined]
    ];

    for (const [method, path, body] of paths) {
      const sb = createUiSandbox({
        fetchImpl: async () => blocked422(["address"], true, ["false_positive"])
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

  test("CapacitorHttp 422 overridable opens the dialog and sends the exact override on confirm", async () => {
    const sb = createUiSandbox({
      withCapacitor: true,
      capImpl: async (reqOpts, callNo) => {
        if (callNo === 1) {
          return {
            status: 422,
            data: {
              error: { code: "phi_blocked", message: "Blocked.", requestId: "req-cap" },
              categories: ["address"],
              overridable: true,
              allowedConditions: ["false_positive"]
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
    assert.match(modal.innerHTML, /<li>Address<\/li>/);
    const send = modal.querySelector('[data-rmd-phi-send="1"]');
    assert.equal(send.textContent, BUTTON, "the single button label is exact");
    send.click();

    const res = await reqPromise;
    assert.equal(res.draft.capOk, true);
    assert.equal(sb.capCalls.length, 2);
    assert.deepEqual(
      JSON.parse(JSON.stringify(sb.capCalls[1].data.phiOverride)),
      { accepted: true, termsVersion: "rmd-phi-override-v2", condition: "false_positive" }
    );
  });

  test("docs contain the v1 terms, verbatim legal text, retention and draft marker", () => {
    const terms = readFileSync(join(ROOT, "docs/research/PHI_OVERRIDE_TERMS.md"), "utf8");
    const runbook = readFileSync(join(ROOT, "docs/research/RUNBOOK_PAPERORCHESTRA.md"), "utf8");
    const privacy = readFileSync(join(ROOT, "privacy.html"), "utf8");

    assert.ok(terms.startsWith("Draft v1 for counsel to settle\n"), "terms starts with the v1 settle marker");
    assert.match(terms, /rmd-phi-override-v1/);
    assert.match(terms, /rmd-phi-override-v0/);
    assert.match(terms, /DPDP Act/);
    assert.match(terms, /ai_phi_override/);
    assert.ok(terms.includes(V1_OPT_CONSENT), "terms reproduces the verbatim consent option");
    assert.ok(terms.includes(V1_CONFIRM_2), "terms reproduces the verbatim provider paragraph");
    assert.ok(terms.includes(V1_NOTE), "terms reproduces the verbatim note");
    assert.ok(terms.includes("\u2014"), "verbatim legal text keeps its em dashes");
    assert.equal(terms.indexOf("\u2013"), -1);
    assert.match(terms, /at least one year/);

    assert.match(runbook, /## Patient identifier override \(\/ai-draft only\)/);
    assert.match(runbook, /ai_phi_override/);
    assert.match(runbook, /rmd-phi-override-v1/);
    assert.match(runbook, /allowedConditions/);
    assert.match(runbook, /patient_name/);
    assert.match(runbook, /at least one year/);
    assert.match(runbook, /PHI_OVERRIDE_TERMS\.md/);
    assert.match(runbook, /Draft v1 for counsel to settle/);
    assert.equal(runbook.indexOf("\u2014"), -1);
    assert.equal(runbook.indexOf("\u2013"), -1);

    assert.match(privacy, /AI drafting and patient identifiers/);
    assert.ok(!/Draft for counsel review/.test(privacy), "counsel signed off (27 Nov 2026): no draft marker");
    assert.match(privacy, /at least one year/);
    assert.match(privacy, /Runware, which passes it to an OpenAI GPT model/); // real chain: Runware -> OpenAI GPT model (2026-11-27)
    assert.match(privacy, /Google Vertex AI \(Gemini\)/);
  });

  test("counsel wording 2026-11-27: terms and privacy carry the reviewed ResearchMD copy", () => {
    const terms = readFileSync(join(ROOT, "terms.html"), "utf8");
    const privacy = readFileSync(join(ROOT, "privacy.html"), "utf8");

    // Draft markers stay in place until instructed counsel approves the final text.
    assert.ok(!terms.includes("Draft for counsel review."), "counsel signed off: terms has no draft marker");
    assert.ok(!privacy.includes("Draft for counsel review."), "counsel signed off: privacy has no draft marker");

    // terms.html section 32: opening, review step, takedown, liability.
    assert.ok(terms.includes(T32_OPENING), "s32 opening paragraph verbatim");
    assert.ok(terms.includes(T32_REVIEW_STEP), "s32 review-step sentence kept as its own paragraph");
    assert.ok(terms.includes(T32_TAKEDOWN), "s32 takedown timeline verbatim");
    assert.ok(terms.includes(T32_LIABILITY), "s32 liability cap and carve-outs verbatim");
    assert.ok(terms.includes('(subject "ResearchMD grievance")'), "s32 keeps the Grievance Officer contact line");
    assert.equal(terms.indexOf("<li><b>What ResearchMD is.</b>"), -1, "old What ResearchMD is item replaced");
    assert.equal(terms.indexOf("<li><b>AI output.</b>"), -1, "old AI output item replaced");
    assert.equal(terms.indexOf("<li><b>Ownership of your drafts.</b>"), -1, "old ownership item replaced");
    assert.equal(terms.indexOf("<li><b>Prohibited use.</b>"), -1, "old prohibited use item replaced");
    assert.equal(terms.indexOf("We acknowledge within 24 hours and resolve within 7 days"), -1, "old takedown timeline replaced");
    assert.equal(terms.indexOf("and nothing in these Terms limits liability"), -1, "old s32 liability tail replaced");

    // privacy.html section 27: provider chain.
    assert.ok(privacy.includes(P27_PROVIDERS), "p27 provider chain verbatim");
    assert.equal(privacy.indexOf("Runware, which passes it to the AI model in use"), -1, "old p27 provider sentence replaced");

    // privacy.html section 28: retention, literature, logging, deletion.
    assert.ok(privacy.includes(P28_OVERRIDE), "p28 override retention verbatim");
    assert.ok(privacy.includes(P28_LITERATURE), "p28 literature paragraph verbatim");
    assert.ok(privacy.includes(P28_LOG), "p28 what we log paragraph verbatim");
    assert.ok(privacy.includes(P28_DELETION), "p28 deletion paragraph verbatim");
    assert.equal(privacy.indexOf("Override records are kept for at least one year for audit."), -1, "old p28 override sentence replaced");
    assert.equal(privacy.indexOf("Literature features send only bibliographic identifiers"), -1, "old p28 literature sentence replaced");

    // privacy.html section 14: Cloudflare storage and transfers.
    assert.ok(privacy.includes(P14_CLOUDFLARE), "p14 Cloudflare storage paragraph verbatim");

    // Keywords the counsel brief requires on the pages.
    assert.ok(terms.includes("wilful misconduct"), "terms: wilful misconduct");
    assert.ok(terms.includes("36 hours"), "terms: 36 hours");
    assert.ok(privacy.includes("OpenAI GPT model"), "privacy: OpenAI GPT model");
    assert.ok(privacy.includes("within 30 days"), "privacy: within 30 days");

    // No em or en dash inside the new paragraphs (scoped to the changed sections;
    // the kept p14 GDPR sentence predates this change and is excluded by slicing
    // only the new Cloudflare paragraph).
    const s32 = sliceBetween(terms, 'id="s32"', 'class="foot"');
    const p27 = sliceBetween(privacy, 'id="p27"', 'id="p28"');
    const p28 = sliceBetween(privacy, 'id="p28"', 'class="foot"');
    const p14Cloudflare = sliceBetween(privacy, "Project data is served through Cloudflare", "</p>");
    const dashFree = { "terms s32": s32, "privacy p27": p27, "privacy p28": p28, "privacy p14 Cloudflare": p14Cloudflare };
    for (const [name, text] of Object.entries(dashFree)) {
      assert.equal(text.indexOf("\u2014"), -1, name + " contains no em dash");
      assert.equal(text.indexOf("\u2013"), -1, name + " contains no en dash");
    }
    assert.equal(/region/i.test(p14Cloudflare), false, "Cloudflare paragraph claims no region controls");
  });
});
