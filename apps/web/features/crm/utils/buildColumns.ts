import { FieldDefinition } from "@/lib/schemas/crm";

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

/** `canManage` = the viewer holds an alias that manages the community. */
export function buildColumns(
  fields: FieldDefinition[],
  canManage: boolean
): ColumnDef[] {
  const canEditPublic = canManage;
  const canEditPrivate = canManage;

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
