/**
 * Records: a record's fields, written through their one door, and an invented
 * type's records, queried by field (lib/records/service.ts). A record is a
 * node (a person, an event) or a note that declares one of the space's own
 * types (a Deal, a Candidate); either way only the fields its type declares
 * are written, each value parsed by the Directory table's own rule, under
 * the record's own gate as the caller.
 */
import { z } from 'zod'
import { defineAction, ActionError, type ActionCaller } from '@/lib/actions/types'
import { resolveTarget } from '@/lib/actions/resolve'
import { queryRecords, recordTypes, setFields } from '@/lib/records/service'
import { RECORD_PAGE_MAX } from '@/lib/records/shared/fields'

const spaceArg = z.string().describe('The space to act in — list_spaces returns the ids you can act in')

const fieldValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])

async function setFieldsAction(
  ctx: ActionCaller,
  args: { space_id: string; path?: string; node_id?: string; fields: Record<string, unknown> },
) {
  if (!!args.path === !!args.node_id) throw new ActionError(400, 'Name the record by exactly one of path (a note) or node_id (a node).')
  const target = await resolveTarget(ctx, args.space_id)
  const result = await setFields(
    target.principal,
    target.context,
    args.path ? { path: args.path } : { nodeId: args.node_id! },
    args.fields,
  )
  if (!result.ok) throw new ActionError(result.status, result.error)
  return { record: result.record, fields: result.fields }
}

async function listRecordsAction(
  ctx: ActionCaller,
  args: {
    space_id: string
    type?: string
    where?: Array<{ key: string; op: 'eq' | 'in' | 'range' | 'contains'; value?: string | number | boolean; values?: Array<string | number>; min?: string | number; max?: string | number }>
    order_by?: string
    direction?: 'asc' | 'desc'
    limit?: number
    cursor?: string
  },
) {
  const target = await resolveTarget(ctx, args.space_id)
  if (!args.type) return { types: await recordTypes(target.principal, target.context) }
  const where = (args.where ?? []).map((p) => {
    switch (p.op) {
      case 'eq':
        if (p.value === undefined) throw new ActionError(400, `An eq on ${p.key} needs a value.`)
        return { key: p.key, op: 'eq' as const, value: p.value }
      case 'in':
        return { key: p.key, op: 'in' as const, values: p.values ?? [] }
      case 'range':
        return { key: p.key, op: 'range' as const, ...(p.min !== undefined ? { min: p.min } : {}), ...(p.max !== undefined ? { max: p.max } : {}) }
      case 'contains':
        return { key: p.key, op: 'contains' as const, value: String(p.value ?? '') }
    }
  })
  const page = await queryRecords(target.principal, target.context, {
    type: args.type,
    where,
    ...(args.order_by ? { order: { key: args.order_by, direction: args.direction ?? 'asc' } } : {}),
    limit: args.limit,
    cursor: args.cursor ?? null,
  })
  if (!page.ok) throw new ActionError(page.status, page.error)
  return {
    type: page.type,
    total: page.total,
    records: page.rows.map((row) => ({
      path: row.path,
      title: row.title,
      tags: row.tags,
      updated_at: row.updatedAt,
      fields: row.fields,
      ...(row.invalid.length ? { invalid: row.invalid } : {}),
    })),
    next_cursor: page.nextCursor,
  }
}

export const RECORD_ACTIONS = [
  defineAction({
    name: 'set_fields',
    scope: 'context:write',
    summary: "Set a record's fields — a node's tracked fields or an invented type's fields on its note.",
    description:
      "Set one or more fields on a record. A record is a node (a person, a space, an event — name it by `node_id`) " +
      'or a note that declares one of the space\'s own types (a Deal, a Candidate — name it by `path`). Only fields ' +
      "the record's type declares can be set (the Directory table's columns; add_type and the table add them); a key " +
      'the platform keeps — `status`, `title`, `tags`, `type` and the rest — is refused, as is any key the type does ' +
      'not declare. Each value is parsed like a table cell: a number, a date as YYYY-MM-DD, one of a select\'s options, ' +
      'yes/no for a checkbox. Null or an empty string clears the field. You need to be able to edit the record.',
    input: {
      space_id: spaceArg,
      path: z.string().optional().describe('The note of a record of an invented type, e.g. deals/acme.md'),
      node_id: z.string().optional().describe('The node of a node-backed record, e.g. person:ada'),
      fields: z.record(z.string(), fieldValue).describe('Field key → value, e.g. { "stage": "Won", "amount": 12000 }'),
    },
    run: (ctx, args) => setFieldsAction(ctx, args),
  }),

  defineAction({
    name: 'list_records',
    scope: 'context:read',
    summary: "Query an invented type's records by field — or, with no type, list the space's own types and counts.",
    description:
      "The records of one of the space's own types (a Deal, a Candidate — notes that declare the type), filtered by " +
      'field and ordered, a page at a time. `where` is a list of predicates, all of which must hold: `eq` (value), ' +
      '`in` (values), `range` (min and/or max — numbers or YYYY-MM-DD dates) and `contains` (text). A value that does ' +
      "not read as its field's kind never matches and is listed under `invalid`. Without `type`, answers the space's " +
      'own types and how many records of each you can read. Only records you can read are returned.',
    annotations: { readOnlyHint: true },
    input: {
      space_id: spaceArg,
      type: z.string().optional().describe("One of the space's own types, e.g. Deal"),
      where: z
        .array(
          z.object({
            key: z.string(),
            op: z.enum(['eq', 'in', 'range', 'contains']),
            value: z.union([z.string(), z.number(), z.boolean()]).optional(),
            values: z.array(z.union([z.string(), z.number()])).optional(),
            min: z.union([z.string(), z.number()]).optional(),
            max: z.union([z.string(), z.number()]).optional(),
          }),
        )
        .optional()
        .describe('Field predicates, all of which must hold'),
      order_by: z.string().optional().describe('A field key, or title / updated'),
      direction: z.enum(['asc', 'desc']).optional(),
      limit: z.number().int().min(1).max(RECORD_PAGE_MAX).optional(),
      cursor: z.string().optional().describe('next_cursor from the previous page'),
    },
    run: (ctx, args) => listRecordsAction(ctx, args),
  }),
]
