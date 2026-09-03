import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireSession } from '@/lib/session';
import { resolveContext, principalOf } from '@/lib/notes/resolve';
import { readVisible, writeGated } from '@/lib/notes/contextService';
import {
  joinFrontmatter,
  parseFrontmatter,
  splitFrontmatter,
} from '@/lib/notes/shared/markdown';
import { parseConnectorPerimeter, SANDBOX_LIMITS } from '@/lib/connectors/config';
import { describeConnector, listConnectorCalls } from '@/lib/connectors/service';

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
 * PATCH is admin-only, matching the list route: connector frontmatter is
 * infrastructure config (hosts, header shapes, secret names), not space
 * content. GET is open to any member who can READ the note (the same
 * visibility lens the service uses), because a `mode: user` connector's page
 * is where a member connects their own account — but a member's response
 * carries no env templates, no secret status and no call log.
 */

/** Session → admin-resolved context, or the response that says why not. */
async function requireConnectorAdmin(spaceId: string) {
  const session = await requireSession();
  if (session instanceof Response) return session;
  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response) return resolved;
  if (!resolved.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return resolved;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; name: string }> }
) {
  const { spaceId, name } = await params;
  const session = await requireSession();
  if (session instanceof Response) return session;
  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response) return resolved;

  const principal = await principalOf(resolved);
  const connector = await describeConnector(principal, resolved, decodeURIComponent(name));
  if (!connector) {
    return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
  }

  if (!resolved.isAdmin) {
    // A member sees the shape (hosts, rules, auth mode) — enough for the
    // Connections card — and nothing an admin would call configuration.
    return NextResponse.json({
      connector: {
        ...connector,
        secrets: [],
        perimeter: connector.perimeter ? { ...connector.perimeter, env: {} } : null,
      },
      calls: [],
    });
  }

  const stored = connector.secrets.length
    ? await prisma.connectorSecret.findMany({
        where: { spaceId, name: { in: connector.secrets } },
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
    // Who ran this connector and what came back — the audit trail narrowed to
    // this note, so the page answers "is anything using this?" without a
    // second round trip.
    calls: await listConnectorCalls(spaceId, connector.path),
  });
}

interface PatchBody {
  /** The console's off switch — false writes `enabled: false`, true deletes the key. */
  enabled?: unknown;
  description?: unknown;
  hosts?: unknown;
  allow?: unknown;
  env?: unknown;
  timeoutMs?: unknown;
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; name: string }> }
) {
  const { spaceId, name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const resolved = await requireConnectorAdmin(spaceId);
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

  // Absent means on, so `true` deletes the key rather than writing the
  // default back into the note.
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return bad('Enabled must be true or false');
    if (body.enabled) delete fm.enabled;
    else fm.enabled = false;
  }

  if (body.description !== undefined) {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description) fm.description = description;
    else delete fm.description;
  }

  if (body.timeoutMs !== undefined) {
    if (typeof body.timeoutMs !== 'number' || !Number.isFinite(body.timeoutMs)) {
      return bad('Timeout must be a number');
    }
    const { min, max } = SANDBOX_LIMITS.timeoutMs;
    const timeout = Math.floor(body.timeoutMs);
    if (timeout < min || timeout > max) return bad(`Timeout must be between ${min} and ${max}`);
    fm.timeout_ms = timeout;
  }

  if (body.hosts !== undefined) {
    if (!Array.isArray(body.hosts) || body.hosts.some((h) => typeof h !== 'string')) {
      return bad('Hosts must be a list of host or host:port strings');
    }
    fm.hosts = (body.hosts as string[]).map((h) => h.trim()).filter(Boolean);
  }

  if (body.allow !== undefined) {
    if (!Array.isArray(body.allow) || body.allow.some((r) => typeof r !== 'string')) {
      return bad('Allow must be a list of "METHOD /path" strings');
    }
    const allow = (body.allow as string[]).map((r) => r.trim()).filter(Boolean);
    if (allow.length > 0) fm.allow = allow;
    else delete fm.allow;
  }

  if (body.env !== undefined) {
    if (typeof body.env !== 'object' || body.env === null || Array.isArray(body.env)) {
      return bad('Env must be an object of NAME \u2192 value template');
    }
    const env = Object.fromEntries(
      Object.entries(body.env as Record<string, unknown>)
        .map(([key, value]) => [key.trim(), typeof value === 'string' ? value.trim() : ''])
        .filter(([key]) => key.length > 0),
    );
    if (Object.keys(env).length > 0) fm.env = env;
    else delete fm.env;
  }

  // The merged note has to be a connector the runtime would accept, or the
  // save is refused: an admin editing here can't be allowed to write a note
  // that only the Raw tab could get back out of.
  const parsed = parseConnectorPerimeter(fm);
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
