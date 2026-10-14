#!/usr/bin/env node
/**
 * tools/build-cancer-protocol-map.mjs
 *
 * Generates the bidirectional mapping table between Knowledge Library cancer disease articles
 * and Oncology treatment protocols:
 * 1. kb/cancer-mapping.json
 * 2. cancer-protocols-map.js (ES5 IIFE for client & node runtime)
 *
 * Grounded in:
 * - 304 Oncology protocols (kb/protocols/*.json)
 * - 65 ONCOTREE navigators (kb/oncotree/*.json)
 * - kb/cancer-mapping-overrides.json
 * - Knowledge Library disease articles (kb/diseases/ and kb/reference/)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Regimen one-liner formatter
export function formatDays(days) {
  if (!days || !days.length) return "";
  if (days.length === 1) return "D" + days[0];
  const sorted = [...days].sort((a, b) => a - b);
  let isConsecutive = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) { isConsecutive = false; break; }
  }
  if (isConsecutive && sorted.length > 2) return "D" + sorted[0] + "-" + sorted[sorted.length - 1];
  return "D" + sorted.join(",");
}

export function formatDrug(d) {
  const name = d.name || d.id || "";
  let doseStr = "";
  if (d.unit && String(d.unit).toLowerCase() === "auc") {
    doseStr = "AUC " + (d.dosePerUnit != null ? d.dosePerUnit : "");
  } else if (d.dosePerUnit != null) {
    doseStr = d.dosePerUnit + (d.unit ? " " + d.unit : "");
  }
  const route = (d.route || "IV").split(" ")[0];
  const daysStr = formatDays(d.days);
  return [name, doseStr, route, daysStr].filter(Boolean).join(" ");
}

export function formatRegimen(p) {
  const drugs = (p.drugs || []).map(formatDrug);
  let cycleInfo = "";
  if (p.cycleLengthDays) {
    cycleInfo = "q" + p.cycleLengthDays + "d";
    if (p.cycles) cycleInfo += " x " + p.cycles;
    cycleInfo = " (" + cycleInfo + ")";
  }
  return drugs.join(" + ") + cycleInfo;
}

export function deriveSetting(pathStr, section, title, p) {
  const combined = ((pathStr || "") + " " + (section || "") + " " + (title || "")).toLowerCase();
  if (/neuroendocrine|small[- ]cell/.test(combined)) return "Neuroendocrine / Small Cell";
  if (/chemoradiation|chemo[- ]?rt|radiosensitiz|concurrent/.test(combined)) return "Concurrent Chemoradiation";
  if (/neoadjuvant|preoperative/.test(combined)) return "Neoadjuvant";
  if (/adjuvant/.test(combined)) return "Adjuvant";
  if (/maintenance/.test(combined)) return "Maintenance";
  if (/\b1l\b|first[- ]line/.test(combined)) return "First-line Systemic";
  if (/\b2l\b|second[- ]line|relapse|refractory|salvage|later/.test(combined)) return "Second-line / Relapsed";
  if (/metastatic|recurren|advanced|palliative/.test(combined)) return "Recurrent / Metastatic";
  if (/definitive|locoregional/.test(combined)) return "Definitive / Locoregional";
  if (/induction/.test(combined)) return "Induction";
  if (/consolidation/.test(combined)) return "Consolidation";

  const pSet = Array.isArray(p.treatmentSetting) ? p.treatmentSetting.join(" ") : String(p.treatmentSetting || "");
  const pLower = pSet.toLowerCase();
  if (/neuroendocrine|small[- ]cell/.test(pLower)) return "Neuroendocrine / Small Cell";
  if (/chemoradiation|concurrent/.test(pLower)) return "Concurrent Chemoradiation";
  if (/neoadjuvant/.test(pLower)) return "Neoadjuvant";
  if (/adjuvant/.test(pLower)) return "Adjuvant";
  if (/maintenance/.test(pLower)) return "Maintenance";
  if (/first[- ]line/.test(pLower)) return "First-line Systemic";
  if (/second[- ]line|salvage/.test(pLower)) return "Second-line / Relapsed";
  if (/metastatic|recurrent/.test(pLower)) return "Recurrent / Metastatic";
  if (/induction/.test(pLower)) return "Induction";
  if (/consolidation/.test(pLower)) return "Consolidation";

  return "Systemic Therapy";
}

export function loadAllData(root = ROOT) {
  // Load KB articles
  const kb = new Map();
  for (const dir of ["kb/diseases", "kb/reference"]) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full).filter((x) => x.endsWith(".json"))) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(full, f), "utf8"));
        const id = f.replace(/\.json$/, "");
        kb.set(id, {
          id,
          title: d.title || d.name || id.replace(/_/g, " "),
          dir
        });
      } catch (e) {}
    }
  }

  // Load Protocols
  const protocols = new Map();
  const protoDir = path.join(root, "kb/protocols");
  for (const f of fs.readdirSync(protoDir).filter((x) => x.endsWith(".json") && x !== "index.json")) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(protoDir, f), "utf8"));
      protocols.set(p.id, p);
    } catch (e) {}
  }

  // Load Oncotree Guidelines
  const guidelines = [];
  const otDir = path.join(root, "kb/oncotree");
  if (fs.existsSync(otDir)) {
    for (const f of fs.readdirSync(otDir).filter((x) => x.endsWith(".json"))) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(otDir, f), "utf8"));
        guidelines.push(d);
      } catch (e) {}
    }
  }

  // Load Overrides
  const overridePath = path.join(root, "kb/cancer-mapping-overrides.json");
  const overrides = fs.existsSync(overridePath) ? JSON.parse(fs.readFileSync(overridePath, "utf8")) : { diseaseAliases: {}, protocolOverrides: {} };

  return { kb, protocols, guidelines, overrides };
}

export function buildCancerProtocolMap(data = loadAllData()) {
  const { kb, protocols, guidelines, overrides } = data;
  const aliases = overrides.diseaseAliases || {};
  const protoOverrides = overrides.protocolOverrides || {};

  // Map guideline -> KB article IDs
  const guidelineToArticles = new Map();
  for (const g of guidelines) {
    const arts = new Set();
    const directId = g.diseaseId;
    if (kb.has(directId)) arts.add(directId);
    if (aliases[directId]) {
      for (const a of aliases[directId]) if (kb.has(a)) arts.add(a);
    }
    if (aliases[g.guideline]) {
      for (const a of aliases[g.guideline]) if (kb.has(a)) arts.add(a);
    }
    guidelineToArticles.set(g.guideline, Array.from(arts));
  }

  // Collect protocols per cancer article
  // Map<articleId, Map<protoId, { id, name, regimen, settings: Set, intent }>>
  const articleProtocols = new Map();
  const getArticleBucket = (artId) => {
    if (!articleProtocols.has(artId)) articleProtocols.set(artId, new Map());
    return articleProtocols.get(artId);
  };

  // 1. Process Oncotree guidelines
  for (const g of guidelines) {
    const targetArticles = guidelineToArticles.get(g.guideline) || [];
    if (!targetArticles.length) continue;

    if (g.nodes) {
      for (const n of g.nodes) {
        if (!n.protocolRefs || !n.protocolRefs.length) continue;
        for (const prId of n.protocolRefs) {
          const proto = protocols.get(prId);
          if (!proto) continue;

          for (const artId of targetArticles) {
            const bucket = getArticleBucket(artId);
            let entry = bucket.get(prId);
            if (!entry) {
              entry = {
                id: prId,
                name: proto.name || prId,
                regimen: formatRegimen(proto),
                settings: new Set(),
                intent: proto.intentOptions || []
              };
              bucket.set(prId, entry);
            }
            const s = deriveSetting(n.path, n.section, n.title, proto);
            entry.settings.add(s);
          }
        }
      }
    }
  }

  // 2. Process protocols by diseaseId fallback (if not already mapped via oncotree)
  for (const [prId, proto] of protocols) {
    const directDisease = proto.diseaseId;
    let targetArticles = [];
    if (directDisease && kb.has(directDisease)) targetArticles.push(directDisease);
    if (directDisease && aliases[directDisease]) {
      for (const a of aliases[directDisease]) if (kb.has(a)) targetArticles.push(a);
    }
    for (const artId of targetArticles) {
      const bucket = getArticleBucket(artId);
      if (!bucket.has(prId)) {
        const s = deriveSetting("", "", "", proto);
        bucket.set(prId, {
          id: prId,
          name: proto.name || prId,
          regimen: formatRegimen(proto),
          settings: new Set([s]),
          intent: proto.intentOptions || []
        });
      }
    }
  }

  // 3. Apply protocol overrides
  for (const [prId, ov] of Object.entries(protoOverrides)) {
    const proto = protocols.get(prId);
    if (!proto) continue;
    const targetArticles = ov.articles || [];
    const customSettings = ov.settings || [];

    for (const artId of targetArticles) {
      if (!kb.has(artId)) continue;
      const bucket = getArticleBucket(artId);
      let entry = bucket.get(prId);
      if (!entry) {
        entry = {
          id: prId,
          name: proto.name || prId,
          regimen: formatRegimen(proto),
          settings: new Set(),
          intent: proto.intentOptions || []
        };
        bucket.set(prId, entry);
      }
      if (customSettings.length) {
        // If specific settings override is provided, use it
        entry.settings = new Set(customSettings);
      }
    }
  }

  // 4. Canonical setting order
  const SETTING_ORDER = [
    "Neoadjuvant",
    "Adjuvant",
    "Concurrent Chemoradiation",
    "Definitive / Locoregional",
    "First-line Systemic",
    "Second-line / Relapsed",
    "Recurrent / Metastatic",
    "Maintenance",
    "Induction",
    "Consolidation",
    "Neuroendocrine / Small Cell",
    "Systemic Therapy"
  ];

  // Assemble final articles map
  const articlesOut = {};
  const protocolsToArticles = {};

  for (const [artId, protoMap] of articleProtocols) {
    if (!protoMap.size) continue;
    const kbInfo = kb.get(artId) || { id: artId, title: artId };

    const protoList = [];
    const allSettingsSet = new Set();

    for (const [prId, entry] of protoMap) {
      const settingsArr = Array.from(entry.settings).sort((a, b) => {
        const ia = SETTING_ORDER.indexOf(a);
        const ib = SETTING_ORDER.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });
      settingsArr.forEach((s) => allSettingsSet.add(s));

      protoList.push({
        id: entry.id,
        name: entry.name,
        regimen: entry.regimen,
        settings: settingsArr,
        intent: entry.intent
      });

      // Reverse map
      if (!protocolsToArticles[entry.id]) protocolsToArticles[entry.id] = [];
      if (!protocolsToArticles[entry.id].some((x) => x.id === artId)) {
        protocolsToArticles[entry.id].push({ id: artId, title: kbInfo.title });
      }
    }

    // Sort settings according to canonical order
    const sortedSettings = Array.from(allSettingsSet).sort((a, b) => {
      const ia = SETTING_ORDER.indexOf(a);
      const ib = SETTING_ORDER.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    // Sort protocols: by primary setting order, then name
    protoList.sort((a, b) => {
      const sA = a.settings[0] || "";
      const sB = b.settings[0] || "";
      const ia = SETTING_ORDER.indexOf(sA);
      const ib = SETTING_ORDER.indexOf(sB);
      if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.name.localeCompare(b.name);
    });

    articlesOut[artId] = {
      articleId: artId,
      articleTitle: kbInfo.title,
      totalProtocols: protoList.length,
      settings: sortedSettings,
      protocols: protoList
    };
  }

  // Find all cancer articles in KB
  const cancerKws = [
    "cancer", "carcinoma", "sarcoma", "lymphoma", "leukemia", "leukaemia",
    "myeloma", "melanoma", "tumour", "tumor", "neoplasm", "glioma", "blastoma",
    "seminoma", "mesothelioma", "teratoma", "pheochromocytoma", "neuroblastoma", "malignan"
  ];
  const allCancerArticlesInKb = [];
  const unmappedCancerArticles = [];

  for (const [id, item] of kb) {
    const s = (id + " " + item.title).toLowerCase();
    if (cancerKws.some((kw) => s.includes(kw))) {
      allCancerArticlesInKb.push({ id, title: item.title });
      if (!articlesOut[id]) {
        unmappedCancerArticles.push({ id, title: item.title });
      }
    }
  }

  // Check protocols without articles
  const unmappedProtocols = [];
  for (const [id, proto] of protocols) {
    if (!protocolsToArticles[id] || !protocolsToArticles[id].length) {
      unmappedProtocols.push({ id, name: proto.name, diseaseId: proto.diseaseId });
    }
  }

  return {
    articles: articlesOut,
    protocolsToArticles,
    totalProtocolsInKb: protocols.size,
    articlesWithProtocolsCount: Object.keys(articlesOut).length,
    unmappedProtocols,
    unmappedCancerArticles,
    allCancerArticlesCount: allCancerArticlesInKb.length
  };
}

export function writeMappingOutputs(result, root = ROOT) {
  // 1. JSON output
  const jsonPath = path.join(root, "kb/cancer-mapping.json");
  const jsonContent = JSON.stringify({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    totalProtocols: result.totalProtocolsInKb,
    articlesCount: result.articlesWithProtocolsCount,
    articles: result.articles,
    protocolsToArticles: result.protocolsToArticles
  }, null, 2);
  fs.writeFileSync(jsonPath, jsonContent, "utf8");

  // 2. Client JS bundle (cancer-protocols-map.js)
  const jsPath = path.join(root, "cancer-protocols-map.js");
  const jsContent = `/* StewardMD - Cancer Knowledge Library <-> Oncology Protocols Map.
 * Buildless ES5 IIFE defining window.SMD_ONCO_KB_MAP.
 * Auto-generated by tools/build-cancer-protocol-map.mjs.
 */
(function (root) {
  "use strict";
  var ARTICLES = ${JSON.stringify(result.articles)};
  var REVERSE = ${JSON.stringify(result.protocolsToArticles)};

  var API = {
    get: function (id) {
      if (!id) return null;
      return ARTICLES[id] || null;
    },
    getProtocols: function (id) {
      var a = this.get(id);
      return a ? a.protocols : [];
    },
    getReverse: function (protoId) {
      if (!protoId) return [];
      return REVERSE[protoId] || [];
    },
    isCancer: function (id) {
      return !!ARTICLES[id];
    },
    allArticles: function () {
      return Object.keys(ARTICLES);
    },
    _raw: ARTICLES,
    _reverse: REVERSE,
    _version: "1.0"
  };

  if (root) root.SMD_ONCO_KB_MAP = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
`;
  fs.writeFileSync(jsPath, jsContent, "utf8");

  return { jsonPath, jsPath };
}

// CLI execution
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log("Building Cancer <-> Oncology Protocols map...");
  const result = buildCancerProtocolMap();
  const { jsonPath, jsPath } = writeMappingOutputs(result);

  console.log(`\n=== CANCER PROTOCOLS MAP BUILD COMPLETE ===`);
  console.log(`Total protocols in repo: ${result.totalProtocolsInKb}`);
  console.log(`KB Cancer Articles with protocols: ${result.articlesWithProtocolsCount}`);
  console.log(`Unmapped protocols: ${result.unmappedProtocols.length}`);
  if (result.unmappedProtocols.length) {
    console.log("Unmapped protocols:", result.unmappedProtocols);
  }
  console.log(`Total cancer articles in KB: ${result.allCancerArticlesCount}`);
  console.log(`Cancer articles without protocols: ${result.unmappedCancerArticles.length}`);
  console.log(`Generated JSON: ${jsonPath}`);
  console.log(`Generated JS:   ${jsPath}`);

  // Cervical check
  const cerv = result.articles["cervical_cancer"];
  if (cerv) {
    console.log("\n--- Cervical Cancer Protocols Check ---");
    console.log(`Title: ${cerv.articleTitle}, Total: ${cerv.totalProtocols}`);
    console.log(`Settings (${cerv.settings.length}):`, cerv.settings);
    cerv.protocols.forEach((p) => {
      console.log(`  - [${p.settings.join(", ")}] ${p.name}`);
      console.log(`    Regimen: ${p.regimen}`);
    });
  }
}
