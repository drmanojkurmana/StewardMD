"use strict";

const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { safeResolve, isAllowedExternalUrl } = require("./security.cjs");

const APP_SCHEME = "stewardmd";
const APP_HOST = "app";
const API_ORIGIN = "https://stewardmd.in";
const APP_ROOT = path.join(app.getAppPath(), "app");
const MAX_FILE_BYTES = 100 * 1024 * 1024;

protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true
  }
}]);

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".gz": "application/gzip"
  })[ext] || "application/octet-stream";
}

async function serveLocalAsset(url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return new Response("Bad request", { status: 400 }); }
  if (pathname === "/") pathname = "/index.html";
  const filePath = safeResolve(APP_ROOT, pathname);
  if (!filePath) return new Response("Not found", { status: 404 });
  let stat;
  try { stat = await fs.stat(filePath); }
  catch { return new Response("Not found", { status: 404 }); }
  const resolved = stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
  try {
    const body = await fs.readFile(resolved);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": mimeType(resolved),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": /\\.(html|js|mjs|css)$/.test(resolved) ? "no-cache" : "public, max-age=86400"
      }
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function proxyApiRequest(request, url) {
  const target = new URL(url.pathname + url.search, API_ORIGIN);
  const headers = new Headers(request.headers);
  for (const key of ["host", "origin", "referer", "content-length", "connection", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"]) {
    headers.delete(key);
  }
  headers.set("Origin", API_ORIGIN);
  headers.set("Referer", API_ORIGIN + "/");
  const init = { method: request.method, headers, redirect: "follow" };
  if (!["GET", "HEAD"].includes(request.method)) init.body = Buffer.from(await request.arrayBuffer());
  try {
    return await net.fetch(target.toString(), init);
  } catch {
    return new Response(JSON.stringify({ error: "api_unavailable", message: "StewardMD service is temporarily unavailable." }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
}

async function handleAppProtocol(request) {
  const url = new URL(request.url);
  if (url.hostname !== APP_HOST) return new Response("Not found", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return proxyApiRequest(request, url);
    return new Response("Method not allowed", { status: 405 });
  }
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return proxyApiRequest(request, url);
  return serveLocalAsset(url);
}

function trustedSender(event) {
  try {
    const senderUrl = new URL(event.senderFrame.url);
    return senderUrl.protocol === APP_SCHEME + ":" && senderUrl.hostname === APP_HOST;
  } catch {
    return false;
  }
}

function registerIpc() {
  ipcMain.handle("smd:pick-files", async (event, options = {}) => {
    if (!trustedSender(event)) throw new Error("Untrusted IPC sender");
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: Array.isArray(options.filters) ? options.filters.slice(0, 12) : undefined
    });
    if (result.canceled) return [];
    const files = [];
    for (const filePath of result.filePaths) {
      const stat = await fs.stat(filePath);
      if (stat.size > MAX_FILE_BYTES) throw new Error("Selected file exceeds the 100 MB desktop import limit");
      const data = await fs.readFile(filePath);
      files.push({
        name: path.basename(filePath),
        path: filePath,
        size: stat.size,
        dataBase64: data.toString("base64")
      });
    }
    return files;
  });

  ipcMain.handle("smd:save-file", async (event, payload = {}) => {
    if (!trustedSender(event)) throw new Error("Untrusted IPC sender");
    if (typeof payload.dataBase64 !== "string" || payload.dataBase64.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 8) {
      throw new Error("Invalid or oversized file payload");
    }
    const name = path.basename(String(payload.name || "stewardmd-export").replace(/[\\/]/g, "_"));
    const result = await dialog.showSaveDialog({
      defaultPath: name,
      filters: Array.isArray(payload.filters) ? payload.filters.slice(0, 12) : undefined
    });
    if (result.canceled || !result.filePath) return { saved: false };
    const data = Buffer.from(payload.dataBase64, "base64");
    if (data.length > MAX_FILE_BYTES) throw new Error("Export exceeds the 100 MB desktop limit");
    await fs.writeFile(result.filePath, data, { flag: "wx" }).catch(async (error) => {
      if (error.code !== "EEXIST") throw error;
      await fs.writeFile(result.filePath, data);
    });
    return { saved: true, name: path.basename(result.filePath) };
  });

  ipcMain.handle("smd:open-external", async (event, rawUrl) => {
    if (!trustedSender(event)) throw new Error("Untrusted IPC sender");
    if (!isAllowedExternalUrl(rawUrl)) throw new Error("Only HTTPS external links are allowed");
    await shell.openExternal(rawUrl);
    return { opened: true };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "StewardMD",
    backgroundColor: "#0d1b26",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, targetUrl) => {
    try {
      const target = new URL(targetUrl);
      if (target.protocol !== APP_SCHEME + ":" || target.hostname !== APP_HOST) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  win.loadURL(APP_SCHEME + "://" + APP_HOST + "/index.html");
}

app.whenReady().then(() => {
  protocol.handle(APP_SCHEME, handleAppProtocol);
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
