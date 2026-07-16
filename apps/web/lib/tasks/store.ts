// Server-side persistence layer for the Tasks kanban board (Prisma-backed),
// mirroring lib/notes/store.ts: plain async functions that throw Error on bad
// input (routes map those to 400 via failFromError). Every function scopes its
// queries by communityId — a row id alone is never trusted.

import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type {
  ColumnCreateInput,
  ColumnPatchInput,
  TaskCreateInput,
  TaskPatchInput,
  TaskMoveInput,
} from './schema';

export interface ColumnDTO {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface TaskDTO {
  id: string;
  columnId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null;
  labels: string[];
  position: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BoardMember {
  userId: string;
  name: string;
  image: string | null;
}

export interface BoardDTO {
  columns: ColumnDTO[];
  tasks: TaskDTO[];
  members: BoardMember[];
}

const DEFAULT_COLUMNS = [
  { name: 'To do', color: '#94a3b8' },
  { name: 'In progress', color: '#3b82f6' },
  { name: 'Done', color: '#22c55e' },
];

type ColumnRow = { id: string; name: string; color: string; position: number };
type TaskRow = {
  id: string;
  columnId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: Date | null;
  labels: string[];
  position: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

function columnToDTO(c: ColumnRow): ColumnDTO {
  return { id: c.id, name: c.name, color: c.color, position: c.position };
}

function taskToDTO(t: TaskRow): TaskDTO {
  return {
    id: t.id,
    columnId: t.columnId,
    title: t.title,
    description: t.description,
    assigneeId: t.assigneeId,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    labels: t.labels,
    position: t.position,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Throws unless `assigneeId` (when set) is an active member of the community. */
async function assertAssignee(communityId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: assigneeId, communityId } },
    select: { status: true },
  });
  if (membership?.status !== 'active') throw new Error('Assignee is not an active member');
}

async function getColumnOrThrow(communityId: string, columnId: string) {
  const column = await prisma.taskColumn.findFirst({ where: { id: columnId, communityId } });
  if (!column) throw new Error('Column not found');
  return column;
}

async function getTaskOrThrow(communityId: string, taskId: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, communityId } });
  if (!task) throw new Error('Task not found');
  return task;
}

/**
 * The whole board in one call: columns + tasks in display order, plus the
 * active member list (the assignee picker's source — the standalone members
 * endpoint is admin-only, so the board carries its own). Seeds the default
 * columns on a community's first visit.
 */
export async function getBoard(communityId: string): Promise<BoardDTO> {
  let columns = await prisma.taskColumn.findMany({
    where: { communityId },
    orderBy: { position: 'asc' },
  });
  if (columns.length === 0) {
    // Two first visitors can race here; the second createMany just adds
    // duplicate-named columns, so re-check inside a transaction instead.
    columns = await prisma.$transaction(async (tx) => {
      const existing = await tx.taskColumn.findMany({
        where: { communityId },
        orderBy: { position: 'asc' },
      });
      if (existing.length > 0) return existing;
      await tx.taskColumn.createMany({
        data: DEFAULT_COLUMNS.map((c, i) => ({ communityId, ...c, position: i })),
      });
      return tx.taskColumn.findMany({ where: { communityId }, orderBy: { position: 'asc' } });
    });
  }

  const [tasks, memberships] = await Promise.all([
    prisma.task.findMany({
      where: { communityId },
      orderBy: [{ columnId: 'asc' }, { position: 'asc' }],
    }),
    prisma.userCommunity.findMany({
      where: { communityId, status: 'active' },
      include: { user: { select: { id: true, name: true, image: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
  ]);

  return {
    columns: columns.map(columnToDTO),
    tasks: tasks.map(taskToDTO),
    members: memberships.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      image: m.user.image,
    })),
  };
}

export async function createColumn(communityId: string, input: ColumnCreateInput): Promise<ColumnDTO> {
  const max = await prisma.taskColumn.aggregate({
    where: { communityId },
    _max: { position: true },
  });
  const column = await prisma.taskColumn.create({
    data: {
      communityId,
      name: input.name,
      ...(input.color ? { color: input.color } : {}),
      position: (max._max.position ?? -1) + 1,
    },
  });
  return columnToDTO(column);
}

export async function updateColumn(
  communityId: string,
  columnId: string,
  input: ColumnPatchInput,
): Promise<ColumnDTO> {
  await getColumnOrThrow(communityId, columnId);
  const column = await prisma.taskColumn.update({
    where: { id: columnId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    },
  });
  return columnToDTO(column);
}

/**
 * Rewrites every column position from the full ordered id list (dense
 * integers). The list must contain exactly the community's column ids.
 */
export async function reorderColumns(communityId: string, orderedIds: string[]): Promise<ColumnDTO[]> {
  return prisma.$transaction(async (tx) => {
    const columns = await tx.taskColumn.findMany({ where: { communityId }, select: { id: true } });
    const existing = new Set(columns.map((c) => c.id));
    if (
      orderedIds.length !== existing.size ||
      orderedIds.some((id) => !existing.has(id)) ||
      new Set(orderedIds).size !== orderedIds.length
    ) {
      throw new Error('orderedIds must contain each board column exactly once');
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.taskColumn.update({ where: { id: orderedIds[i] }, data: { position: i } });
    }
    const updated = await tx.taskColumn.findMany({
      where: { communityId },
      orderBy: { position: 'asc' },
    });
    return updated.map(columnToDTO);
  });
}

/** Deletes a column and (via FK cascade) every task in it. */
export async function deleteColumn(communityId: string, columnId: string): Promise<void> {
  await getColumnOrThrow(communityId, columnId);
  await prisma.taskColumn.delete({ where: { id: columnId } });
}

export async function createTask(
  communityId: string,
  createdBy: string,
  input: TaskCreateInput,
): Promise<TaskDTO> {
  await getColumnOrThrow(communityId, input.columnId);
  await assertAssignee(communityId, input.assigneeId);
  const max = await prisma.task.aggregate({
    where: { columnId: input.columnId },
    _max: { position: true },
  });
  const task = await prisma.task.create({
    data: {
      communityId,
      columnId: input.columnId,
      title: input.title,
      description: input.description,
      assigneeId: input.assigneeId,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      labels: input.labels,
      position: (max._max.position ?? 0) + 1,
      createdBy,
    },
  });
  return taskToDTO(task);
}

export async function updateTask(
  communityId: string,
  taskId: string,
  input: TaskPatchInput,
): Promise<TaskDTO> {
  await getTaskOrThrow(communityId, taskId);
  if (input.assigneeId !== undefined) await assertAssignee(communityId, input.assigneeId);
  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      ...(input.dueDate !== undefined
        ? { dueDate: input.dueDate ? new Date(input.dueDate) : null }
        : {}),
      ...(input.labels !== undefined ? { labels: input.labels } : {}),
    },
  });
  return taskToDTO(task);
}

export async function deleteTask(communityId: string, taskId: string): Promise<void> {
  await getTaskOrThrow(communityId, taskId);
  await prisma.task.delete({ where: { id: taskId } });
}

/**
 * Moves a task into `columnId` between the neighbors the client observed after
 * the drop (`beforeTaskId` = the card above, `afterTaskId` = the card below;
 * either may be null at the column edges). Writes one row in the common case
 * (float midpoint); when consecutive midpoints exhaust the gap the destination
 * column is renormalized to dense integers inside the same transaction.
 */
export async function moveTask(
  communityId: string,
  taskId: string,
  input: TaskMoveInput,
): Promise<TaskDTO> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await tx.task.findFirst({ where: { id: taskId, communityId } });
    if (!existing) throw new Error('Task not found');
    const column = await tx.taskColumn.findFirst({
      where: { id: input.columnId, communityId },
      select: { id: true },
    });
    if (!column) throw new Error('Column not found');

    let position = await placementPosition(tx, taskId, input);
    if (position === null) {
      // Gap exhausted — renormalize the destination column, then re-place.
      const columnTasks = await tx.task.findMany({
        where: { columnId: input.columnId, id: { not: taskId } },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      for (let i = 0; i < columnTasks.length; i++) {
        await tx.task.update({ where: { id: columnTasks[i].id }, data: { position: i + 1 } });
      }
      position = await placementPosition(tx, taskId, input);
      if (position === null) throw new Error('Could not place task');
    }

    return tx.task.update({
      where: { id: taskId },
      data: { columnId: input.columnId, position },
    });
  });
  return taskToDTO(task);
}

/**
 * Computes the float position between the drop neighbors, or null when the
 * midpoint would collide with a neighbor (caller renormalizes and retries).
 * Neighbors must live in the destination column; a stale neighbor id (moved
 * away by someone else since the client's last refetch) throws.
 */
async function placementPosition(
  tx: Prisma.TransactionClient,
  movingTaskId: string,
  input: TaskMoveInput,
): Promise<number | null> {
  const neighbor = async (id: string | null) => {
    if (!id) return null;
    const t = await tx.task.findFirst({
      where: { id, columnId: input.columnId, NOT: { id: movingTaskId } },
      select: { position: true },
    });
    if (!t) throw new Error('Drop position is out of date — refresh the board');
    return t.position;
  };
  const before = await neighbor(input.beforeTaskId);
  const after = await neighbor(input.afterTaskId);

  if (before === null && after === null) {
    const max = await tx.task.aggregate({
      where: { columnId: input.columnId, NOT: { id: movingTaskId } },
      _max: { position: true },
    });
    return (max._max.position ?? 0) + 1;
  }
  if (before !== null && after === null) return before + 1;
  if (before === null && after !== null) return after - 1;
  const mid = (before! + after!) / 2;
  return mid > before! && mid < after! ? mid : null;
}
