import fs from "node:fs";
import path from "node:path";

export type WindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
};

const FILE = "window-state.json";
const DEFAULT_WINDOW_STATE: WindowState = { width: 1360, height: 860 };

export function loadWindowState(userDataDir: string): WindowState {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(userDataDir, FILE), "utf8")) as Partial<WindowState>;
    if (typeof raw.width !== "number" || typeof raw.height !== "number") return DEFAULT_WINDOW_STATE;
    return { ...DEFAULT_WINDOW_STATE, ...raw };
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}

export function saveWindowState(userDataDir: string, state: WindowState): void {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, FILE), JSON.stringify(state));
  } catch {
    // Best effort — losing window bounds is not worth crashing over.
  }
}
