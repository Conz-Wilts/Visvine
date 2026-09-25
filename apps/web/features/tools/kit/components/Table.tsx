import type { ReactNode } from 'react';
import { clsx as cx } from 'clsx';
import { CLICKABLE_ROW, RIGHT, TABLE, TD, TH } from './tableClasses';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** Any CSS width — `'120px'`, `'30%'`. */
  width?: string;
}

export interface TableProps<T> {
  columns: Array<TableColumn<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  /** Shown in place of the rows when there are none. */
  empty?: ReactNode;
}

export function Table<T>({ columns, rows, rowKey, onRowClick, empty }: TableProps<T>) {
  return (
    <table className={TABLE}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} style={c.width ? { width: c.width } : undefined} className={cx(TH, c.align === 'right' && RIGHT)}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && empty !== undefined ? (
          <tr>
            <td colSpan={columns.length} className={TD}>{empty}</td>
          </tr>
        ) : (
          rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className={cx(onRowClick && CLICKABLE_ROW)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx(TD, c.align === 'right' && RIGHT)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
