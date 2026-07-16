'use client';

import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui';
import type { BoardMember, ColumnDTO, TaskDTO } from '../lib/types';
import TaskCard from './TaskCard';

interface ColumnProps {
  column: ColumnDTO;
  tasks: TaskDTO[];
  members: BoardMember[];
  isAdmin: boolean;
  onOpenTask: (task: TaskDTO) => void;
  onAddTask: (columnId: string) => void;
  onEditColumn: (column: ColumnDTO) => void;
  onDeleteColumn: (columnId: string) => Promise<void>;
}

export default function Column({
  column,
  tasks,
  members,
  isAdmin,
  onOpenTask,
  onAddTask,
  onEditColumn,
  onDeleteColumn,
}: ColumnProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Column shells are sortable (horizontal reorder) but only via the admin
  // grip handle, so card dragging inside never fights the column drag.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: 'column' },
    disabled: !isAdmin,
  });

  // Separate droppable for the card area so tasks can be dropped into an
  // empty column (no task sortables to collide with).
  const { setNodeRef: setDropRef } = useDroppable({
    id: `column-drop-${column.id}`,
    data: { type: 'column-drop', columnId: column.id },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex w-72 shrink-0 flex-col rounded-2xl bg-surface-2 ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: column.color }} />
        <h3 className="truncate text-sm font-semibold text-text-primary">{column.name}</h3>
        <span className="text-xs text-text-muted">{tasks.length}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {isAdmin && (
            <>
              <button
                {...attributes}
                {...listeners}
                aria-label={`Reorder ${column.name}`}
                className="cursor-grab rounded-md p-1 text-text-muted hover:bg-surface-1 hover:text-text-secondary active:cursor-grabbing"
              >
                <GripHorizontal className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onEditColumn(column)}
                aria-label={`Edit ${column.name}`}
                className="rounded-md p-1 text-text-muted hover:bg-surface-1 hover:text-text-secondary"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                aria-label={`Delete ${column.name}`}
                className="rounded-md p-1 text-text-muted hover:bg-surface-1 hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <div ref={setDropRef} className="flex min-h-[3rem] flex-1 flex-col gap-2 overflow-y-auto px-3 pb-2">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} members={members} onOpen={onOpenTask} />
          ))}
        </SortableContext>
      </div>

      <button
        onClick={() => onAddTask(column.id)}
        className="mx-3 mb-3 flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-1 hover:text-text-secondary"
      >
        <Plus className="h-4 w-4" /> Add task
      </button>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${column.name}"?`}
        body={
          tasks.length > 0
            ? `This column and its ${tasks.length} task${tasks.length === 1 ? '' : 's'} will be permanently deleted.`
            : 'This column will be permanently deleted.'
        }
        confirmLabel="Delete column"
        destructive
        onConfirm={async () => {
          await onDeleteColumn(column.id);
          setConfirmDelete(false);
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
