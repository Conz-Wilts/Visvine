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

export default function EmptyState({ title, description, action, icon, size = 'md' }: EmptyStateProps) {
  const padding = size === 'sm' ? 'py-8' : 'py-12';

  return (
    <div className={`flex flex-col items-center justify-center text-center ${padding}`}>
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100">
          {icon}
        </div>
      )}
      <p className="text-gray-500 mb-4">{description ?? title}</p>
      {action && (
        action.href ? (
          <Link
            href={action.href}
            className="inline-block px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
          >
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="inline-block px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
          >
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
