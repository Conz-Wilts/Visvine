import { contextBridge } from "electron";

/**
 * The only bridge into the renderer. Deliberately tiny and read-only: the web
 * app can detect that it runs inside the desktop shell and adapt, nothing more.
 * (Sandboxed preloads get a trimmed `process`; the version rides in on argv via
 * `webPreferences.additionalArguments`.)
 */
const version =
  process.argv.find((a) => a.startsWith("--visvine-desktop-version="))?.split("=")[1] ?? "0.0.0";

contextBridge.exposeInMainWorld("visvineDesktop", {
  isDesktop: true,
  platform: process.platform,
  version,
});
