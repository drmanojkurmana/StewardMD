"use strict";

const path = require("node:path");

function safeResolve(root, requestPath) {
  const clean = String(requestPath || "").replace(/^\\/+/, "");
  const base = path.resolve(root);
  const candidate = path.resolve(base, clean);
  return candidate === base || candidate.startsWith(base + path.sep) ? candidate : null;
}

function isAllowedExternalUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl));
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

module.exports = { safeResolve, isAllowedExternalUrl };
