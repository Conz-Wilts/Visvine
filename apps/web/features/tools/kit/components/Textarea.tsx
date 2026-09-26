import type { TextareaHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { Textarea as UITextarea } from '@visvine/ui';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** The app's own textarea (@visvine/ui), its placeholder a step lighter like Input's. */
export function Textarea({ className, ...props }: TextareaProps) {
  return <UITextarea className={clsx('placeholder:text-fg-subtle!', className)} {...props} />;
}
