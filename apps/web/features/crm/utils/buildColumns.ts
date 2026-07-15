import { FieldDefinition } from "@/lib/schemas/crm";
import { COMMUNITY_ROLES } from "@/lib/crm/roles";

type ColumnLayer = "public" | "private";

export interface ColumnDef {
  key: string;
  label: string;
  type: string;
  layer: ColumnLayer;
  editable: boolean;
  options?: string[];
  activeUserLocked?: boolean; // if true + row is active → read-only
}

export function buildColumns(
  fields: FieldDefinition[],
  currentUserRole: string
): ColumnDef[] {
  const canEditPublic = currentUserRole === "admin";
  const canEditPrivate = currentUserRole === "admin";

  const publicColumns: ColumnDef[] = [
    {
      key: "avatar_url",
      label: "",
      type: "avatar",
      layer: "public",
      editable: false,
    },
    {
      key: "name",
      label: "Name",
      type: "text",
      layer: "public",
      editable: canEditPublic,
      activeUserLocked: true,
    },
    {
      key: "headline",
      label: "Headline",
      type: "text",
      layer: "public",
      editable: canEditPublic,
      activeUserLocked: true,
    },
    {
      key: "email",
      label: "Email",
      type: "text",
      layer: "public",
      editable: false,
    },
    {
      key: "is_active",
      label: "Status",
      type: "badge",
      layer: "public",
      editable: false,
    },
    {
      key: "role",
      label: "Role",
      type: "select",
      layer: "private",
      editable: canEditPublic,
      options: [...COMMUNITY_ROLES],
    },
  ];

  const privateColumns: ColumnDef[] = fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    layer: "private",
    editable: canEditPrivate,
    options: f.options,
  }));

  return [...publicColumns, ...privateColumns];
}
