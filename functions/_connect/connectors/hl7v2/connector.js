// functions/_connect/connectors/hl7v2/connector.js — HL7 v2 event-profile connector.
// Auth is the ingest spine's HMAC (no per-connector auth). ingest = parse -> normalize; never throws on a
// malformed message (parser + normalizer degrade with warnings).
import { parseHl7, seg, comp, field } from "./parser.js";
import { normalizeHl7 } from "./normalize.js";

function hashId(s) { let h = 5381; const str = String(s || ""); for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return "h" + h.toString(16); }

export const hl7v2Connector = {
  meta: { id: "hl7v2", name: "HL7 v2 (event)", version: "1.0", profile: "event", kinds: ["hl7v2"], sccmVersion: "1.0" },
  authenticate: async () => ({ ok: true }),                    // auth handled by the HMAC-gated spine
  validate: async () => ({ ok: true, checks: [{ name: "parser", ok: true }] }),
  initiate: async () => ({ handle: null }),                    // n/a for HL7
  normalize: async (ctx, msg) => normalizeHl7(ctx, msg),
  ingest: async (ctx, rawEvent) => {
    const msg = parseHl7((rawEvent && rawEvent.rawBody) || "", { budget: ctx.budget });
    const bundle = normalizeHl7(ctx, msg);
    const msh = seg(msg, "MSH");
    return { handle: { type: "hl7", msgType: comp(msh, 9, 0, msg.encoding), msgIdHash: hashId(field(msh, 10)) }, bundle };
  },
};
