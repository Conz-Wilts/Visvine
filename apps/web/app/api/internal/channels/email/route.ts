import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { deliverMessage } from '@/lib/agents/channels';
import { clean, MAX_BODY, MAX_SUBJECT, parseAgentAddress } from '@/lib/agents/shared/channels';

export const dynamic = 'force-dynamic';

/** What an inbound-email provider posts. Deliberately the small common subset. */
const bodySchema = z.object({
  to: z.string().min(3),
  from: z.string().min(3),
  subject: z.string().default(''),
  text: z.string().default(''),
  /** The provider's own id, so a retried delivery is not a second run. */
  messageId: z.string().max(400).optional(),
  fromName: z.string().max(200).optional(),
});

/** The bare address out of `Name <a@b.c>`. */
function bareAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value);
  return (angled ? angled[1] : value).trim().toLowerCase();
}

function senderIsProvider(req: NextRequest): boolean {
  const expected = process.env.EMAIL_INBOUND_SECRET;
  // Absent configuration closes the door rather than opening it: with no secret
  // there is no inbound email, which is the safe reading of "not set up yet".
  if (!expected || expected.length < 24) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Email in.
 *
 * An agent answers on `<agent>@<space>.<domain>`, so the address says both which
 * space this is about and which agent — never inferred from the sender, who may
 * belong to several spaces. The route authenticates the PROVIDER with a shared
 * secret; the SENDER is authenticated separately, by matching the From address
 * against the space's members, which is where the real gate is.
 *
 * The route always answers 200 to a provider it recognises, even when the
 * message is refused: a bounce loop helps nobody, and the refusal is recorded
 * here where it can be looked at.
 */
export async function POST(req: NextRequest) {
  if (!senderIsProvider(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'malformed message' }, { status: 400 });
  const { to, from, subject, text, messageId, fromName } = parsed.data;

  const domain = process.env.AGENT_EMAIL_DOMAIN;
  if (!domain) return NextResponse.json({ error: 'inbound email is not configured' }, { status: 503 });

  const address = parseAgentAddress(bareAddress(to), domain);
  if (!address) return NextResponse.json({ ok: false, reason: 'unroutable_address' });

  // The address carries a space SLUG; spaces are addressed by id everywhere
  // else (`community:blackbird-ventures`), so this is the one translation — the
  // slug is the id's last segment. Two spaces whose ids end the same way is
  // ambiguity, and ambiguity is refused rather than guessed: delivering
  // somebody's message to the wrong tenant is the worst outcome available here.
  const candidates = await prisma.space.findMany({
    where: { id: { endsWith: `:${address.spaceSlug}` } },
    select: { id: true },
    take: 2,
  });
  if (candidates.length !== 1) {
    logger.warn('agents.channel.address_unresolved', { slug: address.spaceSlug, matches: candidates.length });
    return NextResponse.json({ ok: false, reason: candidates.length === 0 ? 'unknown_space' : 'ambiguous_space' });
  }
  const space = candidates[0];

  const result = await deliverMessage({
    channel: 'email',
    spaceId: space.id,
    agentName: address.agentName,
    from: { email: bareAddress(from), display: fromName },
    subject: clean(subject, MAX_SUBJECT),
    body: clean(text, MAX_BODY),
    externalId: messageId ?? null,
  });

  if (!result.ok) {
    logger.warn('agents.channel.email_refused', { spaceId: space.id, agent: address.agentName, reason: result.reason });
    return NextResponse.json({ ok: false, reason: result.reason });
  }
  return NextResponse.json({ ok: true, agent: result.agentName });
}
