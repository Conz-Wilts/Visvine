import { contextBridge, ipcRenderer } from "electron";

/**
 * The only bridge into the renderer. The web app can detect that it runs
 * inside the desktop shell, and reach the local runtimes — the member's own
 * Claude Code or Codex on this machine (src/runtimes). Nothing here returns a
 * credential: `list` says whether a binary is signed in, `login` opens the
 * binary's own sign-in in a terminal, `run` streams what the binary says.
 * (Sandboxed preloads get a trimmed `process`; the version rides in on argv
 * via `webPreferences.additionalArguments`.)
 */
const version =
  process.argv.find((a) => a.startsWith("--visvine-desktop-version="))?.split("=")[1] ?? "0.0.0";

type RunEventListener = (payload: { runId: string; event: unknown }) => void;

contextBridge.exposeInMainWorld("visvineDesktop", {
  isDesktop: true,
  platform: process.platform,
  version,
  /** Stand the macOS traffic lights at (x, y) points from the window's corner. */
  setWindowControls: (position: { x: number; y: number }) => ipcRenderer.send("window:controls", position),
  runtimes: {
    list: () => ipcRenderer.invoke("runtimes:list"),
    login: (id: string) => ipcRenderer.invoke("runtimes:login", id),
    run: (input: unknown) => ipcRenderer.invoke("runtimes:run", input),
    cancel: (runId: string) => ipcRenderer.invoke("runtimes:cancel", runId),
    onEvent: (listener: RunEventListener) => {
      const wrapped = (_e: unknown, payload: { runId: string; event: unknown }) => listener(payload);
      ipcRenderer.on("runtimes:event", wrapped);
      return () => ipcRenderer.removeListener("runtimes:event", wrapped);
    },
  },
});
