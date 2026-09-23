/* Deterministic frame renderer for the StewardMD launch film.
 *
 * Same principle as NullMotion's exporter: nothing is recorded in real time. The composition's
 * paused GSAP timeline (window.__timelines.root) is seeked to each frame's exact time and that
 * frame is captured, so no frame is ever dropped and every render is identical.
 *
 *   node test/serve.mjs . 8991 &                     # repo root (film loads repo assets in place)
 *   python3 launch-film/audio/soundtrack.py          # -> launch-film/audio/soundtrack.wav
 *   node launch-film/render/render.mjs               # -> launch-film/out/stewardmd-launch-30s.mp4
 *
 * Options:  --fps 30   --stills 0,3.5,8.2   (PNG stills only, into out/stills/)
 *           --from 0 --to 30 (seconds, for a partial preview)   --out path.mp4
 * Env: BASE (default http://localhost:8991/), FFMPEG (default "ffmpeg"), CHROME (optional).
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? a.concat([[v.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]]) : a), []));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const FPS = +(args.fps || 30);
const URL = BASE + "launch-film/film/index.html";

const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__filmReady === true, null, { timeout: 60000 });
const duration = await page.evaluate(() => window.__timelines.root.duration());
const seek = (t) => page.evaluate((t) => { window.__timelines.root.seek(t, false); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }, t);

if (args.stills) {
  const dir = join(ROOT, "out", "stills"); mkdirSync(dir, { recursive: true });
  for (const t of String(args.stills).split(",").map(Number)) {
    await seek(t);
    await page.screenshot({ path: join(dir, `t${t.toFixed(2).padStart(5, "0")}.png`) });
  }
  console.log("stills ->", dir);
  await browser.close();
  process.exit(0);
}

const from = +(args.from || 0), to = Math.min(+(args.to || duration), 30);
const frames = Math.round((to - from) * FPS);
const out = args.out || join(ROOT, "out", "stewardmd-launch-30s.mp4");
const audio = join(ROOT, "audio", "soundtrack.wav");
mkdirSync(dirname(out), { recursive: true });

const ff = [
  "-y", "-hide_banner", "-loglevel", "error",
  "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
  ...(existsSync(audio) ? ["-ss", String(from), "-t", String(to - from), "-i", audio] : []),
  "-c:v", "libx264", "-preset", "slow", "-crf", String(args.crf || 16), "-tune", "animation",
  "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
  "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
  "-x264-params", "keyint=" + FPS + ":min-keyint=" + FPS,
  "-r", String(FPS), "-frames:v", String(frames),
  ...(existsSync(audio) ? ["-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest"] : []),
  "-movflags", "+faststart", out
];
const enc = spawn(FFMPEG, ff, { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((res, rej) => enc.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg exit " + c)))));

const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  await seek(from + i / FPS);
  const buf = await page.screenshot({ type: "png" });
  if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once("drain", r));
  if (i % 60 === 0) process.stdout.write(`frame ${i}/${frames}  ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}
enc.stdin.end();
await done;
await browser.close();
console.log("wrote", out, frames, "frames @", FPS, "fps");
