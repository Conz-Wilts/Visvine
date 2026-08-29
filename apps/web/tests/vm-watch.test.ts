// Watch tickets: what lets a browser onto one machine's socket, for a minute,
// without ever holding the token that opens every machine.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/vm-watch.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { machineRef, mintWatchTicket, TICKET_TTL_SECONDS, verifyWatchTicket, watchUrl } from '@/lib/vm/watch'

const SECRET = 'edge-service-token-for-tests-0000000000'
const SPACE = 'community:blackbird-ventures'
const AGENT = 'weekly-digest'
const MACHINE = machineRef(SPACE, AGENT)

test('a freshly minted ticket is good for its own machine', () => {
  const ticket = mintWatchTicket(SPACE, AGENT, SECRET)
  assert.equal(verifyWatchTicket(ticket, MACHINE, SECRET), null)
})

test('a ticket is good for exactly one machine', () => {
  const ticket = mintWatchTicket(SPACE, AGENT, SECRET)
  // The interesting refusal: a real ticket, from a real admin, pointed at
  // somebody else's machine.
  assert.match(verifyWatchTicket(ticket, machineRef(SPACE, 'other-agent'), SECRET) ?? '', /different machine/)
  assert.match(verifyWatchTicket(ticket, machineRef('community:someone-else', AGENT), SECRET) ?? '', /different machine/)
})

test('a ticket expires', () => {
  const now = Date.now()
  const ticket = mintWatchTicket(SPACE, AGENT, SECRET, now)
  assert.equal(verifyWatchTicket(ticket, MACHINE, SECRET, now + (TICKET_TTL_SECONDS - 1) * 1000), null)
  assert.match(verifyWatchTicket(ticket, MACHINE, SECRET, now + (TICKET_TTL_SECONDS + 1) * 1000) ?? '', /expired/)
})

test('a ticket nobody signed, or signed with another secret, is refused', () => {
  const ticket = mintWatchTicket(SPACE, AGENT, SECRET)
  assert.match(verifyWatchTicket(ticket, MACHINE, 'a-different-secret') ?? '', /not signed/)

  // Tampering with the claims invalidates the signature over them.
  const [body] = ticket.split('.')
  const forgedClaims = Buffer.from(
    JSON.stringify({ machine: MACHINE, exp: Math.floor(Date.now() / 1000) + 86_400 }),
  ).toString('base64url')
  const forged = `${forgedClaims}.${ticket.split('.')[1]}`
  assert.notEqual(forgedClaims, body)
  assert.match(verifyWatchTicket(forged, MACHINE, SECRET) ?? '', /not signed/)

  for (const malformed of ['', 'nonsense', 'a.b.c', `${body}.`]) {
    assert.notEqual(verifyWatchTicket(malformed, MACHINE, SECRET), null, malformed)
  }
})

test('the socket URL carries the ticket and switches scheme', () => {
  const ticket = mintWatchTicket(SPACE, AGENT, SECRET)
  const url = new URL(watchUrl('https://edge.example.com', SPACE, AGENT, ticket))
  assert.equal(url.protocol, 'wss:')
  assert.equal(url.pathname, '/watch')
  assert.equal(url.searchParams.get('space'), SPACE)
  assert.equal(url.searchParams.get('agent'), AGENT)
  assert.equal(url.searchParams.get('ticket'), ticket)
})
