/**
 * Kanban primitives — a board of columns of cards, with drag-to-move done in
 * pointer events (no HTML5 drag-and-drop, which is unreliable inside a
 * sandboxed iframe and does not work on touch).
 *
 * Deliberately headless about DATA: the Tool owns the columns and cards and
 * decides what a move means (usually a `context.write` of a note's status),
 * so the board only reports `onMove({ cardId, fromColumnId, toColumnId, index })`
 * and re-renders from whatever the Tool passes next. Nothing is reordered
 * optimistically on the board's behalf.
 *
 *   <KanbanBoard onMove={move}>
 *     <KanbanColumn id="todo" title="To do">
 *       <KanbanCard id="deal-1">Acme renewal</KanbanCard>
 *     </KanbanColumn>
 *   </KanbanBoard>
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { cx } from './cx';

export interface KanbanMove {
  cardId: string;
  fromColumnId: string;
  toColumnId: string;
  /** Position within the destination column, after the move. */
  index: number;
}

interface DragState {
  cardId: string;
  fromColumnId: string;
  /** Pointer offset inside the card at pick-up. */
  dx: number;
  dy: number;
  width: number;
  height: number;
  x: number;
  y: number;
  /** Where the card would land right now. */
  over: { columnId: string; index: number } | null;
}

interface BoardContextValue {
  drag: DragState | null;
  beginDrag: (e: ReactPointerEvent<HTMLElement>, cardId: string, columnId: string) => void;
}

const BoardContext = createContext<BoardContextValue | null>(null);
const ColumnContext = createContext<string | null>(null);

const COLUMN_ATTR = 'data-vv-kanban-column';
const CARD_ATTR = 'data-vv-kanban-card';
/** Pixels of movement before a press becomes a drag (so clicks still work). */
const DRAG_THRESHOLD = 4;

function targetAt(x: number, y: number, doc: Document): { columnId: string; index: number } | null {
  const el = doc.elementFromPoint(x, y);
  const columnEl = el?.closest<HTMLElement>(`[${COLUMN_ATTR}]`);
  if (!columnEl) return null;
  const columnId = columnEl.getAttribute(COLUMN_ATTR) ?? '';
  const cards = Array.from(columnEl.querySelectorAll<HTMLElement>(`[${CARD_ATTR}]`)).filter(
    (c) => !c.classList.contains('vv-kanban__card--dragging'),
  );
  let index = cards.length;
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    if (y < rect.top + rect.height / 2) {
      index = i;
      break;
    }
  }
  return { columnId, index };
}

export interface KanbanBoardProps {
  onMove: (move: KanbanMove) => void;
  className?: string;
  children: ReactNode;
}

export function KanbanBoard({ onMove, className, children }: KanbanBoardProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const beginDrag = useCallback((e: ReactPointerEvent<HTMLElement>, cardId: string, fromColumnId: string) => {
    if (e.button !== 0) return;
    const cardEl = e.currentTarget;
    const doc = cardEl.ownerDocument;
    const rect = cardEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    const onMoveEvt = (ev: PointerEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
        started = true;
      }
      ev.preventDefault();
      setDrag({
        cardId,
        fromColumnId,
        dx: startX - rect.left,
        dy: startY - rect.top,
        width: rect.width,
        height: rect.height,
        x: ev.clientX,
        y: ev.clientY,
        over: targetAt(ev.clientX, ev.clientY, doc),
      });
    };
    const finish = (ev: PointerEvent) => {
      doc.removeEventListener('pointermove', onMoveEvt);
      doc.removeEventListener('pointerup', finish);
      doc.removeEventListener('pointercancel', cancel);
      if (!started) return;
      const over = targetAt(ev.clientX, ev.clientY, doc);
      setDrag(null);
      if (over) onMoveRef.current({ cardId, fromColumnId, toColumnId: over.columnId, index: over.index });
    };
    const cancel = () => {
      doc.removeEventListener('pointermove', onMoveEvt);
      doc.removeEventListener('pointerup', finish);
      doc.removeEventListener('pointercancel', cancel);
      setDrag(null);
    };
    doc.addEventListener('pointermove', onMoveEvt);
    doc.addEventListener('pointerup', finish);
    doc.addEventListener('pointercancel', cancel);
  }, []);

  const value = useMemo(() => ({ drag, beginDrag }), [drag, beginDrag]);

  return (
    <BoardContext.Provider value={value}>
      <div className={cx('vv-kanban', drag && 'vv-kanban--dragging', className)}>{children}</div>
    </BoardContext.Provider>
  );
}

export interface KanbanColumnProps {
  id: string;
  title: ReactNode;
  /** Shown next to the title. */
  count?: number;
  /** Rendered in the column header, opposite the title. */
  actions?: ReactNode;
  /** Shown when the column has no cards. */
  empty?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function KanbanColumn({ id, title, count, actions, empty, className, children }: KanbanColumnProps) {
  const board = useContext(BoardContext);
  const isOver = board?.drag?.over?.columnId === id;
  const hasCards = Array.isArray(children) ? children.length > 0 : Boolean(children);
  const attrs = { [COLUMN_ATTR]: id } as Record<string, string>;
  return (
    <ColumnContext.Provider value={id}>
      <div {...attrs} className={cx('vv-kanban__column', isOver && 'vv-kanban__column--over', className)}>
        <div className="vv-kanban__column-header">
          <span className="vv-kanban__column-title">
            {title}
            {count !== undefined && <span className="vv-kanban__count">{count}</span>}
          </span>
          {actions}
        </div>
        <div className="vv-kanban__cards">
          {children}
          {!hasCards && empty !== undefined && <div className="vv-kanban__empty">{empty}</div>}
        </div>
      </div>
    </ColumnContext.Provider>
  );
}

export interface KanbanCardProps {
  id: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

export function KanbanCard({ id, onClick, className, children }: KanbanCardProps) {
  const board = useContext(BoardContext);
  const columnId = useContext(ColumnContext);
  const drag = board?.drag;
  const dragging = drag?.cardId === id;
  const attrs = { [CARD_ATTR]: id } as Record<string, string>;
  const ghostStyle: CSSProperties | undefined =
    dragging && drag
      ? {
          position: 'fixed',
          left: drag.x - drag.dx,
          top: drag.y - drag.dy,
          width: drag.width,
          height: drag.height,
          pointerEvents: 'none',
          zIndex: 1000,
        }
      : undefined;
  return (
    <>
      <div
        {...attrs}
        className={cx('vv-kanban__card', dragging && 'vv-kanban__card--dragging', onClick && 'vv-kanban__card--clickable', className)}
        onPointerDown={board && columnId !== null ? (e) => board.beginDrag(e, id, columnId) : undefined}
        onClick={onClick}
        // Long-press on touch would otherwise start a text selection instead of a drag.
        style={{ touchAction: 'none' }}
      >
        {children}
      </div>
      {dragging && ghostStyle && (
        <div className="vv-kanban__card vv-kanban__card--ghost" style={ghostStyle} aria-hidden>
          {children}
        </div>
      )}
    </>
  );
}
