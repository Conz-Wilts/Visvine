// Who can create what, in one place.
//
// There are two entry points into creation — the "+" caret menu in the sidebar
// rail and the docked panel's type grid — and they used to disagree: the grid
// filtered by feature flags and admin, the caret menu offered a hardcoded list
// to everyone. A member of a community with channels off was shown "Channel"
// and got an error on submit. This module is the single gate both now ask.
//
// It answers "may this person create this here", NOT "does this surface list
// it": a workspace is creatable but deliberately absent from the grid (it has
// its own flow off the community dropdown), which is what `inGrid` is for.

import type { CreateableType } from '@/lib/contexts/CreateModalContext'
import type { CommunityFeatureConfig } from '@/lib/types'
// From featureAccess, not features.tsx: the latter carries JSX, which drags a
// React runtime into anything that imports this (including the unit tests).
import { isFeatureEnabled } from '@/lib/featureAccess'

export interface CreatePermissions {
  featureConfig: CommunityFeatureConfig | null
  isAdmin: boolean
}

export function canCreateType(type: CreateableType, { featureConfig, isAdmin }: CreatePermissions): boolean {
  switch (type) {
    // Channels and spaces are community-admin surfaces behind the channels feature.
    case 'channel':
    case 'space':
      return isFeatureEnabled(featureConfig, 'channels') && isAdmin

    // Both land in the community brain, so both follow the notes ("Context")
    // feature. A connector is additionally admin-only to write — the real gate
    // is server-side in brainService.writeDenial; this just stops us offering
    // a form that would 403.
    case 'file':
      return isFeatureEnabled(featureConfig, 'notes')
    case 'connector':
      return isFeatureEnabled(featureConfig, 'notes') && isAdmin

    // A resource node only exists because the Resources tool does — same rule
    // the console's Types tab and the directory filters follow.
    case 'resource':
      return isFeatureEnabled(featureConfig, 'resources')

    // Anyone can start a workspace of their own.
    case 'workspace':
      return true

    // The remaining note-first types: person, community, context. A community
    // here is a directory record, not a provisioned workspace — recording that
    // an organisation exists is as ordinary as writing a note about it. Writing
    // a context note is the baseline capability of a member, gated per-folder
    // server-side rather than per-type here.
    default:
      return true
  }
}
