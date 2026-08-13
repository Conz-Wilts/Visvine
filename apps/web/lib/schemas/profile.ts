import { z } from "zod";

/**
 * The one field of a user's `publicMeta` a PATCH to /api/profile/public may
 * set. Each key carries its own value shape, so the refine is the validation —
 * `links` is a list, `avatar_url` a URL, everything else a bounded string.
 */
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
