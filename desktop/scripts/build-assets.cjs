"use strict";

// Keep the root PWA and Capacitor build pipeline as the single source of truth.
// This script only copies the already-supported www/ output into the desktop package.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..");
const bash = process.platform === "win32" ? "bash.exe" : "bash";
const build = spawnSync(bash, [path.join(repoRoot, "scripts", "build-www.sh")], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32"
});
if (build.error || build.status !== 0) {
  console.error("StewardMD web asset build failed. On Windows, install Git for Windows and ensure Git Bash is on PATH.");
  process.exit(build.status || 1);
}

const source = path.join(repoRoot, "www");
const target = path.join(desktopDir, "app");
if (!fs.existsSync(path.join(source, "index.html"))) {
  console.error("Expected www/index.html was not generated.");
  process.exit(1);
}
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true, dereference: true });
console.log("Desktop assets copied from the existing PWA build into desktop/app.");
