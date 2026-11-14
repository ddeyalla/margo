// Runs in the page before it loads. It gives the page one small, fixed API and nothing else.
// With sandbox on, a preload may only use `electron`, which is all this needs.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("riggApp", {
  isApp: true,
  /** Opens the native folder picker. Resolves to the chosen path, or null if cancelled. */
  pickFolder: () => ipcRenderer.invoke("rigg:pick-folder"),
});
