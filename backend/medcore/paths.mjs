/* backend/medcore/paths.mjs — one way to turn a --in or --out argument into a real path.
 *
 * The scripts used to do `join(ROOT, arg)` each for themselves, which quietly does the wrong thing
 * with an absolute path: `join("/home/user/StewardMD", "/tmp/x.json")` is
 * "/home/user/StewardMD/tmp/x.json". Passing --out /tmp/art.json therefore wrote an artifact INTO
 * the repository, at a path nobody asked for, and reported success. Meanwhile synth/generate.mjs
 * wrote to its argument directly and honoured absolute paths, so two scripts in the same pipeline
 * disagreed about what a path meant.
 *
 * A file written somewhere other than where it was asked for is worse than a failure: the failure
 * is visible. So this resolves absolute paths as themselves, relative paths against the repository
 * root, and is the only path logic in the pipeline.
 */
import { isAbsolute, join, dirname } from "node:path";
import { mkdirSync } from "node:fs";

/** @param {string} root repository root @param {string} p a --in / --out argument */
export function resolvePath(root, p) {
  const str = String(p);
  return isAbsolute(str) ? str : join(root, str);
}

/** Resolves an output path and makes sure its directory exists. */
export function resolveOut(root, p) {
  const full = resolvePath(root, p);
  mkdirSync(dirname(full), { recursive: true });
  return full;
}
