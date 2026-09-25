import type { TextareaHTMLAttributes } from 'react';
import { Textarea as UITextarea } from '@visvine/ui';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** The app's own textarea (@visvine/ui). */
export function Textarea(props: TextareaProps) {
  return <UITextarea {...props} />;
}
