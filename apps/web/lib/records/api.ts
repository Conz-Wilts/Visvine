/** What the records routes answer — shared by the routes and their clients. */
import type { RecordRow } from './shared/fields'

export interface RecordTypesResponse {
  types: Array<{ name: string; count: number }>
}

export interface RecordsResponse {
  type: string
  rows: RecordRow[]
  nextCursor: string | null
  total: number
}
