'use client';

// The kanban board: one DndContext handles both drag types — task cards
// (vertical within / across columns) and column shells (horizontal, admin
// grip-handle only), discriminated by `data.type`. Card moves are applied to
// local state during onDragOver (the standard dnd-kit multi-container
// pattern) and persisted from onDragEnd via the move endpoint, which returns
// the authoritative position; failures restore the pre-drag snapshot.

import { useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { BoardMember, ColumnDTO, TaskDTO } from '../lib/types';
import type { UseBoardResult } from '../lib/useBoard';
import Column from './Column';
import TaskCard from './TaskCard';

interface BoardProps {
  boardApi: UseBoardResult;
  members: BoardMember[];
  isAdmin: boolean;
  onOpenTask: (task: TaskDTO) => void;
  onAddTask: (columnId: string) => void;
  onEditColumn: (column: ColumnDTO) => void;
}

type BoardState = NonNullable<UseBoardResult['board']>;

function columnIdOf(data: { type?: string; task?: TaskDTO; columnId?: string } | undefined, id: string | number, board: BoardState): string | null {
  if (!data) return null;
  if (data.type === 'task') return (data.task && board.tasks.find((t) => t.id === data.task!.id)?.columnId) ?? data.task?.columnId ?? null;
  if (data.type === 'column-drop') return data.columnId ?? null;
  if (data.type === 'column') return String(id);
  return null;
}

export default function Board({ boardApi, members, isAdmin, onOpenTask, onAddTask, onEditColumn }: BoardProps) {
  const { board, setBoard, snapshot, restore, setDragging, commitMove, commitColumnOrder, deleteColumn } = boardApi;
  const [activeTask, setActiveTask] = useState<TaskDTO | null>(null);
  const [activeColumn, setActiveColumn] = useState<ColumnDTO | null>(null);
  const preDragRef = useRef<BoardState | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!board) return null;

  const tasksIn = (columnId: string) => board.tasks.filter((t) => t.columnId === columnId);

  const handleDragStart = ({ active }: DragStartEvent) => {
    preDragRef.current = snapshot();
    setDragging(true);
    const data = active.data.current as { type?: string; task?: TaskDTO } | undefined;
    if (data?.type === 'task' && data.task) {
      setActiveTask(board.tasks.find((t) => t.id === data.task!.id) ?? data.task);
    } else if (data?.type === 'column') {
      setActiveColumn(board.columns.find((c) => c.id === active.id) ?? null);
    }
  };

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || active.id === over.id) return;
    const activeData = active.data.current as { type?: string } | undefined;
    if (activeData?.type !== 'task') return;

    setBoard((s) => {
      if (!s) return s;
      const task = s.tasks.find((t) => t.id === active.id);
      if (!task) return s;
      const overData = over.data.current as { type?: string; task?: TaskDTO; columnId?: string } | undefined;
      const overColumnId = columnIdOf(overData, over.id, s);
      if (!overColumnId) return s;

      const rest = s.tasks.filter((t) => t.id !== task.id);
      const columnTasks = rest.filter((t) => t.columnId === overColumnId);
      let insertAt = columnTasks.length; // default: end of column
      if (overData?.type === 'task' && overData.task) {
        const overIndex = columnTasks.findIndex((t) => t.id === overData.task!.id);
        if (overIndex !== -1) insertAt = overIndex;
      }

      // Rebuild the flat list with the task spliced into the target column at
      // insertAt; array order within a column is the display order.
      const moved = { ...task, columnId: overColumnId };
      const out: TaskDTO[] = [];
      let placed = false;
      let seen = 0;
      for (const t of rest) {
        if (t.columnId === overColumnId) {
          if (seen === insertAt) {
            out.push(moved);
            placed = true;
          }
          seen++;
        }
        out.push(t);
      }
      if (!placed) out.push(moved);
      return { ...s, tasks: out };
    });
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const prev = preDragRef.current;
    preDragRef.current = null;
    setDragging(false);
    const wasTask = activeTask !== null;
    const wasColumn = activeColumn !== null;
    setActiveTask(null);
    setActiveColumn(null);

    if (!over) {
      restore(prev);
      return;
    }

    if (wasColumn) {
      const overData = over.data.current as { type?: string; columnId?: string } | undefined;
      const overColumnId = overData?.type === 'column-drop' ? overData.columnId : String(over.id);
      if (!overColumnId || overColumnId === active.id) return;
      const from = board.columns.findIndex((c) => c.id === active.id);
      const to = board.columns.findIndex((c) => c.id === overColumnId);
      if (from === -1 || to === -1 || from === to) return;
      const reordered = arrayMove(board.columns, from, to);
      setBoard((s) => (s ? { ...s, columns: reordered } : s));
      void commitColumnOrder(reordered.map((c) => c.id), prev);
      return;
    }

    if (wasTask) {
      // onDragOver already placed the card; read its final neighbors.
      const task = board.tasks.find((t) => t.id === active.id);
      if (!task || !prev) return;
      const columnTasks = board.tasks.filter((t) => t.columnId === task.columnId);
      const index = columnTasks.findIndex((t) => t.id === task.id);
      const prevTask = prev.tasks.find((t) => t.id === task.id);
      const prevColumnTasks = prev.tasks.filter((t) => t.columnId === (prevTask?.columnId ?? ''));
      const prevIndex = prevColumnTasks.findIndex((t) => t.id === task.id);
      const unmoved = prevTask?.columnId === task.columnId && prevIndex === index;
      if (unmoved) return;
      const beforeTaskId = index > 0 ? columnTasks[index - 1].id : null;
      const afterTaskId = index < columnTasks.length - 1 ? columnTasks[index + 1].id : null;
      void commitMove(task.id, task.columnId, beforeTaskId, afterTaskId, prev);
    }
  };

  const handleDragCancel = () => {
    restore(preDragRef.current);
    preDragRef.current = null;
    setDragging(false);
    setActiveTask(null);
    setActiveColumn(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex h-full items-start gap-4 overflow-x-auto pb-4">
        <SortableContext items={board.columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
          {board.columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              tasks={tasksIn(column.id)}
              members={members}
              isAdmin={isAdmin}
              onOpenTask={onOpenTask}
              onAddTask={onAddTask}
              onEditColumn={onEditColumn}
              onDeleteColumn={deleteColumn}
            />
          ))}
        </SortableContext>
      </div>
      <DragOverlay>
        {activeTask && <TaskCard task={activeTask} members={members} onOpen={() => {}} overlay />}
        {activeColumn && (
          <div className="w-72 rounded-2xl bg-surface-2 px-3 py-3 opacity-90 shadow-float">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeColumn.color }} />
              <span className="text-sm font-semibold text-text-primary">{activeColumn.name}</span>
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
