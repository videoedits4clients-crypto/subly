// Preload script — runs in an isolated context with access to Node APIs,
// bridging ONLY the minimum surface the renderer needs (desktop spec
// section 3: contextIsolation on, nodeIntegration off, no arbitrary
// filesystem access exposed). The app's actual functionality (upload,
// transcribe, edit, export) all goes through the existing HTTP API routes
// served by the local Next server — this bridge is intentionally small.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("subly", {
  isDesktop: true,
});
