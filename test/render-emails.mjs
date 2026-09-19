/* Render every email to HTML (and, with CHROME set, to a full-page PNG) so a human can look at them.
 *
 *   OUT=/tmp/emails CHROME=/path/to/chrome node test/render-emails.mjs
 *
 * Writes <OUT>/<kind>.html and <OUT>/<kind>.png. No network: sendBranded is captured.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import * as E from "../functions/_email.js";
import { PROMO_EDITIONS } from "../functions/_promo.js";
import { buildPreview } from "../functions/api/email-preview.js";

const OUT = process.env.OUT || join(process.env.CLAUDE_JOB_DIR || "/tmp", "emails");
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || process.env.CHROME_BIN || "";
const kinds = ["welcome", "upsell", "verified", "reminder", "failed", "pro", "otp", "reset", "temp", "alert"].concat(PROMO_EDITIONS.map((e) => "promo:" + e));
const width = +(process.env.WIDTH || 640);

for (const k of kinds) {
  const o = await buildPreview({}, k, { name: "Asha Rao" });
  const html = E.renderEmail(Object.assign({}, o, { unsub: o.kind === "marketing" ? "https://stewardmd.in/api/unsubscribe?t=preview" : "" }));
  const base = join(OUT, k.replace(":", "-"));
  writeFileSync(base + ".html", html);
  if (CHROME) {
    const r = spawnSync(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${width},2600`, `--screenshot=${base}.png`, "file://" + base + ".html"], { stdio: "ignore" });
    console.log((r.status === 0 ? "png " : "html ") + base);
  } else console.log("html " + base);
}
