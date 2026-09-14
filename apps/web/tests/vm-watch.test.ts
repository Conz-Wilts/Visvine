// Watch tickets: what lets a browser onto one machine's socket, for a minute,
// without ever holding the token that opens every machine.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/vm-watch.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { machineRef, mintWatchTicket, TICKET_TTL_SECONDS, verifyWatchTicket, watchUrl } from '@/lib/vm/watch'

const SECRET = 'edge-service-token-for-tests-0000000000'
const SPACE = 'space:blackbird-ventures'
const AGENT = 'weekly-digest'
const ENV = 'dev'
const MACHINE = machineRef(ENV, SPACE, AGENT)

test('a freshly minted ticket is good for its own machine', () => {
  const ticket = mintWatchTicket(ENV, SPACE, AGENT, SECRET)
  assert.equal(verifyWatchTicket(ticket, MACHINE, SECRET), null)
})

test('a developer ticket cannot open the production machine of the same name', () => {
  // The two share an edge and a bucket, so the environment is part of what a
  // ticket names — without it, a local test opens production's window.
  const dev = mintWatchTicket('dev', SPACE, AGENT, SECRET)
  assert.equal(verifyWatchTicket(dev, machineRef('prod', SPACE, AGENT), SECRET) !== null, true)
  assert.equal(verifyWatchTicket(dev, machineRef('dev', SPACE, AGENT), SECRET), null)
})

test('a ticket is good for exactly one machine', () => {
  const ticket = mintWatchTicket(ENV, SPACE, AGENT, SECRET)
  // The interesting refusal: a real ticket, from a real admin, pointed at
  // somebody else's machine.
  assert.match(verifyWatchTicket(ticket, machineRef(ENV, SPACE, 'other-agent'), SECRET) ?? '', /different machine/)
  assert.match(verifyWatchTicket(ticket, machineRef(ENV, 'space:someone-else', AGENT), SECRET) ?? '', /different machine/)
})

test('a ticket expires', () => {
  const now = Date.now()
  const ticket = mintWatchTicket(ENV, SPACE, AGENT, SECRET, now)
  assert.equal(verifyWatchTicket(ticket, MACHINE, SECRET, now + (TICKET_TTL_SECONDS - 1) * 1000), null)
  assert.match(verifyWatchTicket(ticket, MACHINE, SECRET, now + (TICKET_TTL_SECONDS + 1) * 1000) ?? '', /expired/)
})

test('a ticket nobody signed, or signed with another secret, is refused', () => {
  const ticket = mintWatchTicket(ENV, SPACE, AGENT, SECRET)
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
  const ticket = mintWatchTicket(ENV, SPACE, AGENT, SECRET)
  const url = new URL(watchUrl('https://edge.example.com', ENV, SPACE, AGENT, ticket))
  assert.equal(url.protocol, 'wss:')
  assert.equal(url.pathname, '/watch')
  assert.equal(url.searchParams.get('env'), ENV)
  assert.equal(url.searchParams.get('space'), SPACE)
  assert.equal(url.searchParams.get('agent'), AGENT)
  assert.equal(url.searchParams.get('ticket'), ticket)
})
