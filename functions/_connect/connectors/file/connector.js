// functions/_connect/connectors/file/connector.js — file/CSV ingest event-profile connector.
import { parseDelimited } from "./csv.js";
import { normalizeCsvLab } from "./normalize.js";

export const fileConnector = {
  meta: { id: "file", name: "File/CSV lab feed", version: "1.0", profile: "event", kinds: ["file-csv"], sccmVersion: "1.0" },
  authenticate: async () => ({ ok: true }),                    // auth handled by the HMAC-gated spine
  validate: async () => ({ ok: true, checks: [{ name: "csv", ok: true }] }),
  initiate: async () => ({ handle: null }),
  normalize: async (ctx, parsed) => normalizeCsvLab(ctx, parsed),
  ingest: async (ctx, rawEvent) => {
    const opts = {};
    try { const cfg = typeof ctx.config.config === "string" ? JSON.parse(ctx.config.config) : ctx.config.config; if (cfg && cfg.delimiter) opts.delimiter = cfg.delimiter; } catch (e) {}
    const parsed = parseDelimited((rawEvent && rawEvent.rawBody) || "", opts);
    const bundle = normalizeCsvLab(ctx, parsed);
    return { handle: { type: "file", rows: (parsed.rows || []).length }, bundle };
  },
};
