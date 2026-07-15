import { z } from "zod";
import { COMMUNITY_ROLES } from "@/lib/crm/roles";

const FieldDefinitionSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z_]+$/, "Key must be lowercase letters and underscores only"),
    label: z.string().min(1).max(100),
    type: z.enum(["text", "select", "date", "boolean", "number"]),
    options: z.array(z.string().min(1)).optional(),
  })
  .refine((d) => d.type !== "select" || (d.options && d.options.length > 0), {
    message: "select fields must have at least one option",
    path: ["options"],
  });

export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

export const CommunitySettingsSchema = z.object({
  fields: z.array(FieldDefinitionSchema).max(20),
});

export const MemberListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().max(200).optional(),
  filter: z
    .string()
    .regex(/^[a-z_]+:.+$/, "Filter must be in format field:value")
    .optional(),
  sort: z
    .string()
    .regex(/^[a-z_]+:(asc|desc)$/)
    .default("name:asc"),
});

export const CreateShadowMemberSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  headline: z.string().max(300).optional(),
  private_meta: z.record(z.string(), z.unknown()).optional(),
});

export const PublicFieldPatchSchema = z
  .object({
    field: z.enum(["name", "headline", "bio", "avatar_url", "location", "links"]),
    value: z.unknown(),
  })
  .refine(
    ({ field, value }) => {
      if (field === "links")
        return z
          .array(z.object({ label: z.string(), url: z.string().url() }))
          .safeParse(value).success;
      if (field === "avatar_url")
        return z.string().url().safeParse(value).success;
      return z.string().max(500).safeParse(value).success;
    },
    { message: "value does not match expected type for field" }
  );

export const PrivateFieldPatchSchema = z.object({
  field: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z_]+$/),
  value: z.unknown(),
});

export const RolePatchSchema = z.object({
  role: z.enum(COMMUNITY_ROLES),
});
