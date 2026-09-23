/**
 * The app's icon set — ours, not a library's.
 *
 * Glyphs live as SVG files in `assets/icons/` at the repo root and are codegen'd
 * into the components re-exported here (see docs/icons.md). Importing
 * `lucide-react` or `@heroicons/react` is an eslint error; import from here.
 *
 *   import { CheckIcon, XIcon } from '@/features/shared/icons'   // static
 *   import { Icon } from '@/features/shared/icons'               // by name
 *
 * Prefer the named exports. `Icon`/`ICONS` pull the whole set, so they're for
 * the surfaces that genuinely store an icon name as data.
 */
export * from './generated/icons';
export { Icon } from './Icon';
export { IconBase } from '@visvine/ui';
// The names themselves are NOT re-exported here. They are React-free and live
// in `@/lib/icons/names`, which is what route handlers and zod schemas import —
// re-exporting them through a module that pulls in 146 components would make it
// far too easy to drag the whole set into a request handler by accident.
