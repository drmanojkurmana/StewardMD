/* StewardMD - ResearchMD block randomisation (window.SMD_RESEARCH_RANDOMISE).
 * ES5 IIFE. Dual export. Seeded generator only. No clock reads.
 * Seed: FNV-1a 32-bit of seed + "|" + stratum label (UTF-16 code units).
 * PRNG: mulberry32. Blocks stay whole, so a list may be longer than n.
 * No em or en dashes.
 */
(function (G) {
  "use strict";

  function fail(warnings) {
    return { ok: false, warnings: warnings || [], seed: null, csv: "", rows: [] };
  }

  function isPosInt(v) {
    return typeof v === "number" && isFinite(v) && v > 0 && Math.floor(v) === v;
  }

  function fnv1a(text) {
    var h = 2166136261;
    var i, c;
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      h = Math.imul(h ^ c, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      var t;
      a = (a + 0x6D2B79F5) >>> 0;
      t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function blockMessage(blockSize, ratio) {
    var sum, i, low, high, ratioTxt, use;
    sum = 0;
    for (i = 0; i < ratio.length; i++) sum += ratio[i];
    if (!(sum > 0)) return null;
    if (blockSize % sum === 0) return null;
    low = Math.floor(blockSize / sum) * sum;
    if (low < sum) low = 0;
    high = (Math.floor(blockSize / sum) + 1) * sum;
    ratioTxt = ratio.join(":");
    if (low === 0) use = "use " + high + ".";
    else use = "use " + low + " or " + high + ".";
    return "Block size " + blockSize + " cannot split " + ratioTxt + "; " + use;
  }

  function stratumLabels(strata) {
    var labels, s, i, j, next, level;
    if (!strata || !strata.length) return [""];
    labels = [""];
    for (s = 0; s < strata.length; s++) {
      if (!strata[s] || !strata[s].length) return [];
      next = [];
      for (i = 0; i < labels.length; i++) {
        for (j = 0; j < strata[s].length; j++) {
          level = String(strata[s][j]);
          next.push(labels[i] === "" ? level : (labels[i] + ", " + level));
        }
      }
      labels = next;
    }
    return labels;
  }

  function pad3(n) {
    var s = String(n);
    while (s.length < 3) s = "0" + s;
    return s;
  }

  function csvCell(v) {
    var s = String(v);
    if (s.indexOf(",") >= 0 || s.indexOf("\"") >= 0 || s.indexOf("\n") >= 0 || s.indexOf("\r") >= 0) {
      return "\"" + s.replace(/"/g, "\"\"") + "\"";
    }
    return s;
  }

  function shuffle(slots, rand) {
    var i, j, tmp;
    for (i = slots.length - 1; i >= 1; i--) {
      j = Math.floor(rand() * (i + 1));
      tmp = slots[i];
      slots[i] = slots[j];
      slots[j] = tmp;
    }
    return slots;
  }

  function fillBlock(arms, ratio, blockSize, rand) {
    var sum, i, count, slots, j;
    sum = 0;
    for (i = 0; i < ratio.length; i++) sum += ratio[i];
    slots = [];
    for (i = 0; i < arms.length; i++) {
      count = blockSize * ratio[i] / sum;
      for (j = 0; j < count; j++) slots.push(arms[i]);
    }
    return shuffle(slots, rand);
  }

  function blockList(opts) {
    try {
      var n, arms, ratio, blockSizes, strata, seed, i, warnings, labels, rows, seq, s, label, rand, blockNo, size, slots, k, within, row, lines, seedText;
      if (!opts || typeof opts !== "object") return fail([]);
      n = opts.n;
      arms = opts.arms;
      ratio = opts.ratio;
      blockSizes = opts.blockSizes;
      strata = opts.strata;
      if (!isPosInt(n)) return fail([]);
      if (!arms || !arms.length || arms.length < 2) return fail([]);
      if (!ratio || ratio.length !== arms.length) return fail([]);
      if (!blockSizes || !blockSizes.length) return fail([]);
      for (i = 0; i < arms.length; i++) {
        if (arms[i] == null || String(arms[i]) === "") return fail([]);
        if (!isPosInt(ratio[i])) return fail([]);
      }
      for (i = 0; i < blockSizes.length; i++) {
        if (!isPosInt(blockSizes[i])) return fail([]);
      }
      if (opts.seed == null || typeof opts.seed === "object" || typeof opts.seed === "boolean") return fail([]);
      seedText = String(opts.seed);
      warnings = [];
      for (i = 0; i < blockSizes.length; i++) {
        if (blockMessage(blockSizes[i], ratio)) warnings.push(blockMessage(blockSizes[i], ratio));
      }
      if (warnings.length) return fail(warnings);
      labels = stratumLabels(strata);
      if (!labels.length) return fail([]);
      rows = [];
      seq = 1;
      for (s = 0; s < labels.length; s++) {
        label = labels[s];
        seed = fnv1a(seedText + "|" + label);
        rand = mulberry32(seed);
        blockNo = 0;
        within = 0;
        while (within < n) {
          size = blockSizes[Math.floor(rand() * blockSizes.length)];
          blockNo += 1;
          slots = fillBlock(arms, ratio, size, rand);
          for (k = 0; k < slots.length; k++) {
            within += 1;
            row = {
              seq: seq,
              stratum: label,
              envelope: (s + 1) + "-" + pad3(within),
              block: blockNo,
              blockSize: size,
              arm: slots[k]
            };
            rows.push(row);
            seq += 1;
          }
        }
      }
      lines = ["seq,stratum,envelope,block,block_size,arm"];
      for (i = 0; i < rows.length; i++) {
        row = rows[i];
        lines.push([
          csvCell(row.seq),
          csvCell(row.stratum),
          csvCell(row.envelope),
          csvCell(row.block),
          csvCell(row.blockSize),
          csvCell(row.arm)
        ].join(","));
      }
      return {
        ok: true,
        warnings: [],
        seed: seedText,
        csv: lines.join("\n") + "\n",
        rows: rows
      };
    } catch (errRand) {
      return fail([]);
    }
  }

  var API = { blockList: blockList };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_RESEARCH_RANDOMISE = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
