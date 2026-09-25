/**
 * Kit 1 — what a Tool declaring `sdk: ^1` (or declaring none, as every Tool
 * built before kit 2 does) imports as `@visvine/tool-kit`: kit 1's own
 * components, frozen, and the same API as kit 2. The frame document chooses
 * the major per Tool (lib/tools/frameDocument.ts), so a Tool renders exactly
 * as it did when it was written.
 */
export * from './legacy';
export * from './api';
