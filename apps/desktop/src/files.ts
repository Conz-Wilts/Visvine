import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain, session, shell, type DownloadItem } from "electron";
import { appPathUrl, isSameApp } from "./urls";
import { cachePathFor, clearCache, dispositionFileName, freePath, isResourceId, pruneCache } from "./resource-cache";

/**
 * Opening a resource in the computer's own app — Preview, Word, Numbers — or
 * in Quick Look on macOS. The renderer names a resource id and nothing else:
 * the bytes come from the app's own gated door (`/api/resources/<id>/raw`),
 * fetched with the window's session so the server asks the same question it
 * asks the browser, and land in the cache under a path built and checked here
 * (src/resource-cache.ts). A file already in the cache is opened as it is —
 * a resource's bytes never change under its id.
 */

type OpenResult = { ok: true } | { ok: false; error: string };

async function fetchToCache(appUrl: string, userData: string, resourceId: string): Promise<{ file: string; name: string }> {
  const dir = path.dirname(cachePathFor(userData, resourceId, "x"));
  const cached = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => !f.endsWith(".part")) : undefined;
  if (cached) {
    const file = cachePathFor(userData, resourceId, cached);
    const now = new Date();
    fs.utimesSync(file, now, now);
    return { file, name: cached };
  }
  const res = await session.defaultSession.fetch(appPathUrl(appUrl, `/api/resources/${resourceId}/raw?download=1`));
  if (!res.ok) throw new Error(res.status === 404 ? "This file is not available to you." : `Download failed (${res.status}).`);
  const name = dispositionFileName(res.headers.get("content-disposition")) ?? resourceId;
  const file = cachePathFor(userData, resourceId, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Written beside its final name and moved into place, so a download cut off
  // halfway is never mistaken for the file on the next open.
  const part = `${file}.part`;
  fs.writeFileSync(part, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(part, file);
  pruneCache(userData);
  return { file, name: path.basename(file) };
}

export function registerFileIpc(appUrl: string, userData: string, fromApp: (event: Electron.IpcMainInvokeEvent) => boolean) {
  const guarded = (work: (event: Electron.IpcMainInvokeEvent, id: string) => Promise<OpenResult>) =>
    async (event: Electron.IpcMainInvokeEvent, id: unknown): Promise<OpenResult> => {
      if (!fromApp(event) || !isResourceId(id)) return { ok: false, error: "Refused." };
      try {
        return await work(event, id);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Could not open it." };
      }
    };

  ipcMain.handle(
    "files:open",
    guarded(async (_event, id) => {
      const { file } = await fetchToCache(appUrl, userData, id);
      const error = await shell.openPath(file);
      return error ? { ok: false, error } : { ok: true };
    }),
  );

  ipcMain.handle(
    "files:quickLook",
    guarded(async (event, id) => {
      const { file, name } = await fetchToCache(appUrl, userData, id);
      const win = BrowserWindow.fromWebContents(event.sender);
      if (process.platform === "darwin" && win) {
        win.previewFile(file, name);
        return { ok: true };
      }
      const error = await shell.openPath(file);
      return error ? { ok: false, error } : { ok: true };
    }),
  );
}

/**
 * A download the page starts (Download on a resource, any `download` link)
 * goes straight to the Downloads folder under its own name, never over a file
 * already there, and shows on the Dock's Downloads stack when it lands. Only
 * the app's own pages may download: one from any other page is cancelled.
 */
export function handleDownloads(appUrl: string) {
  session.defaultSession.on("will-download", (_event, item: DownloadItem, contents) => {
    if (!contents || !isSameApp(contents.getURL(), appUrl)) {
      item.cancel();
      return;
    }
    const target = freePath(app.getPath("downloads"), item.getFilename());
    item.setSavePath(target);
    item.once("done", (_e, state) => {
      if (state === "completed" && process.platform === "darwin") app.dock?.downloadFinished(target);
    });
  });
}

/** Signing out takes the files opened as that person with it. */
export function clearResourceCache(userData: string) {
  clearCache(userData);
}
