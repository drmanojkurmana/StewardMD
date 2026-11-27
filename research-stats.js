/* StewardMD - on-device master chart statistics (window.SMD_RESEARCH_STATS).
 * Pure: no DOM, no Date, no Math.random, no I/O. ES5 only (var/function).
 * Dual export: browser global SMD_RESEARCH_STATS and CommonJS module.exports.
 * No network and no model calls. Bad input throws "research: ...".
 *
 * Numeric helpers (normal quantile, gamma, beta, t quantile) follow the same
 * approximations as research-engine.js. Shapiro-Wilk is Royston AS R94.
 * Two-sample and signed-rank exact p-values follow the R 4.6 permutation
 * distribution on average ranks. Asymptotic rank tests use the normal
 * approximation with the continuity correction. 2 by 2 chi-square uses Yates.
 * Odds ratios use the Woolf logit interval (0.5 on every cell only when a
 * cell is 0). Risk ratios use the Katz log interval. Logistic regression is
 * IRLS binomial logit with Wald intervals.
 */
(function (G) {
  "use strict";

  var BIG = 10000000;
  var Z975_P = 0.975;
  var PM = " \u00b1 ";
  var ENGINE_VERSION = "rod2";

  function bad(msg) { throw new Error("research: " + msg); }
  function badCode(code, msg) {
    var err = new Error("research: " + (msg || code));
    err.code = code;
    throw err;
  }

  function isFin(n) { return typeof n === "number" && isFinite(n); }

  function isArray(x) {
    return Object.prototype.toString.call(x) === "[object Array]";
  }

  function trim(s) {
    return String(s).replace(/^\s+|\s+$/g, "");
  }

  /* Horner evaluation of c[0]*x^n + ... + c[n]. */
  function polyHorner(c, x) {
    var s = c[0], i;
    for (i = 1; i < c.length; i++) s = s * x + c[i];
    return s;
  }

  /* Low-to-high polynomial: cc[0] + cc[1]*x + ... (AS 181.2). */
  function polyLow(cc, x) {
    var nord = cc.length, ret = cc[0], p, j;
    if (nord > 1) {
      p = x * cc[nord - 1];
      for (j = nord - 2; j > 0; j--) p = (p + cc[j]) * x;
      ret = ret + p;
    }
    return ret;
  }

  /* Inverse standard-normal CDF (Acklam; absolute error under 1.2e-9). */
  function normalQuantile(p) {
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
      138.3577518672690, -30.66479806614716, 2.506628277459239];
    var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
      66.80131188771972, -13.28068155288572];
    var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783];
    var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996,
      3.754408661907416];
    var b1 = [b[0], b[1], b[2], b[3], b[4], 1];
    var d1 = [d[0], d[1], d[2], d[3], 1];
    var plow = 0.02425, phigh = 1 - 0.02425, q, r;
    if (!(p > 0 && p < 1)) bad("probability must be between 0 and 1");
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      return polyHorner(c, q) / polyHorner(d1, q);
    }
    if (p > phigh) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -polyHorner(c, q) / polyHorner(d1, q);
    }
    q = p - 0.5; r = q * q;
    return polyHorner(a, r) * q / polyHorner(b1, r);
  }

  function gammln(x) {
    var cof = [76.18009172947146, -86.50532032961677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, tmp = x + 5.5, ser = 1.000000000190015, j;
    tmp -= (x + 0.5) * Math.log(tmp);
    for (j = 0; j < 6; j++) { y += 1; ser += cof[j] / y; }
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function gammaP(a, x) {
    var ITMAX = 300, EPS = 3e-12, ap, del, sum, n;
    if (!(a > 0)) bad("gamma shape must be positive");
    if (x <= 0) return 0;
    if (x >= a + 1) return 1 - gammaQ(a, x);
    ap = a; del = 1 / a; sum = del;
    for (n = 1; n <= ITMAX; n++) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gammln(a));
  }

  function gammaQ(a, x) {
    var ITMAX = 300, EPS = 3e-12, FPMIN = 1e-300;
    var gln, b, c, d, h, i, an, del;
    if (!(a > 0)) bad("gamma shape must be positive");
    if (x <= 0) return 1;
    if (x < a + 1) return 1 - gammaP(a, x);
    gln = gammln(a); b = x + 1 - a; c = 1 / FPMIN; d = 1 / b; h = d;
    for (i = 1; i <= ITMAX; i++) {
      an = -i * (i - a); b += 2; d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return Math.exp(-x + a * Math.log(x) - gln) * h;
  }

  function chiSqUpper(q, df) {
    if (!(q >= 0) || !(df >= 1)) bad("bad chi-square inputs");
    if (q === 0) return 1;
    return gammaQ(df / 2, q / 2);
  }

  function betacf(a, b, x) {
    var MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d, h, m, m2, aa, del;
    d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; h = d;
    for (m = 1; m <= MAXIT; m++) {
      m2 = 2 * m;
      aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  function betai(a, b, x) {
    var bt;
    if (!(a > 0) || !(b > 0)) bad("bad beta parameters");
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    bt = Math.exp(gammln(a + b) - gammln(a) - gammln(b) +
      a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  function invBetai(a, b, p) {
    var lo = 0, hi = 1, mid, i;
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    for (i = 0; i < 200; i++) {
      mid = (lo + hi) / 2;
      if (betai(a, b, mid) < p) lo = mid; else hi = mid;
      if (hi - lo < 1e-14) break;
    }
    return (lo + hi) / 2;
  }

  function tQuantile(p, df) {
    var x;
    if (!(p > 0 && p < 1)) bad("probability must be between 0 and 1");
    if (!isFin(df) || !(df >= 1)) bad("df must be >= 1");
    if (p === 0.5) return 0;
    if (df === 1) return Math.tan(Math.PI * (p - 0.5));
    if (df > 10000) return normalQuantile(p);
    if (p > 0.5) {
      x = invBetai(df / 2, 0.5, 2 * (1 - p));
      return Math.sqrt(df * (1 - x) / x);
    }
    x = invBetai(df / 2, 0.5, 2 * p);
    return -Math.sqrt(df * (1 - x) / x);
  }

  function tTail(t, df) {
    if (t < 0) t = -t;
    if (t === 0) return 1;
    return betai(df / 2, 0.5, df / (df + t * t));
  }

  function fTail(F, df1, df2) {
    if (!(F > 0)) return 1;
    return betai(df2 / 2, df1 / 2, df2 / (df2 + df1 * F));
  }

  function normalUpper(z) {
    var q;
    if (z === 0) return 0.5;
    q = 0.5 * gammaQ(0.5, (z * z) / 2);
    if (z > 0) return q;
    return 1 - q;
  }

  function atanh(r) {
    if (r >= 1) return Infinity;
    if (r <= -1) return -Infinity;
    return 0.5 * Math.log((1 + r) / (1 - r));
  }

  function tanh(z) {
    var e;
    if (z > 20) return 1;
    if (z < -20) return -1;
    e = Math.exp(2 * z);
    return (e - 1) / (e + 1);
  }

  function fisherZInterval(r, n) {
    var z, se, crit, lo, hi;
    if (!(n > 3) || !isFin(r) || r <= -1 || r >= 1) {
      return { ciLower: null, ciUpper: null };
    }
    z = atanh(r);
    se = 1 / Math.sqrt(n - 3);
    crit = normalQuantile(Z975_P);
    lo = tanh(z - crit * se);
    hi = tanh(z + crit * se);
    return { ciLower: lo, ciUpper: hi };
  }

  /* ---- big integers, base 1e7, for exact rank sums past 2^53 ---- */

  function biAddInto(dst, src) {
    var carry = 0, i = 0, s, sb;
    if (dst === src) src = dst.slice();
    while (i < src.length || carry) {
      sb = i < src.length ? src[i] : 0;
      s = (i < dst.length ? dst[i] : 0) + sb + carry;
      if (s >= BIG) { carry = 1; s -= BIG; }
      else carry = 0;
      dst[i] = s;
      i++;
    }
  }

  function biTop(a) {
    var i = a.length - 1;
    while (i > 0 && a[i] === 0) i--;
    if (i === 0) return { v: a[0], e: 0 };
    return { v: a[i] * BIG + a[i - 1], e: i - 1 };
  }

  function biRatio(num, den) {
    var A = biTop(num), B = biTop(den);
    if (!(B.v > 0)) return 0;
    return (A.v / B.v) * Math.pow(BIG, A.e - B.e);
  }

  function biSumWhere(row, pred) {
    var acc = [0], s;
    for (s = 0; s < row.length; s++) {
      if (row[s] && pred(s)) biAddInto(acc, row[s]);
    }
    return acc;
  }

  /* Distribution of the sum of a size-nx subset of integer scores. */
  function subsetSumRow(scores, nx) {
    var dp = [], k, item, r, src, s, dest, N;
    N = scores.length;
    dp[0] = [];
    dp[0][0] = [1];
    for (k = 1; k <= nx; k++) dp[k] = [];
    for (item = 0; item < N; item++) {
      r = scores[item];
      for (k = nx; k >= 1; k--) {
        src = dp[k - 1];
        for (s = 0; s < src.length; s++) {
          if (!src[s]) continue;
          dest = s + r;
          if (!dp[k][dest]) dp[k][dest] = [0];
          biAddInto(dp[k][dest], src[s]);
        }
      }
    }
    return dp[nx];
  }

  function twoSidedSubsetP(row, observed) {
    var lower = biSumWhere(row, function (s) { return s <= observed; });
    var upper = biSumWhere(row, function (s) { return s >= observed; });
    var total = biSumWhere(row, function () { return true; });
    var pLo = 2 * biRatio(lower, total);
    var pHi = 2 * biRatio(upper, total);
    var p = pLo < pHi ? pLo : pHi;
    if (p > 1) p = 1;
    if (p < 0) p = 0;
    return p;
  }

  /* Signed-rank subset sums: each score is in or out. Counts fit in a double for n < 50. */
  function signSubsetP(scores, observedScaled, observedRaw, meanRaw) {
    var cur = [1], i, r, s, dest, total = 0, lower = 0, upper = 0, p;
    for (i = 0; i < scores.length; i++) {
      r = scores[i];
      for (s = cur.length - 1; s >= 0; s--) {
        if (!cur[s]) continue;
        dest = s + r;
        while (cur.length <= dest) cur.push(0);
        cur[dest] += cur[s];
      }
    }
    for (s = 0; s < cur.length; s++) {
      if (!cur[s]) continue;
      total += cur[s];
      if (s <= observedScaled) lower += cur[s];
      if (s >= observedScaled) upper += cur[s];
    }
    if (!(total > 0)) return 1;
    if (observedRaw > meanRaw) p = 2 * upper / total;
    else p = 2 * lower / total;
    if (p > 1) p = 1;
    return p;
  }

  /* ---- parsing and column typing ---- */

  function isMissingToken(v) {
    var s, u;
    if (v === null || v === undefined) return true;
    s = trim(v);
    if (s === "") return true;
    u = s.toLowerCase();
    return u === "na" || u === "n/a" || u === "-" || u === "." || u === "nil";
  }

  function parseNumber(v) {
    var s;
    if (isMissingToken(v)) return null;
    s = trim(v);
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    if (!/^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
    var n = Number(s);
    if (!isFinite(n)) return null;
    return n;
  }

  function sortLevels(levels) {
    var a = levels.slice();
    a.sort(function (x, y) {
      var nx = parseNumber(x), ny = parseNumber(y);
      var sx, sy;
      if (nx !== null && ny !== null && String(x).indexOf(",") < 0 && String(y).indexOf(",") < 0) {
        if (nx < ny) return -1;
        if (nx > ny) return 1;
      }
      sx = String(x).toLowerCase();
      sy = String(y).toLowerCase();
      if (sx < sy) return -1;
      if (sx > sy) return 1;
      if (String(x) < String(y)) return -1;
      if (String(x) > String(y)) return 1;
      return 0;
    });
    return a;
  }

  function nameTokens(name) {
    var s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, " ");
    s = trim(s);
    if (!s) return [];
    return s.split(/\s+/);
  }

  function hasPhrase(tokens, phrase) {
    var i, j, ok;
    for (i = 0; i + phrase.length <= tokens.length; i++) {
      ok = true;
      for (j = 0; j < phrase.length; j++) {
        if (tokens[i + j] !== phrase[j]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  function phiHeader(tokens) {
    var phrases = [
      ["patient", "name"],
      ["date", "of", "birth"],
      ["hospital", "no"],
      ["hospital", "number"],
      ["ip", "no"],
      ["op", "no"],
      ["aadhaar"],
      ["adhaar"],
      ["abha"],
      ["uhid"],
      ["mrn"],
      ["phone"],
      ["mobile"],
      ["contact"],
      ["address"],
      ["email"],
      ["e", "mail"],
      ["dob"],
      ["name"]
    ];
    var i;
    for (i = 0; i < phrases.length; i++) {
      if (hasPhrase(tokens, phrases[i])) return phrases[i].join(" ");
    }
    return "";
  }

  function idHeader(tokens) {
    var i;
    if (hasPhrase(tokens, ["s", "no"])) return true;
    if (hasPhrase(tokens, ["ip", "no"])) return true;
    if (hasPhrase(tokens, ["serial"])) return true;
    for (i = 0; i < tokens.length; i++) {
      if (tokens[i] === "id" || tokens[i] === "uhid" || tokens[i] === "sl" ||
          tokens[i] === "serial" || tokens[i] === "reg" || tokens[i] === "sno") return true;
    }
    return false;
  }

  function looksDate(s) {
    var t = trim(s);
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return true;
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(t)) return true;
    if (/^\d{1,2}[ \-](jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[ \-,]\s*\d{4}$/i.test(t)) return true;
    return false;
  }

  function looksEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trim(s));
  }

  function looksMobile(s) {
    var t = trim(s).replace(/[\s\-()]/g, "");
    if (t.indexOf("+91") === 0) t = t.substring(3);
    else if (t.indexOf("0091") === 0) t = t.substring(4);
    else if (t.length === 12 && t.indexOf("91") === 0) t = t.substring(2);
    else if (t.length === 11 && t.charAt(0) === "0") t = t.substring(1);
    return /^[6-9]\d{9}$/.test(t);
  }

  function looksAadhaar(s) {
    var t = trim(s).replace(/[\s\-]/g, "");
    return /^\d{12}$/.test(t);
  }

  function knownBinaryPair(levels) {
    var a = String(levels[0]).toLowerCase();
    var b = String(levels[1]).toLowerCase();
    var key = a + "|" + b;
    var pairs = {
      "yes|no": 1, "no|yes": 1,
      "y|n": 1, "n|y": 1,
      "1|0": 1, "0|1": 1,
      "m|f": 1, "f|m": 1,
      "male|female": 1, "female|male": 1,
      "present|absent": 1, "absent|present": 1,
      "true|false": 1, "false|true": 1,
      "positive|negative": 1, "negative|positive": 1
    };
    return !!pairs[key];
  }

  function detectDelim(text) {
    var i = 0, n = text.length, inQ = false, c;
    var commas = 0, semis = 0, tabs = 0, best = ",", bestN;
    while (i < n) {
      c = text.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (i + 1 < n && text.charAt(i + 1) === '"') { i += 2; continue; }
          inQ = false;
        }
        i++;
        continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === "\n" || c === "\r") break;
      if (c === ",") commas++;
      else if (c === ";") semis++;
      else if (c === "\t") tabs++;
      i++;
    }
    bestN = commas;
    if (semis > bestN) { best = ";"; bestN = semis; }
    if (tabs > bestN) best = "\t";
    return best;
  }

  function rowBlank(row) {
    var i;
    for (i = 0; i < row.length; i++) if (row[i] !== "") return false;
    return true;
  }

  function parseCsv(text) {
    var delim, i, n, c, inQ, field, row, records, columns, rows, r, rec;
    if (typeof text !== "string") bad("csv text must be a string");
    if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
    if (text === "") bad("csv is empty");
    delim = detectDelim(text);
    i = 0;
    n = text.length;
    inQ = false;
    field = "";
    row = [];
    records = [];
    while (i < n) {
      c = text.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (i + 1 < n && text.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQ = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === delim) {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && i + 1 < n && text.charAt(i + 1) === "\n") i++;
        row.push(field);
        field = "";
        records.push(row);
        row = [];
        i++;
        continue;
      }
      field += c;
      i++;
    }
    if (inQ) bad("csv has an unterminated quote");
    if (field.length || row.length) {
      row.push(field);
      records.push(row);
    }
    while (records.length && rowBlank(records[records.length - 1])) records.pop();
    if (!records.length) bad("csv is empty");
    columns = records[0];
    if (!columns.length) bad("csv header is empty");
    rows = [];
    for (r = 1; r < records.length; r++) {
      rec = records[r];
      if (rec.length > columns.length) bad("row has more columns than the header");
      while (rec.length < columns.length) rec.push("");
      rows.push(rec);
    }
    return { columns: columns, rows: rows };
  }

  function inferColumn(name, values) {
    var tokens, headerPhi, present, levels, seen, i, v, label, numOk, dateOk;
    var emailN, phoneN, aadhaarN, uniq, type, phi, reason, numericFrac;
    if (!isArray(values)) bad("inferColumn needs a values array");
    tokens = nameTokens(name);
    headerPhi = phiHeader(tokens);
    present = [];
    for (i = 0; i < values.length; i++) {
      if (!isMissingToken(values[i])) present.push(trim(values[i]));
    }
    seen = {};
    levels = [];
    numOk = 0;
    dateOk = 0;
    emailN = 0;
    phoneN = 0;
    aadhaarN = 0;
    for (i = 0; i < present.length; i++) {
      v = present[i];
      if (!seen[v]) { seen[v] = 1; levels.push(v); }
      else seen[v]++;
      if (parseNumber(v) !== null) numOk++;
      if (looksDate(v)) dateOk++;
      if (looksEmail(v)) emailN++;
      if (looksMobile(v)) phoneN++;
      if (looksAadhaar(v)) aadhaarN++;
    }
    uniq = levels.length;
    numericFrac = present.length ? numOk / present.length : 0;
    type = "text";
    if (present.length && idHeader(tokens) && uniq === present.length) type = "id";
    else if (present.length && dateOk / present.length >= 0.8) type = "date";
    else if (uniq === 2 && (knownBinaryPair(levels) || numericFrac < 0.9)) type = "binary";
    else if (present.length && numericFrac >= 0.9) type = "numeric";
    else if (uniq > 0 && uniq <= 20) type = "categorical";
    else type = "text";
    if (type === "binary" || type === "categorical") levels = sortLevels(levels);
    else levels = [];
    if (levels.length > 20) levels = levels.slice(0, 20);
    phi = false;
    reason = "";
    if (headerPhi) {
      phi = true;
      reason = "header matches " + headerPhi;
    } else if (present.length) {
      if (phoneN / present.length >= 0.5) {
        phi = true;
        reason = "values look like phone numbers";
      } else if (aadhaarN / present.length >= 0.5) {
        phi = true;
        reason = "values look like Aadhaar numbers";
      } else if (emailN / present.length >= 0.5) {
        phi = true;
        reason = "values look like email addresses";
      }
    }
    return {
      type: type,
      levels: levels,
      missing: values.length - present.length,
      phi: phi,
      phiReason: reason
    };
  }

  /* ---- summaries ---- */

  function meanOf(xs) {
    var s = 0, i;
    for (i = 0; i < xs.length; i++) s += xs[i];
    return s / xs.length;
  }

  function sdOf(xs) {
    var m, i, d, v = 0;
    if (xs.length < 2) return null;
    m = meanOf(xs);
    for (i = 0; i < xs.length; i++) { d = xs[i] - m; v += d * d; }
    return Math.sqrt(v / (xs.length - 1));
  }

  function quantile7(sorted, p) {
    var n = sorted.length, h, lo, hi;
    if (!n) return null;
    if (n === 1) return sorted[0];
    h = (n - 1) * p;
    lo = Math.floor(h);
    hi = Math.ceil(h);
    return sorted[lo] * (1 - (h - lo)) + sorted[hi] * (h - lo);
  }

  function shapiroCoef(n) {
    var nn2 = Math.floor(n / 2);
    var a = [], i, an, an25, summ2, ssumm2, rsn, a1, a2, fac, i1;
    var c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
    var c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
    for (i = 0; i <= nn2; i++) a.push(0);
    if (n === 3) {
      a[1] = 0.70710678;
      return a;
    }
    an = n;
    an25 = an + 0.25;
    summ2 = 0;
    for (i = 1; i <= nn2; i++) {
      a[i] = normalQuantile((i - 0.375) / an25);
      summ2 += a[i] * a[i];
    }
    summ2 *= 2;
    ssumm2 = Math.sqrt(summ2);
    rsn = 1 / Math.sqrt(an);
    a1 = polyLow(c1, rsn) - a[1] / ssumm2;
    if (n > 5) {
      i1 = 3;
      a2 = -a[2] / ssumm2 + polyLow(c2, rsn);
      fac = Math.sqrt((summ2 - 2 * a[1] * a[1] - 2 * a[2] * a[2]) /
        (1 - 2 * a1 * a1 - 2 * a2 * a2));
      a[2] = a2;
    } else {
      i1 = 2;
      fac = Math.sqrt((summ2 - 2 * a[1] * a[1]) / (1 - 2 * a1 * a1));
    }
    a[1] = a1;
    for (i = i1; i <= nn2; i++) a[i] = a[i] / -fac;
    return a;
  }

  function shapiroP(W, n) {
    var w1, y, gamma, m, s, xx, z;
    var g = [-2.273, 0.459];
    var c3 = [0.544, -0.39978, 0.025054, -6.714e-4];
    var c4 = [1.3822, -0.77857, 0.062767, -0.0020322];
    var c5 = [-1.5861, -0.31082, -0.083751, 0.0038915];
    var c6 = [-0.4803, -0.082676, 0.0030302];
    var pi6 = 1.90985931710274;
    var stqr = 1.04719755119660;
    if (n === 3) {
      y = pi6 * (Math.asin(Math.sqrt(W < 0 ? 0 : (W > 1 ? 1 : W))) - stqr);
      if (y < 0) y = 0;
      return y;
    }
    w1 = 1 - W;
    if (!(w1 > 0)) return 1;
    y = Math.log(w1);
    if (n <= 11) {
      gamma = polyLow(g, n);
      if (y >= gamma) return 1e-99;
      y = -Math.log(gamma - y);
      m = polyLow(c3, n);
      s = Math.exp(polyLow(c4, n));
    } else {
      xx = Math.log(n);
      m = polyLow(c5, xx);
      s = Math.exp(polyLow(c6, xx));
    }
    if (!(s > 0)) return null;
    z = (y - m) / s;
    return normalUpper(z);
  }

  function shapiroWilk(xs) {
    var n = xs.length, sorted, range, a, nn2, wts, i, sx, sa, ssa, ssx, sax, asa, xsx, W, p;
    if (n < 3 || n > 5000) return null;
    sorted = xs.slice().sort(function (a0, b0) { return a0 - b0; });
    range = sorted[n - 1] - sorted[0];
    if (!(range > 1e-19)) return null;
    a = shapiroCoef(n);
    nn2 = Math.floor(n / 2);
    wts = [];
    for (i = 0; i < n; i++) wts.push(0);
    for (i = 1; i <= nn2; i++) {
      wts[i - 1] = -a[i];
      wts[n - i] = a[i];
    }
    sx = 0;
    sa = 0;
    for (i = 0; i < n; i++) {
      sx += sorted[i] / range;
      sa += wts[i];
    }
    sx /= n;
    sa /= n;
    ssa = 0;
    ssx = 0;
    sax = 0;
    for (i = 0; i < n; i++) {
      asa = wts[i] - sa;
      xsx = sorted[i] / range - sx;
      ssa += asa * asa;
      ssx += xsx * xsx;
      sax += asa * xsx;
    }
    if (!(ssa > 0) || !(ssx > 0)) return null;
    W = (sax * sax) / (ssa * ssx);
    if (W > 1) W = 1;
    if (W < 0) W = 0;
    p = shapiroP(W, n);
    if (p === null || !isFin(p)) return null;
    if (p < 0) p = 0;
    if (p > 1) p = 1;
    return { test: "Shapiro-Wilk", W: W, p: p, normal: p >= 0.05 };
  }

  function numericValues(values) {
    var xs = [], miss = 0, i, n;
    if (!isArray(values)) bad("describe needs a values array");
    for (i = 0; i < values.length; i++) {
      if (isMissingToken(values[i])) { miss++; continue; }
      n = parseNumber(values[i]);
      if (n === null) miss++;
      else xs.push(n);
    }
    return { xs: xs, missing: miss };
  }

  function describe(values, type) {
    var parsed, xs, sorted, sw, i, v, seen, order, counts, nLevel, out, info;
    if (!isArray(values)) bad("describe needs a values array");
    if (type !== "numeric" && type !== "binary" && type !== "categorical") {
      bad("describe type must be numeric, binary, or categorical");
    }
    if (type === "numeric") {
      parsed = numericValues(values);
      xs = parsed.xs;
      sorted = xs.slice().sort(function (a, b) { return a - b; });
      sw = xs.length >= 3 && xs.length <= 5000 ? shapiroWilk(xs) : null;
      return {
        n: xs.length,
        missing: parsed.missing,
        mean: xs.length ? meanOf(xs) : null,
        sd: sdOf(xs),
        median: xs.length ? quantile7(sorted, 0.5) : null,
        q1: xs.length ? quantile7(sorted, 0.25) : null,
        q3: xs.length ? quantile7(sorted, 0.75) : null,
        min: xs.length ? sorted[0] : null,
        max: xs.length ? sorted[sorted.length - 1] : null,
        normality: sw
      };
    }
    seen = {};
    order = [];
    nLevel = 0;
    out = 0;
    for (i = 0; i < values.length; i++) {
      if (isMissingToken(values[i])) { out++; continue; }
      v = trim(values[i]);
      if (!seen[v]) { seen[v] = 0; order.push(v); }
      seen[v]++;
      nLevel++;
    }
    order = sortLevels(order);
    counts = [];
    for (i = 0; i < order.length; i++) {
      counts.push({
        level: order[i],
        n: seen[order[i]],
        pct: nLevel ? (100 * seen[order[i]] / nLevel) : 0
      });
    }
    info = { n: nLevel, missing: out, counts: counts };
    return info;
  }

  /* ---- ranks and classical tests ---- */

  function averageRanks(values) {
    var n = values.length, idx = [], ranks = [], s, e, i, avg;
    for (i = 0; i < n; i++) { idx.push(i); ranks.push(0); }
    idx.sort(function (a, b) {
      if (values[a] < values[b]) return -1;
      if (values[a] > values[b]) return 1;
      return a - b;
    });
    s = 0;
    while (s < n) {
      e = s;
      while (e + 1 < n && values[idx[e + 1]] === values[idx[s]]) e++;
      avg = (s + 1 + e + 1) / 2;
      for (i = s; i <= e; i++) ranks[idx[i]] = avg;
      s = e + 1;
    }
    return ranks;
  }

  function tieCubeSum(ranks) {
    var copy = ranks.slice().sort(function (a, b) { return a - b; });
    var i = 0, j, t, sum = 0;
    while (i < copy.length) {
      j = i;
      while (j + 1 < copy.length && copy[j + 1] === copy[i]) j++;
      t = j - i + 1;
      sum += t * t * t - t;
      i = j + 1;
    }
    return sum;
  }

  function welchTest(a, b) {
    var n1 = a.length, n2 = b.length, m1, m2, s1, s2, v1, v2, se, t, df, crit, md;
    if (n1 < 2 || n2 < 2) bad("Welch t test needs at least 2 observations in each group");
    m1 = meanOf(a);
    m2 = meanOf(b);
    s1 = sdOf(a);
    s2 = sdOf(b);
    v1 = (s1 * s1) / n1;
    v2 = (s2 * s2) / n2;
    se = Math.sqrt(v1 + v2);
    md = m1 - m2;
    if (!(se > 0)) {
      return {
        statistic: md === 0 ? 0 : (md > 0 ? Infinity : -Infinity),
        df: null,
        p: md === 0 ? 1 : 0,
        estimate: md,
        ciLower: null,
        ciUpper: null,
        means: [m1, m2]
      };
    }
    t = md / se;
    df = (v1 + v2) * (v1 + v2) / ((v1 * v1) / (n1 - 1) + (v2 * v2) / (n2 - 1));
    crit = tQuantile(Z975_P, df);
    return {
      statistic: t,
      df: df,
      p: tTail(t, df),
      estimate: md,
      ciLower: md - crit * se,
      ciUpper: md + crit * se,
      means: [m1, m2]
    };
  }

  function pairedTTest(d) {
    var n = d.length, m, s, se, t, crit;
    if (n < 2) bad("paired t test needs at least 2 complete pairs");
    m = meanOf(d);
    s = sdOf(d);
    se = s / Math.sqrt(n);
    if (!(se > 0)) {
      return {
        statistic: m === 0 ? 0 : (m > 0 ? Infinity : -Infinity),
        df: n - 1,
        p: m === 0 ? 1 : 0,
        estimate: m,
        ciLower: null,
        ciUpper: null
      };
    }
    t = m / se;
    crit = tQuantile(Z975_P, n - 1);
    return {
      statistic: t,
      df: n - 1,
      p: tTail(t, n - 1),
      estimate: m,
      ciLower: m - crit * se,
      ciUpper: m + crit * se
    };
  }

  function anovaTest(groups) {
    var k = groups.length, i, j, N = 0, grand = 0, mean, ni, ssb = 0, ssw = 0, d, msb, msw, F, df1, df2;
    var means = [];
    if (k < 2) bad("ANOVA needs at least 2 groups");
    for (i = 0; i < k; i++) {
      if (groups[i].length < 1) bad("ANOVA group is empty");
      N += groups[i].length;
      means.push(meanOf(groups[i]));
      grand += meanOf(groups[i]) * groups[i].length;
    }
    if (N <= k) bad("ANOVA needs residual degrees of freedom");
    grand /= N;
    for (i = 0; i < k; i++) {
      ni = groups[i].length;
      ssb += ni * (means[i] - grand) * (means[i] - grand);
      for (j = 0; j < ni; j++) {
        d = groups[i][j] - means[i];
        ssw += d * d;
      }
    }
    df1 = k - 1;
    df2 = N - k;
    msb = ssb / df1;
    msw = ssw / df2;
    if (!(msw > 0)) {
      F = msb === 0 ? 0 : Infinity;
      return { statistic: F, df: [df1, df2], p: F === 0 ? 1 : 0 };
    }
    F = msb / msw;
    return { statistic: F, df: [df1, df2], p: fTail(F, df1, df2) };
  }

  function kruskalTest(groups) {
    var all = [], own = [], i, j, ranks, N, Ri, ni, H, corr, tie, df;
    for (i = 0; i < groups.length; i++) {
      own.push(all.length);
      for (j = 0; j < groups[i].length; j++) all.push(groups[i][j]);
    }
    N = all.length;
    if (N < 2) bad("Kruskal-Wallis needs observations");
    ranks = averageRanks(all);
    H = 0;
    for (i = 0; i < groups.length; i++) {
      ni = groups[i].length;
      Ri = 0;
      for (j = 0; j < ni; j++) Ri += ranks[own[i] + j];
      H += (Ri * Ri) / ni;
    }
    H = (12 / (N * (N + 1))) * H - 3 * (N + 1);
    tie = tieCubeSum(ranks);
    corr = 1 - tie / (N * N * N - N);
    if (corr > 0 && corr < 1) H = H / corr;
    df = groups.length - 1;
    if (H < 0) H = 0;
    return { statistic: H, df: df, p: chiSqUpper(H, df) };
  }

  function mannWhitney(x, y) {
    var both = [], i, ranks, nx, ny, N, rankSum, U, mean, sigma, tie, z, corr, scores, row, observed;
    nx = x.length;
    ny = y.length;
    if (!nx || !ny) bad("Mann-Whitney needs observations in each group");
    for (i = 0; i < nx; i++) both.push(x[i]);
    for (i = 0; i < ny; i++) both.push(y[i]);
    ranks = averageRanks(both);
    rankSum = 0;
    for (i = 0; i < nx; i++) rankSum += ranks[i];
    U = rankSum - nx * (nx + 1) / 2;
    if (nx < 50 && ny < 50) {
      scores = [];
      for (i = 0; i < ranks.length; i++) scores.push(Math.round(ranks[i] * 2));
      observed = 0;
      for (i = 0; i < nx; i++) observed += scores[i];
      row = subsetSumRow(scores, nx);
      return { statistic: U, df: null, p: twoSidedSubsetP(row, observed) };
    }
    N = nx + ny;
    mean = nx * ny / 2;
    tie = tieCubeSum(ranks);
    sigma = Math.sqrt((nx * ny / 12) * ((N + 1) - tie / (N * (N - 1))));
    if (!(sigma > 0)) return { statistic: U, df: null, p: U === mean ? 1 : 0 };
    z = U - mean;
    corr = z > 0 ? 0.5 : (z < 0 ? -0.5 : 0);
    z = (z - corr) / sigma;
    return { statistic: U, df: null, p: chiSqUpper(z * z, 1) };
  }

  function wilcoxonSigned(d) {
    var n = d.length, ranks, i, V, zRanks, scores, observed, mean, k, NTIES, vari, sigma, z, corr, absx;
    if (n < 1) bad("Wilcoxon signed-rank needs observations");
    absx = [];
    for (i = 0; i < n; i++) absx.push(d[i] < 0 ? -d[i] : d[i]);
    ranks = averageRanks(absx);
    V = 0;
    zRanks = [];
    k = 0;
    for (i = 0; i < n; i++) {
      if (d[i] > 0) V += ranks[i];
      if (d[i] !== 0) zRanks.push(ranks[i]);
      else k++;
    }
    if (n < 50) {
      if (!zRanks.length) return { statistic: 0, df: null, p: 1 };
      scores = [];
      observed = Math.round(V * 2);
      mean = 0;
      for (i = 0; i < zRanks.length; i++) {
        scores.push(Math.round(zRanks[i] * 2));
        mean += zRanks[i];
      }
      mean = mean / 2;
      return { statistic: V, df: null, p: signSubsetP(scores, observed, V, mean) };
    }
    mean = n * (n + 1) / 4;
    vari = n * (n + 1) * (2 * n + 1) / 24;
    NTIES = tieCubeSum(ranks);
    vari -= NTIES / 48;
    if (k) {
      mean -= k * (k + 1) / 4;
      vari -= k * (k + 1) * (k + 1) / 16;
    }
    sigma = Math.sqrt(vari);
    if (!(sigma > 0)) return { statistic: V, df: null, p: V === mean ? 1 : 0 };
    z = V - mean;
    corr = z > 0 ? 0.5 : (z < 0 ? -0.5 : 0);
    z = (z - corr) / sigma;
    return { statistic: V, df: null, p: chiSqUpper(z * z, 1) };
  }



  function pearsonR(x, y) {
    var n = x.length, i, mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0, dx, dy;
    if (n < 3) bad("correlation needs at least 3 complete pairs");
    for (i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n;
    my /= n;
    for (i = 0; i < n; i++) {
      dx = x[i] - mx;
      dy = y[i] - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    if (!(sxx > 0) || !(syy > 0)) bad("correlation is undefined when a variable has no variation");
    return sxy / Math.sqrt(sxx * syy);
  }

  function corrTest(r, n) {
    var df = n - 2, t, p, ci;
    if (r >= 1 || r <= -1) {
      return { statistic: r, df: df, p: r === 1 || r === -1 ? 0 : 1, ciLower: null, ciUpper: null };
    }
    t = r * Math.sqrt(df / (1 - r * r));
    p = tTail(t, df);
    ci = fisherZInterval(r, n);
    return { statistic: r, df: df, p: p, ciLower: ci.ciLower, ciUpper: ci.ciUpper };
  }

  function logChoose(n, k) {
    if (k < 0 || k > n) return -Infinity;
    return gammln(n + 1) - gammln(k + 1) - gammln(n - k + 1);
  }

  function fisherExactP(table) {
    var a = table[0][0], b = table[0][1], c = table[1][0], d = table[1][1];
    var r1 = a + b, c1 = a + c, c2 = b + d, N = r1 + c + d;
    var lo = r1 - c2; if (lo < 0) lo = 0;
    var hi = r1 < c1 ? r1 : c1;
    var logs = [], k, lp, maxLp = -Infinity, pObs = null, i, sum = 0, tot = 0, e;
    for (k = lo; k <= hi; k++) {
      lp = logChoose(c1, k) + logChoose(c2, r1 - k) - logChoose(N, r1);
      logs.push(lp);
      if (k === a) pObs = lp;
      if (lp > maxLp) maxLp = lp;
    }
    if (pObs === null) bad("Fisher table is outside its margins");
    for (i = 0; i < logs.length; i++) {
      e = Math.exp(logs[i] - maxLp);
      tot += e;
      if (logs[i] <= pObs + Math.log(1 + 1e-7)) sum += e;
    }
    return tot > 0 ? sum / tot : 1;
  }

  function woolfAndKatz(a, b, c, d) {
    var z, se, ser, or, rr, use;
    use = (a === 0 || b === 0 || c === 0 || d === 0);
    if (use) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; }
    if (!(a > 0 && b > 0 && c > 0 && d > 0)) bad("odds ratio is undefined");
    or = (a * d) / (b * c);
    se = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
    rr = (a / (a + b)) / (c / (c + d));
    ser = Math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d));
    z = normalQuantile(Z975_P);
    return {
      or: or,
      orLo: Math.exp(Math.log(or) - z * se),
      orHi: Math.exp(Math.log(or) + z * se),
      rr: rr,
      rrLo: rr > 0 ? Math.exp(Math.log(rr) - z * ser) : 0,
      rrHi: rr > 0 ? Math.exp(Math.log(rr) + z * ser) : null
    };
  }

  function chiSquare(counts) {
    var r = counts.length, c = counts[0].length, i, j, N = 0, rowS = [], colS = [], E, stat, yates, diff, df;
    for (i = 0; i < r; i++) {
      rowS.push(0);
      for (j = 0; j < c; j++) {
        if (!colS[j]) colS[j] = 0;
        rowS[i] += counts[i][j];
        colS[j] += counts[i][j];
        N += counts[i][j];
      }
    }
    if (!(N > 0)) bad("chi-square table is empty");
    E = [];
    yates = 0;
    if (r === 2 && c === 2) {
      diff = Math.abs(counts[0][0] - rowS[0] * colS[0] / N);
      yates = diff < 0.5 ? diff : 0.5;
    }
    stat = 0;
    for (i = 0; i < r; i++) {
      E[i] = [];
      for (j = 0; j < c; j++) {
        E[i][j] = rowS[i] * colS[j] / N;
        if (!(E[i][j] > 0)) bad("chi-square expected count is zero");
        diff = Math.abs(counts[i][j] - E[i][j]) - yates;
        if (diff < 0) diff = 0;
        stat += (diff * diff) / E[i][j];
      }
    }
    df = (r - 1) * (c - 1);
    return { statistic: stat, df: df, p: chiSqUpper(stat, df), expected: E };
  }

  function mcnemarTest(b, c) {
    var stat, or, se, z, lo, hi;
    if (b + c === 0) {
      return { statistic: 0, df: 1, p: 1, estimate: null, ciLower: null, ciUpper: null };
    }
    stat = (Math.abs(b - c) - 1);
    stat = (stat * stat) / (b + c);
    if (b === 0 || c === 0) { b += 0.5; c += 0.5; }
    or = b / c;
    se = Math.sqrt(1 / b + 1 / c);
    z = normalQuantile(Z975_P);
    lo = Math.exp(Math.log(or) - z * se);
    hi = Math.exp(Math.log(or) + z * se);
    return { statistic: stat, df: 1, p: chiSqUpper(stat, 1), estimate: or, ciLower: lo, ciUpper: hi };
  }

  /* ---- test choice ---- */

  var TEST_TEXT = {
    welch_t: ["Welch t test", "(both groups were normally distributed, so we compared means)"],
    mann_whitney: ["Mann-Whitney U test", "(the outcome was not normally distributed in both groups, so we compared medians)"],
    anova: ["One-way ANOVA", "(the groups were normally distributed, so we compared means)"],
    kruskal: ["Kruskal-Wallis test", "(the groups were not all normally distributed, so we compared ranks)"],
    chi_square: ["Chi-square test", "(the outcome was categorical and the expected counts were large enough for a chi-square test)"],
    fisher: ["Fisher exact test", "(an expected count was under 5, so we used an exact test)"],
    paired_t: ["Paired t test", "(the paired differences were normally distributed, so we compared the mean difference)"],
    wilcoxon: ["Wilcoxon signed-rank test", "(the paired differences were not normally distributed, so we compared the ranks of the differences)"],
    mcnemar: ["McNemar test", "(the outcome was paired and binary, so we compared discordant pairs)"],
    pearson: ["Pearson correlation", "(both variables were normally distributed, so we used a linear correlation)"],
    spearman: ["Spearman rank correlation", "(a variable was not normally distributed, so we used a rank correlation)"]
  };

  function allNormal(normal) {
    var i;
    if (normal === true) return true;
    if (isArray(normal)) {
      if (!normal.length) return false;
      for (i = 0; i < normal.length; i++) if (!normal[i]) return false;
      return true;
    }
    return false;
  }

  function chooseTest(opts) {
    var outcomeType, groups, paired, normal, smallExpected, key;
    if (!opts || typeof opts !== "object") bad("chooseTest needs an options object");
    outcomeType = opts.outcomeType;
    if (outcomeType === "survival") {
      return {
        test: "log_rank",
        label: "Kaplan-Meier with log-rank test",
        why: "(compares time to the event between groups)",
        ok: true,
        warnings: []
      };
    }
    if (outcomeType !== "numeric" && outcomeType !== "binary" && outcomeType !== "categorical") {
      bad("chooseTest needs an outcome type of numeric, binary, or categorical");
    }
    groups = opts.groups;
    if (groups === null || groups === undefined || groups === "") groups = 0;
    if (isArray(groups)) groups = groups.length;
    if (typeof groups !== "number" || !isFinite(groups)) bad("groups must be a count");
    paired = !!opts.paired;
    normal = allNormal(opts.normal);
    smallExpected = !!opts.smallExpected;
    if (paired && outcomeType === "numeric") key = normal ? "paired_t" : "wilcoxon";
    else if (paired && (outcomeType === "binary" || outcomeType === "categorical")) key = "mcnemar";
    else if (outcomeType === "numeric" && groups === 0) key = normal ? "pearson" : "spearman";
    else if (outcomeType === "numeric" && groups === 2) key = normal ? "welch_t" : "mann_whitney";
    else if (outcomeType === "numeric" && groups > 2) key = normal ? "anova" : "kruskal";
    else if (outcomeType === "binary" || outcomeType === "categorical") key = smallExpected ? "fisher" : "chi_square";
    else bad("chooseTest cannot pick a test for these inputs");
    return { test: key, label: TEST_TEXT[key][0], why: TEST_TEXT[key][1] };
  }

  function isPositiveLevel(level) {
    var u = String(level).toLowerCase();
    var pos = {
      "1": 1, "yes": 1, "y": 1, "true": 1, "present": 1, "positive": 1,
      "pos": 1, "male": 1, "m": 1, "case": 1, "event": 1, "abnormal": 1
    };
    return !!pos[u];
  }

  function eventLevel(levels) {
    var i, hits = [];
    for (i = 0; i < levels.length; i++) if (isPositiveLevel(levels[i])) hits.push(levels[i]);
    if (hits.length === 1) return hits[0];
    return levels[levels.length - 1];
  }

  function indexOfLevel(levels, level) {
    var i;
    for (i = 0; i < levels.length; i++) if (levels[i] === level) return i;
    return -1;
  }

  function uniqueLabels(labels) {
    var seen = {}, out = [], i;
    for (i = 0; i < labels.length; i++) {
      if (!seen[labels[i]]) { seen[labels[i]] = 1; out.push(labels[i]); }
    }
    return sortLevels(out);
  }

  function looksContinuous(values) {
    var parsed = numericValues(values), xs = parsed.xs, seen = {}, u = 0, i, key;
    if (!xs.length) return false;
    if (xs.length !== values.length - parsed.missing && parsed.missing !== values.length - xs.length) {
      /* numericValues already dropped non-numbers; continuous only if almost all parse */
    }
    if (xs.length / (xs.length + 0) < 1 && parsed.missing > xs.length * 0.1) return false;
    for (i = 0; i < xs.length; i++) {
      key = String(xs[i]);
      if (!seen[key]) { seen[key] = 1; u++; }
    }
    if (u >= 10) return true;
    if (u > 5 && xs.length && u / xs.length > 0.5) return true;
    return false;
  }

  function groupNormFlags(buckets) {
    var flags = [], i, sw;
    for (i = 0; i < buckets.length; i++) {
      sw = buckets[i].length >= 3 && buckets[i].length <= 5000 ? shapiroWilk(buckets[i]) : null;
      flags.push(!!(sw && sw.normal));
    }
    return flags;
  }

  function describeGroup(name, xs, type) {
    return { group: name, describe: describe(xs, type) };
  }

  function blankEffect() {
    return { measure: null, estimate: null, ciLower: null, ciUpper: null };
  }

  function pack(choice, statName, stat, df, p, byGroup, effect, dropped) {
    return {
      test: choice.test,
      label: choice.label,
      why: choice.why,
      statistic: stat,
      statisticName: statName,
      df: df,
      p: p,
      byGroup: byGroup,
      effect: effect,
      dropped: dropped
    };
  }

  function compare(outcomeValues, groupValues, opts) {
    var outcomeType, paired, i, ox, gx, dropped, pairsX, pairsG, labels, buckets, flags, choice;
    var a, b, d, sw, res, byGroup, cont, rx, ry, ranks, rho, corr, names;
    if (!isArray(outcomeValues) || !isArray(groupValues)) bad("compare needs two arrays");
    if (outcomeValues.length !== groupValues.length) bad("compare arrays must have the same length");
    if (!opts || typeof opts !== "object") bad("compare needs an options object");
    outcomeType = opts.outcomeType;
    if (outcomeType !== "numeric" && outcomeType !== "binary" && outcomeType !== "categorical") {
      bad("compare needs an outcome type of numeric, binary, or categorical");
    }
    paired = !!opts.paired;
    dropped = 0;
    if (paired) {
      pairsX = [];
      pairsG = [];
      for (i = 0; i < outcomeValues.length; i++) {
        if (isMissingToken(outcomeValues[i]) || isMissingToken(groupValues[i])) { dropped++; continue; }
        if (outcomeType === "numeric") {
          ox = parseNumber(outcomeValues[i]);
          gx = parseNumber(groupValues[i]);
          if (ox === null || gx === null) { dropped++; continue; }
          pairsX.push(ox);
          pairsG.push(gx);
        } else {
          pairsX.push(trim(outcomeValues[i]));
          pairsG.push(trim(groupValues[i]));
        }
      }
      if (outcomeType === "numeric") {
        d = [];
        for (i = 0; i < pairsX.length; i++) d.push(pairsX[i] - pairsG[i]);
        sw = d.length >= 3 && d.length <= 5000 ? shapiroWilk(d) : null;
        choice = chooseTest({ outcomeType: "numeric", groups: 2, paired: true, normal: !!(sw && sw.normal) });
        byGroup = [
          describeGroup("1", pairsX, "numeric"),
          describeGroup("2", pairsG, "numeric")
        ];
        if (choice.test === "paired_t") {
          res = pairedTTest(d);
          return pack(choice, "t", res.statistic, res.df, res.p, byGroup, {
            measure: "MD", estimate: res.estimate, ciLower: res.ciLower, ciUpper: res.ciUpper
          }, dropped);
        }
        res = wilcoxonSigned(d);
        return pack(choice, "V", res.statistic, null, res.p, byGroup, blankEffect(), dropped);
      }
      return comparePairedBinary(pairsX, pairsG, dropped);
    }

    if (outcomeType === "numeric" && looksContinuous(groupValues) && looksContinuous(outcomeValues)) {
      return compareCorrelation(outcomeValues, groupValues);
    }

    labels = [];
    buckets = [];
    names = [];
    dropped = 0;
    var index = {};
    for (i = 0; i < outcomeValues.length; i++) {
      if (isMissingToken(outcomeValues[i]) || isMissingToken(groupValues[i])) { dropped++; continue; }
      gx = trim(groupValues[i]);
      if (outcomeType === "numeric") {
        ox = parseNumber(outcomeValues[i]);
        if (ox === null) { dropped++; continue; }
      } else ox = trim(outcomeValues[i]);
      if (!index.hasOwnProperty(gx)) {
        index[gx] = names.length;
        names.push(gx);
        buckets.push([]);
      }
      buckets[index[gx]].push(ox);
    }
    labels = sortLevels(names);
    var ordered = [];
    for (i = 0; i < labels.length; i++) ordered.push(buckets[index[labels[i]]]);
    if (labels.length < 2) bad("compare needs at least two groups");
    byGroup = [];
    for (i = 0; i < labels.length; i++) byGroup.push(describeGroup(labels[i], ordered[i], outcomeType));

    if (outcomeType === "numeric") {
      flags = groupNormFlags(ordered);
      choice = chooseTest({ outcomeType: "numeric", groups: labels.length, paired: false, normal: flags });
      if (choice.test === "welch_t") {
        res = welchTest(ordered[0], ordered[1]);
        return pack(choice, "t", res.statistic, res.df, res.p, byGroup, {
          measure: "MD", estimate: res.estimate, ciLower: res.ciLower, ciUpper: res.ciUpper
        }, dropped);
      }
      if (choice.test === "mann_whitney") {
        res = mannWhitney(ordered[0], ordered[1]);
        return pack(choice, "U", res.statistic, null, res.p, byGroup, blankEffect(), dropped);
      }
      if (choice.test === "anova") {
        res = anovaTest(ordered);
        return pack(choice, "F", res.statistic, res.df, res.p, byGroup, blankEffect(), dropped);
      }
      res = kruskalTest(ordered);
      return pack(choice, "H", res.statistic, res.df, res.p, byGroup, blankEffect(), dropped);
    }
    return compareCategorical(labels, ordered, byGroup, dropped, opts);
  }

  function compareCorrelation(outcomeValues, groupValues) {
    var xs = [], ys = [], i, ox, gx, dropped = 0, dx, dy, swx, swy, choice, r, ranks, rho, res, byGroup;
    for (i = 0; i < outcomeValues.length; i++) {
      if (isMissingToken(outcomeValues[i]) || isMissingToken(groupValues[i])) { dropped++; continue; }
      ox = parseNumber(outcomeValues[i]);
      gx = parseNumber(groupValues[i]);
      if (ox === null || gx === null) { dropped++; continue; }
      xs.push(ox);
      ys.push(gx);
    }
    swx = xs.length >= 3 && xs.length <= 5000 ? shapiroWilk(xs) : null;
    swy = ys.length >= 3 && ys.length <= 5000 ? shapiroWilk(ys) : null;
    choice = chooseTest({
      outcomeType: "numeric",
      groups: 0,
      paired: false,
      normal: [!!(swx && swx.normal), !!(swy && swy.normal)]
    });
    byGroup = [describeGroup("1", xs, "numeric"), describeGroup("2", ys, "numeric")];
    if (choice.test === "pearson") {
      r = pearsonR(xs, ys);
      res = corrTest(r, xs.length);
      return pack(choice, "r", res.statistic, res.df, res.p, byGroup, {
        measure: "r", estimate: res.statistic, ciLower: res.ciLower, ciUpper: res.ciUpper
      }, dropped);
    }
    ranks = [averageRanks(xs), averageRanks(ys)];
    rho = pearsonR(ranks[0], ranks[1]);
    res = corrTest(rho, xs.length);
    return pack(choice, "rho", res.statistic, res.df, res.p, byGroup, {
      measure: "rho", estimate: res.statistic, ciLower: res.ciLower, ciUpper: res.ciUpper
    }, dropped);
  }

  function comparePairedBinary(xs, ys, dropped) {
    var tab = crosstab(xs, ys), b, c, res, choice, byGroup, levels;
    if (tab.rowLevels.length !== 2 || tab.colLevels.length !== 2) {
      bad("McNemar test needs two levels on each measurement");
    }
    b = tab.counts[0][1];
    c = tab.counts[1][0];
    res = mcnemarTest(b, c);
    choice = chooseTest({ outcomeType: "binary", groups: 2, paired: true, normal: false });
    levels = tab.rowLevels;
    byGroup = [
      describeGroup("1", xs, levels.length === 2 ? "binary" : "categorical"),
      describeGroup("2", ys, "binary")
    ];
    return pack(choice, "chi2", res.statistic, res.df, res.p, byGroup, {
      measure: "OR",
      estimate: res.estimate,
      ciLower: res.ciLower,
      ciUpper: res.ciUpper
    }, dropped);
  }

  function binaryEffectForDesign(wk, opts) {
    var st = String((opts && opts.studyType) || "").toLowerCase();
    if (/case[-_\s]?control/.test(st)) {
      return {
        measure: "OR",
        estimate: wk.or,
        ciLower: wk.orLo,
        ciUpper: wk.orHi
      };
    }
    if (/\brct\b|randomi|trial|cohort|survival|time to event/.test(st)) {
      return {
        measure: "RR",
        estimate: wk.rr,
        ciLower: wk.rrLo,
        ciUpper: wk.rrHi,
        or: wk.or,
        orCiLower: wk.orLo,
        orCiUpper: wk.orHi
      };
    }
    return {
      measure: "OR",
      estimate: wk.or,
      ciLower: wk.orLo,
      ciUpper: wk.orHi,
      rr: wk.rr,
      rrCiLower: wk.rrLo,
      rrCiUpper: wk.rrHi
    };
  }

  function compareCategorical(labels, ordered, byGroup, dropped, opts) {
    var colSeen = {}, cols = [], i, j, r, c, counts, choice, small, chi, wk, effect, a, b, d, ev, evIdx, other, out;
    var studyDesign = String((opts && opts.studyType) || "").toLowerCase();
    for (i = 0; i < ordered.length; i++) {
      for (j = 0; j < ordered[i].length; j++) {
        if (!colSeen[ordered[i][j]]) { colSeen[ordered[i][j]] = 1; cols.push(ordered[i][j]); }
      }
    }
    cols = sortLevels(cols);
    counts = [];
    for (r = 0; r < labels.length; r++) {
      counts[r] = [];
      for (c = 0; c < cols.length; c++) counts[r][c] = 0;
      for (j = 0; j < ordered[r].length; j++) {
        c = indexOfLevel(cols, ordered[r][j]);
        counts[r][c]++;
      }
    }
    small = false;
    if (labels.length === 2 && cols.length === 2) {
      chi = chiSquare(counts);
      for (r = 0; r < 2; r++) for (c = 0; c < 2; c++) if (chi.expected[r][c] < 5) small = true;
    }
    choice = chooseTest({
      outcomeType: cols.length === 2 ? "binary" : "categorical",
      groups: labels.length,
      paired: false,
      normal: false,
      smallExpected: small
    });
    effect = blankEffect();
    if (choice.test === "fisher") {
      ev = eventLevel(cols);
      evIdx = indexOfLevel(cols, ev);
      other = evIdx === 0 ? 1 : 0;
      a = counts[0][evIdx];
      b = counts[0][other];
      c = counts[1][evIdx];
      d = counts[1][other];
      wk = woolfAndKatz(a, b, c, d);
      effect = binaryEffectForDesign(wk, opts);
      out = pack(choice, null, null, null, fisherExactP(counts), byGroup, effect, dropped);
      if (/case[-_\s]?control/.test(studyDesign)) out.studyDesign = "case-control";
      return out;
    }
    chi = chiSquare(counts);
    if (labels.length === 2 && cols.length === 2) {
      ev = eventLevel(cols);
      evIdx = indexOfLevel(cols, ev);
      other = evIdx === 0 ? 1 : 0;
      a = counts[0][evIdx];
      b = counts[0][other];
      c = counts[1][evIdx];
      d = counts[1][other];
      wk = woolfAndKatz(a, b, c, d);
      effect = binaryEffectForDesign(wk, opts);
    }
    out = pack(choice, "chi2", chi.statistic, chi.df, chi.p, byGroup, effect, dropped);
    if (/case[-_\s]?control/.test(studyDesign)) out.studyDesign = "case-control";
    return out;
  }

  function crosstab(aValues, bValues) {
    var i, ax, bx, rowNames = [], colNames = [], ri = {}, ci = {}, counts = [], r, c, N, rowS, colS, expected;
    if (!isArray(aValues) || !isArray(bValues)) bad("crosstab needs two arrays");
    if (aValues.length !== bValues.length) bad("crosstab arrays must have the same length");
    var pairsA = [], pairsB = [];
    for (i = 0; i < aValues.length; i++) {
      if (isMissingToken(aValues[i]) || isMissingToken(bValues[i])) continue;
      pairsA.push(trim(aValues[i]));
      pairsB.push(trim(bValues[i]));
    }
    rowNames = uniqueLabels(pairsA);
    colNames = uniqueLabels(pairsB);
    for (r = 0; r < rowNames.length; r++) {
      ri[rowNames[r]] = r;
      counts[r] = [];
      for (c = 0; c < colNames.length; c++) counts[r][c] = 0;
    }
    for (c = 0; c < colNames.length; c++) ci[colNames[c]] = c;
    for (i = 0; i < pairsA.length; i++) counts[ri[pairsA[i]]][ci[pairsB[i]]]++;
    N = pairsA.length;
    rowS = [];
    colS = [];
    for (c = 0; c < colNames.length; c++) colS[c] = 0;
    for (r = 0; r < rowNames.length; r++) {
      rowS[r] = 0;
      for (c = 0; c < colNames.length; c++) {
        rowS[r] += counts[r][c];
        colS[c] += counts[r][c];
      }
    }
    expected = [];
    for (r = 0; r < rowNames.length; r++) {
      expected[r] = [];
      for (c = 0; c < colNames.length; c++) {
        expected[r][c] = N ? (rowS[r] * colS[c] / N) : 0;
      }
    }
    return { rowLevels: rowNames, colLevels: colNames, counts: counts, expected: expected };
  }

  /* ---- display ---- */

  function roundAway(x, digits) {
    var sign = x < 0 ? -1 : 1;
    var p = Math.pow(10, digits);
    var v = Math.abs(x) * p;
    var n = Math.floor(v + 1e-8);
    if (v + 1e-8 - n >= 0.5) n += 1;
    if (n === 0) sign = 1;
    return sign * n / p;
  }

  function fmtNum(x, digits) {
    var sign, p, v, n, ip, fp, fs;
    if (!isFin(x)) return "";
    sign = x < 0 ? "-" : "";
    p = Math.pow(10, digits);
    v = Math.abs(x) * p;
    n = Math.floor(v + 1e-8);
    if (v + 1e-8 - n >= 0.5) n += 1;
    if (n === 0) sign = "";
    ip = Math.floor(n / p);
    fp = n - ip * p;
    if (digits === 0) return sign + String(ip);
    fs = String(fp);
    while (fs.length < digits) fs = "0" + fs;
    return sign + String(ip) + "." + fs;
  }

  function fmtMean(desc) {
    if (!desc || !desc.n) return "";
    if (desc.n < 2 || desc.sd === null) return fmtNum(desc.mean, 1);
    return fmtNum(desc.mean, 1) + PM + fmtNum(desc.sd, 1);
  }

  function fmtMedian(desc) {
    if (!desc || !desc.n) return "";
    if (desc.n < 2) return fmtNum(desc.median, 1);
    return fmtNum(desc.median, 1) + " (" + fmtNum(desc.q1, 1) + " to " + fmtNum(desc.q3, 1) + ")";
  }

  function fmtCount(n, pct) {
    return String(n) + " (" + fmtNum(pct, 1) + "%)";
  }

  function formatP(p) {
    if (!isFin(p) || p < 0 || p > 1) bad("p must be between 0 and 1");
    if (p < 0.001) return "p < 0.001";
    if (p < 0.1) return "p = " + fmtNum(p, 3);
    return "p = " + fmtNum(p, 2);
  }

  function columnValues(rows, columns, name) {
    var idx = -1, i, out = [];
    for (i = 0; i < columns.length; i++) if (columns[i] === name) { idx = i; break; }
    if (idx < 0) bad("unknown column " + name);
    for (i = 0; i < rows.length; i++) {
      if (!isArray(rows[i])) bad("each row must be an array");
      out.push(rows[i][idx]);
    }
    return out;
  }

  function resolveTypes(columns, types) {
    var map = {}, i;
    if (!types) return map;
    if (isArray(types)) {
      for (i = 0; i < columns.length && i < types.length; i++) map[columns[i]] = types[i];
      return map;
    }
    if (typeof types === "object") return types;
    bad("types must be a map or an array");
    return map;
  }

  function table1(rows, columns, groupColumn, variables, types) {
    var typeMap, groupsVals, i, j, gLabels, gCounts, seen, overallMask, varName, type, vals;
    var useMean, overallDesc, groupDesc, cells, result, rowOut, level, counts, gi, lv, n, pct, found;
    if (!isArray(rows) || !isArray(columns) || !isArray(variables)) bad("table1 needs rows, columns, and variables");
    typeMap = resolveTypes(columns, types);
    groupsVals = columnValues(rows, columns, groupColumn);
    seen = {};
    gLabels = [];
    for (i = 0; i < groupsVals.length; i++) {
      if (isMissingToken(groupsVals[i])) continue;
      if (!seen[trim(groupsVals[i])]) { seen[trim(groupsVals[i])] = 1; gLabels.push(trim(groupsVals[i])); }
    }
    gLabels = sortLevels(gLabels);
    if (gLabels.length < 1) bad("table1 group column has no values");
    gCounts = [];
    for (i = 0; i < gLabels.length; i++) gCounts.push({ name: gLabels[i], n: 0 });
    for (i = 0; i < groupsVals.length; i++) {
      if (isMissingToken(groupsVals[i])) continue;
      for (j = 0; j < gLabels.length; j++) if (gLabels[j] === trim(groupsVals[i])) gCounts[j].n++;
    }
    rowOut = [];
    for (j = 0; j < variables.length; j++) {
      varName = variables[j];
      vals = columnValues(rows, columns, varName);
      type = typeMap[varName];
      if (!type) type = inferColumn(varName, vals).type;
      if (type === "numeric") {
        overallMask = [];
        for (i = 0; i < vals.length; i++) {
          if (!isMissingToken(groupsVals[i])) overallMask.push(vals[i]);
          else overallMask.push("");
        }
        overallDesc = describe(overallMask, "numeric");
        useMean = !!(overallDesc.normality && overallDesc.normality.normal);
        cells = [];
        groupDesc = [];
        for (gi = 0; gi < gLabels.length; gi++) {
          var bucket = [];
          for (i = 0; i < vals.length; i++) {
            if (!isMissingToken(groupsVals[i]) && trim(groupsVals[i]) === gLabels[gi]) bucket.push(vals[i]);
          }
          groupDesc.push(describe(bucket, "numeric"));
          cells.push(useMean ? fmtMean(groupDesc[gi]) : fmtMedian(groupDesc[gi]));
        }
        result = null;
        if (gLabels.length >= 2) {
          result = compare(vals, groupsVals, { outcomeType: "numeric", paired: false });
        }
        rowOut.push({
          variable: varName,
          type: "numeric",
          label: useMean ? "mean \u00b1 SD" : "median (IQR)",
          overall: useMean ? fmtMean(overallDesc) : fmtMedian(overallDesc),
          cells: cells,
          p: result ? formatP(result.p) : "",
          test: result ? result.label : ""
        });
      } else if (type === "binary" || type === "categorical") {
        var perGroup = [];
        var overallVals = [];
        for (gi = 0; gi < gLabels.length; gi++) perGroup.push([]);
        for (i = 0; i < vals.length; i++) {
          if (isMissingToken(groupsVals[i])) continue;
          overallVals.push(vals[i]);
          for (gi = 0; gi < gLabels.length; gi++) {
            if (trim(groupsVals[i]) === gLabels[gi]) perGroup[gi].push(vals[i]);
          }
        }
        var oDesc = describe(overallVals, type === "binary" ? "binary" : "categorical");
        var gDesc = [];
        for (gi = 0; gi < gLabels.length; gi++) gDesc.push(describe(perGroup[gi], type === "binary" ? "binary" : "categorical"));
        result = null;
        if (gLabels.length >= 2) result = compare(vals, groupsVals, { outcomeType: type, paired: false });
        var levelNames = oDesc.counts.length ? [] : [];
        for (i = 0; i < oDesc.counts.length; i++) levelNames.push(oDesc.counts[i].level);
        for (gi = 0; gi < gDesc.length; gi++) {
          for (i = 0; i < gDesc[gi].counts.length; i++) {
            found = false;
            for (lv = 0; lv < levelNames.length; lv++) if (levelNames[lv] === gDesc[gi].counts[i].level) found = true;
            if (!found) levelNames.push(gDesc[gi].counts[i].level);
          }
        }
        levelNames = sortLevels(levelNames);
        for (lv = 0; lv < levelNames.length; lv++) {
          level = levelNames[lv];
          cells = [];
          n = 0;
          pct = 0;
          for (i = 0; i < oDesc.counts.length; i++) if (oDesc.counts[i].level === level) { n = oDesc.counts[i].n; pct = oDesc.counts[i].pct; }
          var overallCell = oDesc.n ? fmtCount(n, pct) : "0";
          for (gi = 0; gi < gLabels.length; gi++) {
            n = 0;
            pct = 0;
            counts = gDesc[gi].counts;
            for (i = 0; i < counts.length; i++) if (counts[i].level === level) { n = counts[i].n; pct = counts[i].pct; }
            cells.push(gDesc[gi].n ? fmtCount(n, gDesc[gi].n ? (100 * n / gDesc[gi].n) : 0) : "0");
          }
          rowOut.push({
            variable: varName,
            type: type,
            label: level,
            overall: overallCell,
            cells: cells,
            p: result ? formatP(result.p) : "",
            test: result ? result.label : ""
          });
        }
      } else {
        var nOverall = 0;
        cells = [];
        for (gi = 0; gi < gLabels.length; gi++) cells.push(0);
        for (i = 0; i < vals.length; i++) {
          if (isMissingToken(groupsVals[i]) || isMissingToken(vals[i])) continue;
          nOverall++;
          for (gi = 0; gi < gLabels.length; gi++) if (trim(groupsVals[i]) === gLabels[gi]) cells[gi]++;
        }
        for (gi = 0; gi < cells.length; gi++) cells[gi] = String(cells[gi]);
        rowOut.push({
          variable: varName,
          type: type,
          label: "",
          overall: String(nOverall),
          cells: cells,
          p: "",
          test: ""
        });
      }
    }
    return { groups: gCounts, rows: rowOut };
  }

  /* ---- logistic regression, IRLS binomial logit ---- */

  function expit(eta) {
    var e;
    if (eta >= 0) {
      e = Math.exp(-eta);
      return 1 / (1 + e);
    }
    e = Math.exp(eta);
    return e / (1 + e);
  }

  function logit(mu) {
    var m = mu;
    if (m < 1e-12) m = 1e-12;
    if (m > 1 - 1e-12) m = 1 - 1e-12;
    return Math.log(m / (1 - m));
  }

  function binomDev(y, mu) {
    var d = 0, i, yi, m, t;
    for (i = 0; i < y.length; i++) {
      yi = y[i];
      m = mu[i];
      if (m < 1e-15) m = 1e-15;
      if (m > 1 - 1e-15) m = 1 - 1e-15;
      t = 0;
      if (yi > 0) t += yi * Math.log(yi / m);
      if (yi < 1) t += (1 - yi) * Math.log((1 - yi) / (1 - m));
      d += 2 * t;
    }
    return d;
  }

  function solveLinear(A, b) {
    var p = b.length, M = [], i, j, k, max, maxR, tmp, pivot, f, x;
    for (i = 0; i < p; i++) {
      M[i] = [];
      for (j = 0; j < p; j++) M[i][j] = A[i][j];
      M[i][p] = b[i];
    }
    for (k = 0; k < p; k++) {
      max = Math.abs(M[k][k]);
      maxR = k;
      for (i = k + 1; i < p; i++) {
        if (Math.abs(M[i][k]) > max) { max = Math.abs(M[i][k]); maxR = i; }
      }
      if (!(max > 1e-12)) return null;
      if (maxR !== k) { tmp = M[k]; M[k] = M[maxR]; M[maxR] = tmp; }
      pivot = M[k][k];
      for (j = k; j <= p; j++) M[k][j] /= pivot;
      for (i = 0; i < p; i++) {
        if (i === k) continue;
        f = M[i][k];
        if (f === 0) continue;
        for (j = k; j <= p; j++) M[i][j] -= f * M[k][j];
      }
    }
    x = [];
    for (i = 0; i < p; i++) x.push(M[i][p]);
    return x;
  }

  /* Covariance of a binomial logit fit from the QR of sqrt(weight) * X. */
  function qrDecompose(X) {
    var n = X.length, p = X[0].length, i, j, k, t, dot, norm;
    var V = [], R = [], Q = [], invR = [];
    for (j = 0; j < p; j++) {
      V[j] = [];
      for (i = 0; i < n; i++) V[j][i] = X[i][j];
    }
    for (i = 0; i < p; i++) {
      R[i] = [];
      for (j = 0; j < p; j++) R[i][j] = 0;
    }
    for (j = 0; j < p; j++) {
      for (k = 0; k < j; k++) {
        dot = 0;
        for (i = 0; i < n; i++) dot += Q[k][i] * V[j][i];
        R[k][j] = dot;
        for (i = 0; i < n; i++) V[j][i] -= dot * Q[k][i];
      }
      norm = 0;
      for (i = 0; i < n; i++) norm += V[j][i] * V[j][i];
      norm = Math.sqrt(norm);
      if (!(norm > 1e-14)) return null;
      R[j][j] = norm;
      Q[j] = [];
      for (i = 0; i < n; i++) Q[j][i] = V[j][i] / norm;
    }
    for (i = 0; i < p; i++) {
      invR[i] = [];
      for (j = 0; j < p; j++) invR[i][j] = 0;
    }
    for (j = p - 1; j >= 0; j--) {
      invR[j][j] = 1 / R[j][j];
      for (k = j + 1; k < p; k++) {
        dot = 0;
        for (t = j + 1; t <= k; t++) dot += R[j][t] * invR[t][k];
        invR[j][k] = -dot / R[j][j];
      }
    }
    return { Q: Q, R: R, invR: invR };
  }

  function invRToBread(invR) {
    var p = invR.length, j, k, t, dot, cov = [];
    for (j = 0; j < p; j++) {
      cov[j] = [];
      for (k = 0; k < p; k++) {
        dot = 0;
        for (t = 0; t < p; t++) dot += invR[j][t] * invR[k][t];
        cov[j][k] = dot;
      }
    }
    return cov;
  }

  function qrCovariance(X, wgt) {
    var n = X.length, p = X[0].length, i, j, Xw = [], qr;
    for (i = 0; i < n; i++) {
      Xw[i] = [];
      var sw = Math.sqrt(wgt[i]);
      for (j = 0; j < p; j++) Xw[i][j] = X[i][j] * sw;
    }
    qr = qrDecompose(Xw);
    return qr ? invRToBread(qr.invR) : null;
  }

  function invertMatrix(A) {
    var p = A.length, inv = [], j, i, e, col;
    for (i = 0; i < p; i++) inv[i] = [];
    for (j = 0; j < p; j++) {
      e = [];
      for (i = 0; i < p; i++) e.push(i === j ? 1 : 0);
      col = solveLinear(A, e);
      if (!col) return null;
      for (i = 0; i < p; i++) inv[i][j] = col[i];
    }
    return inv;
  }

  function logistic(rows, columns, outcome, predictors, types) {
    var typeMap, yRaw, i, j, k, predVals, designNames, levels, ref, lv, used, y, X, p, n;
    var events = 0, eta, mu, dev, devOld, iter, conv, w, z, xtwx, xtwz, beta, a, b;
    var sep, inv, se, crit, coefs, name, or, lo, hi, zp, warn, nPred, yi, xv;
    if (!isArray(rows) || !isArray(columns) || !isArray(predictors)) bad("logistic needs rows, columns, and predictors");
    if (!predictors.length) bad("logistic needs at least one predictor");
    typeMap = resolveTypes(columns, types);
    yRaw = columnValues(rows, columns, outcome);
    predVals = [];
    for (j = 0; j < predictors.length; j++) predVals.push(columnValues(rows, columns, predictors[j]));
    designNames = ["Intercept"];
    var levelInfo = [];
    for (j = 0; j < predictors.length; j++) {
      var t = typeMap[predictors[j]];
      if (!t) t = inferColumn(predictors[j], predVals[j]).type;
      if (t === "binary" || t === "categorical") {
        levels = inferColumn(predictors[j], predVals[j]).levels;
        if (!levels.length) {
          var tmpSeen = {}, tmp = [];
          for (i = 0; i < predVals[j].length; i++) {
            if (isMissingToken(predVals[j][i])) continue;
            if (!tmpSeen[trim(predVals[j][i])]) { tmpSeen[trim(predVals[j][i])] = 1; tmp.push(trim(predVals[j][i])); }
          }
          levels = sortLevels(tmp);
        }
        if (levels.length < 2) bad("predictor " + predictors[j] + " has fewer than 2 levels");
        ref = levels[0];
        var dummies = [];
        for (lv = 1; lv < levels.length; lv++) {
          dummies.push(levels[lv]);
          designNames.push(predictors[j] + ": " + levels[lv] + " vs " + ref);
        }
        levelInfo.push({ kind: "cat", levels: levels, ref: ref, dummies: dummies });
      } else if (t === "numeric") {
        designNames.push(predictors[j]);
        levelInfo.push({ kind: "num" });
      } else bad("predictor " + predictors[j] + " must be numeric, binary, or categorical");
    }
    var outcomeType = typeMap[outcome];
    if (!outcomeType) outcomeType = inferColumn(outcome, yRaw).type;
    var outcomeLevels = [];
    var oSeen = {};
    for (i = 0; i < yRaw.length; i++) {
      if (isMissingToken(yRaw[i])) continue;
      if (!oSeen[trim(yRaw[i])]) { oSeen[trim(yRaw[i])] = 1; outcomeLevels.push(trim(yRaw[i])); }
    }
    outcomeLevels = sortLevels(outcomeLevels);
    if (outcomeLevels.length !== 2) bad("logistic outcome must have exactly 2 levels");
    var ev = eventLevel(outcomeLevels);
    used = [];
    y = [];
    X = [];
    for (i = 0; i < rows.length; i++) {
      if (isMissingToken(yRaw[i])) continue;
      var skip = false;
      var rowx = [1];
      for (j = 0; j < predictors.length; j++) {
        if (isMissingToken(predVals[j][i])) { skip = true; break; }
        if (levelInfo[j].kind === "num") {
          xv = parseNumber(predVals[j][i]);
          if (xv === null) { skip = true; break; }
          rowx.push(xv);
        } else {
          var lab = trim(predVals[j][i]);
          for (k = 0; k < levelInfo[j].dummies.length; k++) rowx.push(lab === levelInfo[j].dummies[k] ? 1 : 0);
        }
      }
      if (skip) continue;
      yi = trim(yRaw[i]) === ev ? 1 : 0;
      y.push(yi);
      X.push(rowx);
      if (yi === 1) events++;
    }
    n = y.length;
    p = designNames.length;
    if (n < p) bad("not enough complete rows for logistic regression");
    if (events === 0 || events === n) bad("logistic outcome has no variation");
    nPred = predictors.length;
    mu = [];
    eta = [];
    for (i = 0; i < n; i++) {
      mu.push((y[i] + 0.5) / 2);
      eta.push(logit(mu[i]));
    }
    devOld = 0;
    conv = false;
    sep = false;
    beta = null;
    iter = 0;
    for (iter = 1; iter <= 50; iter++) {
      w = [];
      z = [];
      for (i = 0; i < n; i++) {
        var m = mu[i];
        if (m < 1e-12) m = 1e-12;
        if (m > 1 - 1e-12) m = 1 - 1e-12;
        var ww = m * (1 - m);
        w.push(ww);
        z.push(eta[i] + (y[i] - mu[i]) / ww);
      }
      xtwx = [];
      xtwz = [];
      for (a = 0; a < p; a++) {
        xtwx[a] = [];
        xtwz[a] = 0;
        for (b = 0; b < p; b++) xtwx[a][b] = 0;
      }
      for (i = 0; i < n; i++) {
        for (a = 0; a < p; a++) {
          xtwz[a] += X[i][a] * w[i] * z[i];
          for (b = 0; b < p; b++) xtwx[a][b] += X[i][a] * w[i] * X[i][b];
        }
      }
      beta = solveLinear(xtwx, xtwz);
      if (!beta) {
        return {
          n: n,
          events: events,
          converged: false,
          iterations: iter,
          warning: "A predictor has no variation, so the model is not identified.",
          coefficients: nullCoefs(designNames)
        };
      }
      sep = false;
      for (a = 0; a < p; a++) {
        if (!isFin(beta[a]) || Math.abs(beta[a]) > 40) sep = true;
      }
      for (i = 0; i < n; i++) {
        eta[i] = 0;
        for (a = 0; a < p; a++) eta[i] += X[i][a] * beta[a];
        if (!isFin(eta[i]) || eta[i] > 40 || eta[i] < -40) sep = true;
        mu[i] = expit(isFin(eta[i]) ? eta[i] : 0);
        if (mu[i] < 1e-12 || mu[i] > 1 - 1e-12) sep = true;
      }
      if (sep) {
        return {
          n: n,
          events: events,
          converged: false,
          iterations: iter,
          warning: "The outcome is perfectly separated by a predictor, so the odds ratios are not finite.",
          coefficients: nullCoefs(designNames)
        };
      }
      dev = binomDev(y, mu);
      if (Math.abs(dev - devOld) / (0.1 + Math.abs(dev)) < 1e-8) {
        conv = true;
        break;
      }
      devOld = dev;
    }
    warn = "";
    if (!conv) warn = "The model did not converge; treat the odds ratios with caution.";
    else if (events / nPred < 10) {
      warn = "Too few events for this many risk factors (fewer than 10 events per factor); treat the result with caution.";
    }
    /* Wald covariance uses the weights that produced the last beta, as glm does. */
    inv = qrCovariance(X, w);
    crit = normalQuantile(Z975_P);
    coefs = [];
    for (a = 0; a < p; a++) {
      name = designNames[a];
      se = inv && inv[a][a] > 0 ? Math.sqrt(inv[a][a]) : null;
      if (se === null || !isFin(beta[a])) {
        coefs.push({ name: name, estimate: null, se: null, z: null, or: null, ciLower: null, ciUpper: null, p: null });
      } else {
        zp = beta[a] / se;
        or = Math.exp(beta[a]);
        lo = Math.exp(beta[a] - crit * se);
        hi = Math.exp(beta[a] + crit * se);
        coefs.push({
          name: name,
          estimate: beta[a],
          se: se,
          z: zp,
          or: or,
          ciLower: lo,
          ciUpper: hi,
          p: chiSqUpper(zp * zp, 1)
        });
      }
    }
    var yBar = events / n;
    var muNull = [];
    for (i = 0; i < n; i++) muNull.push(yBar);
    var nullDev = binomDev(y, muNull);
    var devFinal = binomDev(y, mu);
    return {
      n: n,
      events: events,
      converged: conv,
      iterations: iter,
      warning: warn,
      deviance: devFinal,
      nullDeviance: nullDev,
      aic: devFinal + 2 * p,
      coefficients: coefs
    };
  }

  function nullCoefs(names) {
    var out = [], i;
    for (i = 0; i < names.length; i++) {
      out.push({ name: names[i], estimate: null, se: null, z: null, or: null, ciLower: null, ciUpper: null, p: null });
    }
    return out;
  }

  /* ---- linear regression (OLS with optional HC3 robust SEs) ---- */

  function buildPredictorSpec(rows, columns, predictors, typeMap) {
    var predVals = [], designNames = ["Intercept"], levelInfo = [], j, i, t, levels, tmpSeen, tmp, ref, dummies, lv;
    for (j = 0; j < predictors.length; j++) predVals.push(columnValues(rows, columns, predictors[j]));
    for (j = 0; j < predictors.length; j++) {
      t = typeMap[predictors[j]];
      if (!t) t = inferColumn(predictors[j], predVals[j]).type;
      if (t === "binary" || t === "categorical") {
        levels = inferColumn(predictors[j], predVals[j]).levels;
        if (!levels.length) {
          tmpSeen = {}; tmp = [];
          for (i = 0; i < predVals[j].length; i++) {
            if (isMissingToken(predVals[j][i])) continue;
            if (!tmpSeen[trim(predVals[j][i])]) { tmpSeen[trim(predVals[j][i])] = 1; tmp.push(trim(predVals[j][i])); }
          }
          levels = sortLevels(tmp);
        }
        if (levels.length < 2) bad("predictor " + predictors[j] + " has fewer than 2 levels");
        ref = levels[0];
        dummies = [];
        for (lv = 1; lv < levels.length; lv++) {
          dummies.push(levels[lv]);
          designNames.push(predictors[j] + ": " + levels[lv] + " vs " + ref);
        }
        levelInfo.push({ kind: "cat", levels: levels, ref: ref, dummies: dummies });
      } else if (t === "numeric") {
        designNames.push(predictors[j]);
        levelInfo.push({ kind: "num" });
      } else {
        bad("predictor " + predictors[j] + " must be numeric, binary, or categorical");
      }
    }
    return { predVals: predVals, designNames: designNames, levelInfo: levelInfo };
  }

  function linear(rows, columns, outcome, predictors, types, opts) {
    var typeMap, yRaw, pSpec, predVals, designNames, levelInfo, y, X, i, j, k, yv, xv, skip, rowx, lab;
    var dropped = 0, n, p, robust, level, qr, qty, beta, bread, yhat, resid, ssr, ySum, yMean, sst;
    var V, a, b, c, h, denom, w, meat, tmp, s2, crit, coefs, est, se, tStat, pVal, sigma, r2, adjR2, fStat, fDf, fP, aic;
    if (!isArray(rows) || !isArray(columns) || !isArray(predictors)) bad("linear needs rows, columns, and predictors");
    opts = opts || {};
    robust = opts.robust == null ? null : opts.robust;
    if (robust !== null && robust !== "HC3") badCode("invalid_robust", "robust must be null or HC3");
    level = opts.level == null ? 0.95 : opts.level;
    if (!isFin(level) || !(level > 0 && level < 1)) bad("level must be between 0 and 1");
    typeMap = resolveTypes(columns, types);
    yRaw = columnValues(rows, columns, outcome);
    pSpec = buildPredictorSpec(rows, columns, predictors, typeMap);
    predVals = pSpec.predVals;
    designNames = pSpec.designNames;
    levelInfo = pSpec.levelInfo;
    y = [];
    X = [];
    for (i = 0; i < rows.length; i++) {
      if (isMissingToken(yRaw[i])) { dropped++; continue; }
      yv = parseNumber(yRaw[i]);
      if (yv === null) { dropped++; continue; }
      skip = false;
      rowx = [1];
      for (j = 0; j < predictors.length; j++) {
        if (isMissingToken(predVals[j][i])) { skip = true; break; }
        if (levelInfo[j].kind === "num") {
          xv = parseNumber(predVals[j][i]);
          if (xv === null) { skip = true; break; }
          rowx.push(xv);
        } else {
          lab = trim(predVals[j][i]);
          for (k = 0; k < levelInfo[j].dummies.length; k++) rowx.push(lab === levelInfo[j].dummies[k] ? 1 : 0);
        }
      }
      if (skip) { dropped++; continue; }
      y.push(yv);
      X.push(rowx);
    }
    n = y.length;
    p = designNames.length;
    if (n <= p) badCode("too_few_rows", "not enough complete rows for linear regression");
    qr = qrDecompose(X);
    if (!qr) badCode("singular_design", "predictors are collinear or constant");
    qty = [];
    for (j = 0; j < p; j++) {
      var qdot = 0;
      for (i = 0; i < n; i++) qdot += qr.Q[j][i] * y[i];
      qty[j] = qdot;
    }
    beta = [];
    for (j = 0; j < p; j++) {
      var bs = 0;
      for (k = j; k < p; k++) bs += qr.invR[j][k] * qty[k];
      beta[j] = bs;
    }
    bread = invRToBread(qr.invR);
    yhat = [];
    resid = [];
    ssr = 0;
    ySum = 0;
    for (i = 0; i < n; i++) {
      var yh = 0;
      for (j = 0; j < p; j++) yh += X[i][j] * beta[j];
      yhat[i] = yh;
      resid[i] = y[i] - yh;
      ssr += resid[i] * resid[i];
      ySum += y[i];
    }
    yMean = ySum / n;
    sst = 0;
    for (i = 0; i < n; i++) {
      var dy = y[i] - yMean;
      sst += dy * dy;
    }
    s2 = ssr / (n - p);
    if (robust === "HC3") {
      meat = [];
      for (a = 0; a < p; a++) {
        meat[a] = [];
        for (b = 0; b < p; b++) meat[a][b] = 0;
      }
      for (i = 0; i < n; i++) {
        h = 0;
        for (j = 0; j < p; j++) h += qr.Q[j][i] * qr.Q[j][i];
        denom = 1 - h;
        if (!(denom > 1e-12)) badCode("singular_design", "leverage equals 1; HC3 is undefined");
        w = (resid[i] / denom) * (resid[i] / denom);
        for (a = 0; a < p; a++) {
          for (b = 0; b < p; b++) meat[a][b] += w * X[i][a] * X[i][b];
        }
      }
      tmp = [];
      for (a = 0; a < p; a++) {
        tmp[a] = [];
        for (b = 0; b < p; b++) {
          var s = 0;
          for (c = 0; c < p; c++) s += bread[a][c] * meat[c][b];
          tmp[a][b] = s;
        }
      }
      V = [];
      for (a = 0; a < p; a++) {
        V[a] = [];
        for (b = 0; b < p; b++) {
          var vab = 0;
          for (c = 0; c < p; c++) vab += tmp[a][c] * bread[c][b];
          V[a][b] = vab;
        }
      }
    } else {
      V = [];
      for (a = 0; a < p; a++) {
        V[a] = [];
        for (b = 0; b < p; b++) V[a][b] = s2 * bread[a][b];
      }
    }
    crit = tQuantile((1 + level) / 2, n - p);
    coefs = [];
    for (j = 0; j < p; j++) {
      est = beta[j];
      se = V[j][j] > 0 ? Math.sqrt(V[j][j]) : 0;
      tStat = se > 0 ? est / se : (est === 0 ? 0 : Infinity);
      pVal = se > 0 ? tTail(tStat, n - p) : 0;
      coefs.push({
        term: designNames[j],
        estimate: est,
        se: se,
        t: tStat,
        p: pVal,
        ciLower: est - crit * se,
        ciUpper: est + crit * se
      });
    }
    sigma = Math.sqrt(s2);
    r2 = p === 1 ? 0 : (sst > 0 ? 1 - ssr / sst : 0);
    adjR2 = (p > 1 && sst > 0) ? 1 - (1 - r2) * (n - 1) / (n - p) : 0;
    if (p > 1 && ssr > 0) {
      fStat = ((sst - ssr) / (p - 1)) / (ssr / (n - p));
      fDf = [p - 1, n - p];
      fP = fTail(fStat, p - 1, n - p);
    } else {
      fStat = null;
      fDf = null;
      fP = null;
    }
    aic = ssr > 0 ? (n * (Math.log(2 * Math.PI) + Math.log(ssr / n) + 1) + 2 * (p + 1)) : -Infinity;
    return {
      family: "linear",
      outcome: outcome,
      predictors: predictors.slice(),
      robust: robust,
      level: level,
      coefficients: coefs,
      n: n,
      dropped: dropped,
      dfResidual: n - p,
      sigma: sigma,
      r2: r2,
      adjR2: adjR2,
      fStatistic: fStat,
      fDf: fDf,
      fP: fP,
      aic: aic
    };
  }

  function resultsSentence(result, opts) {
    var outcome, labels, i, parts, g1, g2, d1, d2, eff, tail, statBit;
    if (!result || typeof result !== "object") bad("resultsSentence needs a compare result");
    opts = opts || {};
    outcome = opts.outcome ? String(opts.outcome) : "the outcome";
    labels = opts.groupLabels;
    if (!isArray(labels)) labels = [];
    function gname(i0, fallback) {
      if (labels[i0]) return String(labels[i0]);
      if (result.byGroup && result.byGroup[i0]) return String(result.byGroup[i0].group);
      return fallback;
    }
    function pbit() { return formatP(result.p); }
    eff = result.effect || blankEffect();
    if (result.test === "welch_t" || result.test === "paired_t") {
      d1 = result.byGroup[0].describe;
      d2 = result.byGroup[1].describe;
      g1 = gname(0, "group A");
      g2 = gname(1, "group B");
      tail = "mean difference " + fmtNum(eff.estimate, 1) + ", 95% CI " +
        fmtNum(eff.ciLower, 1) + " to " + fmtNum(eff.ciUpper, 1) + "; " +
        result.label + ", " + pbit();
      return "Mean " + outcome + " was " + fmtMean(d1) + " in " + g1 + " and " +
        fmtMean(d2) + " in " + g2 + " (" + tail + ").";
    }
    if (result.test === "mann_whitney" || result.test === "wilcoxon") {
      d1 = result.byGroup[0].describe;
      d2 = result.byGroup[1].describe;
      g1 = gname(0, "group A");
      g2 = gname(1, "group B");
      return "Median " + outcome + " was " + fmtMedian(d1) + " in " + g1 + " and " +
        fmtMedian(d2) + " in " + g2 + " (" + result.label + ", " + pbit() + ").";
    }
    if (result.test === "anova" || result.test === "kruskal") {
      statBit = result.statisticName + " = " + fmtNum(result.statistic, 2);
      return result.label + " compared " + outcome + " across " + result.byGroup.length +
        " groups (" + statBit + ", " + pbit() + ").";
    }
    if (result.test === "pearson" || result.test === "spearman") {
      var left = labels[0] ? String(labels[0]) : outcome;
      var right = labels[1] ? String(labels[1]) : "the second measurement";
      var sym = result.test === "pearson" ? "r" : "rho";
      tail = sym + " = " + fmtNum(eff.estimate, 2);
      if (isFin(eff.ciLower) && isFin(eff.ciUpper)) {
        tail += ", 95% CI " + fmtNum(eff.ciLower, 2) + " to " + fmtNum(eff.ciUpper, 2);
      }
      tail += "; " + result.label + ", " + pbit();
      return result.label + " between " + left + " and " + right + " was " + tail + ".";
    }
    if (result.test === "chi_square" || result.test === "fisher" || result.test === "mcnemar") {
      var isCaseCtrl = /case[-_\s]?control/i.test(String((opts && opts.studyType) || result.studyDesign || ""));
      if (eff && eff.measure === "RR" && isFin(eff.estimate)) {
        tail = "risk ratio " + fmtNum(eff.estimate, 2) + ", 95% CI " +
          fmtNum(eff.ciLower, 2) + " to " + fmtNum(eff.ciUpper, 2);
        if (isFin(eff.or) && isFin(eff.orCiLower) && isFin(eff.orCiUpper)) {
          tail += "; odds ratio " + fmtNum(eff.or, 2) + ", 95% CI " +
            fmtNum(eff.orCiLower, 2) + " to " + fmtNum(eff.orCiUpper, 2);
        }
        tail += "; " + result.label + ", " + pbit();
        return "The risk of " + outcome + " differed between the groups (" + tail + ").";
      }
      if (eff && eff.measure === "OR" && isFin(eff.estimate)) {
        tail = "odds ratio " + fmtNum(eff.estimate, 2) + ", 95% CI " +
          fmtNum(eff.ciLower, 2) + " to " + fmtNum(eff.ciUpper, 2) + "; " +
          result.label + ", " + pbit();
        if (isCaseCtrl) {
          var ccDir = eff.estimate > 1 ? "higher" : (eff.estimate < 1 ? "lower" : "similar");
          return "Cases vs controls had " + ccDir + " odds of " + outcome + " (" + tail + ").";
        }
        return "The odds of " + outcome + " differed between the groups (" + tail + ").";
      }
      statBit = isFin(result.statistic) ? (result.statisticName + " = " + fmtNum(result.statistic, 2) + ", ") : "";
      return result.label + " compared " + outcome + " across the groups (" + statBit + pbit() + ").";
    }
    bad("resultsSentence does not recognise this test");
    return "";
  }

  /* Survival, log-rank, Cox and matched odds ratio.
   * These return { ok, warnings } and do not throw on bad data.
   * The proportional hazards reminder is shown by the screen, not here. */

  var MSG_NO_EVENTS = "No events yet, so the groups cannot be compared.";
  var MSG_NOT_SETTLED = "The model did not settle on an answer. Do not report a hazard ratio; ask your statistician.";
  var MSG_SEPARATION = "One group had no events (or only events), so its hazard ratio cannot be estimated.";
  var MSG_TOO_FEW = "Too few events for this many factors; use fewer factors.";
  var MSG_NO_PAIRS = "No pairs differ in exposure, so the matched odds ratio cannot be calculated.";
  var MSG_OR_HUGE = "The odds ratio is very large; report only the lower limit.";
  var MSG_OR_WIDE = "Very few pairs differ; the interval is wide.";

  function softFail(extra) {
    var out = { ok: false, warnings: [] };
    var k;
    if (extra) for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    return out;
  }

  function msgExcluded(n) {
    return n + " rows were left out because the time or event value was missing or invalid.";
  }

  function msgSmall(name, n) {
    return "Group " + name + " has only " + n + " patients; treat these numbers as unreliable.";
  }

  function msgNoEvent(name) {
    return "No one in group " + name + " had the event, so median survival is not reached.";
  }

  function coerceEvent(v) {
    var s;
    if (v === true || v === 1) return 1;
    if (v === false || v === 0) return 0;
    if (typeof v === "number") return null;
    if (v == null) return null;
    s = trim(String(v)).toLowerCase();
    if (s === "1" || s === "yes" || s === "y" || s === "true" || s === "dead" || s === "died" || s === "event") return 1;
    if (s === "0" || s === "no" || s === "n" || s === "false" || s === "alive" || s === "censored") return 0;
    return null;
  }

  function coerceTime(v) {
    var n;
    if (typeof v === "number" && isFinite(v) && v >= 0) return v;
    if (typeof v === "string" && trim(v) !== "") {
      n = Number(trim(v));
      if (isFinite(n) && n >= 0) return n;
    }
    return null;
  }

  function asCovariateNumber(v) {
    var n;
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string" && trim(v) !== "") {
      n = Number(trim(v));
      if (isFinite(n)) return n;
    }
    return null;
  }

  function zForLevel(level) {
    var p;
    if (!isFin(level) || !(level > 0) || !(level < 1)) return null;
    p = 0.5 + level / 2;
    try { return normalQuantile(p); } catch (e) { return null; }
  }

  function kmCi(surv, se, z, confType) {
    var logS, loPow, hiPow, lo, hi;
    if (se == null || !isFinite(se) || !isFinite(surv)) return { lo: null, hi: null };
    if (!(surv > 0)) return { lo: null, hi: null };
    if (surv === 1 && se === 0) return { lo: 1, hi: 1 };
    if (confType === "plain") {
      lo = surv - z * surv * se;
      hi = surv + z * surv * se;
    } else if (confType === "log-log") {
      logS = Math.log(surv);
      if (!(logS < 0)) return { lo: 1, hi: 1 };
      loPow = Math.exp(-z * se / logS);
      hiPow = Math.exp(z * se / logS);
      lo = Math.pow(surv, loPow);
      hi = Math.pow(surv, hiPow);
    } else {
      lo = surv * Math.exp(-z * se);
      hi = surv * Math.exp(z * se);
    }
    if (!isFinite(lo) || !isFinite(hi)) return { lo: null, hi: null };
    if (lo < 0) lo = 0;
    if (hi > 1) hi = 1;
    if (lo > 1) lo = 1;
    return { lo: lo, hi: hi };
  }

  function kmQuantile(steps, field) {
    var i, v, hitT, hitV, lastT;
    if (!steps.length) return null;
    lastT = steps[steps.length - 1].t;
    hitT = null;
    hitV = null;
    for (i = 0; i < steps.length; i++) {
      v = steps[i][field];
      if (v == null || !isFinite(v)) continue;
      if (v <= 0.5 + 1e-12) { hitT = steps[i].t; hitV = v; break; }
    }
    if (hitT == null) return null;
    if (hitV < 0.5 - 1e-9) return hitT;
    for (i = 0; i < steps.length; i++) {
      if (steps[i].t > hitT && steps[i].events > 0) return (hitT + steps[i].t) / 2;
    }
    return (hitT + lastT) / 2;
  }

  function kmOne(recs, z, confType) {
    var steps, i, n, atRisk, surv, cum, seInf, t, d, c, risk, se, band;
    recs.sort(function (a, b) {
      if (a.t < b.t) return -1;
      if (a.t > b.t) return 1;
      return b.e - a.e;
    });
    steps = [];
    n = recs.length;
    atRisk = n;
    surv = 1;
    cum = 0;
    seInf = false;
    i = 0;
    while (i < n) {
      t = recs[i].t;
      d = 0;
      c = 0;
      risk = atRisk;
      while (i < n && recs[i].t === t) {
        if (recs[i].e === 1) d += 1; else c += 1;
        i += 1;
        atRisk -= 1;
      }
      if (d > 0 && risk > 0) {
        surv = surv * (1 - d / risk);
        if (risk === d) seInf = true;
        else if (!seInf) cum += d / (risk * (risk - d));
      }
      se = seInf ? null : Math.sqrt(cum);
      if (se != null && !isFinite(se)) se = null;
      band = kmCi(surv, se, z, confType);
      steps.push({
        t: t,
        atRisk: risk,
        events: d,
        censored: c,
        survival: surv,
        seLogS: se,
        ciLower: band.lo,
        ciUpper: band.hi
      });
    }
    return steps;
  }

  function prepTimeEvent(times, events, groups) {
    var i, t, e, name, order, map, recs, badTE, badGroup, g;
    if (!isArray(times) || !isArray(events) || times.length !== events.length) return null;
    if (groups != null && (!isArray(groups) || groups.length !== times.length)) return null;
    order = [];
    map = {};
    badTE = 0;
    badGroup = 0;
    for (i = 0; i < times.length; i++) {
      t = coerceTime(times[i]);
      e = coerceEvent(events[i]);
      if (t == null || e == null) { badTE += 1; continue; }
      if (groups == null) name = "All";
      else if (groups[i] == null) { badGroup += 1; continue; }
      else name = String(groups[i]);
      if (!map[name]) {
        map[name] = [];
        order.push(name);
      }
      map[name].push({ t: t, e: e });
    }
    recs = [];
    for (i = 0; i < order.length; i++) {
      g = map[order[i]];
      recs.push({ name: order[i], recs: g });
    }
    return { badTE: badTE, badGroup: badGroup, groups: recs };
  }

  function kaplanMeier(times, events, groups, opts) {
    try {
      var confType, confLevel, z, prep, warnings, outGroups, i, g, steps, nEvents, gi;
      confType = "log";
      confLevel = 0.95;
      if (opts != null && typeof opts === "object") {
        if (opts.confType != null) confType = opts.confType;
        if (opts.confLevel != null) confLevel = opts.confLevel;
      } else if (opts != null) {
        return softFail({ nExcluded: 0, groups: [] });
      }
      if (confType !== "log" && confType !== "log-log" && confType !== "plain") {
        return softFail({ nExcluded: 0, groups: [] });
      }
      z = zForLevel(confLevel);
      if (z == null) return softFail({ nExcluded: 0, groups: [] });
      prep = prepTimeEvent(times, events, groups);
      if (!prep) return softFail({ nExcluded: 0, groups: [] });
      warnings = [];
      if (prep.badTE > 0) warnings.push(msgExcluded(prep.badTE));
      for (i = 0; i < prep.groups.length; i++) {
        if (prep.groups[i].recs.length < 5) {
          warnings.push(msgSmall(prep.groups[i].name, prep.groups[i].recs.length));
        }
      }
      outGroups = [];
      for (i = 0; i < prep.groups.length; i++) {
        g = prep.groups[i];
        nEvents = 0;
        for (gi = 0; gi < g.recs.length; gi++) if (g.recs[gi].e === 1) nEvents += 1;
        if (nEvents === 0) warnings.push(msgNoEvent(g.name));
        steps = kmOne(g.recs, z, confType);
        outGroups.push({
          name: g.name,
          n: g.recs.length,
          nEvents: nEvents,
          steps: steps,
          median: {
            value: kmQuantile(steps, "survival"),
            lower: kmQuantile(steps, "ciLower"),
            upper: kmQuantile(steps, "ciUpper")
          }
        });
      }
      return {
        ok: true,
        warnings: warnings,
        nExcluded: prep.badTE + prep.badGroup,
        groups: outGroups
      };
    } catch (errKm) {
      return softFail({ nExcluded: 0, groups: [] });
    }
  }

  function logRank(times, events, groups) {
    try {
      var prep, warnings, i, j, k, g, nEvents, rows, names, observed, expected, nCount;
      var timeMap, timesKey, t, rec, risk, deaths, n, d, ng, dg, eAdd, varAdd;
      var keep, use, V, rhs, solved, chi2, df, p, gi, a, b, varTerms;
      prep = prepTimeEvent(times, events, groups);
      if (!prep) return softFail({ chi2: null, df: null, p: null, table: [] });
      warnings = [];
      if (prep.badTE > 0) warnings.push(msgExcluded(prep.badTE));
      nEvents = 0;
      names = [];
      observed = [];
      expected = [];
      nCount = [];
      rows = [];
      for (i = 0; i < prep.groups.length; i++) {
        g = prep.groups[i];
        names.push(g.name);
        nCount.push(g.recs.length);
        observed.push(0);
        expected.push(0);
        if (g.recs.length < 5) warnings.push(msgSmall(g.name, g.recs.length));
        for (j = 0; j < g.recs.length; j++) {
          rows.push({ t: g.recs[j].t, e: g.recs[j].e, g: i });
          if (g.recs[j].e === 1) nEvents += 1;
        }
      }
      if (nEvents === 0) {
        warnings.push(MSG_NO_EVENTS);
        deaths = [];
        for (j = 0; j < names.length; j++) {
          deaths.push({ group: names[j], n: nCount[j], observed: 0, expected: 0 });
        }
        return { ok: false, warnings: warnings, chi2: null, df: null, p: null, table: deaths };
      }
      timeMap = {};
      timesKey = [];
      for (i = 0; i < rows.length; i++) {
        rec = rows[i];
        t = String(rec.t);
        if (!timeMap[t]) {
          timeMap[t] = { t: rec.t, risk: [], deaths: [] };
          for (j = 0; j < names.length; j++) {
            timeMap[t].risk.push(0);
            timeMap[t].deaths.push(0);
          }
          timesKey.push(t);
        }
        timeMap[t].risk[rec.g] += 1;
        if (rec.e === 1) timeMap[t].deaths[rec.g] += 1;
      }
      /* Risk set is everyone with time >= t, so accumulate from the latest time. */
      timesKey.sort(function (x, y) { return Number(y) - Number(x); });
      risk = [];
      varTerms = [];
      for (j = 0; j < names.length; j++) risk.push(0);
      for (k = 0; k < timesKey.length; k++) {
        rec = timeMap[timesKey[k]];
        for (j = 0; j < names.length; j++) risk[j] += rec.risk[j];
        d = 0;
        n = 0;
        for (j = 0; j < names.length; j++) {
          d += rec.deaths[j];
          n += risk[j];
        }
        if (d <= 0 || n <= 0) continue;
        for (j = 0; j < names.length; j++) {
          eAdd = risk[j] * d / n;
          expected[j] += eAdd;
          observed[j] += rec.deaths[j];
        }
        if (n <= 1) continue;
        varAdd = d * (n - d) / (n * n * (n - 1));
        varTerms.push({ risk: risk.slice(), nAt: n, varAdd: varAdd });
      }
      keep = [];
      for (j = 0; j < names.length; j++) if (expected[j] > 0) keep.push(j);
      df = keep.length - 1;
      chi2 = null;
      p = null;
      if (df >= 1) {
        use = [];
        for (j = 1; j < keep.length; j++) use.push(keep[j]);
        V = [];
        for (a = 0; a < use.length; a++) {
          V[a] = [];
          for (b = 0; b < use.length; b++) V[a][b] = 0;
        }
        for (k = 0; k < varTerms.length; k++) {
          rec = varTerms[k];
          for (a = 0; a < use.length; a++) {
            for (b = 0; b < use.length; b++) {
              gi = use[a];
              j = use[b];
              if (gi === j) V[a][b] += rec.risk[gi] * (rec.nAt - rec.risk[gi]) * rec.varAdd;
              else V[a][b] += -rec.risk[gi] * rec.risk[j] * rec.varAdd;
            }
          }
        }
        rhs = [];
        for (a = 0; a < use.length; a++) rhs.push(observed[use[a]] - expected[use[a]]);
        solved = solveLinear(V, rhs);
        if (solved) {
          chi2 = 0;
          for (a = 0; a < rhs.length; a++) chi2 += rhs[a] * solved[a];
          if (chi2 < 0 && chi2 > -1e-8) chi2 = 0;
          if (chi2 >= 0) {
            try { p = chiSqUpper(chi2, df); } catch (eP) { p = null; }
          } else {
            chi2 = null;
          }
        }
      } else {
        df = df < 0 ? 0 : df;
      }
      deaths = [];
      for (j = 0; j < names.length; j++) {
        deaths.push({ group: names[j], n: nCount[j], observed: observed[j], expected: expected[j] });
      }
      return {
        ok: true,
        warnings: warnings,
        chi2: chi2,
        df: df,
        p: p,
        table: deaths
      };
    } catch (errLr) {
      return softFail({ chi2: null, df: null, p: null, table: [] });
    }
  }

  function solveLinear(A, b) {
    var n, M, i, j, k, max, maxR, tmp, pivot, factor, x, sum;
    n = b.length;
    if (!n || A.length !== n) return null;
    M = [];
    for (i = 0; i < n; i++) {
      M[i] = [];
      for (j = 0; j < n; j++) M[i][j] = A[i][j];
      M[i][n] = b[i];
    }
    for (k = 0; k < n; k++) {
      max = Math.abs(M[k][k]);
      maxR = k;
      for (i = k + 1; i < n; i++) {
        if (Math.abs(M[i][k]) > max) { max = Math.abs(M[i][k]); maxR = i; }
      }
      if (!(max > 1e-12)) return null;
      if (maxR !== k) { tmp = M[k]; M[k] = M[maxR]; M[maxR] = tmp; }
      pivot = M[k][k];
      for (i = k + 1; i < n; i++) {
        factor = M[i][k] / pivot;
        for (j = k; j <= n; j++) M[i][j] -= factor * M[k][j];
      }
    }
    x = [];
    for (i = n - 1; i >= 0; i--) {
      sum = M[i][n];
      for (j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
      x[i] = sum / M[i][i];
      if (!isFinite(x[i])) return null;
    }
    return x;
  }

  function zerosVec(p) {
    var a = [], i;
    for (i = 0; i < p; i++) a.push(0);
    return a;
  }

  function zeroMat(p) {
    var a = [], i, j, row;
    for (i = 0; i < p; i++) {
      row = [];
      for (j = 0; j < p; j++) row.push(0);
      a.push(row);
    }
    return a;
  }

  function dotVec(x, beta) {
    var s = 0, i;
    for (i = 0; i < beta.length; i++) s += x[i] * beta[i];
    return s;
  }

  function accumCov(x, w, sumX, sumXX) {
    var i, j, xw;
    for (i = 0; i < x.length; i++) {
      xw = w * x[i];
      sumX[i] += xw;
      for (j = 0; j < x.length; j++) sumXX[i][j] += xw * x[j];
    }
  }

  /* Partial log likelihood, score and observed information. subjects sorted by time. */
  function coxPartial(subjects, beta, ties, wantDeriv) {
    var p, ll, score, info, n, idx, etas, t, start, deathIdx, dcount, maxEta, j, dw, w;
    var sumW, sumWx, sumWxx, sumDW, sumDWx, sumDWxx, sumDx, sumDeta, di, k, frac, s0, s1, invS0, i1, j1, v;
    p = beta.length;
    ll = 0;
    score = zerosVec(p);
    info = zeroMat(p);
    n = subjects.length;
    etas = [];
    idx = 0;
    while (idx < n) {
      t = subjects[idx].t;
      start = idx;
      deathIdx = [];
      while (idx < n && subjects[idx].t === t) {
        if (subjects[idx].e === 1) deathIdx.push(idx);
        idx += 1;
      }
      dcount = deathIdx.length;
      if (dcount === 0) continue;
      maxEta = -1e300;
      for (j = start; j < n; j++) {
        etas[j] = dotVec(subjects[j].x, beta);
        if (etas[j] > maxEta) maxEta = etas[j];
      }
      sumW = 0;
      sumWx = zerosVec(p);
      sumWxx = zeroMat(p);
      sumDW = 0;
      sumDWx = zerosVec(p);
      sumDWxx = zeroMat(p);
      sumDx = zerosVec(p);
      sumDeta = 0;
      for (j = start; j < n; j++) {
        dw = etas[j] - maxEta;
        w = dw < -745 ? 0 : Math.exp(dw);
        sumW += w;
        if (wantDeriv) accumCov(subjects[j].x, w, sumWx, sumWxx);
      }
      if (!(sumW > 0)) return null;
      for (di = 0; di < dcount; di++) {
        j = deathIdx[di];
        sumDeta += etas[j];
        dw = etas[j] - maxEta;
        w = dw < -745 ? 0 : Math.exp(dw);
        sumDW += w;
        for (i1 = 0; i1 < p; i1++) sumDx[i1] += subjects[j].x[i1];
        if (wantDeriv) accumCov(subjects[j].x, w, sumDWx, sumDWxx);
      }
      if (ties === "breslow") {
        ll += sumDeta - dcount * (maxEta + Math.log(sumW));
        if (wantDeriv) {
          invS0 = 1 / sumW;
          for (i1 = 0; i1 < p; i1++) score[i1] += sumDx[i1] - dcount * sumWx[i1] * invS0;
          for (i1 = 0; i1 < p; i1++) {
            for (j1 = 0; j1 < p; j1++) {
              info[i1][j1] += dcount * (sumWxx[i1][j1] * invS0 - sumWx[i1] * sumWx[j1] * invS0 * invS0);
            }
          }
        }
      } else {
        ll += sumDeta;
        for (k = 0; k < dcount; k++) {
          frac = k / dcount;
          s0 = sumW - frac * sumDW;
          if (!(s0 > 0)) return null;
          ll -= maxEta + Math.log(s0);
          if (wantDeriv) {
            s1 = zerosVec(p);
            for (i1 = 0; i1 < p; i1++) s1[i1] = sumWx[i1] - frac * sumDWx[i1];
            invS0 = 1 / s0;
            for (i1 = 0; i1 < p; i1++) score[i1] -= s1[i1] * invS0;
            for (i1 = 0; i1 < p; i1++) {
              for (j1 = 0; j1 < p; j1++) {
                v = (sumWxx[i1][j1] - frac * sumDWxx[i1][j1]) * invS0 - s1[i1] * s1[j1] * invS0 * invS0;
                info[i1][j1] += v;
              }
            }
          }
        }
        if (wantDeriv) {
          for (i1 = 0; i1 < p; i1++) score[i1] += sumDx[i1];
        }
      }
    }
    if (!isFinite(ll)) return null;
    return { ll: ll, score: score, info: info };
  }

  function coxFail(extra) {
    var base = {
      ok: false,
      warnings: [],
      n: 0,
      nEvents: 0,
      nExcluded: 0,
      converged: false,
      iterations: 0,
      logLik: null,
      lrTest: null,
      coefficients: []
    };
    var key;
    if (extra) for (key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) base[key] = extra[key];
    return base;
  }

  function normalizeCoxPredictors(opts) {
    var preds = opts.predictors, covs = opts.covariates, i, out = [];
    if (isArray(preds) && preds.length) return preds;
    if (isArray(covs) && covs.length) {
      for (i = 0; i < covs.length; i++) {
        out.push(typeof covs[i] === "string" ? { name: covs[i], type: "numeric" } : covs[i]);
      }
      return out;
    }
    return null;
  }

  function prepareCoxSubjects(rows, opts) {
    var preds, i, j, k, row, t, e, pred, num, raw, missing;
    var included, badTE, missCov, levels, seen, columns, ref, found, lv, p, subjects, x, means, nSub, nEvents;
    var vals, name, cat, xi;
    if (!isArray(rows) || !opts || typeof opts !== "object") return null;
    preds = normalizeCoxPredictors(opts);
    if (!isArray(preds) || !preds.length) return null;
    if (opts.time == null || opts.event == null) return null;
    for (i = 0; i < preds.length; i++) {
      pred = preds[i];
      if (!pred || typeof pred !== "object" || pred.name == null || pred.name === "") return null;
      if (pred.type !== "numeric" && pred.type !== "categorical") return null;
    }
    included = [];
    badTE = 0;
    missCov = 0;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (!row || typeof row !== "object" || isArray(row)) { badTE += 1; continue; }
      t = coerceTime(row[opts.time]);
      e = coerceEvent(row[opts.event]);
      if (t == null || e == null) { badTE += 1; continue; }
      vals = [];
      missing = false;
      for (j = 0; j < preds.length; j++) {
        pred = preds[j];
        if (pred.type === "numeric") {
          num = asCovariateNumber(row[pred.name]);
          if (num == null) { missing = true; break; }
          vals.push(num);
        } else {
          raw = row[pred.name];
          if (raw == null) { missing = true; break; }
          cat = trim(String(raw));
          if (cat === "") { missing = true; break; }
          vals.push(cat);
        }
      }
      if (missing) { missCov += 1; continue; }
      included.push({ t: t, e: e, vals: vals });
    }
    columns = [];
    for (j = 0; j < preds.length; j++) {
      pred = preds[j];
      name = String(pred.name);
      if (pred.type === "numeric") {
        columns.push({ predictor: name, level: null, term: name, predIndex: j });
      } else {
        seen = {};
        levels = [];
        for (i = 0; i < included.length; i++) {
          cat = included[i].vals[j];
          if (!seen[cat]) { seen[cat] = 1; levels.push(cat); }
        }
        levels.sort();
        if (!levels.length) continue;
        ref = levels[0];
        if (pred.reference != null && trim(String(pred.reference)) !== "") {
          ref = trim(String(pred.reference));
          found = false;
          for (k = 0; k < levels.length; k++) if (levels[k] === ref) found = true;
          if (!found) ref = levels[0];
        }
        for (k = 0; k < levels.length; k++) {
          lv = levels[k];
          if (lv === ref) continue;
          columns.push({ predictor: name, level: lv, term: name + "=" + lv, predIndex: j });
        }
      }
    }
    p = columns.length;
    nSub = included.length;
    nEvents = 0;
    for (i = 0; i < nSub; i++) if (included[i].e === 1) nEvents += 1;
    means = zerosVec(p);
    subjects = [];
    for (i = 0; i < nSub; i++) {
      x = [];
      for (j = 0; j < p; j++) {
        if (columns[j].level == null) xi = included[i].vals[columns[j].predIndex];
        else xi = included[i].vals[columns[j].predIndex] === columns[j].level ? 1 : 0;
        x.push(xi);
        means[j] += xi;
      }
      subjects.push({ t: included[i].t, e: included[i].e, x: x });
    }
    for (j = 0; j < p; j++) means[j] /= (nSub || 1);
    for (i = 0; i < nSub; i++) {
      for (j = 0; j < p; j++) subjects[i].x[j] -= means[j];
    }
    subjects.sort(function (a, b) {
      if (a.t < b.t) return -1;
      if (a.t > b.t) return 1;
      return 0;
    });
    return {
      subjects: subjects,
      columns: columns,
      p: p,
      nSub: nSub,
      nEvents: nEvents,
      badTE: badTE,
      missCov: missCov
    };
  }

  function cox(rows, opts) {
    try {
      var ties, maxIter, eps, confLevel, zcrit, j, prep, columns, p, subjects, nSub, nEvents, badTE, missCov;
      var beta, fit0, ll0, ll, iterations, converged, sep, prevAbs, grow, iter, parts, step, scale, h, trial, trialFit;
      var oldLL, dll, absb, sepFlag, finalFit, variances, col, unit, allEst, warnings, coefficients, coef, se, zstat, hr, lo, hi, wp, chi, lp;
      if (!isArray(rows) || !opts || typeof opts !== "object") return coxFail();
      ties = opts.ties == null ? "efron" : opts.ties;
      if (ties !== "efron" && ties !== "breslow") return coxFail();
      maxIter = opts.maxIter == null ? 20 : opts.maxIter;
      if (typeof maxIter !== "number" || !isFinite(maxIter) || maxIter < 0 || Math.floor(maxIter) !== maxIter) return coxFail();
      eps = opts.eps == null ? 1e-9 : opts.eps;
      if (!isFin(eps) || !(eps > 0)) return coxFail();
      confLevel = opts.confLevel == null ? 0.95 : opts.confLevel;
      zcrit = zForLevel(confLevel);
      if (zcrit == null) return coxFail();
      prep = prepareCoxSubjects(rows, opts);
      if (!prep) return coxFail();
      subjects = prep.subjects;
      columns = prep.columns;
      p = prep.p;
      nSub = prep.nSub;
      nEvents = prep.nEvents;
      badTE = prep.badTE;
      missCov = prep.missCov;
      warnings = [];
      if (badTE > 0) warnings.push(msgExcluded(badTE));
      if (!p || !nSub) {
        return coxFail({ n: nSub, nEvents: nEvents, nExcluded: badTE + missCov, warnings: warnings });
      }
      if (nEvents === 0) {
        warnings.push(MSG_NO_EVENTS);
        return coxFail({ ok: false, n: nSub, nEvents: 0, nExcluded: badTE + missCov, warnings: warnings });
      }
      if (nEvents < 10 * p) warnings.push(MSG_TOO_FEW);
      beta = zerosVec(p);
      fit0 = coxPartial(subjects, beta, ties, true);
      if (!fit0) {
        warnings.push(MSG_NOT_SETTLED);
        return coxFail({ n: nSub, nEvents: nEvents, nExcluded: badTE + missCov, warnings: warnings });
      }
      ll0 = fit0.ll;
      ll = ll0;
      iterations = 0;
      converged = false;
      sep = [];
      prevAbs = zerosVec(p);
      grow = zerosVec(p);
      for (j = 0; j < p; j++) sep.push(false);
      sepFlag = false;
      parts = fit0;
      for (iter = 0; iter < maxIter; iter++) {
        if (iter > 0) {
          parts = coxPartial(subjects, beta, ties, true);
          if (!parts) break;
          ll = parts.ll;
        }
        step = solveLinear(parts.info, parts.score);
        if (!step) {
          for (j = 0; j < p; j++) if (Math.abs(beta[j]) > 15) { sep[j] = true; sepFlag = true; }
          break;
        }
        scale = 1;
        trialFit = null;
        for (h = 0; h <= 10; h++) {
          trial = [];
          for (j = 0; j < p; j++) trial.push(beta[j] + scale * step[j]);
          trialFit = coxPartial(subjects, trial, ties, false);
          if (trialFit && isFinite(trialFit.ll) && trialFit.ll >= ll - eps * Math.max(1, Math.abs(ll))) break;
          trialFit = null;
          scale *= 0.5;
        }
        if (!trialFit) break;
        oldLL = ll;
        beta = trial;
        ll = trialFit.ll;
        iterations += 1;
        dll = Math.abs(ll - oldLL);
        for (j = 0; j < p; j++) {
          absb = Math.abs(beta[j]);
          if (!isFinite(absb)) { sep[j] = true; sepFlag = true; }
          else {
            if (dll < 1e-6 && absb > prevAbs[j] + 1e-12) grow[j] += 1;
            else grow[j] = 0;
            prevAbs[j] = absb;
            if (absb > 15 || grow[j] >= 3) { sep[j] = true; sepFlag = true; }
          }
        }
        if (sepFlag) break;
        if (dll <= eps * Math.max(1, Math.abs(ll))) { converged = true; break; }
      }
      if (sepFlag) converged = false;
      finalFit = coxPartial(subjects, beta, ties, true);
      variances = [];
      for (j = 0; j < p; j++) variances.push(null);
      if (finalFit) {
        ll = finalFit.ll;
        for (j = 0; j < p; j++) {
          unit = zerosVec(p);
          unit[j] = 1;
          col = solveLinear(finalFit.info, unit);
          if (col && isFinite(col[j]) && col[j] > 1e-16) variances[j] = col[j];
        }
      }
      if (!converged && !sepFlag) warnings.push(MSG_NOT_SETTLED);
      if (sepFlag) warnings.push(MSG_SEPARATION);
      coefficients = [];
      allEst = converged && !sepFlag;
      for (j = 0; j < p; j++) {
        coef = {
          term: columns[j].term,
          predictor: columns[j].predictor,
          level: columns[j].level,
          beta: beta[j],
          se: variances[j] == null ? null : Math.sqrt(variances[j]),
          hr: null,
          ciLower: null,
          ciUpper: null,
          z: null,
          p: null,
          estimable: false
        };
        if (converged && !sep[j] && variances[j] != null) {
          se = Math.sqrt(variances[j]);
          zstat = beta[j] / se;
          hr = Math.exp(beta[j]);
          lo = Math.exp(beta[j] - zcrit * se);
          hi = Math.exp(beta[j] + zcrit * se);
          wp = null;
          if (isFinite(zstat) && isFinite(hr) && isFinite(lo) && isFinite(hi)) {
            try { wp = chiSqUpper(zstat * zstat, 1); } catch (eWald) { wp = null; }
          }
          if (wp != null) {
            coef.se = se;
            coef.hr = hr;
            coef.ciLower = lo;
            coef.ciUpper = hi;
            coef.z = zstat;
            coef.p = wp;
            coef.estimable = true;
          }
        }
        if (!coef.estimable) allEst = false;
        if (!converged) {
          coef.hr = null;
          coef.ciLower = null;
          coef.ciUpper = null;
          coef.z = null;
          coef.p = null;
          coef.estimable = false;
        }
        coefficients.push(coef);
      }
      lp = null;
      chi = null;
      if (allEst) {
        chi = 2 * (ll - ll0);
        if (chi < 0 && chi > -1e-7) chi = 0;
        if (chi >= 0) {
          try { lp = chiSqUpper(chi, p); } catch (eLr) { lp = null; chi = null; }
        } else chi = null;
      }
      return {
        ok: converged || sepFlag,
        warnings: warnings,
        n: nSub,
        nEvents: nEvents,
        nExcluded: badTE + missCov,
        converged: converged,
        iterations: iterations,
        logLik: ll,
        lrTest: (chi != null && lp != null) ? { chi2: chi, df: p, p: lp } : null,
        coefficients: coefficients
      };
    } catch (errCox) {
      return coxFail();
    }
  }

  /* ---- Schoenfeld proportional hazards test (cox.zph transform = "km") ---- */

  function lowerBound(arr, target) {
    var lo = 0, hi = arr.length, mid;
    while (lo < hi) {
      mid = (lo + hi) >>> 1;
      if (arr[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function schoenfeld(coxResult, rows, spec, opts) {
    var transform, prep, subjects, columns, p, n, beta, i, j, k, c, ties;
    var eventTimes, surv, s, idx, start, d, nRisk, prefix, g, meanG, evCount, gc;
    var etas, maxEta, w, U, Ibb, Ibt, Itt, deathIdx, dcount, sumW, sumWx, sumWxx, sumDW, sumDWx, sumDWxx, sumDx;
    var dw, wi, di, a, b, A, xbSum, frac, s0, xb, invS0, gt, rt;
    var IbbInvIbt, unit, col, schur, terms, chisq, uSchur, globalChisq;
    opts = opts || {};
    transform = opts.transform == null ? "km" : opts.transform;
    if (transform !== "km") bad("schoenfeld only supports transform = 'km'");
    if (!coxResult || !coxResult.ok || !coxResult.converged || !isArray(coxResult.coefficients) || !coxResult.coefficients.length) {
      return { ok: false, transform: transform, terms: [], global: null };
    }
    prep = prepareCoxSubjects(rows, spec);
    if (!prep || !prep.p || !prep.nSub || !prep.nEvents) {
      return { ok: false, transform: transform, terms: [], global: null };
    }
    subjects = prep.subjects;
    columns = prep.columns;
    p = prep.p;
    n = prep.nSub;
    ties = (spec && spec.ties) || "efron";
    if (coxResult.coefficients.length !== p) {
      return { ok: false, transform: transform, terms: [], global: null };
    }
    beta = [];
    for (j = 0; j < p; j++) {
      c = coxResult.coefficients[j];
      if (!c || !isFin(c.beta)) return { ok: false, transform: transform, terms: [], global: null };
      beta.push(c.beta);
    }
    eventTimes = [];
    surv = [];
    s = 1.0;
    idx = 0;
    while (idx < n) {
      start = idx;
      d = 0;
      while (idx < n && subjects[idx].t === subjects[start].t) {
        if (subjects[idx].e === 1) d += 1;
        idx += 1;
      }
      if (d > 0) {
        nRisk = n - start;
        s *= 1 - d / nRisk;
        eventTimes.push(subjects[start].t);
        surv.push(s);
      }
    }
    prefix = [1.0].concat(surv);
    g = [];
    meanG = 0;
    evCount = 0;
    for (i = 0; i < n; i++) {
      g[i] = 1.0 - prefix[lowerBound(eventTimes, subjects[i].t)];
      if (subjects[i].e === 1) {
        meanG += g[i];
        evCount += 1;
      }
    }
    if (!evCount) return { ok: false, transform: transform, terms: [], global: null };
    meanG /= evCount;
    gc = [];
    for (i = 0; i < n; i++) gc[i] = g[i] - meanG;

    etas = [];
    maxEta = -1e300;
    for (i = 0; i < n; i++) {
      etas[i] = dotVec(subjects[i].x, beta);
      if (etas[i] > maxEta) maxEta = etas[i];
    }
    w = [];
    for (i = 0; i < n; i++) {
      dw = etas[i] - maxEta;
      w[i] = dw < -745 ? 0 : Math.exp(dw);
    }

    U = zerosVec(p);
    Ibb = zeroMat(p);
    Ibt = zeroMat(p);
    Itt = zeroMat(p);

    idx = 0;
    while (idx < n) {
      start = idx;
      deathIdx = [];
      while (idx < n && subjects[idx].t === subjects[start].t) {
        if (subjects[idx].e === 1) deathIdx.push(idx);
        idx += 1;
      }
      dcount = deathIdx.length;
      if (dcount === 0) continue;
      sumW = 0; sumWx = zerosVec(p); sumWxx = zeroMat(p);
      sumDW = 0; sumDWx = zerosVec(p); sumDWxx = zeroMat(p);
      sumDx = zerosVec(p);
      for (j = start; j < n; j++) {
        wi = w[j];
        sumW += wi;
        accumCov(subjects[j].x, wi, sumWx, sumWxx);
      }
      if (!(sumW > 0)) return { ok: false, transform: transform, terms: [], global: null };
      for (di = 0; di < dcount; di++) {
        j = deathIdx[di];
        wi = w[j];
        sumDW += wi;
        for (a = 0; a < p; a++) sumDx[a] += subjects[j].x[a];
        accumCov(subjects[j].x, wi, sumDWx, sumDWxx);
      }
      A = zeroMat(p);
      xbSum = zerosVec(p);
      for (k = 0; k < dcount; k++) {
        frac = ties === "breslow" ? 0 : (k / dcount);
        s0 = sumW - frac * sumDW;
        if (!(s0 > 0)) return { ok: false, transform: transform, terms: [], global: null };
        invS0 = 1 / s0;
        xb = [];
        for (a = 0; a < p; a++) {
          xb[a] = (sumWx[a] - frac * sumDWx[a]) * invS0;
          xbSum[a] += xb[a];
        }
        for (a = 0; a < p; a++) {
          for (b = 0; b < p; b++) {
            A[a][b] += (sumWxx[a][b] - frac * sumDWxx[a][b]) * invS0 - xb[a] * xb[b];
          }
        }
      }
      gt = gc[deathIdx[0]];
      for (a = 0; a < p; a++) {
        rt = sumDx[a] - xbSum[a];
        U[a] += gt * rt;
        for (b = 0; b < p; b++) {
          Ibb[a][b] += A[a][b];
          Ibt[a][b] += gt * A[a][b];
          Itt[a][b] += gt * gt * A[a][b];
        }
      }
    }

    IbbInvIbt = zeroMat(p);
    for (b = 0; b < p; b++) {
      unit = [];
      for (a = 0; a < p; a++) unit.push(Ibt[a][b]);
      col = solveLinear(Ibb, unit);
      if (!col) return { ok: false, transform: transform, terms: [], global: null };
      for (a = 0; a < p; a++) IbbInvIbt[a][b] = col[a];
    }
    schur = zeroMat(p);
    for (a = 0; a < p; a++) {
      for (b = 0; b < p; b++) {
        var sub = 0;
        for (k = 0; k < p; k++) sub += Ibt[k][a] * IbbInvIbt[k][b];
        schur[a][b] = Itt[a][b] - sub;
      }
    }
    terms = [];
    for (j = 0; j < p; j++) {
      if (!(schur[j][j] > 0)) return { ok: false, transform: transform, terms: [], global: null };
      chisq = (U[j] * U[j]) / schur[j][j];
      terms.push({ term: columns[j].term, chisq: chisq, df: 1, p: chiSqUpper(chisq, 1) });
    }
    uSchur = solveLinear(schur, U);
    if (!uSchur) return { ok: false, transform: transform, terms: [], global: null };
    globalChisq = 0;
    for (j = 0; j < p; j++) globalChisq += U[j] * uSchur[j];
    if (globalChisq < 0 && globalChisq > -1e-9) globalChisq = 0;
    return {
      ok: true,
      transform: transform,
      terms: terms,
      global: { chisq: globalChisq, df: p, p: chiSqUpper(globalChisq, p) }
    };
  }

  /* ---- diagnostic accuracy: per-study and Reitsma bivariate REML + SROC ---- */

  function validateDiagnosticStudies(counts) {
    var cells = ["TP", "FN", "FP", "TN"], out = [], i, j, s, name, v, rec;
    if (!isArray(counts) || !counts.length) bad("studies must be a non-empty array");
    for (i = 0; i < counts.length; i++) {
      s = counts[i];
      if (!s || typeof s !== "object" || isArray(s)) bad("each study must be an object");
      rec = { id: s.id != null ? s.id : ("study-" + (i + 1)) };
      for (j = 0; j < 4; j++) {
        name = cells[j];
        v = s[name] !== undefined ? s[name] : s[name.toLowerCase()];
        if (typeof v !== "number" || !isFin(v) || v < 0) {
          bad("study " + i + ": " + name + " must be a non-negative number");
        }
        rec[name] = v;
      }
      out.push(rec);
    }
    return out;
  }

  function applyDiagnosticCorrection(studies, correction, control) {
    var cells = ["TP", "FN", "FP", "TN"], anyZero = false, i, j, s, rec, out = [], touched = false, hasZero;
    if (control !== "all" && control !== "single" && control !== "none") {
      badCode("invalid_correction_control", "invalid correctionControl");
    }
    if (!isFin(correction) || correction < 0) {
      badCode("invalid_correction", "invalid correction");
    }
    for (i = 0; i < studies.length; i++) {
      for (j = 0; j < 4; j++) if (studies[i][cells[j]] === 0) anyZero = true;
    }
    if (control === "none") {
      if (anyZero) badCode("zero_cell", "zero cell with correctionControl = 'none'");
      return { studies: studies.slice(), applied: false };
    }
    if (control === "all") {
      if (!anyZero) return { studies: studies.slice(), applied: false };
      for (i = 0; i < studies.length; i++) {
        s = studies[i];
        out.push({ id: s.id, TP: s.TP + correction, FN: s.FN + correction, FP: s.FP + correction, TN: s.TN + correction });
      }
      return { studies: out, applied: true };
    }
    for (i = 0; i < studies.length; i++) {
      s = studies[i];
      hasZero = (s.TP === 0 || s.FN === 0 || s.FP === 0 || s.TN === 0);
      if (hasZero) {
        touched = true;
        out.push({ id: s.id, TP: s.TP + correction, FN: s.FN + correction, FP: s.FP + correction, TN: s.TN + correction });
      } else {
        out.push({ id: s.id, TP: s.TP, FN: s.FN, FP: s.FP, TN: s.TN });
      }
    }
    return { studies: out, applied: touched };
  }

  function diagnosticPerStudy(counts, opts) {
    var raw, corr, correction, control, rows = [], i, s, nPos, nNeg;
    opts = opts || {};
    correction = opts.correction == null ? 0.5 : opts.correction;
    control = opts.correctionControl != null ? opts.correctionControl : (opts.correction_control != null ? opts.correction_control : "all");
    raw = validateDiagnosticStudies(counts);
    corr = applyDiagnosticCorrection(raw, correction, control);
    for (i = 0; i < corr.studies.length; i++) {
      s = corr.studies[i];
      nPos = s.TP + s.FN;
      nNeg = s.FP + s.TN;
      if (nPos <= 0 || nNeg <= 0) badCode("zero_marginal", "zero marginal in diagnostic study");
      rows.push({
        id: s.id,
        tp: s.TP,
        fn: s.FN,
        fp: s.FP,
        tn: s.TN,
        sens: s.TP / nPos,
        spec: s.TN / nNeg
      });
    }
    return {
      family: "diagnostic",
      model: "per-study",
      correction: correction,
      correctionControl: control,
      correctionApplied: corr.applied,
      k: rows.length,
      studies: rows
    };
  }

  function remlProfile2x2(theta, y, S) {
    var t0 = theta[0], t1 = theta[1], t2 = theta[2];
    var p00 = t0 * t0, p01 = t0 * t1, p11 = t1 * t1 + t2 * t2;
    var m = y.length, i, a, b, d, det, logdetV = 0;
    var v00, v01, v11, A00 = 0, A01 = 0, A11 = 0, rhs0 = 0, rhs1 = 0;
    var Vinvs = [];
    for (i = 0; i < m; i++) {
      a = S[i][0] + p00;
      b = p01;
      d = S[i][1] + p11;
      det = a * d - b * b;
      if (!(a > 0) || !(det > 0) || !isFin(det)) return 1e12;
      logdetV += Math.log(det);
      v00 = d / det;
      v01 = -b / det;
      v11 = a / det;
      Vinvs.push([v00, v01, v11]);
      A00 += v00;
      A01 += v01;
      A11 += v11;
      rhs0 += v00 * y[i][0] + v01 * y[i][1];
      rhs1 += v01 * y[i][0] + v11 * y[i][1];
    }
    var detA = A00 * A11 - A01 * A01;
    if (!(A00 > 0) || !(detA > 0) || !isFin(detA)) return 1e12;
    var logdetA = Math.log(detA);
    var b0 = (A11 * rhs0 - A01 * rhs1) / detA;
    var b1 = (A00 * rhs1 - A01 * rhs0) / detA;
    var quad = 0, r0, r1;
    for (i = 0; i < m; i++) {
      r0 = y[i][0] - b0;
      r1 = y[i][1] - b1;
      quad += r0 * r0 * Vinvs[i][0] + 2 * r0 * r1 * Vinvs[i][1] + r1 * r1 * Vinvs[i][2];
    }
    var ll = -0.5 * (2 * m - 2) * Math.log(2 * Math.PI) - 0.5 * logdetV - 0.5 * quad - 0.5 * logdetA;
    return isFin(ll) ? -ll : 1e12;
  }

  function bfgsMinimize(fn, x0, gtol, maxiter) {
    var dim = x0.length, x = x0.slice(), H = [], i, j, k, iter;
    function vecAdd(a, b, s) {
      var out = [], idx;
      for (idx = 0; idx < dim; idx++) out.push(a[idx] + s * b[idx]);
      return out;
    }
    function vecDot(a, b) {
      var s = 0, idx;
      for (idx = 0; idx < dim; idx++) s += a[idx] * b[idx];
      return s;
    }
    function grad(pt) {
      var g = [], idx, h, xp, xm, fp, fm;
      for (idx = 0; idx < dim; idx++) {
        h = 1e-6 * Math.max(1, Math.abs(pt[idx]));
        xp = pt.slice(); xp[idx] += h;
        xm = pt.slice(); xm[idx] -= h;
        fp = fn(xp); fm = fn(xm);
        g.push((fp - fm) / (2 * h));
      }
      return g;
    }
    function eye() {
      var M = [], r, c;
      for (r = 0; r < dim; r++) {
        M[r] = [];
        for (c = 0; c < dim; c++) M[r][c] = r === c ? 1 : 0;
      }
      return M;
    }
    H = eye();
    var f = fn(x), g = grad(x);
    for (iter = 0; iter < maxiter; iter++) {
      var maxG = 0;
      for (i = 0; i < dim; i++) if (Math.abs(g[i]) > maxG) maxG = Math.abs(g[i]);
      if (maxG <= gtol) break;
      var d = [];
      for (i = 0; i < dim; i++) {
        var s = 0;
        for (j = 0; j < dim; j++) s -= H[i][j] * g[j];
        d.push(s);
      }
      var slope = vecDot(g, d);
      if (!(slope < 0)) {
        H = eye();
        d = [];
        for (i = 0; i < dim; i++) d.push(-g[i]);
        slope = vecDot(g, d);
        if (!(slope < 0)) break;
      }
      /* Strong Wolfe backtracking + zoom line search */
      var c1 = 1e-4, c2 = 0.9;
      var alphaPrev = 0, fPrev = f, gPrevSlope = slope;
      var alpha = 1.0, xNew = null, fNew = f, gNew = g, accepted = false;
      function zoom(aLo, fLo, gLoSlope, aHi, fHi) {
        var zIter, aMid, xM, fM, gM, gMSlope;
        for (zIter = 0; zIter < 25; zIter++) {
          aMid = 0.5 * (aLo + aHi);
          xM = vecAdd(x, d, aMid);
          fM = fn(xM);
          if (fM > f + c1 * aMid * slope || fM >= fLo || !isFin(fM)) {
            aHi = aMid;
            fHi = fM;
          } else {
            gM = grad(xM);
            gMSlope = vecDot(gM, d);
            if (Math.abs(gMSlope) <= -c2 * slope) {
              xNew = xM; fNew = fM; gNew = gM; accepted = true;
              return;
            }
            if (gMSlope * (aHi - aLo) >= 0) {
              aHi = aLo;
              fHi = fLo;
            }
            aLo = aMid;
            fLo = fM;
            gLoSlope = gMSlope;
          }
          if (Math.abs(aHi - aLo) < 1e-14) break;
        }
        xNew = vecAdd(x, d, aLo);
        fNew = fn(xNew);
        gNew = grad(xNew);
        accepted = isFin(fNew) && fNew <= f;
      }
      var ls;
      for (ls = 0; ls < 30; ls++) {
        var xCand = vecAdd(x, d, alpha);
        var fCand = fn(xCand);
        if (!isFin(fCand) || fCand >= 1e11) {
          alpha *= 0.5;
          continue;
        }
        if (fCand > f + c1 * alpha * slope || (ls > 0 && fCand >= fPrev)) {
          zoom(alphaPrev, fPrev, gPrevSlope, alpha, fCand);
          break;
        }
        var gCand = grad(xCand);
        var gCandSlope = vecDot(gCand, d);
        if (Math.abs(gCandSlope) <= -c2 * slope) {
          xNew = xCand; fNew = fCand; gNew = gCand; accepted = true;
          break;
        }
        if (gCandSlope >= 0) {
          zoom(alpha, fCand, gCandSlope, alphaPrev, fPrev);
          break;
        }
        alphaPrev = alpha;
        fPrev = fCand;
        gPrevSlope = gCandSlope;
        alpha *= 2.0;
        if (alpha > 1e6) break;
      }
      if (!accepted || !xNew) {
        /* Fallback simple Armijo */
        alpha = 1.0;
        for (ls = 0; ls < 40; ls++) {
          xNew = vecAdd(x, d, alpha);
          fNew = fn(xNew);
          if (isFin(fNew) && fNew < f) {
            gNew = grad(xNew);
            accepted = true;
            break;
          }
          alpha *= 0.5;
        }
      }
      if (!accepted) break;
      var sVec = [], yVec = [];
      for (i = 0; i < dim; i++) {
        sVec.push(xNew[i] - x[i]);
        yVec.push(gNew[i] - g[i]);
      }
      var sy = vecDot(sVec, yVec);
      var sNorm = Math.sqrt(vecDot(sVec, sVec));
      var yNorm = Math.sqrt(vecDot(yVec, yVec));
      if (sy > 1e-12 * sNorm * yNorm) {
        var rho = 1 / sy;
        var Hy = [];
        for (i = 0; i < dim; i++) {
          var hyi = 0;
          for (j = 0; j < dim; j++) hyi += H[i][j] * yVec[j];
          Hy.push(hyi);
        }
        var yHy = vecDot(yVec, Hy);
        var Hnew = [];
        for (i = 0; i < dim; i++) {
          Hnew[i] = [];
          for (j = 0; j < dim; j++) {
            Hnew[i][j] = H[i][j] + (1 + rho * yHy) * rho * sVec[i] * sVec[j] -
              rho * (Hy[i] * sVec[j] + sVec[i] * Hy[j]);
          }
        }
        H = Hnew;
      }
      x = xNew;
      f = fNew;
      g = gNew;
      if (sNorm < 1e-12) break;
    }
    return { x: x, fun: f };
  }

  function sroc(fit, fpr, type) {
    var t = type == null ? "ruttergatsonis" : type;
    var grid, b, psi, i, out, tau1, tau2, lam, beta, theta, f, lf;
    if (t !== "ruttergatsonis" && t !== "naive") bad("invalid sroc type: " + t);
    if (!fit || !isArray(fit.coefficients) || fit.coefficients.length < 2 || !isArray(fit.psi)) {
      bad("sroc needs a fitted reitsma object");
    }
    if (fpr == null) {
      grid = [];
      for (i = 1; i < 100; i++) grid.push(i / 100);
    } else {
      grid = fpr;
    }
    b = [fit.coefficients[0].estimate, fit.coefficients[1].estimate];
    psi = fit.psi;
    if (t === "ruttergatsonis") {
      tau1 = Math.sqrt(Math.max(psi[0][0], 0));
      tau2 = Math.sqrt(Math.max(psi[1][1], 0));
      if (!(tau1 > 1e-8 && tau2 > 1e-8)) return null;
      lam = Math.sqrt(tau2 / tau1) * b[0] - Math.sqrt(tau1 / tau2) * b[1];
      beta = Math.log(tau2 / tau1);
      out = [];
      for (i = 0; i < grid.length; i++) {
        f = grid[i];
        lf = Math.log(f / (1 - f));
        out.push(expit(lam * Math.exp(-beta / 2) + Math.exp(-beta) * lf));
      }
      return out;
    }
    if (!(psi[1][1] > 1e-12)) return null;
    theta = psi[0][1] / psi[1][1];
    out = [];
    for (i = 0; i < grid.length; i++) {
      f = grid[i];
      lf = Math.log(f / (1 - f));
      out.push(expit(b[0] + theta * (lf - b[1])));
    }
    return out;
  }

  function reitsma(counts, opts) {
    var raw, corr, correction, control, level, y = [], S = [], i, s, nPos, nNeg, sens, fpr;
    var starts, best = null, res, theta, p00, p01, p11, psi, A00, A01, A11, rhs0, rhs1, a, b, d, det, v00, v01, v11;
    var detA, vcov, estB, z, se, coefs, terms, est, seJ, zJ, pJ, pooledSens, pooledFpr, fprGrid, k;
    opts = opts || {};
    correction = opts.correction == null ? 0.5 : opts.correction;
    control = opts.correctionControl != null ? opts.correctionControl : (opts.correction_control != null ? opts.correction_control : "all");
    level = opts.level == null ? 0.95 : opts.level;
    if (!isFin(level) || !(level > 0 && level < 1)) bad("level must be between 0 and 1");
    raw = validateDiagnosticStudies(counts);
    if (raw.length < 2) bad("reitsma needs at least two studies");
    corr = applyDiagnosticCorrection(raw, correction, control);
    for (i = 0; i < corr.studies.length; i++) {
      s = corr.studies[i];
      nPos = s.TP + s.FN;
      nNeg = s.FP + s.TN;
      if (nPos <= 0 || nNeg <= 0) badCode("zero_marginal", "zero marginal in diagnostic study");
      sens = s.TP / nPos;
      fpr = s.FP / nNeg;
      if (!(sens > 0 && sens < 1 && fpr > 0 && fpr < 1)) badCode("zero_cell", "zero cell in diagnostic study");
      y.push([Math.log(sens / (1 - sens)), Math.log(fpr / (1 - fpr))]);
      S.push([1 / s.TP + 1 / s.FN, 1 / s.FP + 1 / s.TN]);
    }
    starts = [
      [Math.sqrt(0.1), 0.0, Math.sqrt(0.1)],
      [Math.sqrt(0.5), 0.0, Math.sqrt(0.5)]
    ];
    for (k = 0; k < starts.length; k++) {
      res = bfgsMinimize(function (th) { return remlProfile2x2(th, y, S); }, starts[k], 1e-10, 500);
      if (!best || res.fun < best.fun) best = res;
    }
    if (!best || !isFin(best.fun) || best.fun >= 1e11) {
      badCode("reitsma_not_converged", "reitsma REML did not converge");
    }
    theta = best.x;
    p00 = theta[0] * theta[0];
    p01 = theta[0] * theta[1];
    p11 = theta[1] * theta[1] + theta[2] * theta[2];
    psi = [[p00, p01], [p01, p11]];
    A00 = 0; A01 = 0; A11 = 0; rhs0 = 0; rhs1 = 0;
    for (i = 0; i < y.length; i++) {
      a = S[i][0] + p00;
      b = p01;
      d = S[i][1] + p11;
      det = a * d - b * b;
      v00 = d / det; v01 = -b / det; v11 = a / det;
      A00 += v00; A01 += v01; A11 += v11;
      rhs0 += v00 * y[i][0] + v01 * y[i][1];
      rhs1 += v01 * y[i][0] + v11 * y[i][1];
    }
    detA = A00 * A11 - A01 * A01;
    vcov = [[A11 / detA, -A01 / detA], [-A01 / detA, A00 / detA]];
    estB = [
      vcov[0][0] * rhs0 + vcov[0][1] * rhs1,
      vcov[1][0] * rhs0 + vcov[1][1] * rhs1
    ];
    z = normalQuantile((1 + level) / 2);
    se = [Math.sqrt(vcov[0][0]), Math.sqrt(vcov[1][1])];
    terms = ["tsens", "tfpr"];
    coefs = [];
    for (i = 0; i < 2; i++) {
      est = estB[i];
      seJ = se[i];
      zJ = est / seJ;
      pJ = 2 * normalUpper(Math.abs(zJ));
      coefs.push({
        term: terms[i],
        estimate: est,
        se: seJ,
        z: zJ,
        p: pJ,
        ciLower: est - z * seJ,
        ciUpper: est + z * seJ
      });
    }
    pooledSens = expit(estB[0]);
    pooledFpr = expit(estB[1]);
    fprGrid = [];
    for (i = 1; i < 100; i++) fprGrid.push(i / 100);
    var fitObj = {
      family: "diagnostic",
      model: "reitsma",
      correction: correction,
      correctionControl: control,
      correctionApplied: corr.applied,
      level: level,
      k: corr.studies.length,
      coefficients: coefs,
      psi: psi,
      pooledSens: pooledSens,
      pooledSensCiLower: expit(estB[0] - z * se[0]),
      pooledSensCiUpper: expit(estB[0] + z * se[0]),
      pooledFpr: pooledFpr,
      pooledSpec: 1 - pooledFpr,
      pooledSpecCiLower: 1 - expit(estB[1] + z * se[1]),
      pooledSpecCiUpper: 1 - expit(estB[1] - z * se[1])
    };
    fitObj.sroc = {
      fpr: fprGrid,
      ruttergatsonis: sroc(fitObj, fprGrid, "ruttergatsonis"),
      naive: sroc(fitObj, fprGrid, "naive")
    };
    return fitObj;
  }

  function qbetaPolished(a, b, p) {
    var x, i, cdf, dens, g, step;
    if (!(p > 0)) return 0;
    if (!(p < 1)) return 1;
    x = invBetai(a, b, p);
    for (i = 0; i < 12; i++) {
      if (!(x > 0) || !(x < 1)) break;
      try { cdf = betai(a, b, x); } catch (eBeta) { break; }
      g = gammln(a + b) - gammln(a) - gammln(b);
      if (a !== 1) g += (a - 1) * Math.log(x);
      if (b !== 1) g += (b - 1) * Math.log(1 - x);
      dens = Math.exp(g);
      if (!(dens > 0) || !isFinite(dens)) break;
      step = (cdf - p) / dens;
      if (!isFinite(step)) break;
      if (Math.abs(step) < 1e-15) break;
      x = x - step;
      if (x < 1e-16) x = 1e-16;
      if (x > 1 - 1e-16) x = 1 - 1e-16;
    }
    return x;
  }

  function binomTwoSided(b, c) {
    var n, k, j, term, sum, p;
    n = b + c;
    k = b < c ? b : c;
    if (n > 1000) {
      try { p = 2 * betai(n - k, k + 1, 0.5); } catch (eBin) { return null; }
      if (p > 1) p = 1;
      if (p < 0) p = 0;
      return p;
    }
    term = Math.pow(0.5, n);
    sum = term;
    for (j = 0; j < k; j++) {
      term = term * (n - j) / (j + 1);
      sum += term;
    }
    p = 2 * sum;
    if (p > 1) p = 1;
    if (!(p >= 0)) p = 0;
    return p;
  }

  function matchedFail(warnings, b, c) {
    return {
      ok: false,
      warnings: warnings || [],
      b: b == null ? null : b,
      c: c == null ? null : c,
      or: null,
      ciLower: null,
      ciUpper: null,
      p: null,
      method: "exact conditional"
    };
  }

  function exposedFlag(v) {
    var s;
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    if (typeof v === "string") {
      s = trim(v).toLowerCase();
      if (s === "1" || s === "yes" || s === "y" || s === "true") return true;
      if (s === "0" || s === "no" || s === "n" || s === "false") return false;
    }
    return null;
  }

  function isWhole(v) {
    return typeof v === "number" && isFinite(v) && v >= 0 && Math.floor(v) === v;
  }

  function matchedOr(input) {
    try {
      var b, c, i, pair, aExp, bExp, warnings, pL, pU, or, lo, hi, p;
      b = null;
      c = null;
      if (isArray(input)) {
        b = 0;
        c = 0;
        for (i = 0; i < input.length; i++) {
          pair = input[i];
          if (!pair || typeof pair !== "object") return matchedFail([]);
          aExp = exposedFlag(pair.caseExposed);
          bExp = exposedFlag(pair.controlExposed);
          if (aExp == null || bExp == null) return matchedFail([]);
          if (aExp && !bExp) b += 1;
          else if (!aExp && bExp) c += 1;
        }
      } else if (input && typeof input === "object") {
        if (!isWhole(input.b) || !isWhole(input.c)) return matchedFail([]);
        b = input.b;
        c = input.c;
      } else {
        return matchedFail([]);
      }
      if (b + c === 0) return matchedFail([MSG_NO_PAIRS], b, c);
      warnings = [];
      if (c === 0) warnings.push(MSG_OR_HUGE);
      if (b + c < 10) warnings.push(MSG_OR_WIDE);
      if (b === 0) pL = 0;
      else pL = qbetaPolished(b, c + 1, 0.025);
      if (c === 0) pU = 1;
      else pU = qbetaPolished(b + 1, c, 0.975);
      or = c === 0 ? Infinity : b / c;
      lo = pL <= 0 ? 0 : pL / (1 - pL);
      hi = !(pU < 1) ? Infinity : pU / (1 - pU);
      p = binomTwoSided(b, c);
      if (p == null || !isFinite(lo)) return matchedFail(warnings, b, c);
      return {
        ok: true,
        warnings: warnings,
        b: b,
        c: c,
        or: or,
        ciLower: lo,
        ciUpper: hi,
        p: p,
        method: "exact conditional"
      };
    } catch (errOr) {
      return matchedFail([]);
    }
  }

  var STATS = {
    ENGINE_VERSION: ENGINE_VERSION,
    parseCsv: parseCsv,
    inferColumn: inferColumn,
    describe: describe,
    chooseTest: chooseTest,
    compare: compare,
    crosstab: crosstab,
    table1: table1,
    linear: linear,
    logistic: logistic,
    formatP: formatP,
    resultsSentence: resultsSentence,
    kaplanMeier: kaplanMeier,
    logRank: logRank,
    cox: cox,
    schoenfeld: schoenfeld,
    diagnosticPerStudy: diagnosticPerStudy,
    reitsma: reitsma,
    sroc: sroc,
    matchedOr: matchedOr,
    _rank: { mannWhitney: mannWhitney, wilcoxonSigned: wilcoxonSigned } /* exposed for the R parity tests */
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = STATS; }
  if (G) { G.SMD_RESEARCH_STATS = STATS; }

})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : undefined));
