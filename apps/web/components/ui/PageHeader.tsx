import { clsx } from 'clsx';

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  className?: string;
  titleClassName?: string;
}

export default function PageHeader({ title, description, className, titleClassName }: PageHeaderProps) {
  return (
    <div className={clsx('mb-8 text-center', className)}>
      <h1 className={clsx('text-3xl font-bold text-gray-900 mb-2', titleClassName)}>
        {title}
      </h1>
      {description && (
        <p className="text-gray-600">{description}</p>
      )}
    </div>
  );
}
