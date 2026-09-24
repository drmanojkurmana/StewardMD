/* openmed-ner.js — window.SMD_OPENMED_NER
 *
 * On-device biomedical entity tagging with two OpenMed checkpoints (github.com/maziyarpanahi/openmed):
 *   pharma   OpenMed/OpenMed-NER-PharmaDetect-TinyMed-65M-v1-onnx-android   drug / medication mentions
 *   disease  OpenMed/OpenMed-NER-DiseaseDetect-TinyMed-65M-v1-onnx-android  disease / condition mentions
 * Both are 65M-parameter DistilBERT token classifiers, run through the vendored onnxruntime-web that
 * ThoreX and KardiQ X already load (WASM, single thread: capacitor:// is not cross-origin isolated).
 * Weights are downloaded on first use and cached (thorex-model-cache.js), never bundled.
 *
 * FAILS CLOSED. A pack loads only when every file carries a pinned sha256 AND `licence.verified` is
 * true. Both are empty on purpose: the checkpoints' Hugging Face licence pages and files could not be
 * reached from the session that wrote this (network policy), and the owner's rule is that no model
 * ships until its exact checkpoint licence is verified as Apache-2.0. OpenMed's own catalog
 * (models.jsonl @ 4213739) declares both "apache-2.0". To enable: open each repo, confirm the licence,
 * record the sha256 and byte size of model_int8.onnx, tokenizer.json and id2label.json below, set
 * licence.verified, then turn the flag on. Until then every call resolves to [] and nothing downloads.
 *
 * Flags (localStorage, DEFAULT OFF): smd_openmed_pharma, smd_openmed_disease ("1" = on).
 *
 * Advisory only. Output feeds two places that already tolerate an empty answer: extra drug names for
 * claim grounding (kb/ai/maik-grounding.js, stricter checking only) and splitting a diagnosis into
 * conditions for ICD suggestions (scribe-icdsug.js, offered for a tap, never assigned).
 *
 * extract(kind, text, opts) -> Promise<[{type, text, start, end, score}]>   never rejects
 *   opts (tests / harness): { pack, ort, loadBytes, force }  all injectable
 * ES5 + BigInt64Array (needed for int64 tensors). node + browser.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SMD_OPENMED_NER = api;
})(typeof window !== "undefined" ? window : null, function (W) {
  "use strict";

  var HF = "https://huggingface.co/";
  var ORT_BASE = "/vendor/onnxruntime-web";
  var MAX_TOKENS = 510;          // DistilBERT: 512 positions minus [CLS] and [SEP]
  var IDLE_RELEASE_MS = 60000;   // drop the session after a minute idle; a MaiK pack may need the memory

  function file(name) { return { name: name, sha256: null, bytes: null }; }
  var PACKS = {
    pharma: {
      repo: "OpenMed/OpenMed-NER-PharmaDetect-TinyMed-65M-v1-onnx-android",
      flag: "smd_openmed_pharma",
      types: { CHEM: 1, CHEMICAL: 1, DRUG: 1, MEDICATION: 1 },
      minScore: 0.65,             // OpenMed's recommended threshold for the Pharmaceutical family
      files: { model: file("model_int8.onnx"), tokenizer: file("tokenizer.json"), labels: file("id2label.json") },
      licence: { declared: "apache-2.0 (OpenMed models.jsonl @ 4213739)", verified: false }
    },
    disease: {
      repo: "OpenMed/OpenMed-NER-DiseaseDetect-TinyMed-65M-v1-onnx-android",
      flag: "smd_openmed_disease",
      types: { CONDITION: 1, DISEASE: 1, PATHOLOGY: 1 },
      minScore: 0.60,             // OpenMed's recommended threshold for the Disease family
      files: { model: file("model_int8.onnx"), tokenizer: file("tokenizer.json"), labels: file("id2label.json") },
      licence: { declared: "apache-2.0 (OpenMed models.jsonl @ 4213739)", verified: false }
    }
  };

  function lget(k) { try { return W && W.localStorage ? W.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function enabled(kind) { var p = PACKS[kind]; return !!p && lget(p.flag) === "1"; }
  function isHex64(s) { return typeof s === "string" && /^[0-9a-f]{64}$/.test(s); }
  function verified(pack) {
    if (!pack || !pack.licence || pack.licence.verified !== true) return false;
    for (var k in pack.files) if (Object.prototype.hasOwnProperty.call(pack.files, k) && !isHex64(pack.files[k].sha256)) return false;
    return true;
  }
  function status(kind) {
    var p = PACKS[kind];
    if (!p) return { ok: false, reason: "unknown" };
    if (!enabled(kind)) return { ok: false, reason: "flag-off" };
    if (!verified(p)) return { ok: false, reason: "unverified" };
    return { ok: true, reason: "ready" };
  }

  // ── WordPiece tokenizer driven by the checkpoint's own tokenizer.json ───────────────────────────
  function isPunct(c) {
    var n = c.charCodeAt(0);
    if ((n >= 33 && n <= 47) || (n >= 58 && n <= 64) || (n >= 91 && n <= 96) || (n >= 123 && n <= 126)) return true;
    return /[\u00A1-\u00BF\u2010-\u2027\u2030-\u205E\u3000-\u303F]/.test(c);
  }
  function isCjk(n) {
    return (n >= 0x4E00 && n <= 0x9FFF) || (n >= 0x3400 && n <= 0x4DBF) || (n >= 0xF900 && n <= 0xFAFF);
  }
  function stripAccents(s) {
    try { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) { return s; }
  }
  function makeTokenizer(tj) {
    var m = tj && tj.model;
    if (!m || m.type !== "WordPiece" || !m.vocab) throw new Error("tokenizer: WordPiece vocab required");
    var vocab = m.vocab, prefix = m.continuing_subword_prefix || "##", maxChars = m.max_input_chars_per_word || 100;
    var nz = tj.normalizer || {};
    var lower = nz.lowercase !== false && nz.type === "BertNormalizer";
    var strip = nz.strip_accents == null ? lower : !!nz.strip_accents;
    function id(t) { return Object.prototype.hasOwnProperty.call(vocab, t) ? vocab[t] : -1; }
    var UNK = id(m.unk_token || "[UNK]"), CLS = id("[CLS]"), SEP = id("[SEP]");
    if (UNK < 0 || CLS < 0 || SEP < 0) throw new Error("tokenizer: special tokens missing");

    // Words with offsets into the ORIGINAL text: whitespace splits, punctuation and CJK stand alone.
    function words(text) {
      var out = [], i = 0, n = text.length, start = -1;
      function flush(end) { if (start >= 0) { out.push({ s: start, e: end }); start = -1; } }
      for (; i < n; i++) {
        var c = text.charAt(i), code = text.charCodeAt(i);
        if (code === 0 || code === 0xFFFD || (code < 32 && !/\s/.test(c))) { flush(i); continue; }
        if (/\s/.test(c)) { flush(i); continue; }
        if (isPunct(c) || isCjk(code)) { flush(i); out.push({ s: i, e: i + 1 }); continue; }
        if (start < 0) start = i;
      }
      flush(n);
      return out;
    }
    function norm(w) { var t = lower ? w.toLowerCase() : w; return strip ? stripAccents(t) : t; }

    function encode(text) {
      text = String(text == null ? "" : text);
      var ids = [], offs = [], wordIx = [], ws = words(text);
      for (var w = 0; w < ws.length; w++) {
        var raw = text.slice(ws[w].s, ws[w].e), t = norm(raw), exact = t.length === raw.length;
        if (t.length > maxChars) { ids.push(UNK); offs.push([ws[w].s, ws[w].e]); wordIx.push(w); continue; }
        var pieces = [], start = 0, bad = false;
        while (start < t.length) {
          var end = t.length, cur = -1;
          while (start < end) {
            var sub = (start > 0 ? prefix : "") + t.slice(start, end);
            cur = id(sub);
            if (cur >= 0) break;
            end--;
          }
          if (cur < 0) { bad = true; break; }
          pieces.push({ id: cur, s: start, e: end });
          start = end;
        }
        if (bad) { ids.push(UNK); offs.push([ws[w].s, ws[w].e]); wordIx.push(w); continue; }
        for (var p = 0; p < pieces.length; p++) {
          ids.push(pieces[p].id);
          offs.push(exact ? [ws[w].s + pieces[p].s, ws[w].s + pieces[p].e] : [ws[w].s, ws[w].e]);
          wordIx.push(w);
        }
      }
      return { ids: ids, offsets: offs, word: wordIx, CLS: CLS, SEP: SEP };
    }
    return { encode: encode, CLS: CLS, SEP: SEP };
  }

  // ── Labels and decoding ─────────────────────────────────────────────────────────────────────────
  function labelList(id2label) {
    var src = id2label && id2label.id2label ? id2label.id2label : id2label, out = [];
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[+k] = String(src[k]);
    for (var i = 0; i < out.length; i++) if (out[i] == null) throw new Error("labels: non-contiguous id2label");
    if (!out.length) throw new Error("labels: empty");
    return out;
  }
  function splitLabel(l) {
    var m = /^([BIESLU])[-_](.+)$/.exec(l);
    if (m) return { tag: m[1], type: m[2].toUpperCase(), plain: false };
    return l === "O" ? { tag: "O", type: "", plain: false } : { tag: "U", type: l.toUpperCase(), plain: true };
  }
  /** Per-token (label, score) to entity spans. First sub-token decides a word; B/I/E/S/L/U handled. */
  function decode(text, enc, tokLabels, pack) {
    var wordsOut = [], lastWord = -1;
    for (var i = 0; i < enc.ids.length; i++) {
      var w = enc.word[i];
      if (w !== lastWord) { wordsOut.push({ s: enc.offsets[i][0], e: enc.offsets[i][1], lab: splitLabel(tokLabels[i].label), sc: [tokLabels[i].score] }); lastWord = w; }
      else { var cur = wordsOut[wordsOut.length - 1]; cur.e = enc.offsets[i][1]; cur.sc.push(tokLabels[i].score); }
    }
    var spans = [], open = null;
    function close() { if (open) { spans.push(open); open = null; } }
    for (var j = 0; j < wordsOut.length; j++) {
      var wd = wordsOut[j], lab = wd.lab, avg = 0;
      for (var q = 0; q < wd.sc.length; q++) avg += wd.sc[q];
      avg /= wd.sc.length;
      if (lab.tag === "O") { close(); continue; }
      // Continue a span on I/E/L of the same type, or on consecutive unprefixed labels of the same type.
      var cont = open && open.type === lab.type && (lab.tag === "I" || lab.tag === "E" || lab.tag === "L" || (lab.plain && open.plain));
      if (!cont) { close(); open = { type: lab.type, s: wd.s, e: wd.e, sc: [avg], plain: lab.plain }; }
      else { open.e = wd.e; open.sc.push(avg); }
      if (lab.tag === "E" || lab.tag === "L" || lab.tag === "S" || (lab.tag === "U" && !lab.plain)) close();
    }
    close();
    var out = [];
    for (var k = 0; k < spans.length; k++) {
      var sp = spans[k], mean = 0;
      for (var z = 0; z < sp.sc.length; z++) mean += sp.sc[z];
      mean /= sp.sc.length;
      if (!pack.types[sp.type] || mean < pack.minScore) continue;
      out.push({ type: sp.type, text: text.slice(sp.s, sp.e), start: sp.s, end: sp.e, score: Math.round(mean * 1000) / 1000 });
    }
    return out;
  }
  function softmaxArgmax(logits, off, n) {
    var max = -Infinity, arg = 0, sum = 0, i;
    for (i = 0; i < n; i++) if (logits[off + i] > max) { max = logits[off + i]; arg = i; }
    for (i = 0; i < n; i++) sum += Math.exp(logits[off + i] - max);
    return { arg: arg, score: 1 / sum };
  }

  // ── Runtime: ORT session per pack, cached, released when idle ───────────────────────────────────
  var loaded = {}, timers = {};
  function sha256Hex(bytes) {
    var subtle = W && W.crypto && W.crypto.subtle;
    if (!subtle) return Promise.reject(new Error("no WebCrypto for sha256"));
    return subtle.digest("SHA-256", bytes).then(function (h) {
      var a = new Uint8Array(h), s = "";
      for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? "0" : "") + a[i].toString(16);
      return s;
    });
  }
  function defaultLoadBytes(pack, f) {
    var MC = W && W.SMD_THOREX_MODEL_CACHE, url = HF + pack.repo + "/resolve/main/" + f.name;
    var p = MC ? MC.loadModelBytes(url, { cacheName: "openmed-ner" }) : W.fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); });
    return p.then(function (bytes) {
      return sha256Hex(bytes).then(function (h) {
        if (h !== f.sha256) throw new Error("sha256 mismatch for " + f.name);
        return bytes;
      });
    });
  }
  function defaultOrt() {
    var T = W && W.SMD_THOREX_ORT;
    if (W && W.ort) return Promise.resolve(W.ort);
    if (T && T.loadOrtWeb) return T.loadOrtWeb(ORT_BASE);
    return Promise.reject(new Error("onnxruntime-web unavailable"));
  }
  function text(bytes) { return typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8").decode(new Uint8Array(bytes)) : String(bytes); }

  function load(kind, opts) {
    var pack = opts.pack || PACKS[kind];
    var key = opts.pack ? null : kind;
    if (key && loaded[key]) return loaded[key];
    var getBytes = opts.loadBytes || defaultLoadBytes;
    var p = Promise.all([
      (opts.ort ? Promise.resolve(opts.ort) : defaultOrt()),
      getBytes(pack, pack.files.model), getBytes(pack, pack.files.tokenizer), getBytes(pack, pack.files.labels)
    ]).then(function (r) {
      var ort = r[0];
      var tok = makeTokenizer(JSON.parse(text(r[2])));
      var labels = labelList(JSON.parse(text(r[3])));
      return Promise.resolve(ort.InferenceSession.create(new Uint8Array(r[1]))).then(function (session) {
        return { ort: ort, session: session, tok: tok, labels: labels, pack: pack };
      });
    });
    if (key) { loaded[key] = p; p.catch(function () { delete loaded[key]; }); }
    return p;
  }
  function touch(kind) {
    if (!W || !W.setTimeout) return;
    if (timers[kind]) W.clearTimeout(timers[kind]);
    timers[kind] = W.setTimeout(function () { release(kind); }, IDLE_RELEASE_MS);
  }
  function release(kind) {
    var p = loaded[kind]; delete loaded[kind];
    if (p) p.then(function (m) { try { if (m.session.release) m.session.release(); } catch (e) {} }, function () {});
  }

  function runWindow(m, ids) {
    var n = ids.length + 2, a = new BigInt64Array(n), mask = new BigInt64Array(n);
    a[0] = BigInt(m.tok.CLS);
    for (var i = 0; i < ids.length; i++) a[i + 1] = BigInt(ids[i]);
    a[n - 1] = BigInt(m.tok.SEP);
    for (var j = 0; j < n; j++) mask[j] = BigInt(1);
    var feeds = { input_ids: new m.ort.Tensor("int64", a, [1, n]), attention_mask: new m.ort.Tensor("int64", mask, [1, n]) };
    var names = m.session.inputNames || [];
    if (names.indexOf("token_type_ids") >= 0) feeds.token_type_ids = new m.ort.Tensor("int64", new BigInt64Array(n), [1, n]);
    return Promise.resolve(m.session.run(feeds)).then(function (out) {
      var t = out.logits || out[(m.session.outputNames || [])[0]];
      var L = t.dims[2], data = t.data, res = [];
      if (L !== m.labels.length) throw new Error("logits width " + L + " != labels " + m.labels.length);
      for (var k = 1; k < n - 1; k++) {
        var sm = softmaxArgmax(data, k * L, L);
        res.push({ label: m.labels[sm.arg], score: sm.score });
      }
      return res;
    });
  }

  function extract(kind, input, opts) {
    opts = opts || {};
    var pack = opts.pack || PACKS[kind];
    var str = String(input == null ? "" : input);
    if (!pack || !str.trim()) return Promise.resolve([]);
    // Production path: flag on AND licence + checksums pinned. Tests inject a pack; `force` skips the
    // gate for a locally generated fixture model only (never set by app code).
    if (!opts.force && !(opts.pack ? verified(pack) : status(kind).ok)) return Promise.resolve([]);
    return load(kind, opts).then(function (m) {
      var enc = m.tok.encode(str), wins = [], chain = Promise.resolve(), labs = [];
      for (var s = 0; s < enc.ids.length; s += MAX_TOKENS) wins.push(enc.ids.slice(s, s + MAX_TOKENS));
      wins.forEach(function (ids) { chain = chain.then(function () { return runWindow(m, ids).then(function (r) { labs = labs.concat(r); }); }); });
      return chain.then(function () { if (!opts.pack) touch(kind); return decode(str, enc, labs, m.pack); });
    }).then(null, function (e) {
      try { if (W && W.console) W.console.warn("[openmed-ner] " + kind + ": " + (e && e.message)); } catch (x) {}
      return [];
    });
  }

  /** Unique lowercase drug names in `text`, or [] when the pack is off/unverified/failed. */
  function drugNames(input, opts) {
    return extract("pharma", input, opts).then(function (ents) {
      var seen = {}, out = [];
      for (var i = 0; i < ents.length; i++) {
        var n = ents[i].text.toLowerCase().replace(/\s+/g, " ").trim();
        if (n.length >= 3 && !seen[n]) { seen[n] = 1; out.push(n); }
      }
      return out;
    });
  }
  /** Disease phrases in `text` (for ICD suggestions), original casing, in order of appearance. */
  function diseases(input, opts) {
    return extract("disease", input, opts).then(function (ents) {
      var seen = {}, out = [];
      for (var i = 0; i < ents.length; i++) {
        var n = ents[i].text.trim(), k = n.toLowerCase();
        if (n.length >= 3 && !seen[k]) { seen[k] = 1; out.push(n); }
      }
      return out;
    });
  }

  return {
    PACKS: PACKS, extract: extract, drugNames: drugNames, diseases: diseases,
    status: status, enabled: enabled, verified: verified, release: release,
    _makeTokenizer: makeTokenizer, _decode: decode, _labelList: labelList
  };
});
