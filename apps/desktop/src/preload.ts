import { contextBridge, ipcRenderer } from "electron";

import type { DesktopBridge } from "./contracts";

const bridge: DesktopBridge = {
  chooseRepository: () => ipcRenderer.invoke("desktop:choose-repository"),
  uploadRepository: (selectionId, displayName) =>
    ipcRenderer.invoke("desktop:upload-repository", selectionId, displayName),
  githubStatus: () => ipcRenderer.invoke("desktop:github-status"),
  configureGithubToken: (token) =>
    ipcRenderer.invoke("desktop:configure-github-token", token),
  clearGithubToken: () => ipcRenderer.invoke("desktop:clear-github-token"),
  runtimeInfo: () => ipcRenderer.invoke("desktop:runtime-info"),
};

contextBridge.exposeInMainWorld("engineeringObservatory", bridge);
