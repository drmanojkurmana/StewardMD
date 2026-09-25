/* Drug Interactions: the existing MEDAPI catalogue, local spelling candidates,
 * and opt-in OpenMed extraction. Catalogue identity and interaction coverage are
 * separate. No fuzzy match or model output is silently adopted as a drug. */
(function (W) {
  "use strict";
  var PHARMA = {
    repo: "OpenMed/OpenMed-NER-PharmaDetect-TinyMed-65M-v1-onnx-android",
    revision: "58e8e4e79958de9032042ad9a57e788e82f35ea2",
    types: { CHEM: 1, CHEMICAL: 1, DRUG: 1, MEDICATION: 1 }, minScore: 0.65,
    files: {
      model: { name: "model_int8.onnx", bytes: 133609334, sha256: "e93495efb6785e4458c3199f9aa3e8cf3af01aad9b3a211acbdfcfab319e0984" },
      tokenizer: { name: "tokenizer.json", bytes: 669188, sha256: "ca505be6b19b59c080886f9c41db8971878f4876cb59cdf87aa30b34fee28d67" },
      labels: { name: "id2label.json", bytes: 48, sha256: "c7200b2d6f1b15d4f3600f57e65a44f9973f327ae88bfc4a7da3fc51d8af28e6" }
    },
    licence: { declared: "apache-2.0", verified: true, verifiedOn: "2026-09-25",
      source: "https://huggingface.co/OpenMed/OpenMed-NER-PharmaDetect-TinyMed-65M-v1-onnx-android/blob/58e8e4e79958de9032042ad9a57e788e82f35ea2/README.md" }
  };
  function key(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function clean(s) {
    return key(s).replace(/\([^)]*\)/g, " ").replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|units?)\b/g, " ").replace(/\s+/g, " ").trim();
  }
  function vocabulary() {
    var ir = W.INTERACTION_RULES || {}, all = (ir.generics || []).concat(Object.keys(ir.drugClasses || {})), seen = {};
    ((W.MEDDRUGS && W.MEDDRUGS._list) || []).forEach(function (d) { all.push(d.generic); });
    return all.map(key).filter(function (s) { if (!s || seen[s]) return false; seen[s] = true; return true; });
  }
  function local(q) {
    q = key(q); if (!q) return [];
    var rows = W.MEDDRUGS && W.MEDDRUGS.searchIndex ? W.MEDDRUGS.searchIndex(q).slice() : [];
    rows = rows.map(function (r) { return Object.assign({}, r, { suggested: r.rank === 3 }); });
    var words = vocabulary();
    words.forEach(function (g) { if (g.indexOf(q) !== -1) rows.push({ generic: g, brands: [], rank: g === q ? 0 : 2 }); });
    if (W.DrugFuzzy) {
      var hit = W.DrugFuzzy.bestGenericMatch(q, words);
      if (hit && hit.distance > 0) rows.push({ generic: hit.generic, brands: [], suggested: true, rank: 3 });
    }
    return merge(rows, []).slice(0, 30);
  }
  function merge(a, b) {
    var out = [], seen = {};
    a.concat(b).forEach(function (r) {
      var g = clean(r.generic || r.composition); if (!g) return;
      if (seen[g]) {
        var old = seen[g];
        (Array.isArray(r.brands) ? r.brands : (r.brand ? [r.brand] : [])).forEach(function (brand) { if (old.brands.indexOf(brand) < 0) old.brands.push(brand); });
        if (r.suggested !== true) old.suggested = false;
        return;
      }
      var item = Object.assign({}, r, { generic: g, brands: Array.isArray(r.brands) ? r.brands.slice() : (r.brand ? [r.brand] : []), cls: r.cls || r.class || "" });
      seen[g] = item; out.push(item);
    });
    return out.sort(function (x, y) { return Number(!!x.suggested) - Number(!!y.suggested) || (x.rank == null ? 2 : x.rank) - (y.rank == null ? 2 : y.rank); });
  }
  function bounded(p, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error("timeout")); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
    });
  }
  function lookup(fn, q) {
    if (typeof fn !== "function") return Promise.resolve({ results: [], unavailable: true });
    return bounded(Promise.resolve().then(function () { return fn(q, 25); }), 8000)
      .then(function (d) { return d || { results: [], unavailable: true }; }, function () { return { results: [], unavailable: true }; });
  }
  function search(q) {
    q = key(q); var base = local(q), api = W.MEDAPI || {};
    if (q.length < 2) return Promise.resolve({ rows: base, unavailable: false });
    return Promise.all([lookup(api.searchCompositions, q), lookup(api.searchBrands, q)]).then(function (d) {
      var remote = (d[0].results || []).concat(d[1].results || []);
      return { rows: merge(base, remote), unavailable: !!d[0].unavailable || !!d[1].unavailable };
    });
  }
  // Explicit tap only. Text never leaves the device. An extracted mention is a
  // candidate; the caller presents it for confirmation and catalogue resolution.
  function extract(text) {
    if (!W.SMD_OPENMED_NER) return Promise.reject(new Error("Drug reader unavailable. Try again after reopening the module."));
    if (String(text).length > 6000) return Promise.reject(new Error("Read up to 6,000 characters at a time."));
    var failed = false;
    return bounded(W.SMD_OPENMED_NER.extract("pharma", text, { pack: PHARMA, onError: function () { failed = true; } }), 90000).then(function (rows) {
      if (failed) throw new Error("The on-device reader could not load. Retry, or enter one medicine per line.");
      return rows;
    });
  }
  W.SMD_DDI_CATALOG = { search: search, local: local, extract: extract, pharmaPack: PHARMA };
})(window);
