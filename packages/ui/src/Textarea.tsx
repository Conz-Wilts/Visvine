'use client';

import { forwardRef } from 'react';
import { clsx } from 'clsx';
import { inputBaseClass } from './Input';

/**
 * Multi-line sibling of {@link Input} — same soft-filled look, plus relaxed line
 * height, a comfortable min-height, and no resize handle (matches the settings
 * forms' fixed-height feel). Forwards all native `<textarea>` props.
 */
type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={clsx(inputBaseClass, 'min-h-24 resize-none leading-relaxed', className)}
      {...props}
    />
  );
});

export default Textarea;
