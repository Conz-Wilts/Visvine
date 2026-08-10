'use client';

/**
 * Shared renderer for one host-defined registration question (FormField),
 * used by both the public /e/[slug] RSVP form and the logged-in RSVP card on
 * the event detail page. Styling is injected by the caller so each surface
 * keeps its own look while the field semantics stay in one place.
 */

import Select from '@/components/ui/Select';
import type { FormField } from '@/lib/types';

export interface RegistrationFieldClasses {
  /** Wrapper <label> for non-checkbox fields. */
  field: string;
  /** Optional <span> around the label text of non-checkbox fields. */
  fieldText?: string;
  /** Text input / textarea. */
  input: string;
  /** Wrapper <label> for checkbox fields. */
  checkbox: string;
  /** The checkbox <input> itself. */
  checkboxInput: string;
}

export function RegistrationField({ field, value, onChange, classes, checkboxInputStyle }: {
  field: FormField;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
  classes: RegistrationFieldClasses;
  checkboxInputStyle?: React.CSSProperties;
}) {
  const requiredMark = field.required ? ' *' : '';

  if (field.type === 'checkbox') {
    return (
      <label className={classes.checkbox}>
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className={classes.checkboxInput}
          style={checkboxInputStyle}
        />
        {field.label}{requiredMark}
      </label>
    );
  }

  const labelText = classes.fieldText
    ? <span className={classes.fieldText}>{field.label}{requiredMark}</span>
    : <>{field.label}{requiredMark}</>;

  const options = (field.options ?? []).filter((o) => o.trim());
  if (field.type === 'select' && options.length > 0) {
    return (
      <label className={classes.field}>
        {labelText}
        <Select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      </label>
    );
  }

  if (field.type === 'textarea') {
    return (
      <label className={classes.field}>
        {labelText}
        <textarea
          rows={3}
          value={(value as string) ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${classes.input} resize-none`}
        />
      </label>
    );
  }

  // Text-like input. A select with no usable options also lands here so a
  // misconfigured required question can't make registration impossible.
  return (
    <label className={classes.field}>
      {labelText}
      <input
        type={field.type === 'email' ? 'email' : field.type === 'url' || field.type === 'linkedin' ? 'url' : 'text'}
        value={(value as string) ?? ''}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={classes.input}
      />
    </label>
  );
}
