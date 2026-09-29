/* StewardMD - Clinical Bulletins on the disease reader (window.SMD_BULLETINS).
 *
 * Up to three short practice updates a registered doctor has read against the primary source and signed,
 * shown above the reference content when a disease opens (reasoning.js openDiseaseRef). The server list
 * holds only live signed bulletins (functions/_bulletins_api.js); this file keeps an offline copy and draws
 * the card. card() is also the Review Desk preview, so a signer signs exactly what the bedside shows.
 *
 * Rules (docs/CLINICAL_AUTO_UPDATE_ENGINEERING_SPEC.md): nothing when the flag is off; nothing from a copy
 * older than 7 days (a one-line notice instead, never silence that reads as "nothing changed"); never a
 * "no updates" line for a disease without bulletins; unknown disease ids ignored; links only for https.
 * Flag: smd_kb_bulletins, default ON (owner, 2026-09-28). ?bulletins=0 or localStorage "0" turns it off on this device;
 * the server kill switch (Review Desk, bulletin_settings) turns it off everywhere. Buildless ES5.
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  var LS_CACHE = "smd_kb_bulletins_v1", LS_FLAG = "smd_kb_bulletins";
  var MAX_AGE = 7 * 86400000, SYNC_EVERY = 6 * 3600000, MAX_SHOW = 3;
  var KIND = { safety: "Safety alert", approval: "New approval", guideline: "Guideline change", trial: "Trial result" };
  var KIND_ORDER = { safety: 0, approval: 1, guideline: 2, trial: 3 };
  var INDIA = {
    cdsco_approved: ["Approved by CDSCO", ""], not_approved_india: ["Not yet approved in India", "warn"],
    not_applicable: ["Not applicable", ""], unknown: ["India status not confirmed", "warn"],
  };
  var EVID = { regulatory_approval: "Regulatory approval", regulatory_safety: "Regulatory safety communication", guideline: "Guideline", rct: "Randomised controlled trial", meta_analysis: "Meta-analysis" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function now() { return Date.now(); }
  function apiUrl(p) { return (G.SMD_API_BASE || "") + p; }

  function flagOn() {
    try {
      var q = (G.location.search.match(/[?&]bulletins=([^&]+)/) || [])[1];
      if (q === "1" || q === "true") return true;
      if (q === "0" || q === "false") return false;
      return G.localStorage.getItem(LS_FLAG) !== "0";
    } catch (e) { return true; }
  }

  function readCache() {
    try { var o = JSON.parse(G.localStorage.getItem(LS_CACHE) || "null"); return o && typeof o === "object" && Array.isArray(o.items) ? o : null; } catch (e) { return null; }
  }
  function writeCache(o) { try { G.localStorage.setItem(LS_CACHE, JSON.stringify(o)); } catch (e) {} }

  function httpsUrl(u) {
    u = String(u || "");
    if (!/^https:\/\/[^\s"'<>]+$/i.test(u)) return "";
    try { return new URL(u).protocol === "https:" ? u : ""; } catch (e) { return ""; }
  }
  // "2026-09-12" or epoch ms -> "12 Sep 2026" (fixed English months: no locale drift between devices)
  function fmtDate(v) {
    var d = typeof v === "number" ? new Date(v) : (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? new Date(v + "T00:00:00Z") : null);
    if (!d || isNaN(d.getTime())) return "";
    return d.getUTCDate() + " " + MON[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }
  function fmtMonth(ts) { var d = new Date(ts); return isNaN(d.getTime()) ? "" : MON[d.getUTCMonth()] + " " + d.getUTCFullYear(); }
  function drName(n) { n = String(n || "").replace(/^\s*dr\.?\s+/i, ""); return n ? "Dr " + n : ""; }

  // [b]..[/b], [i]..[/i], [u]..[/u] from the Review Desk toolbar. Applied AFTER escaping, with fixed tags only,
  // so formatting can never inject markup. Unpaired markers stay as typed.
  function fmt(escaped) {
    return String(escaped).replace(/\[b\]([\s\S]+?)\[\/b\]/g, "<b>$1</b>").replace(/\[i\]([\s\S]+?)\[\/i\]/g, "<i>$1</i>").replace(/\[u\]([\s\S]+?)\[\/u\]/g, "<u>$1</u>");
  }
  function plain(s) { return String(s == null ? "" : s).replace(/\[\/?[biu]\]/g, ""); }

  /* One bulletin as the bedside shows it. Pure: same input, same markup (the signer's preview relies on it). */
  function card(b) {
    var ind = INDIA[b.india_status] || INDIA.unknown;
    var url = httpsUrl(b.source_url);
    var ev = (EVID[b.evidence_type] || "") + (b.evidence_note ? ", " + b.evidence_note : "");
    var src = url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(b.source_label) + "</a>" : esc(b.source_label);
    // DOI and PubMed links beside the source, so any reader can check the paper (validated shapes only).
    var doi = /^10\.\d{4,9}\/\S+$/.test(String(b.doi || "")) ? b.doi : "", pmid = /^\d{1,10}$/.test(String(b.pmid || "")) ? b.pmid : "";
    if (doi && url.indexOf("doi.org/") < 0) src += ' · <a href="https://doi.org/' + esc(doi) + '" target="_blank" rel="noopener noreferrer">DOI</a>';
    if (pmid) src += ' · <a href="https://pubmed.ncbi.nlm.nih.gov/' + esc(pmid) + '/" target="_blank" rel="noopener noreferrer">PubMed</a>';
    var sig = drName(b.signed_name)
      ? "Reviewed by " + esc(drName(b.signed_name)) + ', <span class="smd-bl-nw">Reg. No. ' + esc(b.signed_reg) + "</span>" + (b.signed_council ? ", " + esc(b.signed_council) : "") +
        ", on " + esc(fmtDate(b.signed_ts)) + ". Review due " + esc(fmtMonth(b.review_due_ts)) + "."
      : "Not yet reviewed.";
    return '<section class="smd-bl smd-bl-' + esc(KIND[b.kind] ? b.kind : "guideline") + '" aria-label="Practice update">' +
      '<div class="smd-bl-top"><span class="smd-bl-kind">' + esc(KIND[b.kind] || "Practice update") + '</span><span class="smd-bl-date">' + esc(fmtDate(b.source_date)) + "</span></div>" +
      '<h4 class="smd-bl-h">' + fmt(esc(b.headline)) + "</h4>" +
      '<p class="smd-bl-p">' + fmt(esc(b.what_changed)) + "</p>" +
      (b.applies_to ? '<p class="smd-bl-row"><b>Applies to:</b> ' + fmt(esc(b.applies_to)) + "</p>" : "") +
      '<p class="smd-bl-row smd-bl-in' + (ind[1] ? " " + ind[1] : "") + '"><b>In India:</b> ' + esc(ind[0]) + "</p>" +
      (ev ? '<p class="smd-bl-row"><b>Evidence:</b> ' + esc(ev) + "</p>" : "") +
      '<p class="smd-bl-row"><b>Source:</b> ' + src + "</p>" +
      '<p class="smd-bl-sig">' + sig + "</p>" +
      '<p class="smd-bl-foot">Check your local protocol before acting.</p>' +
      "</section>";
  }

  function knownDisease(id) { var b = G.KB_ENRICHMENT && G.KB_ENRICHMENT.byId; return !!(b && Object.prototype.hasOwnProperty.call(b, id)); }

  /* Pure selection: this disease, known id, review not due, safety first then newest source, at most 3. */
  function select(items, diseaseId, t) {
    if (!knownDisease(diseaseId)) return [];
    return (items || []).filter(function (b) {
      return b && Array.isArray(b.disease_ids) && b.disease_ids.indexOf(diseaseId) >= 0 && Number(b.review_due_ts) > t && b.headline && b.what_changed;
    }).sort(function (a, b) {
      var k = (KIND_ORDER[a.kind] == null ? 9 : KIND_ORDER[a.kind]) - (KIND_ORDER[b.kind] == null ? 9 : KIND_ORDER[b.kind]);
      if (k) return k;
      return a.source_date < b.source_date ? 1 : a.source_date > b.source_date ? -1 : (a.id < b.id ? -1 : 1);
    }).slice(0, MAX_SHOW);
  }

  /* Markup for the disease reader, or "" when there is nothing to show. */
  function html(diseaseId) {
    if (!flagOn()) return "";
    injectCSS();
    var c = readCache(), t = now();
    if (!c || c.enabled === false) { sync(); return ""; }
    if (!(t - Number(c.fetchedAt) <= MAX_AGE)) {
      sync();
      return '<p class="smd-bl-stale">Practice updates not shown: last synced ' + esc(fmtDate(Number(c.fetchedAt)) || "a while ago") + ". Connect to refresh.</p>";
    }
    var list = select(c.items, diseaseId, t);
    if (!list.length) return "";
    return '<div class="smd-bls"><div class="smd-bls-h">Practice updates</div>' + list.map(card).join("") + "</div>";
  }

  var _inflight = null;
  function sync(force) {
    if (!flagOn() || !G.fetch) return Promise.resolve(false);
    if (_inflight) return _inflight;
    try { if (G.navigator && G.navigator.onLine === false) return Promise.resolve(false); } catch (e) {}
    var c = readCache();
    if (!force && c && now() - Number(c.fetchedAt) < SYNC_EVERY) return Promise.resolve(false);
    var h = {};
    if (c && c.etag && c.enabled !== false) h["If-None-Match"] = c.etag;
    _inflight = G.fetch(apiUrl("/api/updates/bulletins"), { headers: h, cache: "no-store" }).then(function (r) {
      if (r.status === 304 && c) { c.fetchedAt = now(); writeCache(c); return true; }
      if (!r.ok) return false;
      return r.json().then(function (d) {
        if (!d || d.enabled === false) { writeCache({ fetchedAt: now(), etag: "", enabled: false, items: [] }); return true; }   // kill switch: drop the copy
        writeCache({ fetchedAt: now(), etag: r.headers.get("ETag") || "", enabled: true, items: Array.isArray(d.items) ? d.items : [] });
        return true;
      });
    }).catch(function () { return false; }).then(function (x) { _inflight = null; return x; });
    return _inflight;
  }

  var CSS =
    ".smd-bls{margin:0 0 18px}" +
    ".smd-bls-h{font:700 12px/1.3 var(--sans,-apple-system,system-ui,sans-serif);letter-spacing:.06em;text-transform:uppercase;color:var(--mut,#64748b);margin:0 0 8px}" +
    ".smd-bl{border:1px solid var(--line,#e2e8f0);border-left:4px solid #0f766e;border-radius:12px;background:var(--panel,#fff);color:var(--ink,#0f172a);padding:12px 14px;margin:0 0 10px;font:14px/1.5 var(--sans,-apple-system,system-ui,sans-serif);overflow-wrap:anywhere}" +
    ".smd-bl-safety{border-left-color:#b91c1c}" +
    ".smd-bl-top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}" +
    ".smd-bl-kind{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:rgba(15,118,110,.1);color:#0f766e}" +
    ".smd-bl-safety .smd-bl-kind{background:rgba(185,28,28,.1);color:#b91c1c}" +
    ".smd-bl-date{font-size:12px;color:var(--mut,#64748b);white-space:nowrap}" +
    ".smd-bl-h{margin:0 0 4px;font-size:15px;font-weight:700;line-height:1.35}" +
    ".smd-bl-p{margin:0 0 8px}" +
    ".smd-bl-row{margin:0 0 4px;font-size:13px}" +
    ".smd-bl-in.warn{color:#b45309;font-weight:600}" +
    ".smd-bl-row a{color:var(--reader-accent,#0f766e);font-weight:600}" +
    ".smd-bl-sig{margin:8px 0 2px;padding-top:8px;border-top:1px solid var(--line,#e2e8f0);font-size:12px;color:var(--mut,#64748b)}" +
    ".smd-bl-nw{white-space:nowrap}" +
    ".smd-bl-foot{margin:0;font-size:12px;font-weight:600;color:var(--ink,#0f172a)}" +
    ".smd-bl-stale{margin:0 0 14px;font-size:12px;color:var(--mut,#64748b)}" +
    "body.dark .smd-bl{background:var(--panel,#111827);color:var(--ink,#e5e7eb)}" +
    "body.dark .smd-bl-in.warn{color:#fbbf24}body.dark .smd-bl-kind{color:#5eead4}body.dark .smd-bl-safety .smd-bl-kind{color:#fca5a5}";
  function injectCSS() {
    if (!D || D.getElementById("smdBulletinCss")) return;
    var s = D.createElement("style"); s.id = "smdBulletinCss"; s.textContent = CSS; (D.head || D.documentElement).appendChild(s);
  }

  function boot() {
    if (!flagOn()) return;
    sync();
    try {
      D.addEventListener("visibilitychange", function () { if (D.visibilityState === "visible") sync(); });
      G.addEventListener("online", function () { sync(); });
    } catch (e) {}
  }
  if (D && D.readyState === "loading") D.addEventListener("DOMContentLoaded", boot); else if (D) setTimeout(boot, 0);

  var API = {
    html: html, card: card, sync: sync, flagOn: flagOn, injectCSS: injectCSS,
    KIND: KIND, INDIA: INDIA, EVID: EVID, MAX_AGE: MAX_AGE,
    _select: select, _readCache: readCache, _fmtDate: fmtDate, _httpsUrl: httpsUrl, _fmt: fmt, plain: plain,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_BULLETINS = API;
})(typeof window !== "undefined" ? window : globalThis);
