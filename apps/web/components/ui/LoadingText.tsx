interface LoadingTextProps {
  text?: string;
  className?: string;
}

export default function LoadingText({ text = 'Loading…', className = '' }: LoadingTextProps) {
  return (
    <div className={`text-center py-12 text-fg-muted ${className}`}>
      {text}
    </div>
  );
}
