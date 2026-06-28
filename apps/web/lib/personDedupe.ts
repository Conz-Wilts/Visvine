/**
 * Person deduplication and creation logic
 */

import type { NBNode } from './types';
import { normalizeLinkedIn } from './eventUtils';

export interface PersonMatchInput {
  name: string;
  email?: string;
  linkedinUrl?: string;
  companyName?: string;
}

/**
 * Find matching person node in existing nodes
 * Priority: email > LinkedIn URL > fuzzy name+company
 */
export function findMatchingPerson(
  nodes: NBNode[],
  input: PersonMatchInput
): NBNode | null {
  // Identify person nodes by their `person:` id prefix rather than a type-string
  // compare: node types are stored lowercase-canonical ('person'), but the prefix
  // convention is stable across any historical casing ('People'/'people').
  const personNodes = nodes.filter((n) => n.id.startsWith('person:'));

  // Try email match first (case-insensitive)
  if (input.email) {
    const emailLower = input.email.toLowerCase().trim();
    const emailMatch = personNodes.find((node) => {
      const nodeEmail = node.metadata?.email as string | undefined;
      return nodeEmail?.toLowerCase().trim() === emailLower;
    });
    if (emailMatch) return emailMatch;
  }

  // Try LinkedIn URL match (normalized)
  if (input.linkedinUrl) {
    const normalizedInput = normalizeLinkedIn(input.linkedinUrl);
    const linkedinMatch = personNodes.find((node) => {
      const nodeLinkedIn = node.metadata?.linkedinUrl as string | undefined;
      if (!nodeLinkedIn) return false;
      return normalizeLinkedIn(nodeLinkedIn) === normalizedInput;
    });
    if (linkedinMatch) return linkedinMatch;
  }

  // Try fuzzy name + company match (optional, conservative)
  if (input.name && input.companyName) {
    const nameLower = input.name.toLowerCase().trim();
    const companyLower = input.companyName.toLowerCase().trim();

    const fuzzyMatch = personNodes.find((node) => {
      const nodeName = node.name.toLowerCase().trim();
      const nodeCompany = (node.metadata?.companyName as string | undefined)?.toLowerCase().trim();

      // Require exact name match and similar company
      return nodeName === nameLower && nodeCompany === companyLower;
    });

    if (fuzzyMatch) return fuzzyMatch;
  }

  return null;
}

// createPersonNode / ensureUniquePersonId were removed (unused) — node creation
// now goes through the canonical lib/identity resolver.

