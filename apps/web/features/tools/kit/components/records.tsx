/**
 * Records by schema — a Tool describes its fields once (`FieldDef[]`) and
 * every view of them is drawn from that: a value in a cell (`FieldValue`), its
 * input (`FieldInput`), the whole form (`RecordForm`) and the dialog around it
 * (`RecordDialog`), the table (`RecordTable`) and the board grouped by a
 * select field (`RecordBoard`). The look of a status chip, a sum of money, a
 * due date that has slipped or a person's name is then the kit's, the same in
 * every Tool, and the Tool's own code is only what is particular to it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Avatar, Toggle } from '@visvine/ui';
import { Button } from './Button';
import { DatePicker } from './DatePicker';
import { DataTable } from './DataTable';
import type { DataTableColumn } from './DataTable';
import { Field } from './Field';
import { Icon } from './Icon';
import { Input } from './Input';
import { KanbanBoard, KanbanCard, KanbanColumn } from './Kanban';
import type { KanbanMove } from './Kanban';
import { Modal } from './Modal';
import { Select } from './Select';
import { Textarea } from './Textarea';
import { EmptyState } from './EmptyState';
import { useVisvine } from '../hooks';
import { BridgeCallError } from '../client';

// ── hues ──

export type Hue = 'gray' | 'red' | 'orange' | 'amber' | 'yellow' | 'green' | 'teal' | 'cyan' | 'sky' | 'blue' | 'indigo' | 'violet' | 'pink';

/** The hues in the order a set of options takes them when none is named. */
export const HUES: readonly Hue[] = ['blue', 'amber', 'green', 'violet', 'pink', 'teal', 'orange', 'indigo', 'red', 'cyan', 'yellow', 'sky', 'gray'];

/** Literal classes (the stylesheet is compiled from this file). */
const HUE_CHIP: Record<Hue, string> = {
  gray: 'bg-hue-gray-wash text-hue-gray-fg',
  red: 'bg-hue-red-wash text-hue-red-fg',
  orange: 'bg-hue-orange-wash text-hue-orange-fg',
  amber: 'bg-hue-amber-wash text-hue-amber-fg',
  yellow: 'bg-hue-yellow-wash text-hue-yellow-fg',
  green: 'bg-hue-green-wash text-hue-green-fg',
  teal: 'bg-hue-teal-wash text-hue-teal-fg',
  cyan: 'bg-hue-cyan-wash text-hue-cyan-fg',
  sky: 'bg-hue-sky-wash text-hue-sky-fg',
  blue: 'bg-hue-blue-wash text-hue-blue-fg',
  indigo: 'bg-hue-indigo-wash text-hue-indigo-fg',
  violet: 'bg-hue-violet-wash text-hue-violet-fg',
  pink: 'bg-hue-pink-wash text-hue-pink-fg',
};

const HUE_DOT: Record<Hue, string> = {
  gray: 'bg-hue-gray',
  red: 'bg-hue-red',
  orange: 'bg-hue-orange',
  amber: 'bg-hue-amber',
  yellow: 'bg-hue-yellow',
  green: 'bg-hue-green',
  teal: 'bg-hue-teal',
  cyan: 'bg-hue-cyan',
  sky: 'bg-hue-sky',
  blue: 'bg-hue-blue',
  indigo: 'bg-hue-indigo',
  violet: 'bg-hue-violet',
  pink: 'bg-hue-pink',
};

export interface HueChipProps {
  hue?: Hue;
  className?: string;
  children: ReactNode;
}

/** A soft, coloured label — a status, a stage, a tag. */
export function HueChip({ hue = 'gray', className, children }: HueChipProps) {
  return (
    <span className={clsx('inline-flex h-6 max-w-full items-center gap-1.5 rounded-md px-2 text-xs font-medium', HUE_CHIP[hue] ?? HUE_CHIP.gray, className)}>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A small round swatch of a hue — beside a column title, a legend row. */
export function HueDot({ hue = 'gray', className }: { hue?: Hue; className?: string }) {
  return <span className={clsx('inline-block size-2 shrink-0 rounded-full', HUE_DOT[hue] ?? HUE_DOT.gray, className)} />;
}

// ── fields ──

export type FieldKind =
  | 'text'
  | 'longtext'
  | 'number'
  | 'money'
  | 'percent'
  | 'date'
  | 'select'
  | 'tags'
  | 'person'
  | 'email'
  | 'url'
  | 'boolean'
  | 'rating';

export interface FieldOption {
  value: string;
  label?: string;
  hue?: Hue;
}

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  /** For `select` and `tags`: the choices, in order (a board's columns follow it). */
  options?: FieldOption[];
  required?: boolean;
  /** `money`: ISO currency, default USD. */
  currency?: string;
  placeholder?: string;
  /** Left out of the table (still in the form). */
  hideInTable?: boolean;
}

export type RecordData = Record<string, unknown>;

/** A field's options with every one given a hue and a label. */
export function optionsOf(field: FieldDef): Required<FieldOption>[] {
  return (field.options ?? []).map((o, i) => ({ value: o.value, label: o.label ?? o.value, hue: o.hue ?? HUES[i % HUES.length] }));
}

function optionFor(field: FieldDef, value: unknown): Required<FieldOption> | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  return optionsOf(field).find((o) => o.value === text) ?? { value: text, label: text, hue: 'gray' };
}

// ── formatting ──

export function formatMoney(value: unknown, currency = 'USD'): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';
  // One notation for everything a person compares: whole units ("$1,200,000"
  // beside "$300,000", never "$1.2M" beside "$300,000"), compact only for
  // sums too long to read.
  const compact = Math.abs(n) >= 100_000_000;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  }).format(n);
}

/** A hue as a CSS colour, for what a class cannot paint — a chart's slices in the same colours as their chips. */
export function hueColor(hue: Hue): string {
  return `var(--color-hue-${hue})`;
}

/** A word for `count` of it: "1 status", "3 statuses", "2 categories". */
export function plural(word: string, count = 2): string {
  if (count === 1 || !word) return word;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

/** The symbol a currency is written with ("$", "€", "NZ$"). */
function currencySymbol(currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/** A person's own hue, the same everywhere their name is drawn. */
export function hueOf(name: string): Hue {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return HUES[h % (HUES.length - 1)];
}

/** A person's initials on their own hue. */
export function PersonAvatar({ name, size = 'xs' }: { name: string; size?: 'xs' | 'sm' | 'md' }) {
  const hue = hueOf(name);
  return <Avatar name={name} size={size} fallback="initials" style={{ backgroundColor: `var(--vv-color-hue-${hue}-wash)`, color: `var(--vv-color-hue-${hue}-fg)` }} />;
}

export function formatNumber(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: Math.abs(n) < 10 ? 1 : 0 }).format(n) : '';
}

/** `YYYY-MM-DD` (or any date string) → "12 Mar", with the year when it is not this one. */
export function formatDate(value: unknown): string {
  if (!value) return '';
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Whole days from today to a date — negative when it has passed. */
export function daysFrom(value: unknown, now = new Date()): number | null {
  if (!value) return null;
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : String(value));
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / 86_400_000);
}

/** "today", "in 3 days", "2 days ago", else the date. */
export function relativeDate(value: unknown): string {
  const days = daysFrom(value);
  if (days === null) return '';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return `In ${days} days`;
  if (days < -1 && days > -7) return `${-days} days ago`;
  return formatDate(value);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ── one value ──

export interface FieldValueProps {
  field: FieldDef;
  value: unknown;
  /** Tighter, for a card: a percentage's bar is short. */
  compact?: boolean;
  /** A date that is due and not done: drawn in the danger colour once past. A date is only ever red when this says so. */
  due?: boolean;
}

/** One field's value, drawn for reading. Empty is a muted dash. */
export function FieldValue({ field, value, compact = false, due = false }: FieldValueProps) {
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  if (empty && field.kind !== 'boolean') return <span className="text-fg-subtle">—</span>;
  switch (field.kind) {
    case 'select': {
      const o = optionFor(field, value)!;
      return <HueChip hue={o.hue}>{o.label}</HueChip>;
    }
    case 'tags': {
      const values = Array.isArray(value) ? value : String(value).split(',').map((t) => t.trim());
      return (
        <span className="flex flex-wrap gap-1">
          {values.filter(Boolean).map((v) => {
            const o = optionFor(field, v)!;
            return (
              <HueChip key={String(v)} hue={o.hue}>
                {o.label}
              </HueChip>
            );
          })}
        </span>
      );
    }
    case 'money':
      return <span className="tabular-nums">{formatMoney(value, field.currency)}</span>;
    case 'number':
      return <span className="tabular-nums">{formatNumber(value)}</span>;
    case 'percent': {
      const n = Math.max(0, Math.min(100, Number(value) || 0));
      return (
        <span className="inline-flex items-center gap-2">
          <span className={clsx('h-1.5 overflow-hidden rounded-full bg-surface-muted', compact ? 'w-10' : 'w-16')}>
            <span className={clsx('block h-full rounded-full', n >= 100 ? 'bg-success' : 'bg-accent')} style={{ width: `${n}%` }} />
          </span>
          <span className="tabular-nums">{formatNumber(value)}%</span>
        </span>
      );
    }
    case 'date': {
      const days = daysFrom(value);
      const late = due && days !== null && days < 0;
      // One date format in every list, so a column never mixes "Sep 20" with "5 days ago"; the relative reading is the tooltip.
      return <span title={relativeDate(value)} className={clsx('tabular-nums', late && 'font-medium text-danger')}>{formatDate(value)}</span>;
    }
    case 'person':
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <PersonAvatar name={String(value)} />
          <span className="truncate">{String(value)}</span>
        </span>
      );
    case 'email':
      return (
        <a href={`mailto:${String(value)}`} className="truncate text-fg hover:underline" onClick={(e) => e.stopPropagation()}>
          {String(value)}
        </a>
      );
    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-fg-link hover:underline" onClick={(e) => e.stopPropagation()}>
          <span className="truncate">{hostOf(String(value))}</span>
          <Icon name="external-link" size={12} className="opacity-70" />
        </a>
      );
    case 'boolean':
      return value ? <span className="text-success">Yes</span> : <span className="text-fg-subtle">No</span>;
    case 'rating': {
      const n = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
      return (
        <span className="tracking-wide text-hue-amber" aria-label={`${n} of 5`}>
          {'★'.repeat(n)}
          <span className="text-fg-subtle">{'★'.repeat(5 - n)}</span>
        </span>
      );
    }
    case 'longtext':
      return <span className="line-clamp-2 text-fg-secondary">{String(value)}</span>;
    default:
      return <span className="truncate">{String(value)}</span>;
  }
}

// ── one input ──

export interface FieldInputProps {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  id?: string;
  autoFocus?: boolean;
  /** Names a person field offers as it is typed into — the team already in the records. */
  people?: string[];
  /** A filled-in record whose value shows as this field's "e.g." placeholder. */
  example?: RecordData;
  /** Long text: its height in lines. */
  rows?: number;
}

/** "e.g. Northwind" from an example record, for a field that has no placeholder of its own. */
function exampleFor(field: FieldDef, example?: RecordData): string | undefined {
  if (field.placeholder) return field.placeholder;
  const v = example?.[field.key];
  if (v === undefined || v === null || v === '' || typeof v === 'object' || typeof v === 'boolean') return undefined;
  if (field.kind === 'date') return undefined;
  const text = field.kind === 'money' || field.kind === 'number' ? formatNumber(v) : String(v);
  return `e.g. ${text.length > 48 ? `${text.slice(0, 45)}…` : text}`;
}

/** A name typed or picked from the people already in the records, drawn with their avatar. */
function PersonInput({ id, value, onChange, people, placeholder }: { id?: string; value: unknown; onChange: (v: unknown) => void; people: string[]; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const name = String(value ?? '');
  const q = name.trim().toLowerCase();
  const matches = people.filter((p) => p !== name && p.toLowerCase().includes(q)).slice(0, 6);
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2.5 z-10 flex items-center">
        {name.trim() ? <PersonAvatar name={name.trim()} /> : <Icon name="user" size={16} className="text-fg-subtle" />}
      </span>
      <Input
        id={id}
        role="combobox"
        aria-expanded={open && matches.length > 0}
        autoComplete="off"
        className="pl-9 pr-8"
        value={name}
        placeholder={placeholder ?? (people.length ? 'Choose or type a name' : 'Name')}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.currentTarget.value);
          setOpen(true);
        }}
      />
      {people.length > 0 && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-fg-muted">
          <Icon name="chevron-down" size={14} />
        </span>
      )}
      {open && matches.length > 0 && (
        <ul role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-auto rounded-lg border border-line-subtle bg-surface py-1 shadow-lg">
          {matches.map((p) => (
            <li key={p} role="option" aria-selected={false}>
              <button
                type="button"
                // Before the input's blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(p);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-subtle"
              >
                <PersonAvatar name={p} />
                {p}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const RATING_WORDS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

/** Five stars that fill as the pointer moves over them, with the word for the value beside. */
function RatingInput({ label, value, onChange }: { label: string; value: number; onChange: (v: unknown) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-0.5" role="radiogroup" aria-label={label} onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i}
            aria-label={`${i} — ${RATING_WORDS[i]}`}
            onMouseEnter={() => setHover(i)}
            onClick={() => onChange(value === i ? 0 : i)}
            className={clsx('px-0.5 text-2xl leading-none transition-colors', i <= shown ? 'text-warning' : 'text-line hover:text-fg-subtle')}
          >
            ★
          </button>
        ))}
      </div>
      <span className="text-sm text-fg-muted">{shown ? RATING_WORDS[shown] : 'Not rated'}</span>
    </div>
  );
}

/** One field's control, chosen by its kind. */
export function FieldInput({ field, value, onChange, id, autoFocus, people = [], example, rows = 3 }: FieldInputProps) {
  const hint = exampleFor(field, example);
  switch (field.kind) {
    case 'longtext':
      return <Textarea id={id} aria-required={field.required} rows={rows} value={String(value ?? '')} placeholder={hint} onChange={(e) => onChange(e.currentTarget.value)} />;
    case 'number':
    case 'money':
    case 'percent': {
      // The unit sits inside the box, so the number typed is just the number.
      const prefix = field.kind === 'money' ? currencySymbol(field.currency) : null;
      const suffix = field.kind === 'percent' ? '%' : null;
      return (
        <div className="relative">
          {prefix && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-fg-muted">{prefix}</span>}
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            className={clsx(prefix && (prefix.length > 1 ? 'pl-10' : 'pl-7'), suffix && 'pr-8')}
            value={value === null || value === undefined ? '' : String(value)}
            placeholder={hint}
            onChange={(e) => onChange(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
          />
          {suffix && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-fg-muted">{suffix}</span>}
        </div>
      );
    }
    case 'person':
      return <PersonInput id={id} value={value} onChange={onChange} people={people} placeholder={field.placeholder} />;
    case 'date':
      return <DatePicker id={id} value={value ? String(value).slice(0, 10) : null} onChange={onChange} />;
    case 'select':
      return (
        <Select
          id={id}
          value={value ? String(value) : ''}
          placeholder={field.placeholder ?? `Select ${field.label.toLowerCase()}`}
          options={optionsOf(field).map((o) => ({ value: o.value, label: o.label }))}
          onValueChange={(v) => onChange(v)}
        />
      );
    case 'tags': {
      const chosen = new Set(Array.isArray(value) ? value.map(String) : []);
      return (
        <div className="flex flex-wrap gap-1.5">
          {optionsOf(field).map((o) => {
            const on = chosen.has(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(chosen);
                  if (on) next.delete(o.value);
                  else next.add(o.value);
                  onChange([...next]);
                }}
                className={clsx('rounded-md border px-2 py-1 text-xs font-medium transition-colors', on ? `border-transparent ${HUE_CHIP[o.hue]}` : 'border-line-subtle text-fg-muted hover:bg-surface-subtle')}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    case 'boolean':
      return <Toggle checked={Boolean(value)} onChange={onChange} />;
    case 'rating':
      return <RatingInput label={field.label} value={Number(value) || 0} onChange={onChange} />;
    default:
      return (
        <Input
          id={id}
          autoFocus={autoFocus}
          aria-required={field.required}
          type={field.kind === 'email' ? 'email' : field.kind === 'url' ? 'url' : 'text'}
          value={String(value ?? '')}
          placeholder={hint}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      );
  }
}

// ── the form ──

export interface RecordFormProps {
  fields: FieldDef[];
  value: RecordData;
  onChange: (next: RecordData) => void;
  /** Keys whose `required` is unmet, after a submit — each says so under its input. */
  errors?: string[];
  /** Names a person field offers — the people already in the records. */
  people?: string[];
  /** A filled-in record, shown as each empty field's "e.g." placeholder. */
  example?: RecordData;
}

const WIDE: ReadonlySet<FieldKind> = new Set(['longtext', 'tags']);

/**
 * Every field, two to a row on a wide frame; long text, tags and the title
 * take a row of their own. Nothing is focused on open: a focused field draws
 * differently from its neighbours and reads as the odd one out.
 */
export function RecordForm({ fields, value, onChange, errors = [], people, example }: RecordFormProps) {
  const firstText = fields.find((f) => f.kind === 'text')?.key;
  const wide = (f: FieldDef) => WIDE.has(f.kind) || f.key === firstText;
  // Narrow fields pair up; one left without a partner takes the row, so the grid never has a hole.
  const spans = new Set<string>();
  for (let i = 0; i < fields.length; i++) {
    if (wide(fields[i])) spans.add(fields[i].key);
    else if (fields[i + 1] && !wide(fields[i + 1])) i++;
    else spans.add(fields[i].key);
  }
  // A long form keeps its text boxes short, so the dialog opens showing the whole of it.
  const long = fields.length > 5;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((field) => {
        const id = `vv-field-${field.key}`;
        if (field.kind === 'boolean') {
          // A yes/no is one row you press: its name, its switch beside it.
          const set = (v: boolean) => onChange({ ...value, [field.key]: v });
          return (
            <div
              key={field.key}
              onClick={() => set(!value[field.key])}
              className={clsx('flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-line-subtle px-3 py-2.5 text-sm text-fg hover:bg-surface-subtle', spans.has(field.key) && 'sm:col-span-2')}
            >
              <span className="font-medium">{field.label}</span>
              <span onClick={(e) => e.stopPropagation()}>
                <Toggle aria-label={field.label} checked={Boolean(value[field.key])} onChange={set} />
              </span>
            </div>
          );
        }
        return (
          <div key={field.key} className={clsx(spans.has(field.key) && 'sm:col-span-2')}>
            <Field label={<>{field.label}{field.required && <span className="ml-1 text-fg-muted" aria-label="required">*</span>}</>} htmlFor={id} error={errors.includes(field.key) ? `${field.label} is needed` : undefined}>
              <FieldInput id={id} field={field} value={value[field.key]} onChange={(v) => onChange({ ...value, [field.key]: v })} people={people} example={example} rows={long ? 2 : 3} />
            </Field>
          </div>
        );
      })}
    </div>
  );
}

/** Everyone named in the records' person fields, for a form's person picker. */
export function peopleOf(fields: FieldDef[], rows: Array<{ data: RecordData }>): string[] {
  const keys = fields.filter((f) => f.kind === 'person').map((f) => f.key);
  return [...new Set(rows.flatMap((r) => keys.map((k) => r.data[k])).filter((v): v is string => typeof v === 'string' && v.trim() !== ''))];
}

/** The keys a record leaves empty that its fields require. */
export function missingRequired(fields: FieldDef[], value: RecordData): string[] {
  return fields.filter((f) => f.required).filter((f) => {
    const v = value[f.key];
    return v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);
  }).map((f) => f.key);
}

export interface RecordDialogProps {
  open: boolean;
  /** "New deal" / "Edit deal". */
  title: ReactNode;
  fields: FieldDef[];
  /** The record being edited, or the defaults of a new one. */
  initial: RecordData;
  onClose: () => void;
  onSave: (value: RecordData) => Promise<void> | void;
  /** Present on an existing record: a Delete button on the left of the footer. */
  onDelete?: () => Promise<void> | void;
  saveLabel?: string;
  /** Names a person field offers; the viewer is always among them. */
  people?: string[];
  /** A filled-in record, shown as each empty field's "e.g." placeholder on a new one. */
  example?: RecordData;
}

/** A record's form in the app's dialog, with Save, Cancel and (for an existing one) Delete. */
export function RecordDialog({ open, title, fields, initial, onClose, onSave, onDelete, saveLabel = 'Save', people = [], example }: RecordDialogProps) {
  const viewer = useVisvine().viewer.name;
  const team = useMemo(() => [...new Set([...people, viewer].filter((p) => p && p.trim()))].sort((a, b) => a.localeCompare(b)), [people, viewer]);
  const [value, setValue] = useState<RecordData>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seeded = useRef(initial);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open && (!wasOpen.current || seeded.current !== initial)) {
      seeded.current = initial;
      setValue(initial);
      setErrors([]);
      setFailure(null);
    }
    wasOpen.current = open;
  }, [open, initial]);

  const save = async () => {
    if (busy) return;
    setFailure(null);
    const missing = missingRequired(fields, value);
    setErrors(missing);
    if (missing.length) return;
    setBusy(true);
    try {
      await onSave(value);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Could not save this record');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !onDelete) return;
    setBusy(true);
    setFailure(null);
    try { await onDelete(); }
    catch (err) { setFailure(err instanceof Error ? err.message : 'Could not delete this record'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <div className="flex w-full items-center gap-2">
          {onDelete && (
            <Button variant="danger-text" disabled={busy} onClick={() => void remove()}>
              Delete
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              {saveLabel}
            </Button>
          </div>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <RecordForm fields={fields} value={value} onChange={setValue} errors={errors} people={team} example={onDelete ? undefined : example} />
        {failure && <p role="alert" className="mt-4 text-sm text-danger">{failure}</p>}
      </form>
    </Modal>
  );
}

// ── the table ──

export interface RecordTableProps<T extends { id: string; data: RecordData }> {
  fields: FieldDef[];
  rows: T[];
  onOpen?: (row: T) => void;
  /** Shown in place of rows when there are none. */
  empty?: ReactNode;
  /** A last column of the Tool's own (an action, a menu). */
  trailing?: (row: T) => ReactNode;
  maxHeight?: number;
  /** The date field that falls due; it turns red once past on a row that is not done. */
  dueField?: string;
  /** A row that is finished — its due date is never late. */
  isDone?: (row: T) => boolean;
  /** The order it opens in, before anyone presses a header. */
  defaultSort?: { key: string; direction: 'asc' | 'desc' };
}

const RIGHT_KINDS: ReadonlySet<FieldKind> = new Set(['number', 'money']);

/** A sortable table of records: one column per field, the first one bold. */
export function RecordTable<T extends { id: string; data: RecordData }>({ fields, rows, onOpen, empty, trailing, maxHeight, dueField, isDone, defaultSort }: RecordTableProps<T>) {
  const shown = fields.filter((f) => !f.hideInTable);
  const columns: DataTableColumn<T>[] = shown.map((field, i) => ({
    key: field.key,
    header: field.label,
    align: RIGHT_KINDS.has(field.kind) ? 'right' : 'left',
    sortable: true,
    value: (row: T) => row.data[field.key] as unknown,
    render: (row: T) =>
      i === 0 ? (
        <span className="font-medium text-fg">{String(row.data[field.key] ?? '') || 'Untitled'}</span>
      ) : (
        <FieldValue field={field} value={row.data[field.key]} due={field.key === dueField && !(isDone?.(row) ?? false)} />
      ),
  }));
  if (trailing) columns.push({ key: '__trailing', header: '', align: 'right', render: trailing });
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      onRowClick={onOpen}
      maxHeight={maxHeight}
      defaultSort={defaultSort}
      empty={empty ?? <span className="text-fg-muted">Nothing here yet.</span>}
    />
  );
}

// ── the board ──

export interface RecordBoardProps<T extends { id: string; data: RecordData }> {
  fields: FieldDef[];
  /** The select field whose options are the columns. */
  groupBy: string;
  rows: T[];
  onMove: (row: T, toValue: string) => void;
  onOpen?: (row: T) => void;
  /** Fields on a card besides its title, by key — default: every field shown in the table that is not the column. */
  cardFields?: string[];
  /** A number summed at the top of each column (a money or number field's key). */
  sumField?: string;
  /** The date field that falls due: late on an open card turns red. */
  dueField?: string;
  /** Column values that mean finished — a card there is never late. */
  doneValues?: string[];
  /** "+ Add" at the foot of each column, with that column's value. */
  onAdd?: (columnValue: string) => void;
}

const NUMBER_KINDS: ReadonlySet<FieldKind> = new Set(['money', 'number']);
const CHIP_KINDS: ReadonlySet<FieldKind> = new Set(['select', 'tags']);

/**
 * A board with one column per option of a select field; dragging a card sets
 * it. Up to six columns share the width; more scroll sideways behind a fade
 * that says so. A card is its title and its number on one line, its chips
 * under them, and one muted line of the rest joined by `·`.
 */
export function RecordBoard<T extends { id: string; data: RecordData }>({ fields, groupBy, rows, onMove, onOpen, cardFields, sumField, dueField, doneValues, onAdd }: RecordBoardProps<T>) {
  const group = fields.find((f) => f.key === groupBy);
  const titleKey = fields[0]?.key;
  const onCard = useMemo(
    () =>
      (cardFields ?? fields.filter((f) => f.key !== groupBy && f.key !== titleKey && f.kind !== 'longtext' && !f.hideInTable).map((f) => f.key))
        .map((key) => fields.find((f) => f.key === key))
        .filter((f): f is FieldDef => Boolean(f)),
    [cardFields, fields, groupBy, titleKey],
  );
  const sum = sumField ? fields.find((f) => f.key === sumField) : undefined;
  const headline = sum ?? onCard.find((f) => NUMBER_KINDS.has(f.kind));
  const chips = onCard.filter((f) => CHIP_KINDS.has(f.kind)).slice(0, 2);
  const rest = onCard.filter((f) => f !== headline && !CHIP_KINDS.has(f.kind));
  // A card reads as: title and number; one muted line of text; chips; then a
  // footer with who on the left and when on the right — no separators to strand.
  const person = rest.find((f) => f.kind === 'person');
  const when = rest.find((f) => f.kind === 'date');
  const line = rest.filter((f) => f !== person && f !== when && f.kind !== 'boolean').slice(0, 1);
  const done = new Set(doneValues ?? []);

  if (!group) return null;
  const columns = optionsOf(group);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const move = (m: KanbanMove) => {
    const row = byId.get(m.cardId);
    if (row && m.toColumnId !== m.fromColumnId) onMove(row, m.toColumnId);
  };
  const has = (row: T, f: FieldDef | undefined) => f !== undefined && row.data[f.key] !== undefined && row.data[f.key] !== null && row.data[f.key] !== '';
  // Up to six stages share the width and never scroll; a card narrows to fit.
  const fill = columns.length <= 6;

  const column = (col: (typeof columns)[number]) => {
    const inCol = rows.filter((r) => String(r.data[groupBy] ?? '') === col.value);
    const values = sum ? inCol.map((r) => r.data[sum.key]).filter((v) => v !== null && v !== undefined && v !== '').map(Number).filter(Number.isFinite) : [];
    const averaged = sum?.kind === 'percent' || sum?.kind === 'rating';
    const total = values.length ? values.reduce((a, b) => a + b, 0) / (averaged ? values.length : 1) : null;
    const colDone = done.has(col.value);
    return (
      <KanbanColumn
        key={col.value}
        id={col.value}
        fill={fill}
        title={
          <>
            <HueDot hue={col.hue} />
            {col.label}
          </>
        }
        count={inCol.length}
        subtitle={
          sum ? (total !== null && total > 0 ? (sum.kind === 'money' ? formatMoney(total, sum.currency) : `${sum.kind === 'number' ? `${sum.label} ` : ''}${formatNumber(total)}${sum.kind === 'percent' ? '%' : ''}${averaged ? ' avg' : ''}`) : '') : undefined
        }
      >
        {inCol.map((row) => (
          <KanbanCard key={row.id} id={row.id} onClick={onOpen ? () => onOpen(row) : undefined} className={clsx('@container', colDone && 'opacity-80')}>
            <div className="flex flex-col gap-1.5">
              {/* The number beside the title in a wide column, under it in a narrow one — never squeezing the title into two lines. */}
              <div className="flex flex-col gap-0.5 @[15rem]:flex-row @[15rem]:items-start @[15rem]:justify-between @[15rem]:gap-2">
                <span className="min-w-0 text-sm font-medium leading-snug text-fg">{String(row.data[titleKey] ?? '') || 'Untitled'}</span>
                {has(row, headline) && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                    {/* A plain number says what it counts; money and a percentage say it themselves. */}
                    {headline!.kind === 'number' && <span className="mr-1 text-xs font-normal text-fg-muted">{headline!.label}</span>}
                    <FieldValue field={headline!} value={row.data[headline!.key]} compact />
                  </span>
                )}
              </div>
              {line.filter((f) => has(row, f)).map((f) => (
                <span key={f.key} className="truncate text-xs text-fg-muted">
                  <FieldValue field={f} value={row.data[f.key]} compact />
                </span>
              ))}
              {chips.some((f) => has(row, f)) && (
                <div className="flex flex-wrap gap-1">
                  {chips.map((f) => (has(row, f) ? <FieldValue key={f.key} field={f} value={row.data[f.key]} /> : null))}
                </div>
              )}
              {(has(row, person) || has(row, when)) && (
                <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2 text-xs text-fg-muted">
                  {has(row, person) ? (
                    <span className="inline-flex min-w-0 items-center gap-1.5" title={String(row.data[person!.key])}>
                      <PersonAvatar name={String(row.data[person!.key])} />
                      {/* The name only where there is room for it; the avatar says who either way. */}
                      <span className="hidden truncate @[12rem]:inline">{String(row.data[person!.key])}</span>
                    </span>
                  ) : (
                    <span />
                  )}
                  {has(row, when) && (
                    <span className="shrink-0">
                      <FieldValue field={when!} value={row.data[when!.key]} compact due={when!.key === dueField && !colDone} />
                    </span>
                  )}
                </div>
              )}
            </div>
          </KanbanCard>
        ))}
        {onAdd && !colDone && (
          <button
            type="button"
            onClick={() => onAdd(col.value)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
          >
            <span aria-hidden className="text-base leading-none">+</span> Add
          </button>
        )}
      </KanbanColumn>
    );
  };

  return (
    <KanbanBoard onMove={move}>{columns.map(column)}</KanbanBoard>
  );
}

// ── sample rows ──

/**
 * Put `rows` into a collection the first time a Tool opens on an empty one, so
 * the first look is the Tool working, not an empty page. Once per install
 * (an install-wide state key), so clearing the rows keeps them cleared.
 * Returns `clear`, which deletes every row this seeded.
 */
/** A seeder's hold on an empty collection while it writes the sample rows. */
interface SeedClaim {
  claim: string;
  at: number;
}
const CLAIM_SETTLE_MS = 250;
/** A claim left by a frame that closed mid-seed stops holding after this. */
const CLAIM_STALE_MS = 30_000;

export function useSampleRows(collection: string, rows: RecordData[]): { seeding: boolean; hasSamples: boolean; clear: () => Promise<void> } {
  const visvine = useVisvine();
  const [seeding, setSeeding] = useState(false);
  const [hasSamples, setHasSamples] = useState(false);
  const key = `vv:sample:${collection}`;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const done = await visvine.state.get<string[] | SeedClaim>(key, { scope: 'install' });
        if (cancelled) return;
        if (Array.isArray(done)) { setHasSamples(done.length > 0); return; }
        if (done && Date.now() - done.at < CLAIM_STALE_MS) { setHasSamples(true); return; }
        if (rows.length === 0) return;
        const existing = await visvine.collections.count(collection);
        if (existing.total > 0 || cancelled) {
          await visvine.state.set(key, [], { scope: 'install' });
          return;
        }
        // Two frames opening at once (a person with two tabs, a builder's
        // parallel previews) would both find the collection empty and both
        // seed. Each writes a claim, waits a beat, and only the one whose
        // claim is still there seeds — the last writer wins.
        const claim: SeedClaim = { claim: Math.random().toString(36).slice(2), at: Date.now() };
        await visvine.state.set(key, claim, { scope: 'install' });
        await new Promise((resolve) => setTimeout(resolve, CLAIM_SETTLE_MS));
        const held = await visvine.state.get<string[] | SeedClaim>(key, { scope: 'install' });
        if (cancelled) return;
        if (Array.isArray(held) || held?.claim !== claim.claim) { setHasSamples(true); return; }
        setSeeding(true);
        // All at once: one round trip, so a frame closed a moment after it
        // opened (a preview capture, a tab shut) never leaves half the rows.
        const ids = (await Promise.all(rows.map((row) => visvine.collections.insert(collection, row)))).map((r) => r.id);
        await visvine.state.set(key, ids, { scope: 'install' });
        if (!cancelled) setHasSamples(ids.length > 0);
      } catch {
        // A viewer who may not write sees the Tool as it is.
      } finally {
        if (!cancelled) setSeeding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Rows are sample data fixed at build time; the effect runs once per collection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visvine, collection, key]);
  const clear = async () => {
    const held = await visvine.state.get<string[] | SeedClaim>(key, { scope: 'install' });
    const ids = Array.isArray(held) ? held : [];
    for (const id of ids) {
      try { await visvine.collections.delete(collection, id); }
      catch (err) { if (!(err instanceof BridgeCallError && err.code === 'not_found')) throw err; }
    }
    await visvine.state.set(key, [], { scope: 'install' });
    setHasSamples(false);
  };
  return { seeding, hasSamples, clear };
}

/** Demo provenance appears once, keeping record titles natural and readable. */
export function SampleData({ state }: { state: ReturnType<typeof useSampleRows> }) {
  const visvine = useVisvine();
  const [clearing, setClearing] = useState(false);
  if (!state.hasSamples && !state.seeding) return null;
  const clear = async () => {
    setClearing(true);
    try { await state.clear(); }
    catch (err) { void visvine.ui.toast(err instanceof Error ? err.message : 'Could not clear sample data', 'error'); }
    finally { setClearing(false); }
  };
  // Last on the page whatever its place in the code (`order-last` in Page's
  // column): it names what is shown without pushing it down or covering it.
  return (
    <div className="order-last -mt-2 flex items-center gap-1 self-start rounded-full border border-line-subtle py-0.5 pl-3 pr-0.5 text-xs text-fg-muted">
      <span>Sample data</span>
      <Button size="sm" variant="ghost" disabled={clearing || state.seeding} onClick={() => void clear()}>{clearing ? 'Clearing…' : 'Clear'}</Button>
    </div>
  );
}

/** An empty collection's state with its one way out. */
export function RecordsEmpty({ noun, onAdd }: { noun: string; onAdd?: () => void }) {
  return (
    <EmptyState
      title={`No ${noun} yet`}
      action={
        onAdd ? (
          <Button variant="primary" onClick={onAdd}>
            Add {noun.replace(/s$/, '')}
          </Button>
        ) : undefined
      }
    />
  );
}

