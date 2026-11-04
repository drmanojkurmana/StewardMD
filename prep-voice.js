/* PrepNucleus natural voice: Kokoro-82M (Apache-2.0, quantised ONNX, 92 MB) run on the phone through the vendored
 * onnxruntime-web. Downloaded once, on the first tap of Play in a lesson, then kept (Cache API) and used offline; no
 * text or audio leaves the phone. Text becomes phonemes with the CMU dictionary (ISC licence; no GPL espeak) plus
 * spelling rules for words it lacks; the lexicon (prep/tts/lex-v1.txt, built by tools/prep-voice-lex.mjs) ships in the
 * app. Without this file, without WebAssembly or on any failure the lesson keeps the system voice.
 * Pure helpers load under node for tests; window.SMD_PREP_VOICE = false switches the voice off (the UI tests do). API (window.PREP_VOICE): state(), ready(), available(), download(onProgress),
 * unlock(), say(text, rate) -> Promise (resolves when it has been spoken), prefetch(text, rate), stop(), remove(). */
(function (G) {
  "use strict";
  var REV = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";
  var HF = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/" + REV + "/";
  var FILES = {
    model: { url: HF + "onnx/model_quantized.onnx", bytes: 92361116, sha256: "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478" },
    voice: { url: HF + "voices/af_heart.bin", bytes: 522240, sha256: "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b" },
    lex: { url: "/prep/tts/lex-v1.txt" }
  };
  var CACHE = "prep-voice-v1", ORT_BASE = "/vendor/onnxruntime-web", SR = 24000, MAXTOK = 400;
  var VOCAB = {"$":0,";":1,":":2,",":3,".":4,"!":5,"?":6,"—":9,"…":10,"\"":11,"(":12,")":13,"“":14,"”":15," ":16,"̃":17,"ʣ":18,"ʥ":19,"ʦ":20,"ʨ":21,"ᵝ":22,"ꭧ":23,"A":24,"I":25,"O":31,"Q":33,"S":35,"T":36,"W":39,"Y":41,"ᵊ":42,"a":43,"b":44,"c":45,"d":46,"e":47,"f":48,"h":50,"i":51,"j":52,"k":53,"l":54,"m":55,"n":56,"o":57,"p":58,"q":59,"r":60,"s":61,"t":62,"u":63,"v":64,"w":65,"x":66,"y":67,"z":68,"ɑ":69,"ɐ":70,"ɒ":71,"æ":72,"β":75,"ɔ":76,"ɕ":77,"ç":78,"ɖ":80,"ð":81,"ʤ":82,"ə":83,"ɚ":85,"ɛ":86,"ɜ":87,"ɟ":90,"ɡ":92,"ɥ":99,"ɨ":101,"ɪ":102,"ʝ":103,"ɯ":110,"ɰ":111,"ŋ":112,"ɳ":113,"ɲ":114,"ɴ":115,"ø":116,"ɸ":118,"θ":119,"œ":120,"ɹ":123,"ɾ":125,"ɻ":126,"ʁ":128,"ɽ":129,"ʂ":130,"ʃ":131,"ʈ":132,"ʧ":133,"ʊ":135,"ʋ":136,"ʌ":138,"ɣ":139,"ɤ":140,"χ":142,"ʎ":143,"ʒ":147,"ʔ":148,"ˈ":156,"ˌ":157,"ː":158,"ʰ":162,"ʲ":164,"↓":169,"→":171,"↗":172,"↘":173,"ᵻ":177};

  /* ---------- pure: phonemes ---------- */
  // ARPAbet (CMU) to the phoneme symbols Kokoro was trained on (US English). A stress digit follows each vowel.
  var ARPA = { AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "W", AY: "I", EH: "ɛ", ER: "ɜɹ", EY: "A", IH: "ɪ", IY: "i", OW: "O", OY: "Y", UH: "ʊ", UW: "u",
    B: "b", CH: "ʧ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "ʤ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ", P: "p", R: "ɹ", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ" };
  function arpaToPhones(s) {
    var out = "", parts = String(s).split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      var m = /^([A-Z]+)([012])?$/.exec(parts[i]);
      if (!m || !ARPA[m[1]]) continue;
      var base = m[1], st = m[2], ph = ARPA[base];
      if (st === undefined) { out += ph; continue; }
      if (base === "AH") ph = st === "0" ? "ə" : "ʌ";
      else if (base === "ER") ph = st === "0" ? "ɚ" : "ɜɹ";
      out += (st === "1" ? "ˈ" : st === "2" ? "ˌ" : "") + ph;
    }
    return out;
  }
  var UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  var TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  function intWords(n) {
    if (n < 20) return [UNITS[n]];
    if (n < 100) return [TENS[Math.floor(n / 10)]].concat(n % 10 ? [UNITS[n % 10]] : []);
    if (n < 1000) return [UNITS[Math.floor(n / 100)], "hundred"].concat(n % 100 ? intWords(n % 100) : []);
    if (n < 1000000) return intWords(Math.floor(n / 1000)).concat(["thousand"], n % 1000 ? intWords(n % 1000) : []);
    if (n < 1e9) return intWords(Math.floor(n / 1e6)).concat(["million"], n % 1e6 ? intWords(n % 1e6) : []);
    return String(n).split("").map(function (d) { return UNITS[+d]; });
  }
  function numberWords(tok) {
    var m = /^(\d+)(?:\.(\d+))?$/.exec(tok);
    if (!m) return [];
    var ip = m[1];
    var w = ip.length > 1 && ip.charAt(0) === "0" ? ip.split("").map(function (d) { return UNITS[+d]; }) : intWords(parseInt(ip, 10));
    if (m[2]) w = w.concat(["point"], m[2].split("").map(function (d) { return UNITS[+d]; }));
    return w;
  }
  // The notes say British spellings (tumour, anaemia); the dictionary is American.
  var BR = [[/^(.*)aem/, "$1em"], [/^(.*)oed/, "$1ed"], [/^(.*)oesoph/, "$1esoph"], [/^(.*)haem/, "$1hem"], [/^(.*)(col|fav|hon|hum|neighb|behavi|vap|rum|tum|savi|labo|flav|arm|od)our/, "$1$2or"],
    [/^(.*)(?:ae)(?=[a-z])/, "$1e"], [/^(.*)ise($|s$|d$)/, "$1ize$2"], [/^(.*)isation/, "$1ization"], [/^(.*)ysing$/, "$1yzing"], [/^(.*)tre$/, "$1ter"], [/^(.*)ogue$/, "$1og"], [/^(.*)lling$/, "$1ling"]];
  function americanize(w) {
    for (var i = 0; i < BR.length; i++) if (BR[i][0].test(w)) return w.replace(BR[i][0], BR[i][1]);
    return w;
  }
  var LETTERS = { a: "ˈA", b: "bˈi", c: "sˈi", d: "dˈi", e: "ˈi", f: "ˈɛf", g: "ʤˈi", h: "ˈAʧ", i: "ˈI", j: "ʤˈA", k: "kˈA", l: "ˈɛl", m: "ˈɛm", n: "ˈɛn", o: "ˈO", p: "pˈi", q: "kjˈu", r: "ˈɑɹ", s: "ˈɛs", t: "tˈi", u: "jˈu", v: "vˈi", w: "dˈʌbəlju", x: "ˈɛks", y: "wˈI", z: "zˈi" };
  var ROMAN = { ii: "two", iii: "three", vii: "seven", viii: "eight", ix: "nine", xi: "eleven", xii: "twelve" };

  /* Spelling to sound for a word the dictionary lacks. Not espeak: a plain English rule set with a medical suffix table,
     enough that a drug or disease name is spoken as a person would sound it out. A vowel is full quality until stress is
     placed, then unstressed ones reduce. Capital letters in the phones are Kokoro's diphthongs (A I O W Y). */
  var SUF = [["cillin", "sˈɪlɪn"], ["mycin", "mˈIsɪn"], ["floxacin", "flˈɑksəsɪn"], ["azole", "əzˌOl"], ["olol", "əlˌɔl"], ["pril", "pɹˌɪl"], ["sartan", "sˌɑɹtæn"], ["statin", "stˌætɪn"], ["tinib", "tˈɪnɪb"], ["zumab", "zˈumæb"], ["mab", "mˌæb"], ["vir", "vˌɪɹ"],
    ["itis", "ˈItɪs"], ["osis", "ˈOsɪs"], ["aemia", "ˈimiə"], ["emia", "ˈimiə"], ["ectomy", "ˈɛktəmi"], ["otomy", "ˈɑtəmi"], ["ostomy", "ˈɑstəmi"], ["plasty", "plˌæsti"], ["scopy", "skəpi"], ["pathy", "pəθi"], ["logy", "ləʤi"], ["graphy", "ɡɹəfi"], ["oma", "ˈOmə"], ["uria", "ˈjʊɹiə"],
    ["tion", "ʃən"], ["sion", "ʒən"], ["ical", "ɪkəl"], ["ically", "ɪkli"], ["ology", "ˈɑləʤi"], ["ism", "ɪzəm"], ["ist", "ɪst"], ["ity", "ɪɾi"], ["ment", "mənt"], ["ness", "nɪs"], ["able", "əbəl"], ["ible", "ɪbəl"], ["ous", "əs"], ["ive", "ɪv"], ["ium", "iəm"], ["ia", "iə"], ["ic", "ɪk"], ["al", "əl"], ["ar", "ɚ"], ["er", "ɚ"], ["or", "ɚ"],
    ["ine", "ˌin"], ["ide", "ˌId"], ["ate", "ˌAt"], ["ase", "ˌAs"], ["ant", "ənt"], ["ent", "ənt"], ["ly", "li"], ["y", "i"]];
  var RULES = [["tch", "ʧ"], ["dge", "ʤ"], ["ph", "f"], ["ch", "ʧ"], ["sh", "ʃ"], ["th", "θ"], ["ck", "k"], ["ng", "ŋ"], ["gh", ""], ["wh", "w"], ["qu", "kw"], ["x", "ks"], ["ee", "i"], ["ea", "i"], ["oo", "u"], ["ai", "A"], ["ay", "A"], ["oa", "O"], ["oi", "Y"], ["oy", "Y"],
    ["ou", "W"], ["ow", "O"], ["au", "ɔ"], ["aw", "ɔ"], ["ie", "i"], ["ei", "A"], ["eu", "ju"], ["ew", "ju"], ["ue", "u"], ["ui", "u"]];
  var VOW = { a: "æ", e: "ɛ", i: "ɪ", o: "ɑ", u: "ʌ", y: "ɪ" };
  var LONG = { a: "A", e: "i", i: "I", o: "O", u: "ju", y: "I" };
  var FULLV = "æɛɑʌɔʊ", WEAKV = "ɪi";
  function isV(c) { return "aeiouy".indexOf(c) >= 0; }
  function sounds(stem) {
    var out = [], i = 0, w = stem, n = w.length;
    while (i < n) {
      var rest = w.slice(i), hit = null, k;
      if (i === 0 && /^kn/.test(rest)) { out.push({ p: "n" }); i += 2; continue; }
      if (i === 0 && /^wr/.test(rest)) { out.push({ p: "ɹ" }); i += 2; continue; }
      if (/^mb$/.test(rest)) { out.push({ p: "m" }); i += 2; continue; }
      for (k = 0; k < RULES.length; k++) if (rest.indexOf(RULES[k][0]) === 0) { hit = RULES[k]; break; }
      if (hit) {
        var v = /^[AIOWYiuɔ]|^ju/.test(hit[1]) && hit[1] !== "";
        if (hit[1]) out.push({ p: hit[1], v: v, full: v });
        i += hit[0].length; continue;
      }
      var c = w.charAt(i);
      if (c === "c") { out.push({ p: /^c[eiy]/.test(rest) ? "s" : "k" }); i++; continue; }
      if (c === "g") { out.push({ p: /^g[eiy]/.test(rest) && i > 0 ? "ʤ" : "ɡ" }); i++; continue; }
      if (c === "s" && i > 0 && isV(w.charAt(i - 1)) && (i === n - 1 || isV(w.charAt(i + 1)))) { out.push({ p: "z" }); i++; continue; }
      if (c === "j") { out.push({ p: "ʤ" }); i++; continue; }
      if (c === "y" && i === 0) { out.push({ p: "j" }); i++; continue; }
      if (isV(c)) {
        if (c === "e" && i === n - 1 && i > 1) { i++; continue; }
        var magic = /^[aiou][^aeiouy]e$/.test(rest) || (/^[aiou][^aeiouy]e(s|d)$/.test(rest));
        if (magic) { out.push({ p: LONG[c], v: true, full: true }); }
        else out.push({ p: VOW[c], v: true, full: false });
        i++; continue;
      }
      var map = { b: "b", d: "d", f: "f", h: "h", k: "k", l: "l", m: "m", n: "n", p: "p", q: "k", r: "ɹ", s: "s", t: "t", v: "v", w: "w", z: "z" };
      if (map[c]) { if (w.charAt(i + 1) === c) i++; out.push({ p: map[c] }); }
      i++;
    }
    return out;
  }
  function ruleG2P(word) {
    var w = String(word).toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return "";
    var tail = "", stressed = false;
    for (var s = 0; s < SUF.length; s++) {
      var sf = SUF[s][0];
      if (w.length > sf.length + 1 && w.slice(-sf.length) === sf) { tail = SUF[s][1]; w = w.slice(0, -sf.length); break; }
    }
    if (tail.indexOf("ˈ") >= 0) stressed = true;
    var ph = sounds(w), vi = [], i;
    for (i = 0; i < ph.length; i++) if (ph[i].v) vi.push(i);
    var syl = vi.length + (tail ? Math.max(1, (tail.match(/[ɑæʌɔɛɪʊəɚiuAIOWY]/g) || []).length) : 0);
    if (!stressed && vi.length) {
      var at = syl >= 3 ? Math.max(0, vi.length - (tail ? 1 : 2)) : 0;
      ph[vi[Math.min(at, vi.length - 1)]].st = true;
    } else if (stressed && vi.length) {
      // a stressed suffix: the stem's first vowel carries the secondary stress
      ph[vi[0]].sec = true;
    }
    var out = "";
    for (i = 0; i < ph.length; i++) {
      var p = ph[i];
      if (p.v && p.st) out += "ˈ" + p.p;
      else if (p.v && p.sec) out += "ˌ" + p.p;
      else if (p.v && !p.full && FULLV.indexOf(p.p) >= 0) out += "ə";
      else out += p.p;
    }
    return out + tail;
  }
  // A suffix on a word whose stem the dictionary has: tumours -> tumor + z.
  function inflect(w, lex) {
    var m, stem, ph;
    if ((m = /^(.*[^s])s$/.exec(w)) && lex[m[1]]) { ph = lex[m[1]]; return ph + (/[szʃʒʧʤ]$/.test(ph) ? "ᵻz" : /[ptkfθ]$/.test(ph) ? "s" : "z"); }
    if ((m = /^(.*)es$/.exec(w)) && lex[m[1]]) { ph = lex[m[1]]; return ph + (/[szʃʒʧʤ]$/.test(ph) ? "ᵻz" : "z"); }
    if ((m = /^(.*)ed$/.exec(w)) && (lex[m[1]] || lex[m[1] + "e"])) { ph = lex[m[1]] || lex[m[1] + "e"]; return ph + (/[td]$/.test(ph) ? "ᵻd" : /[ptkfθsʃʧ]$/.test(ph) ? "t" : "d"); }
    if ((m = /^(.*)ing$/.exec(w)) && (lex[m[1]] || lex[m[1] + "e"])) return (lex[m[1]] || lex[m[1] + "e"]) + "ɪŋ";
    if ((m = /^(.*)ly$/.exec(w)) && lex[m[1]]) return lex[m[1]] + "li";
    if ((m = /^(.*)ally$/.exec(w)) && lex[m[1]]) return lex[m[1]] + "əli";
    return "";
  }
  function wordPhones(tok, lex) {
    var low = tok.toLowerCase(), ph;
    if (/^\d/.test(tok)) return numberWords(tok).map(function (x) { return lex[x] || ruleG2P(x); }).join(" ");
    if (ROMAN[low] && tok === tok.toUpperCase() && tok.length > 1) return lex[ROMAN[low]] || ruleG2P(ROMAN[low]);
    if (tok.length > 1 && tok === tok.toUpperCase() && !(tok.length >= 3 && lex[low])) return low.split("").map(function (c) { return LETTERS[c] || ""; }).join(" ");
    if (low.length === 1 && low !== "a" && low !== "i") return LETTERS[low] || "";
    if ((ph = lex[low])) return ph;
    var am = americanize(low);
    if (am !== low && (ph = lex[am] || inflect(am, lex))) return ph;
    if ((ph = inflect(low, lex))) return ph;
    return ruleG2P(low);
  }
  var PUNCT = /[;:,.!?—…"()“”]/;
  function phonemize(text, lex) {
    var toks = String(text).match(/[A-Za-z]+(?:'[A-Za-z]+)?|\d+(?:\.\d+)?|[;:,.!?—…"()“”]/g) || [], out = "";
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (PUNCT.test(t)) { out += t; continue; }
      var ph = wordPhones(t, lex || {});
      if (ph) out += (out && !PUNCT.test(out.charAt(out.length - 1)) ? " " : out && /[,;:]$|\.$|!$|\?$/.test(out) ? " " : "") + ph;
    }
    return out.replace(/\s+/g, " ").trim();
  }
  function tokenIds(ph) {
    var ids = [0];
    for (var i = 0; i < ph.length && ids.length < MAXTOK; i++) { var id = VOCAB[ph.charAt(i)]; if (id !== undefined) ids.push(id); }
    ids.push(0);
    return ids;
  }
  function parseLex(txt) {
    var lex = {}, lines = String(txt).split("\n");
    for (var i = 0; i < lines.length; i++) { var sp = lines[i].indexOf(" "); if (sp > 0) lex[lines[i].slice(0, sp)] = lines[i].slice(sp + 1); }
    return lex;
  }
  function wavBlob(f32) {
    var n = f32.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), i;
    function str(o, s) { for (var k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k)); }
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
    for (i = 0; i < n; i++) { var s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true); }
    return buf;
  }
  var PURE = { arpaToPhones: arpaToPhones, numberWords: numberWords, americanize: americanize, ruleG2P: ruleG2P, phonemize: phonemize, wordPhones: wordPhones, tokenIds: tokenIds, parseLex: parseLex, wavBlob: wavBlob, FILES: FILES, VOCAB: VOCAB };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ---------- engine ---------- */
  var D = G.document, st = { s: "none", p: 0, err: "" }, lex = null, voice = null, ort = null, session = null, boot = null, q = Promise.resolve(), audio = null, cur = null, tok = 0, memo = {}, memoKeys = [];
  function realFetch() { try { if (typeof G.CapacitorWebFetch === "function") return G.CapacitorWebFetch.bind(G); } catch (e) {} return G.fetch.bind(G); }
  function can() { return G.SMD_PREP_VOICE !== false && !!(G.WebAssembly && G.caches && G.crypto && G.crypto.subtle && G.Audio); }
  function sha256(bytes) { return G.crypto.subtle.digest("SHA-256", bytes).then(function (h) { var a = new Uint8Array(h), s = ""; for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? "0" : "") + a[i].toString(16); return s; }); }
  function fetchBytes(f, onP) {
    return G.caches.open(CACHE).then(function (c) {
      return c.match(f.url).then(function (hit) {
        if (hit) return hit.arrayBuffer().then(function (b) { onP(1); return b; });
        return realFetch()(f.url).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          var total = f.bytes || +r.headers.get("Content-Length") || 0, got = 0, parts = [];
          if (!r.body || !r.body.getReader) return r.arrayBuffer();
          var rd = r.body.getReader();
          return (function pump() {
            return rd.read().then(function (x) {
              if (x.done) { var out = new Uint8Array(got), o = 0; for (var i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; } return out.buffer; }
              parts.push(x.value); got += x.value.length; if (total) onP(Math.min(1, got / total)); return pump();
            });
          })();
        }).then(function (b) {
          if (f.bytes && b.byteLength !== f.bytes) throw new Error("size mismatch");
          return (f.sha256 ? sha256(b).then(function (h) { if (h !== f.sha256) throw new Error("checksum mismatch"); }) : Promise.resolve()).then(function () {
            return c.put(f.url, new G.Response(b.slice(0))).then(function () { onP(1); return b; }, function () { onP(1); return b; });
          });
        });
      });
    });
  }
  function loadOrt() {
    if (G.ort) return Promise.resolve(G.ort);
    return new Promise(function (res, rej) {
      var s = D.createElement("script"); s.async = true; s.src = ORT_BASE + "/ort.wasm.min.js";
      s.onload = function () { try { G.ort.env.wasm.wasmPaths = ORT_BASE + "/"; G.ort.env.wasm.numThreads = 1; } catch (e) {} res(G.ort); };
      s.onerror = function () { rej(new Error("runtime")); };
      D.head.appendChild(s);
    });
  }
  function cached() { try { return G.caches.open(CACHE).then(function (c) { return c.match(FILES.model.url); }).then(function (h) { return !!h; }, function () { return false; }); } catch (e) { return Promise.resolve(false); } }
  function download(onP) {
    onP = onP || function () {};
    if (!can()) { st.s = "error"; st.err = "unsupported"; return Promise.reject(new Error("unsupported")); }
    if (boot) { boot.cbs.push(onP); return boot.p; }
    st.s = "downloading"; st.p = 0; st.err = "";
    var cbs = [onP], mp = 0;
    var tell = function () { st.p = mp; for (var i = 0; i < cbs.length; i++) { try { cbs[i](st.p); } catch (e) {} } };
    var p = Promise.all([
      fetchBytes(FILES.model, function (x) { mp = x * 0.97; tell(); }),
      fetchBytes(FILES.voice, function () {}),
      fetch(FILES.lex.url).then(function (r) { if (!r.ok) throw new Error("lexicon"); return r.text(); }),
      loadOrt()
    ]).then(function (r) {
      st.s = "loading"; mp = 0.98; tell();
      lex = parseLex(r[2]); voice = new Float32Array(r[1]); ort = r[3];
      return ort.InferenceSession.create(new Uint8Array(r[0]), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    }).then(function (s) { session = s; return bench(); }).then(function () { st.s = "ready"; mp = 1; tell(); }, function (e) { boot = null; st.s = "error"; st.err = String(e && e.message || e); throw e; });
    boot = { p: p, cbs: cbs };
    return p;
  }
  // How fast this phone renders: seconds of work per second of speech, from a short fixed phrase, kept on the device.
  // Above RTF_MAX the voice would stall between sentences, so the lesson keeps the system voice (usable() is false).
  var RTF_MAX = 1.3;
  function bench() {
    var key = "prep_voice_rtf", old = null;
    try { old = parseFloat(G.localStorage.getItem(key)); } catch (e) {}
    if (old > 0) { st.rtf = old; return Promise.resolve(); }
    var t0 = Date.now();
    return synth("This is a short test of the voice.", 1).then(function (a) {
      st.rtf = ((Date.now() - t0) / 1000) / (a.length / SR);
      try { G.localStorage.setItem(key, String(st.rtf)); } catch (e) {}
      delete memo["1|This is a short test of the voice."];
    });
  }
  function usable() { return st.s === "ready" && !(st.rtf > RTF_MAX); }
  function release() { stop(); var s = session; session = null; boot = null; memo = {}; memoKeys = []; if (st.s === "ready" || st.s === "loading") st = { s: "none", p: 0, err: "", rtf: st.rtf }; try { if (s && s.release) s.release(); } catch (e) {} }
  function init() { if (!can() || boot || st.s !== "none") return; cached().then(function (has) { if (has && st.s === "none") download().catch(function () {}); }); }
  function synth(text, rate) {
    var key = rate + "|" + text;
    if (memo[key]) return memo[key];
    var p = q.then(function () {
      var ph = phonemize(text, lex), ids = tokenIds(ph), n = ids.length - 2, off = Math.min(509, Math.max(0, n)) * 256;
      var style = voice.slice(off, off + 256), arr = new BigInt64Array(ids.length);
      for (var i = 0; i < ids.length; i++) arr[i] = BigInt(ids[i]);
      return session.run({ input_ids: new ort.Tensor("int64", arr, [1, ids.length]), style: new ort.Tensor("float32", style, [1, 256]), speed: new ort.Tensor("float32", new Float32Array([rate]), [1]) });
    }).then(function (o) { var w = o.waveform || o[Object.keys(o)[0]], d = w.data, a = new Float32Array(d), lead = Math.min(a.length, 480); for (var i = 0; i < lead; i++) a[i] *= i / lead; return a; });
    q = p.then(function () {}, function () {});
    memo[key] = p; memoKeys.push(key);
    if (memoKeys.length > 10) delete memo[memoKeys.shift()];
    p.catch(function () { delete memo[key]; });
    return p;
  }
  function unlock() {
    if (!audio) { audio = new G.Audio(); audio.preload = "auto"; }
    try { audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAwF0AAICuAAACABAAZGF0YQAAAAA="; var pr = audio.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
  }
  function stop() { tok++; try { if (audio) { audio.pause(); audio.removeAttribute("src"); } } catch (e) {} if (cur) { cur(); cur = null; } }
  // Shared by every engine: one <audio> element plays the rendered clip (24 kHz mono), so the silent switch does not mute it.
  function begin() { return ++tok; }
  function playWave(wave, prate, my) {
    if (my !== tok) return Promise.resolve();
    return new Promise(function (res, rej) {
      if (!audio) audio = new G.Audio();
      var url = G.URL.createObjectURL(new G.Blob([wavBlob(wave)], { type: "audio/wav" })), done = function () { cur = null; try { G.URL.revokeObjectURL(url); } catch (e) {} };
      cur = function () { done(); res(); };
      audio.onended = function () { done(); res(); };
      audio.onerror = function () { done(); rej(new Error("audio")); };
      audio.src = url;
      audio.playbackRate = prate || 1;
      var pr = audio.play(); if (pr && pr.catch) pr.catch(function (e) { done(); rej(e); });
    });
  }
  function say(text, rate) {
    if (st.s !== "ready") return Promise.reject(new Error("not ready"));
    var my = begin();
    return synth(text, rate).then(function (wave) { return playWave(wave, 1, my); });
  }
  function prefetch(text, rate) { if (st.s === "ready") synth(text, rate).catch(function () {}); }
  function remove() { release(); try { G.localStorage.removeItem("prep_voice_rtf"); } catch (e) {} try { return G.caches.delete(CACHE); } catch (e) { return Promise.resolve(); } }
  var KOK = { name: "Kokoro", mb: 92, state: function () { return st.s; }, progress: function () { return st.p; }, error: function () { return st.err; }, ready: function () { return st.s === "ready"; }, usable: usable, rtf: function () { return st.rtf || 0; }, release: release, available: can, download: download, init: init, unlock: unlock, render: synth, phonemes: function (t) { return phonemize(t, lex); }, say: say, prefetch: prefetch, stop: stop, remove: remove, _pure: PURE };
  // The voices a lesson can use: this file's Kokoro and, when its file is loaded, Phonon (prep-voice-phonon.js).
  // use("system") means neither: the lesson speaks with the phone's own voice.
  var engines = { kokoro: KOK }, order = ["kokoro"], pick = "kokoro";
  var host = { begin: begin, play: playWave, halt: stop, unlock: unlock, sr: SR };
  function E() { return engines[pick] || null; }
  function pass(fn, dflt) { return function () { var e = E(); return e && e[fn] ? e[fn].apply(e, arguments) : typeof dflt === "function" ? dflt() : dflt; }; }
  function noVoice() { return Promise.reject(new Error("system voice")); }
  G.PREP_VOICE = {
    register: function (id, make) { if (!engines[id]) { engines[id] = make(host); order.push(id); } },
    ids: function () { return ["system"].concat(order); }, use: function (id) { var n = id === "system" || engines[id] ? id : "kokoro"; if (n !== pick) stop(); pick = n; return pick; }, current: function () { return pick; },
    info: function (id) { var e = engines[id]; return e ? { id: id, name: e.name, mb: e.mb, state: e.state(), progress: e.progress(), rtf: e.rtf() } : { id: "system", name: "System", mb: 0, state: "ready", progress: 1, rtf: 0 }; },
    engine: function (id) { return engines[id] || null; },
    available: pass("available", false), state: pass("state", "none"), progress: pass("progress", 0), error: pass("error", ""), ready: pass("ready", false), usable: pass("usable", false),
    rtf: pass("rtf", 0), release: function () { var k; for (k in engines) if (engines[k].release) engines[k].release(); }, download: pass("download", noVoice),
    init: pass("init"), unlock: unlock, say: pass("say", noVoice), prefetch: pass("prefetch"), stop: stop,
    remove: function (id) { var e = engines[id]; return e && e.remove ? e.remove() : Promise.resolve(); },
    render: KOK.render, phonemes: KOK.phonemes, _pure: PURE
  };
})(typeof window !== "undefined" ? window : this);
