/**
 * Records by schema — a Tool describes its fields once (`FieldDef[]`) and
 * every view of them is drawn from that: a value in a cell (`FieldValue`), its
 * input (`FieldInput`), the whole form (`RecordForm`) and the dialog around it
 * (`RecordDialog`), the table (`RecordTable`) and the board grouped by a
 * select field (`RecordBoard`). The look of a status chip, a sum of money, a
 * due date that has slipped or a person's name is then the kit's, the same in
 * every Tool, and the Tool's own code is only what is particular to it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Avatar, Toggle } from '@visvine/ui';
import { Button } from './Button';
import { DatePicker } from './DatePicker';
import { DataTable } from './DataTable';
import type { DataTableColumn } from './DataTable';
import { Field } from './Field';
import { Input } from './Input';
import { KanbanBoard, KanbanCard, KanbanColumn } from './Kanban';
import type { KanbanMove } from './Kanban';
import { Modal } from './Modal';
import { Select } from './Select';
import { Textarea } from './Textarea';
import { EmptyState } from './EmptyState';
import { useVisvine } from '../hooks';

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
  const compact = Math.abs(n) >= 100_000;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  }).format(n);
}

export function formatNumber(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat().format(n) : '';
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
  /** Tighter: no avatar, dates short. For a card. */
  compact?: boolean;
}

/** One field's value, drawn for reading. Empty is a muted dash. */
export function FieldValue({ field, value, compact = false }: FieldValueProps) {
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
    case 'percent':
      return <span className="tabular-nums">{formatNumber(value)}%</span>;
    case 'date': {
      const days = daysFrom(value);
      return <span className={clsx('tabular-nums', days !== null && days < 0 && 'text-danger')}>{compact ? formatDate(value) : relativeDate(value)}</span>;
    }
    case 'person':
      return (
        <span className="inline-flex min-w-0 items-center gap-2">
          {!compact && <Avatar name={String(value)} size="xs" fallback="initials" />}
          <span className="truncate">{String(value)}</span>
        </span>
      );
    case 'email':
      return (
        <a href={`mailto:${String(value)}`} className="truncate text-fg-link hover:underline" onClick={(e) => e.stopPropagation()}>
          {String(value)}
        </a>
      );
    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" className="truncate text-fg-link hover:underline" onClick={(e) => e.stopPropagation()}>
          {hostOf(String(value))}
        </a>
      );
    case 'boolean':
      return value ? <span className="text-success">Yes</span> : <span className="text-fg-subtle">No</span>;
    case 'rating': {
      const n = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
      return (
        <span className="tracking-wide text-warning" aria-label={`${n} of 5`}>
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
}

/** One field's control, chosen by its kind. */
export function FieldInput({ field, value, onChange, id, autoFocus }: FieldInputProps) {
  switch (field.kind) {
    case 'longtext':
      return <Textarea id={id} rows={4} value={String(value ?? '')} placeholder={field.placeholder} onChange={(e) => onChange(e.currentTarget.value)} />;
    case 'number':
    case 'money':
    case 'percent':
      return (
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          value={value === null || value === undefined ? '' : String(value)}
          placeholder={field.placeholder ?? (field.kind === 'money' ? '0' : undefined)}
          onChange={(e) => onChange(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
        />
      );
    case 'date':
      return <DatePicker id={id} value={value ? String(value).slice(0, 10) : null} onChange={onChange} />;
    case 'select':
      return (
        <Select
          id={id}
          value={value ? String(value) : ''}
          placeholder={field.placeholder ?? 'Choose…'}
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
    case 'rating': {
      const n = Number(value) || 0;
      return (
        <div className="flex gap-1" role="radiogroup" aria-label={field.label}>
          {[1, 2, 3, 4, 5].map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={n === i}
              aria-label={`${i}`}
              onClick={() => onChange(n === i ? 0 : i)}
              className={clsx('text-xl leading-none transition-colors', i <= n ? 'text-warning' : 'text-fg-subtle hover:text-fg-muted')}
            >
              ★
            </button>
          ))}
        </div>
      );
    }
    default:
      return (
        <Input
          id={id}
          autoFocus={autoFocus}
          type={field.kind === 'email' ? 'email' : field.kind === 'url' ? 'url' : 'text'}
          value={String(value ?? '')}
          placeholder={field.placeholder}
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
}

const WIDE: ReadonlySet<FieldKind> = new Set(['longtext', 'tags']);

/**
 * Every field, two to a row on a wide frame; long text and tags take a row of
 * their own. The first text field is focused.
 */
export function RecordForm({ fields, value, onChange, errors = [] }: RecordFormProps) {
  const firstText = fields.find((f) => f.kind === 'text')?.key;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((field) => {
        const id = `vv-field-${field.key}`;
        return (
          <div key={field.key} className={clsx(WIDE.has(field.kind) || field.key === firstText ? 'sm:col-span-2' : undefined)}>
            <Field label={field.label} htmlFor={id} error={errors.includes(field.key) ? `${field.label} is needed` : undefined}>
              <FieldInput id={id} autoFocus={field.key === firstText} field={field} value={value[field.key]} onChange={(v) => onChange({ ...value, [field.key]: v })} />
            </Field>
          </div>
        );
      })}
    </div>
  );
}

/** The keys a record leaves empty that its fields require. */
export function missingRequired(fields: FieldDef[], value: RecordData): string[] {
  return fields.filter((f) => f.required).filter((f) => {
    const v = value[f.key];
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
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
}

/** A record's form in the app's dialog, with Save, Cancel and (for an existing one) Delete. */
export function RecordDialog({ open, title, fields, initial, onClose, onSave, onDelete, saveLabel = 'Save' }: RecordDialogProps) {
  const [value, setValue] = useState<RecordData>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const seeded = useRef(initial);
  useEffect(() => {
    if (open && seeded.current !== initial) {
      seeded.current = initial;
      setValue(initial);
      setErrors([]);
    }
  }, [open, initial]);

  const save = async () => {
    const missing = missingRequired(fields, value);
    setErrors(missing);
    if (missing.length) return;
    setBusy(true);
    try {
      await onSave(value);
    } finally {
      setBusy(false);
    }
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
            <Button variant="danger-text" onClick={() => void onDelete()}>
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
        <RecordForm fields={fields} value={value} onChange={setValue} errors={errors} />
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
}

const RIGHT_KINDS: ReadonlySet<FieldKind> = new Set(['number', 'money', 'percent']);

/** A sortable table of records: one column per field, the first one bold. */
export function RecordTable<T extends { id: string; data: RecordData }>({ fields, rows, onOpen, empty, trailing, maxHeight }: RecordTableProps<T>) {
  const shown = fields.filter((f) => !f.hideInTable);
  const columns: DataTableColumn<T>[] = shown.map((field, i) => ({
    key: field.key,
    header: field.label,
    align: RIGHT_KINDS.has(field.kind) ? 'right' : 'left',
    sortable: true,
    value: (row: T) => row.data[field.key] as unknown,
    render: (row: T) =>
      i === 0 ? <span className="font-medium text-fg">{String(row.data[field.key] ?? '') || 'Untitled'}</span> : <FieldValue field={field} value={row.data[field.key]} />,
  }));
  if (trailing) columns.push({ key: '__trailing', header: '', align: 'right', render: trailing });
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      onRowClick={onOpen}
      maxHeight={maxHeight}
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
  /** Fields shown on a card under its title, by key — default: up to three that are not the column. */
  cardFields?: string[];
  /** A number summed at the top of each column (a money or number field's key). */
  sumField?: string;
}

/** A board with one column per option of a select field; dragging a card sets it. */
export function RecordBoard<T extends { id: string; data: RecordData }>({ fields, groupBy, rows, onMove, onOpen, cardFields, sumField }: RecordBoardProps<T>) {
  const group = fields.find((f) => f.key === groupBy);
  const titleKey = fields[0]?.key;
  const shownOnCard = useMemo(
    () =>
      (cardFields ?? fields.filter((f) => f.key !== groupBy && f.key !== titleKey && f.kind !== 'longtext').slice(0, 3).map((f) => f.key))
        .map((key) => fields.find((f) => f.key === key))
        .filter((f): f is FieldDef => Boolean(f)),
    [cardFields, fields, groupBy, titleKey],
  );
  const sum = sumField ? fields.find((f) => f.key === sumField) : undefined;
  if (!group) return null;
  const columns = optionsOf(group);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const move = (m: KanbanMove) => {
    const row = byId.get(m.cardId);
    if (row && m.toColumnId !== m.fromColumnId) onMove(row, m.toColumnId);
  };
  return (
    <KanbanBoard onMove={move}>
      {columns.map((col) => {
        const inCol = rows.filter((r) => String(r.data[groupBy] ?? '') === col.value);
        const total = sum ? inCol.reduce((acc, r) => acc + (Number(r.data[sum.key]) || 0), 0) : null;
        return (
          <KanbanColumn
            key={col.value}
            id={col.value}
            fill={columns.length <= 4}
            title={
              <>
                <HueDot hue={col.hue} />
                {col.label}
              </>
            }
            count={inCol.length}
            actions={
              total !== null && total > 0 ? (
                <span className="text-xs text-fg-muted tabular-nums">{sum!.kind === 'money' ? formatMoney(total, sum!.currency) : formatNumber(total)}</span>
              ) : undefined
            }
          >
            {inCol.map((row) => (
              <KanbanCard key={row.id} id={row.id} onClick={onOpen ? () => onOpen(row) : undefined}>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">{String(row.data[titleKey] ?? '') || 'Untitled'}</span>
                  {shownOnCard.map((f) =>
                    row.data[f.key] === undefined || row.data[f.key] === null || row.data[f.key] === '' ? null : (
                      <span key={f.key} className="flex min-w-0 items-center text-xs text-fg-muted">
                        <FieldValue field={f} value={row.data[f.key]} compact />
                      </span>
                    ),
                  )}
                </div>
              </KanbanCard>
            ))}
          </KanbanColumn>
        );
      })}
    </KanbanBoard>
  );
}

// ── sample rows ──

/**
 * Put `rows` into a collection the first time a Tool opens on an empty one, so
 * the first look is the Tool working, not an empty page. Once per install
 * (an install-wide state key), so clearing the rows keeps them cleared.
 * Returns `clear`, which deletes every row this seeded.
 */
export function useSampleRows(collection: string, rows: RecordData[]): { seeding: boolean; clear: () => Promise<void> } {
  const visvine = useVisvine();
  const [seeding, setSeeding] = useState(false);
  const key = `vv:sample:${collection}`;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const done = await visvine.state.get<string[]>(key, { scope: 'install' });
        if (done || cancelled || rows.length === 0) return;
        const existing = await visvine.collections.count(collection);
        if (existing.total > 0 || cancelled) {
          await visvine.state.set(key, [], { scope: 'install' });
          return;
        }
        setSeeding(true);
        const ids: string[] = [];
        for (const row of rows) ids.push((await visvine.collections.insert(collection, row)).id);
        await visvine.state.set(key, ids, { scope: 'install' });
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
    const ids = (await visvine.state.get<string[]>(key, { scope: 'install' })) ?? [];
    for (const id of ids) await visvine.collections.delete(collection, id).catch(() => null);
    await visvine.state.set(key, [], { scope: 'install' });
  };
  return { seeding, clear };
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

