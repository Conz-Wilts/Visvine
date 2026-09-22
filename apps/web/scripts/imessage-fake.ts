/**
 * Text the seeded space's line without a phone.
 *
 * Posts a Sendblue-shaped payload to the local inbound door, signed with the
 * deployment's webhook secret, from one of the seed's anchor phones (verified
 * by `pnpm db:seed`). Against `pnpm dev`:
 *
 *   pnpm --filter @visvine/web imessage:fake "what did we decide about SSO?"
 *   pnpm --filter @visvine/web imessage:fake --from admin "add a note: met Sam today"
 *
 * Needs SENDBLUE_API_KEY_ID / SENDBLUE_API_SECRET / SENDBLUE_WEBHOOK_SECRET in
 * .env (any values locally — the reply send will warn and skip without real
 * ones; the run itself, and its summary on the agent's page, are real).
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { ANCHORS } from './seed/space'
import { IMESSAGE_LINE } from './seed/steps/machinery'
import { normalizePhone } from '../lib/imessage/shared/phone'

async function main() {
  const args = process.argv.slice(2)
  let who = 'member'
  const words: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from') who = args[++i] ?? who
    else words.push(args[i])
  }
  const text = words.join(' ').trim() || 'What changed this week?'
  const anchor = ANCHORS.find((a) => a.id.endsWith(who)) ?? ANCHORS[1]
  const from = normalizePhone(anchor.profile.phone, '64')
  if (!from) throw new Error(`anchor phone ${anchor.profile.phone} is not a number`)

  const secret = process.env.SENDBLUE_WEBHOOK_SECRET
  if (!secret) throw new Error('SENDBLUE_WEBHOOK_SECRET is not set')
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const payload = {
    message_handle: `fake-${randomUUID()}`,
    from_number: from,
    sendblue_number: IMESSAGE_LINE,
    to_number: IMESSAGE_LINE,
    content: text,
    is_outbound: false,
    status: 'RECEIVED',
    date_sent: new Date().toISOString(),
    service: 'iMessage',
  }
  console.log(`→ ${anchor.name} (${from}) texts ${IMESSAGE_LINE}: ${text}`)
  const res = await fetch(`${base}/api/hooks/imessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sb-signing-secret': secret },
    body: JSON.stringify(payload),
  })
  console.log(res.status, await res.text())
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
