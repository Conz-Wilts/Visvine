import type OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";

export interface NodeRow {
  id: string;
  name: string;
  type: string;
  alias: string | null;
  subtitle: string | null;
  location: string | null;
  tags: string[];
  metadata: unknown;
}

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_BATCH_SIZE = 96;

function stringifyMetadata(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (v == null || v === "") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      parts.push(`${k}: ${v}`);
    } else if (Array.isArray(v)) {
      const flat = v.filter((x) => x != null).map(String).join(", ");
      if (flat) parts.push(`${k}: ${flat}`);
    } else if (typeof v === "object") {
      try {
        parts.push(`${k}: ${JSON.stringify(v)}`);
      } catch {
        /* skip */
      }
    }
  }
  return parts.length ? parts.join(" | ") : null;
}

export function buildEmbeddingInput(n: NodeRow): string {
  const role = n.alias ?? n.type;
  const tagLine = n.tags?.length ? `Tags: ${n.tags.join(", ")}` : null;
  const metaLine = stringifyMetadata(n.metadata);
  const header = `${n.name} — ${role}${n.type && n.type !== role ? ` (${n.type})` : ""}`;
  return [
    header,
    n.subtitle ? `Role: ${n.subtitle}` : null,
    n.location ? `Location: ${n.location}` : null,
    tagLine,
    metaLine,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface EmbedNodesOptions {
  force?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface EmbedNodesResult {
  processed: number;
  total: number;
  errors: string[];
}

export async function embedNodes(
  prisma: PrismaClient,
  openai: OpenAI,
  options: EmbedNodesOptions = {},
): Promise<EmbedNodesResult> {
  const { force = false, onProgress } = options;
  const nodes = force
    ? await prisma.$queryRaw<NodeRow[]>`
        SELECT id, name, type, alias, subtitle, location, tags, metadata FROM nodes
      `
    : await prisma.$queryRaw<NodeRow[]>`
        SELECT id, name, type, alias, subtitle, location, tags, metadata FROM nodes WHERE embedding IS NULL
      `;

  const total = nodes?.length ?? 0;
  if (total === 0) return { processed: 0, total: 0, errors: [] };

  let processed = 0;
  const errors: string[] = [];

  for (let i = 0; i < nodes.length; i += EMBEDDING_BATCH_SIZE) {
    const slice = nodes.slice(i, i + EMBEDDING_BATCH_SIZE);
    const inputs = slice.map(buildEmbeddingInput);
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: inputs,
      });
      for (let j = 0; j < slice.length; j++) {
        const node = slice[j];
        const embedding = response.data[j].embedding;
        const embeddingStr = `[${embedding.join(",")}]`;
        try {
          await prisma.$executeRaw`
            UPDATE nodes SET embedding = ${embeddingStr}::vector WHERE id = ${node.id}
          `;
          processed++;
          if (onProgress) onProgress(processed, total);
        } catch (error) {
          errors.push(`${node.id}: ${String(error)}`);
        }
      }
    } catch (error) {
      errors.push(`batch ${i}: ${String(error)}`);
    }
  }

  return { processed, total, errors };
}
