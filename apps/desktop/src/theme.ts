/**
 * The handful of colours the shell owns.
 *
 * Everything inside the window is painted by the web app; these are the pixels
 * Electron itself draws — the window background behind a loading page, and the
 * offline fallback in `resources/offline.html`. Both come from the design
 * tokens (`packages/tokens`): `tokens.generated.ts` here, and a generated block
 * of custom properties in offline.html, since that page cannot import anything.
 */
import { VV_COLOR } from "./tokens.generated";

/**
 * What the window paints before the first frame of the app arrives. The web app
 * is light-only, so this is the light surface and nothing else — a window that
 * defaulted to the OS appearance would flash dark on a dark-mode machine.
 */
export const WINDOW_BACKGROUND = VV_COLOR.surfaceBackdrop;

/**
 * The appearance the window chrome takes — frame, title bar, native menus and
 * dialogs. Pinned to the app's theme rather than the OS setting: the pixels
 * Electron draws around the page must match the pixels inside it, and the app
 * has one theme. When the web app turns its dark theme on, this is where the
 * shell follows it.
 */
export const WINDOW_THEME: "light" | "dark" = "light";
