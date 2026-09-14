/* bench/icu-monitor/pixsource.mjs — { w, h, get(x, y) } over an image file, via pixels.py. */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function pixelSource(imagePath) {
  const dir = mkdtempSync(join(tmpdir(), "smd-px-"));
  const raw = join(dir, "px.rgb");
  const dims = execFileSync("python3", [new URL("./pixels.py", import.meta.url).pathname, imagePath, raw], { encoding: "utf8" }).trim().split(/\s+/).map(Number);
  const buf = readFileSync(raw);
  rmSync(dir, { recursive: true, force: true });
  const [w, h] = dims;
  return { w, h, get(x, y) { if (x < 0 || y < 0 || x >= w || y >= h) return null; const i = (y * w + x) * 3; return [buf[i], buf[i + 1], buf[i + 2]]; } };
}
