/* StewardMD - ResearchMD randomisation list engine (window.SMD_RESEARCH_RANDOMISE).
 * ES5 only, pure (no DOM, no clock, no random source). Dual export: browser global and CommonJS.
 *
 * Fixed algorithm (plan v2), so the same seed always gives the same list:
 *  - per stratum, the generator seed is the FNV-1a 32-bit hash of seed + "|" + stratum label
 *    (UTF-16 code units);
 *  - random numbers come from mulberry32;
 *  - repeat until the stratum has at least n rows: pick a block size uniformly from
 *    blockSizes, fill it with arms by ratio, shuffle it with Fisher-Yates
 *    (j = floor(rand * (i + 1)), i from last to 1). Whole blocks are kept, so a
 *    stratum may run past n.
 * The caller computes the SHA-256 fingerprint of the csv (crypto.subtle).
 * Changing any step here changes every list already made: do not.
 */
(function (G) {
  "use strict";

  var MAX_N = 5000;

  function imul(a, b) {
    if (Math.imul) return Math.imul(a, b);
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) | 0);
  }

  function fnv1a(str) {
    var h = 0x811c9dc5, i;
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = imul(a ^ (a >>> 15), 1 | a);
      t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function isInt(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n; }

  function isArr(x) { return Object.prototype.toString.call(x) === "[object Array]"; }

  function pad3(n) {
    var s = String(n);
    while (s.length < 3) s = "0" + s;
    return s;
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function fail(msg) { return { ok: false, warnings: [msg] }; }

  function blockList(opts) {
    var o = opts || {}, seed, arms, ratio, n, sizes, strata, sum = 0, i, j, k, warnings = [];
    seed = o.seed == null ? "" : String(o.seed);
    if (!seed) return fail("Type a seed (any word or number the list keeper will keep private).");
    arms = isArr(o.arms) ? o.arms : ["A", "B"];
    if (arms.length < 2) return fail("A trial needs at least two arms.");
    for (i = 0; i < arms.length; i++) {
      if (arms[i] == null || !String(arms[i]).replace(/\s+/g, "")) return fail("Every arm needs a name.");
    }
    ratio = isArr(o.ratio) ? o.ratio.slice() : [];
    if (!ratio.length) { for (i = 0; i < arms.length; i++) ratio.push(1); }
    if (ratio.length !== arms.length) return fail("Give one ratio number for each arm.");
    for (i = 0; i < ratio.length; i++) {
      if (!isInt(ratio[i]) || ratio[i] < 1) return fail("Ratios must be whole numbers, for example 1:1 or 2:1.");
      sum += ratio[i];
    }
    n = o.n;
    if (!isInt(n) || n < 1) return fail("Enter the number of patients as a whole number.");
    if (n > MAX_N) return fail("The list can hold at most " + MAX_N + " patients per stratum.");
    sizes = isArr(o.blockSizes) && o.blockSizes.length ? o.blockSizes : [sum * 2];
    for (i = 0; i < sizes.length; i++) {
      if (!isInt(sizes[i]) || sizes[i] < 1 || sizes[i] % sum !== 0) {
        return fail("Block size " + sizes[i] + " cannot split " + ratio.join(":") + "; use " + sum + " or " + (sum * 2) + ".");
      }
    }
    strata = isArr(o.strata) && o.strata.length ? o.strata : ["All"];
    for (i = 0; i < strata.length; i++) {
      for (j = i + 1; j < strata.length; j++) {
        if (String(strata[i]) === String(strata[j])) return fail("Each stratum needs a different name.");
      }
    }
    if (sizes.length === 1) {
      warnings.push("With one block size, the last places in each block can be guessed; mix two sizes, for example " + (sum * 2) + " and " + (sum * 3) + ".");
    }

    var rows = [];
    for (k = 0; k < strata.length; k++) {
      var label = String(strata[k]);
      var rand = mulberry32(fnv1a(seed + "|" + label));
      var seq = 0, blockNo = 0;
      while (seq < n) {
        var bs = sizes[Math.floor(rand() * sizes.length)];
        var block = [];
        for (i = 0; i < arms.length; i++) {
          for (j = 0; j < ratio[i] * bs / sum; j++) block.push(String(arms[i]));
        }
        for (i = block.length - 1; i >= 1; i--) {
          j = Math.floor(rand() * (i + 1));
          var tmp = block[i]; block[i] = block[j]; block[j] = tmp;
        }
        blockNo++;
        for (i = 0; i < block.length; i++) {
          seq++;
          rows.push({ seq: seq, stratum: label, envelope: (k + 1) + "-" + pad3(seq), block: blockNo, blockSize: bs, arm: block[i] });
        }
      }
      if (seq > n) {
        warnings.push((strata.length > 1 ? "Stratum " + label + ": " : "") + "the list has " + seq + " places, not " + n + ", because whole blocks are kept.");
      }
    }

    var lines = ["seq,stratum,envelope,block,block_size,arm"];
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      lines.push([r.seq, csvCell(r.stratum), r.envelope, r.block, r.blockSize, csvCell(r.arm)].join(","));
    }
    return { ok: true, warnings: warnings, seed: seed, csv: lines.join("\n") + "\n", rows: rows };
  }

  var R = { blockList: blockList, _fnv1a: fnv1a, _mulberry32: mulberry32 };

  if (typeof module !== "undefined" && module.exports) { module.exports = R; }
  if (G) { G.SMD_RESEARCH_RANDOMISE = R; }

})(typeof window !== "undefined" ? window : undefined);
