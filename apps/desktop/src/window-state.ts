import fs from "node:fs";
import path from "node:path";

export type WindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
  /** Where the page last asked for the traffic lights (macOS). */
  controls?: WindowControls;
};

export type WindowControls = { x: number; y: number };

/**
 * A traffic-light position the page may ask for: whole points, inside the
 * window's top-left corner. Anything else is refused rather than clamped.
 */
export function parseWindowControls(raw: unknown): WindowControls | null {
  if (!raw || typeof raw !== "object") return null;
  const { x, y } = raw as Record<string, unknown>;
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 64;
  return ok(x) && ok(y) ? { x, y } : null;
}

const FILE = "window-state.json";
const DEFAULT_WINDOW_STATE: WindowState = { width: 1360, height: 860 };

export function loadWindowState(userDataDir: string): WindowState {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(userDataDir, FILE), "utf8")) as Partial<WindowState>;
    if (typeof raw.width !== "number" || typeof raw.height !== "number") return DEFAULT_WINDOW_STATE;
    const controls = parseWindowControls(raw.controls) ?? undefined;
    return { ...DEFAULT_WINDOW_STATE, ...raw, controls };
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
