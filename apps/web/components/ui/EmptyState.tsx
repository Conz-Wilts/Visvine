import Link from '@/features/shared/components/SpaceLink';

interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: EmptyStateAction;
  icon?: React.ReactNode;
  /** `page` fills the viewport below the header so the text and action sit on its middle. */
  size?: 'sm' | 'md' | 'page';
  /** `solid` paints the action as a brand button; the default keeps it a text link. */
  actionStyle?: 'link' | 'solid';
}

/**
 * Nothing here yet: a line of muted text and, if there is something to do
 * about it, a text link in the accent. No tile behind the icon — an empty
 * surface should be the quietest thing on the page. A page that is empty in
 * its entirety (no connectors, no agents) is the exception: it takes the
 * viewport's middle and paints its one action, since that action is the whole
 * page.
 */
export default function EmptyState({ title, description, action, icon, size = 'md', actionStyle = 'link' }: EmptyStateProps) {
  const box = size === 'sm' ? 'py-8' : size === 'page' ? 'min-h-[60vh] py-12' : 'py-12';
  const actionClass =
    actionStyle === 'solid'
      ? 'rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 active:translate-y-[1px]'
      : 'text-sm font-semibold text-accent-strong hover:underline';

  return (
    <div className={`flex flex-col items-center justify-center text-center ${box}`}>
      {icon && <div className="mb-3 text-fg-muted [&>svg]:h-6 [&>svg]:w-6">{icon}</div>}
      <p className="mb-3 text-fg-muted">{description ?? title}</p>
      {action && (
        action.href ? (
          <Link href={action.href} className={actionClass}>{action.label}</Link>
        ) : (
          <button type="button" onClick={action.onClick} className={actionClass}>{action.label}</button>
        )
      )}
    </div>
  );
}
