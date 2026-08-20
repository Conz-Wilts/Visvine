interface LoadingTextProps {
  text?: string;
  className?: string;
}

export default function LoadingText({ text = 'Loading…', className = '' }: LoadingTextProps) {
  return (
    <div className={`text-center py-12 text-text-muted ${className}`}>
      {text}
    </div>
  );
}
