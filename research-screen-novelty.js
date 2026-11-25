/* StewardMD - ResearchMD novelty check (SMD_RESEARCH.screens.novelty).
 * ES5 only. Plan v2 item 2: search published cases with the diagnosis plus the
 * unusual feature only (never the patient's details), through the existing
 * find-studies route (PubMed and Europe PMC, no MaiK tokens). "Add to my
 * references" keeps the paper in RMDStore kind "draftmeta", id "references".
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var STOP = /\b(the|a|an|of|in|on|with|and|or|to|for|after|before|by|from|at|as|is|was|were|be|been|this|that|which|patient|patients|case|our|we)\b/gi;

  /* Pure: query from the diagnosis plus the unusual feature, at most 12 words. */
  function buildQuery(cf) {
    var v = cf || {}, text = String(v.diagnosis || "") + " " + String(v.novelty || "");
    text = text.replace(/[^\w\s-]/g, " ").replace(STOP, " ").replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    var w = text ? text.split(" ") : [], seen = {}, out = [], i;
    for (i = 0; i < w.length && out.length < 12; i++) {
      var k = w[i].toLowerCase();
      if (k.length > 1 && !seen[k]) { seen[k] = 1; out.push(w[i]); }
    }
    return out.join(" ");
  }

  function countLine(n) {
    return n === 0 ? "We found no similar published cases with these words. Try other words before you call it the first."
      : "We found " + n + " similar published case" + (n === 1 ? "" : "s") + ".";
  }

  var st = { q: "", results: null, refs: [], busy: false, error: "" };

  function render(container) {
    var K = SMD.kit, proj = K.project();
    if (!proj) { K.noProject(container); return; }
    st.results = null; st.error = ""; st.busy = false;
    container.innerHTML = K.header("Is it new?", "Loading...");
    Promise.all([K.load(proj.id, "casefile", "1"), K.load(proj.id, "draftmeta", "references")]).then(function (r) {
      st.q = buildQuery(r[0]);
      st.refs = (r[1] && r[1].items) || [];
      draw(container, proj);
    });
  }

  function key(p) { return String(p.pmid || p.doi || p.title || ""); }

  function draw(container, proj) {
    var K = SMD.kit, h = [], i, have = {};
    for (i = 0; i < st.refs.length; i++) have[key(st.refs[i])] = 1;
    h.push(K.header("Is it new?", "Look for similar published cases"));
    h.push('<div class="rmd-card rmd-form">' + K.field({ name: "q", label: "Search words (the diagnosis and what is unusual)", value: st.q, example: "zinc phosphide myocarditis ST elevation" }));
    h.push('<p class="rmd-mut">Only these words are searched. Nothing about the patient is sent.</p>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-nv="go"' + (st.busy ? " disabled" : "") + '>Search</button></div>');
    if (st.error) h.push(K.banner(st.error, "warn"));
    if (st.results) {
      h.push('<div class="rmd-card"><p class="rmd-p">' + K.esc(countLine(st.results.length)) + '</p>');
      for (i = 0; i < st.results.length; i++) {
        var p = st.results[i];
        h.push('<div class="rmd-sub-card"><p class="rmd-p"><strong>' + K.esc(p.title || "Untitled") + '</strong></p><p class="rmd-mut">' +
          K.esc([p.journal, p.year, p.pmid ? "PMID " + p.pmid : ""].filter(Boolean).join(", ")) + '</p>' +
          (have[key(p)] ? '<p class="rmd-mut">In your references</p>' : '<button type="button" class="rmd-btn rmd-btn-sm" data-rmd-nv-add="' + i + '">Add to my references</button>') + '</div>');
      }
      h.push('</div>');
    }
    container.innerHTML = '<div class="rmd-nv-screen">' + h.join("") + '</div>';
    container.querySelector('[data-rmd-nv="go"]').onclick = function () {
      st.q = K.read(container, {}).q || "";
      if (!st.q.replace(/\s+/g, "")) { st.error = "Type some words to search for."; draw(container, proj); return; }
      st.busy = true; st.error = ""; draw(container, proj);
      SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(K.apiPid(proj)) + "/find-studies", { q: st.q, limit: 20 }).then(function (d) {
        st.busy = false; st.results = (d && d.results) || []; draw(container, proj);
      }, function (err) {
        st.busy = false;
        st.error = (SMD.p2 && SMD.p2.friendlyError) ? SMD.p2.friendlyError(err).message : "Search failed. Try again.";
        draw(container, proj);
      });
    };
    var adds = container.querySelectorAll("[data-rmd-nv-add]");
    for (i = 0; i < adds.length; i++) {
      adds[i].onclick = function () {
        var p = st.results[+this.getAttribute("data-rmd-nv-add")];
        st.refs.push({ pmid: p.pmid || "", doi: p.doi || "", title: p.title || "", journal: p.journal || "", year: p.year || "", authors: p.authors || "" });
        K.save(proj.id, "draftmeta", "references", { items: st.refs }).then(function () { draw(container, proj); });
      };
    }
  }

  SMD.screens.novelty = { render: render, buildQuery: buildQuery, countLine: countLine };

})(typeof window !== "undefined" ? window : globalThis);
