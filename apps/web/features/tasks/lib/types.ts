// Client-side DTOs for the Tasks board — mirrors the shapes serialized by
// lib/tasks/store.ts (dates are ISO strings).

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

export interface BoardResponse {
  columns: ColumnDTO[];
  tasks: TaskDTO[];
  members: BoardMember[];
}

export interface TaskDraft {
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null;
  labels: string[];
}
