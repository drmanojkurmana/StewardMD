"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("SMD_DESKTOP", Object.freeze({
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,
  pickFiles: (options) => ipcRenderer.invoke("smd:pick-files", options || {}),
  saveFile: (payload) => ipcRenderer.invoke("smd:save-file", payload || {}),
  openExternal: (url) => ipcRenderer.invoke("smd:open-external", url)
}));
