import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireSession } from '@/lib/session';
import { resolveBrain, principalOf } from '@/lib/notes/brain';
import { readVisible, writeGated } from '@/lib/notes/brainService';
import {
  joinFrontmatter,
  parseFrontmatter,
  splitFrontmatter,
} from '@/lib/notes/shared/markdown';
import { CONNECTOR_LIMITS, isValidSecretName, parseConnectorConfig } from '@/lib/connectors/config';
import { describeConnector } from '@/lib/connectors/service';

/**
 * One connector, for its page in the directory. The list route's row plus the
 * parsed config the Connector tab renders, and — the reason this route exists
 * rather than the page filtering the list — whether each `{{secret:NAME}}` it
 * references is actually stored. That join is the difference between a
 * connector that works and one that 500s on first call, and only the server can
 * see it: secret VALUES are never returned, only that a row exists and when it
 * was last written.
 *
 * PATCH writes the same fields back. The note stays the source of truth: an
 * edit is a frontmatter merge into the existing note, so the body, unknown keys
 * and key order survive, and Raw remains a full-power escape hatch rather than
 * a second way to say the same thing.
 *
 * Admin-only, matching the list route: connector frontmatter is infrastructure
 * config (hosts, header shapes, secret names), not community content.
 */

/** Session → admin-resolved brain, or the response that says why not. */
async function requireConnectorAdmin(communityId: string) {
  const session = await requireSession();
  if (session instanceof Response) return session;
  const resolved = await resolveBrain(session, communityId);
  if (resolved instanceof Response) return resolved;
  if (!resolved.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return resolved;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ communityId: string; name: string }> }
) {
  const { communityId, name } = await params;
  const resolved = await requireConnectorAdmin(communityId);
  if (resolved instanceof Response) return resolved;

  const principal = await principalOf(resolved);
  const connector = await describeConnector(principal, resolved, decodeURIComponent(name));
  if (!connector) {
    return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
  }

  const stored = connector.secrets.length
    ? await prisma.communitySecret.findMany({
        where: { communityId, name: { in: connector.secrets } },
        select: { name: true, updatedAt: true },
      })
    : [];
  const updatedByName = new Map(stored.map((row) => [row.name, row.updatedAt]));

  return NextResponse.json({
    connector: {
      ...connector,
      secrets: connector.secrets.map((secretName) => ({
        name: secretName,
        set: updatedByName.has(secretName),
        updatedAt: updatedByName.get(secretName) ?? null,
      })),
    },
  });
}

interface PatchBody {
  description?: unknown;
  baseUrl?: unknown;
  allow?: unknown;
  headers?: unknown;
  timeoutMs?: unknown;
  dsnSecret?: unknown;
  maxRows?: unknown;
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

/** An integer within a clamp range, or the message saying why it isn't. */
function inRange(
  value: unknown,
  label: string,
  range: { min: number; max: number },
): number | string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} must be a number`;
  const n = Math.floor(value);
  if (n < range.min || n > range.max) return `${label} must be between ${range.min} and ${range.max}`;
  return n;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string; name: string }> }
) {
  const { communityId, name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const resolved = await requireConnectorAdmin(communityId);
  if (resolved instanceof Response) return resolved;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return bad('Invalid JSON body');
  }

  const principal = await principalOf(resolved);
  const path = `connectors/${name}.md`;
  const content = await readVisible(principal, resolved, path);
  if (content === null) return NextResponse.json({ error: 'Connector not found' }, { status: 404 });

  const fm = parseFrontmatter(content);
  const alias = typeof fm.alias === 'string' ? fm.alias : null;
  if (alias !== 'http' && alias !== 'postgres') {
    // Nothing below knows which fields are even meaningful. Switching a
    // connector between executors rewrites every other key with it, so that
    // stays a Raw-tab edit rather than a half-applied merge here.
    return bad('Set `alias: http` or `alias: postgres` in the Raw tab first');
  }

  // Reject fields belonging to the other executor outright: silently dropping
  // them would look like a successful save that didn't save.
  const wrongAlias =
    alias === 'http'
      ? ['dsnSecret', 'maxRows'].filter((k) => body[k as keyof PatchBody] !== undefined)
      : ['baseUrl', 'allow', 'headers'].filter((k) => body[k as keyof PatchBody] !== undefined);
  if (wrongAlias.length > 0) {
    return bad(`${wrongAlias.join(', ')} ${wrongAlias.length === 1 ? 'is' : 'are'} not a ${alias} connector field`);
  }

  if (body.description !== undefined) {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description) fm.description = description;
    else delete fm.description;
  }

  if (body.timeoutMs !== undefined) {
    const timeout = inRange(body.timeoutMs, 'Timeout', CONNECTOR_LIMITS.timeoutMs);
    if (typeof timeout === 'string') return bad(timeout);
    fm.timeout_ms = timeout;
  }

  if (alias === 'http') {
    if (body.baseUrl !== undefined) {
      if (typeof body.baseUrl !== 'string') return bad('Base URL must be a string');
      fm.base_url = body.baseUrl.trim().replace(/\/+$/, '');
    }
    if (body.allow !== undefined) {
      if (!Array.isArray(body.allow) || body.allow.some((r) => typeof r !== 'string')) {
        return bad('Allow must be a list of "METHOD /path" strings');
      }
      fm.allow = (body.allow as string[]).map((r) => r.trim()).filter(Boolean);
    }
    if (body.headers !== undefined) {
      if (typeof body.headers !== 'object' || body.headers === null || Array.isArray(body.headers)) {
        return bad('Headers must be an object of name → value');
      }
      const headers = Object.fromEntries(
        Object.entries(body.headers as Record<string, unknown>)
          .map(([key, value]) => [key.trim(), typeof value === 'string' ? value.trim() : ''])
          .filter(([key]) => key.length > 0),
      );
      if (Object.keys(headers).length > 0) fm.headers = headers;
      else delete fm.headers;
    }
  } else {
    if (body.dsnSecret !== undefined) {
      const secretName = typeof body.dsnSecret === 'string' ? body.dsnSecret.trim().toUpperCase() : '';
      if (!isValidSecretName(secretName)) {
        return bad(`Invalid secret name '${secretName}' (use A-Z, 0-9 and _)`);
      }
      // The connector never holds a DSN, only the reference to one — the same
      // invariant parseConnectorConfig enforces on read.
      fm.dsn = `{{secret:${secretName}}}`;
    }
    if (body.maxRows !== undefined) {
      const maxRows = inRange(body.maxRows, 'Row cap', CONNECTOR_LIMITS.maxRows);
      if (typeof maxRows === 'string') return bad(maxRows);
      fm.max_rows = maxRows;
    }
  }

  // The merged note has to be a connector the executors would accept, or the
  // save is refused: an admin editing here can't be allowed to write a note
  // that only the Raw tab could get back out of.
  const parsed = parseConnectorConfig(fm);
  if (!parsed.ok) return bad(parsed.error);

  const written = await writeGated(
    principal,
    resolved,
    path,
    joinFrontmatter(fm, splitFrontmatter(content).body),
  );
  if (written.status === 'denied') {
    return NextResponse.json({ error: written.reason }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
