/* StewardMD - ResearchMD plan v2 screen kit (window.SMD_RESEARCH.kit).
 * ES5 only, buildless. Small shared helpers for the v2 step screens:
 * project lookup, RMDStore load and save, plain form fields, calm banners,
 * file download, SHA-256. Pure helpers are exported for tests.
 */
(function (G) {
  "use strict";

  var SMD = G ? (G.SMD_RESEARCH = G.SMD_RESEARCH || {}) : {};

  function esc(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function store() { return G && G.RMDStore ? G.RMDStore : null; }

  function project() {
    return SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
  }

  /* Server routes take the server project id; local-only projects have none. */
  function apiPid(proj) { return proj ? (proj.serverId || proj.id) : ""; }

  function typeKey(proj) {
    var C = G && G.SMD_RESEARCH_CONTRACTS;
    return C && C.typeKey ? C.typeKey((proj && proj.studyType) || "") : "";
  }

  function load(pid, kind, id) {
    var S = store();
    if (!S) return Promise.resolve(null);
    return S.get(pid, kind, id || "main").then(function (v) { return v; }, function () { return null; });
  }

  function save(pid, kind, id, value) {
    var S = store();
    if (!S) return Promise.reject(new Error("research: The research store is not loaded."));
    return S.put(pid, kind, id || "main", value);
  }

  function noProject(container) {
    container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project first.</p>' +
      '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-kit="to-projects">Go to Projects</button></div>';
    var b = container.querySelector('[data-rmd-kit="to-projects"]');
    if (b) b.onclick = function () { if (SMD.navigate) SMD.navigate("projects", {}); };
  }

  function header(title, subtitle) {
    return '<div class="rmd-screen-header"><h2 class="rmd-screen-title">' + esc(title) + '</h2>' +
      (subtitle ? '<p class="rmd-screen-subtitle">' + esc(subtitle) + '</p>' : '') + '</div>';
  }

  function banner(text, tone) {
    return '<div class="rmd-banner' + (tone ? " rmd-banner-" + esc(tone) : "") + '" role="status">' + esc(text) + '</div>';
  }

  /* field({ name, label, type: text|textarea|number|date|select|check, value, options: [[v, label]], example, help }) */
  function field(f) {
    var id = "rmd_k_" + f.name, v = f.value == null ? "" : f.value, h = '<div class="rmd-field">', i;
    if (f.type === "check") {
      h += '<label class="rmd-check"><input type="checkbox" id="' + id + '" data-k="' + esc(f.name) + '"' + (v ? " checked" : "") + '> ' + esc(f.label) + '</label>';
    } else {
      h += '<label for="' + id + '">' + esc(f.label) + '</label>';
      if (f.type === "textarea") {
        h += '<textarea id="' + id + '" data-k="' + esc(f.name) + '" rows="' + (f.rows || 3) + '"' + (f.example ? ' placeholder="' + esc(f.example) + '"' : '') + '>' + esc(v) + '</textarea>';
      } else if (f.type === "select") {
        h += '<select id="' + id + '" data-k="' + esc(f.name) + '">';
        for (i = 0; i < f.options.length; i++) {
          h += '<option value="' + esc(f.options[i][0]) + '"' + (String(v) === String(f.options[i][0]) ? " selected" : "") + '>' + esc(f.options[i][1]) + '</option>';
        }
        h += '</select>';
      } else {
        h += '<input type="' + (f.type || "text") + '" id="' + id + '" data-k="' + esc(f.name) + '" value="' + esc(v) + '"' + (f.example ? ' placeholder="' + esc(f.example) + '"' : '') + '>';
      }
    }
    if (f.help) h += '<p class="rmd-mut">' + esc(f.help) + '</p>';
    return h + '</div>';
  }

  /* Read every [data-k] input inside el into an object. */
  function read(el, into) {
    var o = into || {}, list = el.querySelectorAll("[data-k]"), i, x;
    for (i = 0; i < list.length; i++) {
      x = list[i];
      o[x.getAttribute("data-k")] = x.type === "checkbox" ? !!x.checked : x.value;
    }
    return o;
  }

  /* Through the shared native-safe helper (Filesystem CACHE plus Share sheet on the phone). */
  function download(name, text, mime) {
    var p2 = SMD.p2;
    if (!p2 || !p2.downloadText) return Promise.reject(new Error("research: This phone cannot save the file."));
    return p2.downloadText(name, text, mime || "text/plain");
  }

  function sha256Hex(text) {
    var sc = G && G.crypto && G.crypto.subtle;
    if (!sc) return Promise.reject(new Error("research: This phone cannot make a fingerprint."));
    var bytes = new G.TextEncoder().encode(text);
    return sc.digest("SHA-256", bytes).then(function (buf) {
      var a = new Uint8Array(buf), s = "", i;
      for (i = 0; i < a.length; i++) s += (a[i] < 16 ? "0" : "") + a[i].toString(16);
      return s;
    });
  }

  /* Calm banners for data-entry steps (plan v2 items 5 and 7). Never blocks. */
  var IEC_BANNER = "Your ethics committee has not approved this study yet. Under ICMR 2017 guidelines, only the ethics committee can decide that a study is exempt.";
  var CTRI_BANNER = "Register on CTRI before you enrol the first patient.";

  function gateMessages(kind, iec, ctri) {
    var out = [];
    if (kind && kind !== "case-report" && kind !== "case-series") {
      var s = iec && iec.status;
      if (s !== "approved" && s !== "waiver") out.push(IEC_BANNER);
    }
    if (kind === "rct" && !(ctri && ctri.number && CTRI_RE.test(ctri.number))) out.push(CTRI_BANNER);
    return out;
  }

  var CTRI_RE = /^CTRI\/\d{4}\/\d{2,3}\/\d{6}$/;

  function gateBannersHtml(proj) {
    if (!proj) return Promise.resolve("");
    var kind = typeKey(proj);
    if (!kind) return Promise.resolve("");
    return Promise.all([load(proj.id, "iec"), load(proj.id, "ctri")]).then(function (r) {
      var m = gateMessages(kind, r[0], r[1]), h = "", i;
      for (i = 0; i < m.length; i++) h += banner(m[i]);
      return h;
    });
  }

  var kit = {
    esc: esc, project: project, apiPid: apiPid, typeKey: typeKey, load: load, save: save, noProject: noProject,
    header: header, banner: banner, field: field, read: read, download: download, sha256Hex: sha256Hex,
    gateMessages: gateMessages, gateBannersHtml: gateBannersHtml, CTRI_RE: CTRI_RE,
    IEC_BANNER: IEC_BANNER, CTRI_BANNER: CTRI_BANNER
  };

  SMD.kit = kit;
  if (typeof module !== "undefined" && module.exports) { module.exports = kit; }

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : undefined));
