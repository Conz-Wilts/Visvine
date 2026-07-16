'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { Alert, Button, PageTitle, Skeleton } from '@/components/ui';
import type { ColumnDTO, TaskDTO } from '../lib/types';
import { useBoard } from '../lib/useBoard';
import Board from './Board';
import ColumnModal from './ColumnModal';
import TaskModal from './TaskModal';

export default function TasksPage() {
  const { currentCommunity, isAdmin } = useCommunity();
  const communityId = currentCommunity?.id ?? null;
  const boardApi = useBoard(communityId);
  const { board, members, loading, error, clearError } = boardApi;

  // null = closed; 'new' = create modal; ColumnDTO = edit modal.
  const [columnModal, setColumnModal] = useState<'new' | ColumnDTO | null>(null);
  // Task modal state: editing an existing task or creating into a column.
  const [editingTask, setEditingTask] = useState<TaskDTO | null>(null);
  const [creatingInColumn, setCreatingInColumn] = useState<string | null>(null);

  if (!currentCommunity) {
    return (
      <div className="p-8 text-sm text-text-muted">Select a community to see its task board.</div>
    );
  }

  const creatingColumn = creatingInColumn
    ? board?.columns.find((c) => c.id === creatingInColumn)
    : undefined;
  const editingColumn = editingTask
    ? board?.columns.find((c) => c.id === editingTask.columnId)
    : undefined;

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <PageTitle title="Tasks" className="pt-0" />
      {isAdmin && (
        <div className="flex justify-end">
          <Button variant="pill-primary" onClick={() => setColumnModal('new')}>
            <span className="inline-flex items-center gap-1.5">
              <Plus className="h-4 w-4" /> Add column
            </span>
          </Button>
        </div>
      )}

      {error && (
        <Alert variant="error" onDismiss={clearError}>
          {error}
        </Alert>
      )}

      {loading && !board ? (
        <div className="flex gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-72 rounded-2xl" />
          ))}
        </div>
      ) : (
        board && (
          <div className="min-h-0 flex-1">
            <Board
              boardApi={boardApi}
              members={members}
              isAdmin={isAdmin}
              onOpenTask={setEditingTask}
              onAddTask={setCreatingInColumn}
              onEditColumn={(column) => setColumnModal(column)}
            />
          </div>
        )
      )}

      {columnModal !== null && (
        <ColumnModal
          column={columnModal === 'new' ? null : columnModal}
          onSave={async (name, color) => {
            if (columnModal === 'new') await boardApi.createColumn(name, color);
            else await boardApi.updateColumn(columnModal.id, { name, color });
          }}
          onClose={() => setColumnModal(null)}
        />
      )}

      {creatingInColumn && creatingColumn && (
        <TaskModal
          task={null}
          columnName={creatingColumn.name}
          members={members}
          onSave={(draft) => boardApi.createTask(creatingInColumn, draft)}
          onClose={() => setCreatingInColumn(null)}
        />
      )}

      {editingTask && (
        <TaskModal
          task={editingTask}
          columnName={editingColumn?.name ?? ''}
          members={members}
          onSave={(draft) => boardApi.updateTask(editingTask.id, draft)}
          onDelete={() => boardApi.deleteTask(editingTask.id)}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  );
}
