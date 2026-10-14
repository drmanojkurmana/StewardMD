/* _prep-kb.js - Server-side KB & protocol retrieval for PrepNucleus Ask MaiK
 * Fetches and extracts high-yield clinical facts, numeric criteria, guidelines, and dosing
 * from StewardMD Knowledge Base articles and Standard Protocols to ground Ask MaiK answers.
 */
// No static node: imports: Cloudflare Workers reject the bundle ("No such module node:fs").
// Node (tests, dev server) gets fs through process.getBuiltinModule; Workers use env.ASSETS only.
const nodeFs = () => globalThis.process?.getBuiltinModule?.("node:fs") || null;
const join = (...p) => p.join("/").replace(/\/{2,}/g, "/");
const cwd = () => globalThis.process?.cwd?.() || "";

export const KB_DIRS = [
  "kb/reference",
  "kb/diseases",
  "kb/protocols",
  "kb/clinical-protocols",
  "kb/treatments",
  "kb/onco/staging",
];

const ONCO_PROTOCOL_MAP = {
  "gestational_trophoblastic_neoplasia": ["gyn-gtn-methotrexate", "gyn-gtn-emaco"],
  "kb-gestational-trophoblastic-neoplasia": ["gyn-gtn-methotrexate", "gyn-gtn-emaco"],
  "hydatidiform_mole": ["gyn-gtn-methotrexate"],
  "kb-hydatidiform-mole": ["gyn-gtn-methotrexate"],
  "choriocarcinoma": ["gyn-gtn-methotrexate", "gyn-gtn-emaco"],
  "kb-choriocarcinoma": ["gyn-gtn-methotrexate", "gyn-gtn-emaco"],
};

export function cleanSlug(id) {
  return String(id || "")
    .replace(/^kb-/, "")
    .toLowerCase()
    .trim();
}

export function candidateFilenames(slug) {
  const s = cleanSlug(slug);
  if (!s) return [];
  const cands = [s + ".json"];
  const under = s.replace(/-/g, "_") + ".json";
  if (under !== cands[0]) cands.push(under);
  const dash = s.replace(/_/g, "-") + ".json";
  if (!cands.includes(dash)) cands.push(dash);
  return cands;
}

export function findKbPathSync(id, rootDir = cwd()) {
  const cands = candidateFilenames(id);
  for (const dir of KB_DIRS) {
    for (const c of cands) {
      const p = join(rootDir, dir, c);
      if (nodeFs()?.existsSync(p)) return join(dir, c);
    }
  }
  return null;
}

export function loadKbJsonSync(id, rootDir = cwd()) {
  const rel = findKbPathSync(id, rootDir);
  if (!rel) return null;
  try {
    return JSON.parse(nodeFs().readFileSync(join(rootDir, rel), "utf8"));
  } catch (e) {
    return null;
  }
}

export async function loadKbJsonAsync(env, id, rootDir = cwd()) {
  // 1. Try env.ASSETS (Cloudflare Pages Functions runtime)
  if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
    const cands = candidateFilenames(id);
    for (const dir of KB_DIRS) {
      for (const c of cands) {
        const rel = dir + "/" + c;
        try {
          const res = await env.ASSETS.fetch(new Request("https://stewardmd.in/" + rel, { method: "GET" }));
          if (res && res.ok) {
            return await res.json();
          }
        } catch (e) {}
      }
    }
  }

  // 2. Try Node filesystem (tests and dev server)
  return loadKbJsonSync(id, rootDir);
}

export function extractKbText(doc, maxLines = 15) {
  if (!doc || typeof doc !== "object") return "";
  const lines = [];
  const title = doc.name || doc.title || "";
  if (title) lines.push(title);

  const ref = doc.reference || doc.harrison;
  if (ref) {
    if (ref.source) lines.push("Source: " + ref.source);
    if (Array.isArray(ref.clinicalPearls)) {
      for (const p of ref.clinicalPearls.slice(0, 6)) {
        if (p) lines.push("- " + p);
      }
    }
    if (Array.isArray(ref.management)) {
      for (const m of ref.management.slice(0, 6)) {
        if (m) lines.push("- " + m);
      }
    }
    if (ref.pathophysiology) {
      lines.push("Pathophysiology: " + String(ref.pathophysiology).slice(0, 300));
    }
    if (Array.isArray(ref.redFlags)) {
      for (const rf of ref.redFlags.slice(0, 3)) {
        if (rf) lines.push("Red flag: " + rf);
      }
    }
  }

  if (Array.isArray(doc.algorithms)) {
    for (const alg of doc.algorithms.slice(0, 2)) {
      if (Array.isArray(alg.steps)) {
        for (const st of alg.steps.slice(0, 4)) {
          if (st && st.action) lines.push("- " + st.action);
        }
      }
    }
  }

  if (doc.biomarkers && doc.biomarkers.note) {
    lines.push("Staging/Criteria note: " + doc.biomarkers.note);
  }

  if (Array.isArray(doc.drugs)) {
    lines.push("Protocol regimens:");
    for (const d of doc.drugs.slice(0, 4)) {
      const parts = [
        d.name,
        d.dosePerUnit && d.unit ? `${d.dosePerUnit} ${d.unit}` : null,
        d.route,
        d.notes,
      ].filter(Boolean);
      lines.push("• " + parts.join(" - "));
    }
  }

  if (Array.isArray(doc.doseModificationRules)) {
    for (const r of doc.doseModificationRules.slice(0, 2)) {
      if (r && r.text) lines.push("Dose rule: " + r.text);
    }
  }

  return lines.slice(0, maxLines).join("\n");
}

export function detectMatchingProtocols(srcPackIds, contextText = "") {
  const out = [];
  const hay = (Array.isArray(srcPackIds) ? srcPackIds.join(" ") : "") + " " + String(contextText || "").toLowerCase();
  for (const [key, protos] of Object.entries(ONCO_PROTOCOL_MAP)) {
    if (hay.includes(key.replace(/_/g, "-")) || hay.includes(key.replace(/-/g, " "))) {
      for (const p of protos) {
        if (!out.includes(p)) out.push(p);
      }
    }
  }
  return out;
}

export function detectInferredKbIds(contextText = "") {
  const hay = String(contextText || "").toLowerCase();
  const out = [];
  if (/gestational trophoblastic|trophoblastic neoplasia|gtn\b|hydatidiform mole|choriocarcinoma/i.test(hay)) {
    out.push("kb-gestational-trophoblastic-neoplasia", "kb-hydatidiform-mole");
  }
  return out;
}

export function formatGroundingSections(docs, kp) {
  const sections = [];
  if (kp && typeof kp === "string" && kp.trim()) {
    sections.push("• Exam pearl / Key point: " + kp.trim());
  }
  for (const item of docs) {
    if (!item || !item.text) continue;
    sections.push("• " + item.text);
  }
  if (!sections.length) return "";
  return sections.join("\n\n").slice(0, 3200);
}

export function resolveKbSync(srcPack, kp, contextText = "", rootDir = cwd()) {
  const ids = Array.isArray(srcPack) ? srcPack.map((x) => (typeof x === "string" ? x : (x && x.id) || "")).filter(Boolean) : [];
  if (!ids.length) {
    ids.push(...detectInferredKbIds(contextText));
  }
  const oncoProtos = detectMatchingProtocols(ids, contextText);
  for (const p of oncoProtos) {
    if (!ids.includes(p) && !ids.includes("kb-" + p)) ids.push(p);
  }

  const docs = [];
  const seen = new Set();
  for (const id of ids) {
    const slug = cleanSlug(id);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const json = loadKbJsonSync(slug, rootDir);
    if (json) {
      const text = extractKbText(json);
      if (text) docs.push({ id: slug, text });
    }
  }
  return formatGroundingSections(docs, kp);
}

export async function fetchKbGrounding(env, srcPack, kp, contextText = "", rootDir = cwd()) {
  const ids = Array.isArray(srcPack) ? srcPack.map((x) => (typeof x === "string" ? x : (x && x.id) || "")).filter(Boolean) : [];
  if (!ids.length) {
    ids.push(...detectInferredKbIds(contextText));
  }
  const oncoProtos = detectMatchingProtocols(ids, contextText);
  for (const p of oncoProtos) {
    if (!ids.includes(p) && !ids.includes("kb-" + p)) ids.push(p);
  }

  const docs = [];
  const seen = new Set();
  for (const id of ids) {
    const slug = cleanSlug(id);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const json = await loadKbJsonAsync(env, slug, rootDir);
    if (json) {
      const text = extractKbText(json);
      if (text) docs.push({ id: slug, text });
    }
  }
  return formatGroundingSections(docs, kp);
}
