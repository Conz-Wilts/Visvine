/**
 * The handful of colours the shell owns.
 *
 * Everything inside the window is painted by the web app; these are the pixels
 * Electron itself draws — the window background behind a loading page, and the
 * offline fallback in `resources/offline.html`. They are the web app's tokens
 * (`--surface-1`, `--text-primary`, `--text-muted`, `--border-subtle` and the
 * brand green in `app/globals.css`), copied because that stylesheet is on the
 * server we cannot reach when this page is what's showing.
 *
 * `resources/offline.html` repeats these literals — it is a standalone file with
 * an inline stylesheet, so it cannot import them. `tests/theme.test.mjs` reads
 * the file and fails if the two ever drift apart.
 */
export const SHELL_COLORS = {
  /** `--surface-1`: the flat ground the whole app sits on. */
  surface: "#ffffff",
  /** `--surface-2`: the quiet fill under a neutral button. */
  surfaceQuiet: "#f9fafb",
  /** `--surface-3`: hover. */
  surfaceHover: "#f3f4f6",
  /** `--border-subtle`: the hairline. */
  border: "#e5e7eb",
  /** `--text-primary`. */
  text: "#111827",
  /** `--text-secondary`. */
  textSecondary: "#374151",
  /** `--text-muted`. */
  textMuted: "#6b7280",
  /** `--color-brand-green`, for the one live-status dot the offline page shows. */
  brand: "#78d870",
} as const;

/**
 * What the window paints before the first frame of the app arrives. The web app
 * is light-only, so this is the light surface and nothing else — a window that
 * defaulted to the OS appearance would flash dark on a dark-mode machine.
 */
export const WINDOW_BACKGROUND = SHELL_COLORS.surface;
