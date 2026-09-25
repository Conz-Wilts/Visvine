// Directory domain: the flattened list-view shape of a node.

import type { NodeType } from './context';

export interface DirectoryItem {
  id: string
  name: string
  type: NodeType
  alias?: string | null
  subtitle?: string | null
  location?: string | null
  url?: string | null
  bio?: string
  tags?: string[]
  image_url?: string | null
  company_name?: string
  company_image_url?: string
  website?: string
  linkedinUrl?: string
  twitterUrl?: string
  phone?: string
  pronouns?: string
  /** The node's whole metadata blob — the tracked fields read from it. */
  metadata?: Record<string, unknown>
  createdAt?: string
  /** When the record's note was last edited, and by whom (lib/directory/recordFacts.ts). */
  updatedAt?: string
  editedBy?: string
  addedBy?: string
  /** A note record's field keys whose written value does not read as the field's kind (lib/records/). */
  invalid?: string[]
}
