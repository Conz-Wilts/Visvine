import type { TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea {...rest} className={cx('vv-textarea', className)} />;
}
