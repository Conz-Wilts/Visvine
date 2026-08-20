import Link from 'next/link';

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
  size?: 'sm' | 'md';
}

/**
 * Nothing here yet: a line of muted text and, if there is something to do
 * about it, a text link in the accent. No tile behind the icon, no button —
 * an empty surface should be the quietest thing on the page.
 */
export default function EmptyState({ title, description, action, icon, size = 'md' }: EmptyStateProps) {
  const padding = size === 'sm' ? 'py-8' : 'py-12';
  const actionClass = 'text-sm font-semibold text-brand-dark-green hover:underline';

  return (
    <div className={`flex flex-col items-center justify-center text-center ${padding}`}>
      {icon && <div className="mb-3 text-text-muted [&>svg]:h-6 [&>svg]:w-6">{icon}</div>}
      <p className="mb-3 text-text-muted">{description ?? title}</p>
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
