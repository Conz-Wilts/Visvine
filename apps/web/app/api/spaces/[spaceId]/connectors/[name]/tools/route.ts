/**
 * An MCP connector's tools, and which of them it may call.
 *
 * GET    ask the server what it has, and say what this note allows each one.
 * PATCH  change that — one tool, or a whole group, at a time.
 *
 * The list is read LIVE on every GET (lib/connectors/service.ts#listConnectorTools):
 * a server may add or withdraw a tool between one visit and the next, and a
 * permissions screen showing a stale list is one somebody decides on wrongly.
 *
 * Both halves are admin-only, matching every other write to connector
 * frontmatter: what a connector may do is infrastructure config, not space
 * content. In a personal space the owner is the admin by definition
 * (resolveContext, never isAdmin()), which is what makes "your connectors" work
 * with no aliases anywhere.
 *
 * The verdicts are written back into the note's own `tools:` block, so the note
 * stays the connector: an admin can read the same decision in Raw, an agent
 * reading the note sees it, and the gate that enforces it
 * (lib/connectors/toolPolicy.ts) reads the same frontmatter the runtime parses.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { principalOf, resolveContext } from '@/lib/notes/resolve';
import { readVisible, writeGated } from '@/lib/notes/contextService';
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown';
import { ConnectorError, parseConnectorPerimeter } from '@/lib/connectors/config';
import { listConnectorTools, loadConnector } from '@/lib/connectors/service';
import {
  TOOL_PERMISSIONS,
  toolPolicyFrontmatter,
  withPermissions,
  type ToolPermission,
} from '@/lib/connectors/toolPolicy';

type Params = { params: Promise<{ spaceId: string; name: string }> };

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

async function requireConnectorAdmin(spaceId: string) {
  const session = await requireSession();
  if (session instanceof Response) return session;
  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response) return resolved;
  if (!resolved.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return resolved;
}

/** A ConnectorError is a configuration or upstream fault, never a crash. */
function fromConnectorError(e: unknown) {
  if (!(e instanceof ConnectorError)) return null;
  const status = e.code === 'rate_limited' ? 429 : e.code === 'config' ? 400 : 502;
  return NextResponse.json({ error: e.message, code: e.code }, { status });
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { spaceId, name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const resolved = await requireConnectorAdmin(spaceId);
  if (resolved instanceof Response) return resolved;

  const principal = await principalOf(resolved);
  try {
    // Space-only: this is the page for ONE note, and it must describe that
    // connector rather than a same-named one of the admin's own.
    const loaded = await loadConnector(principal, resolved, name, { personal: false });
    if (!loaded) return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
    return NextResponse.json(await listConnectorTools(loaded));
  } catch (e) {
    const mapped = fromConnectorError(e);
    if (mapped) return mapped;
    throw e;
  }
}

interface PatchBody {
  /** Tool names to set — the exact names the server advertises. */
  tools?: unknown;
  /** The verdict to set them to. */
  permission?: unknown;
}

export async function PATCH(req: NextRequest, { params }: Params) {
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

  const permission = body.permission;
  if (typeof permission !== 'string' || !(TOOL_PERMISSIONS as readonly string[]).includes(permission)) {
    return bad(`Permission must be one of ${TOOL_PERMISSIONS.join(', ')}`);
  }
  if (!Array.isArray(body.tools) || body.tools.length === 0 || body.tools.some((t) => typeof t !== 'string' || !t.trim())) {
    return bad('Tools must be a non-empty list of tool names');
  }
  const tools = (body.tools as string[]).map((t) => t.trim());

  const principal = await principalOf(resolved);
  const path = `connectors/${name}.md`;
  const content = await readVisible(principal, resolved, path);
  if (content === null) return NextResponse.json({ error: 'Connector not found' }, { status: 404 });

  const fm = parseFrontmatter(content);
  // The policy is re-read from the note rather than sent by the client: two
  // people on the screen at once must not be able to send each other's list
  // back, and a name the caller invented is only ever one more rule.
  const parsed = parseConnectorPerimeter(fm);
  if (!parsed.ok) return bad(parsed.error);

  const next = withPermissions(parsed.perimeter.tools, tools, permission as ToolPermission);
  const block = toolPolicyFrontmatter(next);
  if (block) fm.tools = block;
  else delete fm.tools;

  // The merged note has to be one the runtime would still accept — an edit
  // here can't leave a connector only the Raw tab could rescue.
  const reparsed = parseConnectorPerimeter(fm);
  if (!reparsed.ok) return bad(reparsed.error);

  const written = await writeGated(principal, resolved, path, joinFrontmatter(fm, splitFrontmatter(content).body));
  if (written.status === 'denied') return NextResponse.json({ error: written.reason }, { status: 403 });

  return NextResponse.json({ ok: true, default: next.default, rules: next.rules });
}
