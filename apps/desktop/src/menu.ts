import { app, BrowserWindow, Menu, MenuItemConstructorOptions, shell } from "electron";
import { appPathUrl } from "./urls";

export function buildMenu(opts: { appUrl: string; getWindow: () => BrowserWindow | null }): Menu {
  const isMac = process.platform === "darwin";
  const win = () => opts.getWindow();

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Home",
          accelerator: "CmdOrCtrl+Shift+H",
          click: () => win()?.loadURL(appPathUrl(opts.appUrl, "/home")),
        },
        {
          label: "Open in Browser",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => {
            const url = win()?.webContents.getURL();
            if (url && /^https?:/.test(url)) void shell.openExternal(url);
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        {
          label: "Back",
          accelerator: isMac ? "Cmd+[" : "Alt+Left",
          click: () => {
            const w = win();
            if (w?.webContents.navigationHistory.canGoBack()) w.webContents.navigationHistory.goBack();
          },
        },
        {
          label: "Forward",
          accelerator: isMac ? "Cmd+]" : "Alt+Right",
          click: () => {
            const w = win();
            if (w?.webContents.navigationHistory.canGoForward()) w.webContents.navigationHistory.goForward();
          },
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Visvine on the web", click: () => void shell.openExternal(opts.appUrl) },
        { label: `Connected to ${opts.appUrl}`, enabled: false },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
