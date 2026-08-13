// Who can create what, in one place.
//
// Two surfaces offer creation — the "+" caret menu in the sidebar rail and the
// docked panel's type grid — and both ask this module, so neither can offer a
// type the caller will be refused on submit (e.g. "Channel" in a space with
// channels off).
//
// It answers "may this person create this here", NOT "does this surface list
// it" — the note-first types are creatable everywhere but shown only on
// /directory/new, which is what `inGrid` is for.

import type { CreateableType } from '@/features/shared/contexts/CreateModalContext'
import type { SpaceFeatureConfig } from '@/lib/types'
// From featureAccess, not features.tsx: the latter carries JSX, which drags a
// React runtime into anything that imports this (including the unit tests).
import { isFeatureEnabled } from '@/lib/featureAccess'

export interface CreatePermissions {
  featureConfig: SpaceFeatureConfig | null
  isAdmin: boolean
}

export function canCreateType(type: CreateableType, { featureConfig, isAdmin }: CreatePermissions): boolean {
  switch (type) {
    // Channels and sections are admin surfaces behind the channels feature.
    // NOTE: 'space' (the org type) must NOT appear here —
    // it falls through to the default arm, creatable by any member.
    case 'channel':
    case 'section':
      return isFeatureEnabled(featureConfig, 'channels') && isAdmin

    // An uploaded file lands in the space context, so it follows the notes
    // ("Context") feature.
    case 'file':
      return isFeatureEnabled(featureConfig, 'notes')

    // A connector note only exists because the Connectors tool does — same rule
    // the console's Types tab and the directory filters follow. It's
    // additionally admin-only to write: the real gate is server-side in
    // contextService.writeDenial, this just stops us offering a form that 403s.
    case 'connector':
      return isFeatureEnabled(featureConfig, 'connectors') && isAdmin

    // A resource node only exists because the Resources tool does — same rule
    // the console's Types tab and the directory filters follow.
    case 'resource':
      return isFeatureEnabled(featureConfig, 'resources')

    // The remaining note-first types: person, space, context, index. An
    // index is a folder written as a note, so it follows the note rule. A space
    // here is a directory record — recording that a group or organisation
    // exists is as ordinary as writing a note about it. (Provisioning a space
    // of your own isn't a create type at all; it lives on the switcher.)
    // Writing a context note is the baseline capability of a member, gated
    // per-folder server-side rather than per-type here.
    default:
      return true
  }
}
