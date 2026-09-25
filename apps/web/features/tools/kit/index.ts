/**
 * `@visvine/tool-kit`, kit 2 — everything a Tool author may import.
 *
 * esbuild compiles this folder into one browser ESM module served from the
 * tools origin, and a Tool's `ui.tsx` resolves the bare specifier to it through
 * the frame document's import map (kit 1, ./kit1.ts, for a Tool written for
 * it). If it is not exported here, a Tool cannot reach it — which is the
 * point: the surface is small enough to document in one `.d.ts` (see
 * lib/tools/sdkDocs.ts, which must be updated alongside this file).
 */
export * from './components';
export * from './api';
