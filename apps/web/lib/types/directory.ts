// Directory domain: the flattened list-view shape of a node.

import type { NodeType } from './graph';

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
}
