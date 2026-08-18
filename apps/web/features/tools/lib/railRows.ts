/**
 * Which of a space's installed Tools become sidebar rail rows, and what each
 * row says — everything but the glyph.
 *
 * Kept out of features/shared/lib/features.tsx (which carries JSX icons and so
 * cannot be imported by a node:test) for the same reason lib/featureAccess.ts
 * is: the rule about which installs earn a row is worth pinning down, and the
 * icon is not. features.tsx turns each row here into a `FeatureDef` by adding
 * `<ToolIcon>`; ordering is lib/featureAccess.ts#navFeatureKeys' job.
 */
import { toolRailKey } from '@/lib/featureAccess';
import type { InstalledToolDto } from '@/lib/tools/installs';

/** One installed Tool's rail row, ready for an icon. */
export interface ToolRailRow {
  /** `tool:<slug>` — how the space stores this row's placement. */
  key: string;
  slug: string;
  /** The row's caption: the label the Tool's author chose, else its title. */
  label: string;
  /** The Tool itself, for anywhere the row needs naming in a sentence. */
  title: string;
  /** `/t/<slug>` — the Tool's own full-pane page. */
  href: string;
  /** One of TOOL_RAIL_ICONS (lib/tools/config.ts), or null for the default. */
  icon: string | null;
  /** The install wants something this space hasn't got and runs without it. */
  degraded: boolean;
}

/**
 * The rail rows a space's installs contribute, in the order the space DTO gave
 * them (placement comes from `featureConfig.order`, not from here).
 *
 * An install earns a row only if it is enabled AND declared a `rail` surface.
 * `installedToolsForSpaces` reports `label: null` for the second case — a Tool
 * that only owns a context type's page has no `/t/<slug>` page to link to, so a
 * rail row would point at a 404. The `enabled` check is belt-and-braces: the
 * space DTO already filters disabled installs out (lib/tools/installs.ts).
 */
export function toolRailRows(
  installedTools: readonly InstalledToolDto[] | null | undefined,
): ToolRailRow[] {
  return (installedTools ?? [])
    .filter((tool) => tool.enabled && tool.label !== null)
    .map((tool) => ({
      key: toolRailKey(tool.slug),
      slug: tool.slug,
      label: tool.label || tool.title,
      title: tool.title,
      href: tool.href,
      icon: tool.icon,
      degraded: tool.degraded,
    }));
}
