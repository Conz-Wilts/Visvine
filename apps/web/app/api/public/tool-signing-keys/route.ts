import { NextResponse } from 'next/server'
import { signingKeys } from '@/lib/tools/package'

/**
 * `GET /api/public/tool-signing-keys` — the public keys that verify the
 * signature on an exported listed Tool (lib/crypto/signing.ts), for anyone
 * checking a package offline. Public by nature.
 */
export function GET() {
  return NextResponse.json({ keys: signingKeys() }, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
