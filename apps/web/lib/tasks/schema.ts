// Zod schemas for the Tasks REST routes. Routes parse the JSON body with these
// and pass the typed result to lib/tasks/store.ts; assignee membership is
// checked in the store (it needs a DB lookup, not a shape check).

import { z } from 'zod';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const columnCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(HEX_COLOR, 'color must be a #rrggbb hex value').optional(),
});

export const columnPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    color: z.string().regex(HEX_COLOR, 'color must be a #rrggbb hex value').optional(),
  })
  .refine((v) => v.name !== undefined || v.color !== undefined, {
    message: 'nothing to update',
  });

export const columnReorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

const taskFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  assigneeId: z.string().min(1).nullable(),
  dueDate: z.iso.datetime().nullable(),
  labels: z.array(z.string().trim().min(1).max(40)).max(20),
};

export const taskCreateSchema = z.object({
  columnId: z.string().min(1),
  title: taskFields.title,
  description: taskFields.description.default(''),
  assigneeId: taskFields.assigneeId.default(null),
  dueDate: taskFields.dueDate.default(null),
  labels: taskFields.labels.default([]),
});

export const taskPatchSchema = z
  .object({
    title: taskFields.title.optional(),
    description: taskFields.description.optional(),
    assigneeId: taskFields.assigneeId.optional(),
    dueDate: taskFields.dueDate.optional(),
    labels: taskFields.labels.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'nothing to update',
  });

export const taskMoveSchema = z.object({
  columnId: z.string().min(1),
  // Neighbors in the destination column after the drop; both null = only card
  // in the column (or dropped into an empty column).
  beforeTaskId: z.string().min(1).nullable().default(null),
  afterTaskId: z.string().min(1).nullable().default(null),
});

export type ColumnCreateInput = z.infer<typeof columnCreateSchema>;
export type ColumnPatchInput = z.infer<typeof columnPatchSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskPatchInput = z.infer<typeof taskPatchSchema>;
export type TaskMoveInput = z.infer<typeof taskMoveSchema>;
