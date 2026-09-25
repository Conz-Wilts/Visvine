/**
 * Going global, and Tools as files, over MCP (docs/tools.md § Going global,
 * § Packages).
 *
 *   submit_tool     a space admin asks Visvine to list a version     tools:list
 *   cosign_tool     its author consents, under a license             tools:list
 *   withdraw_tool   either takes a request back                      tools:list
 *   transfer_tool   a listing moves to another publisher space       tools:list
 *   export_tool     a Tool as a .vvtool package                      context:read
 *   import_tool     a package as a new working copy                  tools:author
 *
 * Publishing a Tool to every space is a different act from editing one, so
 * the listing actions ride their own scope. Every gate is the library's
 * (lib/tools/listings.ts, lib/tools/package): the handlers resolve the caller
 * the way every action does and hand the refusal back.
 */
import { z } from 'zod'
import { defineAction, ActionError, type ActionCaller } from '@/lib/actions/types'
import { resolveTarget, type Target } from '@/lib/actions/resolve'
import { featureAccessForbidden } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { fetchPublicBytes } from '@/lib/connectors/publicFetch'
import { toolKey } from '@/lib/tools/registry'
import { answerTransfer, cosignListing, offerTransfer, requestListing, withdrawListing, type ListingResult } from '@/lib/tools/listings'
import { exportVersion, exportWorkingCopy, importPackage } from '@/lib/tools/package'
import { PACKAGE_LIMITS } from '@/lib/tools/package/shared/layout'
import { COMMON_LICENSES } from '@/lib/tools/shared/listing'

const spaceArg = z.string().describe('The space the tool belongs to — list_spaces returns the ids you can act in')
const versionArg = z.string().describe('The version, by the version_id publish_tool returned')
const licenseArg = z
  .string()
  .max(128)
  .describe(`An SPDX license id or "proprietary" — e.g. ${COMMON_LICENSES.slice(0, 4).join(', ')}`)

async function requireTools(ctx: ActionCaller, spaceId: string): Promise<Target> {
  const target = await resolveTarget(ctx, spaceId)
  if (await featureAccessForbidden(ctx.userId, target.context.spaceId, 'directory', ctx.email)) {
    throw new ActionError(403, 'The Tools feature is not available to you in this space')
  }
  return target
}

function refuse(result: { status: number; error: string }): never {
  throw new ActionError(result.status, result.error)
}

/** What a listing act answers with: where the version stands, and who acts next. */
function listingAnswer(result: ListingResult) {
  if (!result.ok) refuse(result)
  const { version, state } = result
  return {
    version_id: version.id,
    key: version.key,
    version: version.version,
    listing_id: version.listingId,
    state,
    license: version.license,
    next:
      state === 'awaiting_cosign'
        ? 'Its author co-signs with cosign_tool — they see the request on the Tool page.'
        : state === 'in_review'
          ? 'Visvine runs its review — an AI read and a dynamic run — then a reviewer decides.'
          : state === 'listed'
            ? 'Listed: every space may install it.'
            : null,
  }
}

/** The version a name means: the newest this space approved. */
async function newestApproved(spaceId: string, name: string): Promise<string> {
  const row = await prisma.appToolVersion.findFirst({
    where: { key: toolKey(spaceId, name), status: 'approved', revokedAt: null },
    orderBy: { version: 'desc' },
    select: { id: true },
  })
  if (!row) throw new ActionError(404, `No approved version of ${name} here — publish it first.`)
  return row.id
}

export const TOOL_LISTING_ACTIONS = [
  defineAction({
    name: 'submit_tool',
    scope: 'tools:list',
    summary: 'Ask Visvine to list an approved version of a tool for every space. Space admins only.',
    description:
      'Ask Visvine to list one of this space’s approved tool versions so ANY space may install it. SPACE ADMINS ONLY. ' +
      'Name the version by version_id, or the tool by name to take its newest approved version. When you wrote the ' +
      'version this also co-signs it, and `license` (an SPDX id or proprietary) is required unless its manifest says ' +
      'one; otherwise the request waits on its author, who co-signs with cosign_tool. Once co-signed Visvine runs its ' +
      'review — an AI read of the code against what it says, and a dynamic run in a honeypot space — and a reviewer ' +
      'decides. Nothing is listed until then.',
    input: {
      space_id: spaceArg,
      version_id: versionArg.optional(),
      name: z.string().optional().describe('The tool, by name — its newest approved version'),
      license: licenseArg.optional(),
      note: z.string().max(4000).optional().describe('A note for Visvine’s reviewer'),
    },
    run: async (ctx, args) => {
      const target = await requireTools(ctx, args.space_id)
      const versionId = args.version_id ?? (args.name ? await newestApproved(target.context.spaceId, args.name) : null)
      if (!versionId) throw new ActionError(400, 'Pass version_id or name.')
      return listingAnswer(
        await requestListing(
          versionId,
          { userId: ctx.userId, email: ctx.email, spaceId: target.context.spaceId, isAdmin: target.resolved.isAdmin },
          { note: args.note, license: args.license },
        ),
      )
    },
  }),

  defineAction({
    name: 'cosign_tool',
    scope: 'tools:list',
    summary: 'Co-sign the listing of a tool version you wrote, under a license.',
    description:
      'The author’s consent to a listing a space admin asked for: without it nothing you wrote is offered to every ' +
      'space. Only the version’s author may co-sign. `license` is the SPDX id (or proprietary) it is listed under.',
    input: { space_id: spaceArg, version_id: versionArg, license: licenseArg },
    run: async (ctx, args) => {
      await requireTools(ctx, args.space_id)
      return listingAnswer(await cosignListing(args.version_id, { userId: ctx.userId, email: ctx.email }, args.license))
    },
  }),

  defineAction({
    name: 'withdraw_tool',
    scope: 'tools:list',
    summary: 'Take back a listing request, or your own version still waiting on your space’s admins.',
    description:
      'Take something back before it is decided: a listing request (waiting on its author, or with Visvine) by an ' +
      'admin of the space that wrote the tool or by its author; or, for its author, a published version still ' +
      'waiting on this space’s admins.',
    annotations: { destructiveHint: true },
    input: { space_id: spaceArg, version_id: versionArg },
    run: async (ctx, args) => {
      const target = await requireTools(ctx, args.space_id)
      return listingAnswer(
        await withdrawListing(args.version_id, {
          userId: ctx.userId,
          email: ctx.email,
          spaceId: target.context.spaceId,
          isAdmin: target.resolved.isAdmin,
        }),
      )
    },
  }),

  defineAction({
    name: 'transfer_tool',
    scope: 'tools:list',
    summary: 'Move a listed tool to another publisher space — offered by one space’s admins, accepted by the other’s.',
    description:
      'A listing moves between publisher spaces only when both agree, and its installs keep receiving upgrades. From ' +
      'the publishing space (as its admin): name the listing by `key` (`<space-id>/<name>`) and `to_space_id` to offer ' +
      'it, or `to_space_id: null` to take an offer back. From the receiving space (as its admin): pass `listing_id` ' +
      'and `answer` (accept or decline); accepting names the tool in YOUR space that carries it on (`name`, default ' +
      'the same name) — import it first with import_tool.',
    input: {
      space_id: spaceArg,
      key: z.string().optional().describe('The listed tool, as `<space-id>/<name>` — when offering'),
      to_space_id: z.string().nullable().optional().describe('The space to offer it to; null takes the offer back'),
      listing_id: z.string().optional().describe('The listing offered to this space — when answering'),
      answer: z.enum(['accept', 'decline']).optional(),
      name: z.string().optional().describe('When accepting: the tool here that carries the listing on'),
    },
    run: async (ctx, args) => {
      const target = await requireTools(ctx, args.space_id)
      const admin = { userId: ctx.userId, email: ctx.email, spaceId: target.context.spaceId, isAdmin: target.resolved.isAdmin }
      const result = args.answer
        ? await answerTransfer(args.listing_id ?? '', admin, { accept: args.answer === 'accept', name: args.name })
        : await offerTransfer({ key: args.key }, admin, args.to_space_id ?? null)
      if (!result.ok) refuse(result)
      return { listing_id: result.listingId, key: result.key, offered_to: result.transferTo }
    },
  }),

  defineAction({
    name: 'export_tool',
    scope: 'context:read',
    summary: 'A tool as a .vvtool package — its manifest and sources, signed when Visvine lists it.',
    description:
      'Package a tool as a `.vvtool` file (a zip: visvine-tool.json, README.md, CHANGELOG.md, src/…, and ' +
      '.visvine/CHECKSUMS). Name a working copy in `space_id` by `name`, as you may read it, or a published ' +
      'version by `version_id` (readable when it is listed, or from its own space). Only a version Visvine lists ' +
      'is signed and names its publisher; every other export names no space. Returns the file as base64.',
    input: {
      space_id: spaceArg,
      name: z.string().optional().describe('A working copy in space_id'),
      version_id: z.string().optional().describe('A published version'),
    },
    annotations: { readOnlyHint: true },
    run: async (ctx, args) => {
      const target = await requireTools(ctx, args.space_id)
      let result
      if (args.version_id) {
        result = await exportVersion(args.version_id, { userId: ctx.userId, email: ctx.email })
      } else {
        if (!args.name) throw new ActionError(400, 'Pass name or version_id.')
        result = await exportWorkingCopy(target.principal, target.context, args.name)
      }
      if (!result.ok) refuse(result)
      return {
        filename: result.filename,
        bytes: result.bytes.byteLength,
        content_base64: Buffer.from(result.bytes).toString('base64'),
        signed: result.signed,
        publisher: result.publisher?.name ?? null,
        version: result.version,
        package_digest: result.digest,
      }
    },
  }),

  defineAction({
    name: 'import_tool',
    scope: 'tools:author',
    summary: 'A .vvtool package into a space, as a new working copy you authored.',
    description:
      'Import a `.vvtool` package as a NEW working copy in `space_id` — the manifest becomes its facts, README.md its ' +
      'docs, src/ its code. Pass the file as `content_base64`, or a public `url` to fetch it from. A tool\'s name is ' +
      'unique across Visvine, so when the package\'s is taken the copy takes the next free one (`name-2`) and says so; ' +
      '`name` asks for one instead. It meets every check when you publish it, like ' +
      'any new code; a Visvine signature only says who published it. Versions, installs and state stay with the ' +
      'space it came from.',
    input: {
      space_id: spaceArg,
      content_base64: z.string().optional().describe('The package, base64'),
      url: z.string().url().optional().describe('A public https URL to fetch the package from'),
      name: z.string().optional().describe('Import under this name instead'),
    },
    run: async (ctx, args) => {
      const target = await requireTools(ctx, args.space_id)
      let bytes: Uint8Array
      if (args.content_base64) {
        bytes = Buffer.from(args.content_base64, 'base64')
      } else if (args.url) {
        const fetched = await fetchPublicBytes(args.url, PACKAGE_LIMITS.maxPackageBytes)
        if (!fetched.ok) throw new ActionError(400, `Could not fetch the package: ${fetched.error}`)
        bytes = fetched.bytes
      } else {
        throw new ActionError(400, 'Pass content_base64 or url.')
      }
      const result = await importPackage(target.principal, target.context, bytes, { name: args.name })
      if (!result.ok) refuse(result)
      return {
        name: result.name,
        ...(result.renamedFrom ? { renamed_from: result.renamedFrom } : {}),
        preview: `/tools/preview/${result.name}`,
        compiles: result.buildOk,
        provenance: result.provenance,
        ...(result.unverifiedSignature ? { signature: 'not this deployment’s — imported as unsigned' } : {}),
        ignored: result.ignored,
        problems: result.problems,
        next: 'It is a working copy: check it with check_tool, then publish_tool.',
      }
    },
  }),
]
