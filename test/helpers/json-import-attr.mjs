// Functions import JSON bare (Cloudflare's esbuild bundles it); Node needs the attribute, so tests add it on resolve.
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });
