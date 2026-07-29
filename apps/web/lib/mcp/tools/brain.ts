/**
 * Brain (knowledge-store) tools — the MCP surface over the community/personal
 * note brains in `lib/notes`. Unlike most tool modules these call the domain
 * layer DIRECTLY (brainService/registry/capture) instead of going through the
 * internal HTTP routes: the brain service already takes an explicit
 * `BrainPrincipal` and applies the folder-visibility lens + write gate itself,
 * so the tool layer only has to build that principal honestly.
 *
 * Tenant boundary: every tool resolves the caller's principal via
 * `requireBrainPrincipal`, which mirrors `lib/notes/brain.ts#resolveBrain` —
 * `isAdmin` (community admins incl. super-admins) OR a live `userCommunity`
 * membership row, else a 403 tool error. The client-supplied `community_id` is
 * always paired with that live membership lookup keyed on the token's userId.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";
import { ApiError } from "@/lib/mcp/apiClient";
import { withCtx } from "@/lib/mcp/tools/_helpers";
import type { McpContext } from "@/lib/mcp/auth";
import {
  searchBrain,
  readVisible,
  visibleVault,
  writeGated,
  appendLogGated,
  listVisibleSources,
  readSourceVisible,
} from "@/lib/notes/brainService";
import { brainAccessFor, ensureAccessSeeded } from "@/lib/notes/access";
import { resolvePersonalBrain } from "@/lib/notes/brain";
import { personalPrincipal } from "@/lib/notes/principal";
import { appendCapture } from "@/lib/notes/capture";
import { SHARED_OWNER_KEY, type Brain } from "@/lib/notes/store";
import { folderIdOfPath } from "@/lib/notes/shared/placement";
import { principalCanWrite, principalLevelName } from "@/lib/notes/shared/permissions";
import { OPEN_ACCESS, readableRoots } from "@/lib/notes/shared/authz";
import type { BrainPrincipal, WriteResult } from "@/lib/notes/shared/brainTypes";
import type { NoteMeta } from "@/lib/notes/shared/types";

type BrainScope = "shared" | "personal";

const scopeArg = z
  .enum(["shared", "personal"])
  .optional()
  .describe(
    "Which brain: 'shared' = the community's brain, 'personal' = your own personal space (your personal community's brain)",
  );

/**
 * Build the BrainPrincipal for the token identity, enforcing community
 * membership (the hard tenant boundary — mirrors resolveBrain in lib/notes).
 * Normal communities also seed their grant rows on first touch (legacy
 * registry migration / member grandfathering); personal spaces are never gated.
 */
async function requireBrainPrincipal(
  ctx: McpContext,
  communityId: string,
): Promise<BrainPrincipal> {
  if (!communityId) throw new ApiError(400, "community_id is required");
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { personalOwnerId: true },
  });
  if (!community) throw new ApiError(404, `Unknown community '${communityId}'`);
  const admin = await isAdmin(ctx.userId, communityId, ctx.email);
  if (!admin) {
    const membership = await prisma.userCommunity.findUnique({
      where: { userId_communityId: { userId: ctx.userId, communityId } },
      select: { userId: true },
    });
    if (!membership) {
      throw new ApiError(403, `You are not a member of community '${communityId}'`);
    }
  }
  let access = OPEN_ACCESS;
  if (community.personalOwnerId === null) {
    await ensureAccessSeeded(communityId);
    access = await brainAccessFor(communityId, ctx.userId);
  }
  return {
    userId: ctx.userId,
    email: ctx.email,
    name: ctx.name || "Unknown",
    communityId,
    communityAdmin: admin,
    access,
  };
}

/**
 * Resolve the (principal, brain) pair a call targets. 'shared' = the requested
 * community's brain under the requested-community principal; 'personal' = the
 * caller's PERSONAL COMMUNITY brain (`me:<userId>`, provisioned on demand)
 * under their personal principal — personal context lives there, not in a
 * per-community personal brain.
 */
async function resolveTarget(
  ctx: McpContext,
  communityId: string,
  scope: BrainScope,
): Promise<{ p: BrainPrincipal; brain: Brain }> {
  const p = await requireBrainPrincipal(ctx, communityId);
  if (scope === "shared") {
    return { p, brain: { communityId, ownerKey: SHARED_OWNER_KEY } };
  }
  const identity = { userId: ctx.userId, name: ctx.name || "Unknown", email: ctx.email };
  const brain = await resolvePersonalBrain(identity);
  return { p: personalPrincipal(identity), brain };
}

/** Map an apply-or-deny WriteResult into a clean tool error on denial. */
function unwrapWrite(result: WriteResult): { status: "applied"; path: string } {
  if (result.status === "denied") throw new ApiError(403, `Write denied: ${result.reason}`);
  return result;
}

function indexLine(m: NoteMeta): string {
  const desc = m.frontmatter.description;
  return desc ? `- ${m.title} (${m.path}) — ${desc}` : `- ${m.title} (${m.path})`;
}

export function registerBrainTools(server: McpServer): void {
  server.registerTool(
    "brain_search",
    {
      description:
        "Search a community brain (knowledge store of markdown notes) with fused retrieval: keyword (BM25) + semantic (vector) + link-context ranking. Searches the shared community brain by default; pass scope:'personal' for your personal space (your personal community's brain). Only notes you're allowed to read are searched. Returns a ranked list of matches with paths you can pass to brain_read.",
      inputSchema: {
        community_id: z.string().describe("The community whose brain to search"),
        query: z.string().describe("Natural-language or keyword search query"),
        scope: scopeArg,
        k: z.number().int().min(1).max(50).optional().describe("Max results (default 8)"),
        type: z.string().optional().describe("Filter by frontmatter `type` (e.g. 'Playbook')"),
        tags: z.array(z.string()).optional().describe("Require ALL of these tags"),
        folder_id: z
          .string()
          .optional()
          .describe("Restrict to one top-level folder ('' = brain root)"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "content:read", async (ctx) => {
        const { p, brain } = await resolveTarget(ctx, args.community_id, args.scope ?? "shared");
        const hits = await searchBrain(
          p,
          brain,
          args.query,
          { type: args.type, tags: args.tags, folderId: args.folder_id },
          args.k,
        );
        if (hits.length === 0) return "No matching notes.";
        return hits
          .map((h) => {
            // Source hits are chunks of an uploaded file — readable via
            // brain_source_read, not brain_read.
            const label = h.kind === "source" ? `- [source] ${h.title} (${h.path}#${h.seq})` : `- ${h.title} (${h.path})`;
            return h.snippet ? `${label} — ${h.snippet}` : label;
          })
          .join("\n");
      }),
  );

  server.registerTool(
    "brain_read",
    {
      description:
        "Read one note from a community brain by its path (e.g. 'deals/canva.md'). Reads the shared community brain by default; pass scope:'personal' for your personal space. Returns the full markdown, or a not-accessible message if the note doesn't exist or you can't read it.",
      inputSchema: {
        community_id: z.string(),
        path: z.string().describe("Brain-relative note path, e.g. 'projects/acme.md'"),
        scope: scopeArg,
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "content:read", async (ctx) => {
        const { p, brain } = await resolveTarget(ctx, args.community_id, args.scope ?? "shared");
        const content = await readVisible(p, brain, args.path);
        return content ?? `No accessible note: ${args.path}`;
      }),
  );

  server.registerTool(
    "brain_index",
    {
      description:
        "List the notes in a community brain (title, path, and description when present) — the table of contents an agent should scan before reading or writing. Shared brain by default; pass scope:'personal' for your own. Optionally restrict to one top-level folder or a path prefix. Only notes you can read are listed.",
      inputSchema: {
        community_id: z.string(),
        scope: scopeArg,
        folder_id: z
          .string()
          .optional()
          .describe("Only notes in this top-level folder ('' = brain root)"),
        path_prefix: z.string().optional().describe("Only notes whose path starts with this prefix"),
        limit: z.number().int().min(1).max(500).optional().describe("Max entries (default 100)"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "content:read", async (ctx) => {
        const { p, brain } = await resolveTarget(ctx, args.community_id, args.scope ?? "shared");
        const { metas } = await visibleVault(p, brain);
        let list = metas;
        if (args.folder_id !== undefined) {
          list = list.filter((m) => folderIdOfPath(m.path) === args.folder_id);
        }
        if (args.path_prefix) {
          list = list.filter((m) => m.path.startsWith(args.path_prefix!));
        }
        list = [...list].sort((a, b) => a.path.localeCompare(b.path));
        const total = list.length;
        if (total === 0) return "No notes.";
        const limit = args.limit ?? 100;
        const shown = list.slice(0, limit);
        const lines = shown.map(indexLine);
        if (total > shown.length) lines.push(`(showing ${shown.length} of ${total})`);
        return lines.join("\n");
      }),
  );

  server.registerTool(
    "brain_backlinks",
    {
      description:
        "List the notes that link TO a given note path (its backlinks) in a community brain — useful for finding context before editing or for tracing how a topic is referenced. Shared brain by default. Only notes you can read are considered.",
      inputSchema: {
        community_id: z.string(),
        path: z.string().describe("The target note path, e.g. 'people/jane-doe.md'"),
        scope: scopeArg,
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "content:read", async (ctx) => {
        const { p, brain } = await resolveTarget(ctx, args.community_id, args.scope ?? "shared");
        const { metas } = await visibleVault(p, brain);
        const target = args.path;
        const alt = target.toLowerCase().endsWith(".md")
          ? target.slice(0, -3)
          : `${target}.md`;
        const backlinks = metas
          .filter((m) => m.linkTargets.includes(target) || m.linkTargets.includes(alt))
          .sort((a, b) => a.path.localeCompare(b.path));
        if (backlinks.length === 0) return `No accessible notes link to ${args.path}.`;
        return backlinks.map(indexLine).join("\n");
      }),
  );

  server.registerTool(
    "brain_write",
    {
      description:
        "Create or overwrite one markdown note in a community brain (full-content write, revision history kept). Writes go to YOUR PERSONAL SPACE by default — to write into the shared community brain you must pass scope:'shared' explicitly, and the write is gated on your access to the target folder (denials explain why). Prefer brain_read first when editing so you don't clobber content.",
      inputSchema: {
        community_id: z.string(),
        path: z.string().describe("Brain-relative note path ending in .md, e.g. 'ideas/pricing.md'"),
        content: z.string().describe("The full markdown content of the note"),
        scope: scopeArg.describe(
          "Target brain — defaults to 'personal' (your private brain); pass 'shared' explicitly to write the community brain",
        ),
      },
    },
    (args, extra) =>
      withCtx(extra, "content:write", async (ctx) => {
        const scope = args.scope ?? "personal";
        const { p, brain } = await resolveTarget(ctx, args.community_id, scope);
        // Agent-originated write: stamp the revision so human vs AI edits stay
        // distinguishable (McpContext carries no client name — generic 'mcp').
        const result = unwrapWrite(await writeGated(p, brain, args.path, args.content, "agent", "mcp"));
        return { status: "applied", scope, path: result.path };
      }),
  );

  server.registerTool(
    "brain_append_log",
    {
      description:
        "Append a dated, attributed entry to a note's '## Log' section (creating the section if absent) — the right way to add an update to an existing note without rewriting it. Defaults to your personal brain; pass scope:'shared' for a shared-brain note (gated on folder write access).",
      inputSchema: {
        community_id: z.string(),
        path: z.string().describe("Path of the existing note to append to"),
        entry: z.string().describe("The log entry text (one update; date + author are added for you)"),
        scope: scopeArg.describe(
          "Target brain — defaults to 'personal'; pass 'shared' explicitly for the community brain",
        ),
      },
    },
    (args, extra) =>
      withCtx(extra, "content:write", async (ctx) => {
        const scope = args.scope ?? "personal";
        const { p, brain } = await resolveTarget(ctx, args.community_id, scope);
        const result = unwrapWrite(await appendLogGated(p, brain, args.path, args.entry, "agent", "mcp"));
        return { status: "applied", scope, path: result.path };
      }),
  );

  server.registerTool(
    "brain_capture",
    {
      description:
        "Quick-capture a thought, fact, or observation into your PRIVATE monthly log (log/YYYY-MM.md in your personal space) — the zero-friction inbox for raw material that may later be distilled into proper notes. Optionally attach note refs and tags. Returns the log path written.",
      inputSchema: {
        community_id: z.string(),
        text: z.string().describe("The capture text (one dated line is appended)"),
        refs: z.array(z.string()).optional().describe("Related note paths to reference"),
        tags: z.array(z.string()).optional().describe("Tags to attach, without '#'"),
      },
    },
    (args, extra) =>
      withCtx(extra, "content:write", async (ctx) => {
        const { p, brain: personal } = await resolveTarget(ctx, args.community_id, "personal");
        const path = await appendCapture(p, personal, args.text, args.refs, args.tags);
        return { status: "applied", scope: "personal", path };
      }),
  );

  server.registerTool(
    "brain_sources_list",
    {
      description:
        "List the Context Sources (uploaded files/tables — csv, markdown, txt) attached to a community brain. Sources are non-note knowledge: they feed brain_search as chunk hits and are readable with brain_source_read, but never appear in the community's context/workspace. Only sources you're allowed to read are listed. Shared brain by default; scope:'personal' for your own.",
      inputSchema: {
        community_id: z.string(),
        scope: scopeArg,
        folder_id: z
          .string()
          .optional()
          .describe("Only sources in this top-level folder ('' = brain root)"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "content:read", async (ctx) => {
        const { p, brain } = await resolveTarget(ctx, args.community_id, args.scope ?? "shared");
        const sources = await listVisibleSources(p, brain, args.folder_id);
        if (sources.length === 0) return "No sources.";
        return sources
          .map(
            (s) =>
              `- ${s.name} (${s.path}) — ${s.kind}, ${s.sizeBytes} bytes, ${s.status}${s.truncated ? ", truncated" : ""}`,
          )
          .join("\n");
      }),
  );

  server.registerTool(
    "brain_source_read",
    {
      description:
        "Read the extracted text of one Context Source (uploaded file/table) by its brain path, paged by character offset — call again with a higher offset for more. Shared brain by default; scope:'personal' for your own. Returns a not-accessible message if the source doesn't exist or you can't read it.",
      inputSchema: {
        community_id: z.string(),
        path: z.string().describe("Brain-relative source path, e.g. 'deals/pricing.csv'"),
        scope: scopeArg,
        offset: z.number().int().min(0).optional().describe("Character offset (default 0)"),
        max_chars: z
          .number()
          .int()
          .min(1)
          .max(100_000)
          .optional()
          .describe("Max characters returned (default 20000)"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "content:read", async (ctx) => {
        const { p, brain } = await resolveTarget(ctx, args.community_id, args.scope ?? "shared");
        const page = await readSourceVisible(p, brain, args.path, {
          offsetChars: args.offset,
          maxChars: args.max_chars,
        });
        if (!page) return `No accessible source: ${args.path}`;
        const offset = args.offset ?? 0;
        const header = `${page.meta.name} (${page.meta.kind}, chars ${offset}-${offset + page.text.length} of ${page.totalChars})`;
        return `${header}\n\n${page.text}`;
      }),
  );

  server.registerTool(
    "brain_folders",
    {
      description:
        "Show your access map for a community's SHARED brain: the subtree roots you can read (with your level — view/comment/edit/full — and whether you can write there), plus the restricted folders you can see into. Access is grant-based and flows down the folder tree ('' = the brain root); a restricted folder cuts inheritance, so it's only visible if a grant reaches you on or inside it. Joining a community does not by itself grant brain access.",
      inputSchema: { community_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "content:read", async (ctx) => {
        const p = await requireBrainPrincipal(ctx, args.community_id);
        const roots = p.communityAdmin ? [""] : readableRoots(p.access);
        return {
          readable_roots: roots.map((path) => ({
            path,
            your_level: principalLevelName(p, path),
            can_write: principalCanWrite(p, path),
          })),
          restricted_folders: p.access.restricted,
          locked_folders: p.access.locked,
          note:
            "'' is the brain root. Your effective level on any note is the strongest grant that reaches it; restricted folders start a fresh boundary.",
        };
      }),
  );
}
