'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Avatar } from '@/components/ui';
import type { BoardMember, TaskDTO } from '../lib/types';

function dueDateTone(dueDate: string): string {
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today ? 'bg-red-50 text-red-600' : 'bg-surface-2 text-text-secondary';
}

function formatDueDate(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface TaskCardProps {
  task: TaskDTO;
  members: BoardMember[];
  onOpen: (task: TaskDTO) => void;
  /** Static render inside DragOverlay — no sortable wiring. */
  overlay?: boolean;
}

export default function TaskCard({ task, members, onOpen, overlay = false }: TaskCardProps) {
  const sortable = useSortable({
    id: task.id,
    data: { type: 'task', task },
    disabled: overlay,
  });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;

  const assignee = task.assigneeId
    ? members.find((m) => m.userId === task.assigneeId)
    : undefined;

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={
        overlay
          ? undefined
          : { transform: CSS.Transform.toString(transform), transition }
      }
      {...(overlay ? {} : { ...attributes, ...listeners })}
      onClick={() => onOpen(task)}
      className={`cursor-pointer rounded-xl border border-border-subtle bg-surface-1 p-3 shadow-soft transition-shadow hover:shadow-md ${
        isDragging ? 'opacity-40' : ''
      } ${overlay ? 'rotate-2 shadow-float' : ''}`}
    >
      <p className="text-sm font-medium leading-snug text-text-primary">{task.title}</p>
      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((label) => (
            <span
              key={label}
              className="rounded-full bg-brand-light-bg px-2 py-0.5 text-[10px] font-semibold text-brand-green"
            >
              {label}
            </span>
          ))}
        </div>
      )}
      {(task.dueDate || task.assigneeId) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          {task.dueDate ? (
            <span
              className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${dueDateTone(task.dueDate)}`}
            >
              {formatDueDate(task.dueDate)}
            </span>
          ) : (
            <span />
          )}
          {task.assigneeId && (
            <Avatar
              name={assignee?.name ?? 'Unknown'}
              imageUrl={assignee?.image}
              size="xs"
            />
          )}
        </div>
      )}
    </div>
  );
}
