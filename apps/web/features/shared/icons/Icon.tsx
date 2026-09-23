/**
 * `<Icon name="check" />` — the by-name door into the icon set.
 *
 * Most code should import the component it wants (`import { CheckIcon } from
 * '@/features/shared/icons'`) so the bundle carries only that glyph. This exists
 * for the surfaces where the icon is *data*: a Tool's declared rail icon, a
 * channel's icon, a space's feature config. Those all store a string, and this
 * is where the string becomes a glyph.
 *
 * An unknown name renders nothing rather than throwing. The write paths validate
 * against `ICON_NAMES`, so the only way to get here with a bad name is a row
 * written before a glyph was renamed — and a gap in the chrome beats a crash.
 */
import type { IconName } from '@/lib/icons/names';
import { ICONS } from './generated/registry';
import { type IconProps } from '@visvine/ui';

export function Icon({ name, ...props }: IconProps & { name: string }) {
  const Glyph = ICONS[name as IconName];
  return Glyph ? <Glyph {...props} /> : null;
}
