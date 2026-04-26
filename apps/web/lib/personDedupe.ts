/**
 * Person deduplication and creation logic
 */

import type { NBNode } from './types';
import { normalizeLinkedIn, slugify } from './eventUtils';

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
  const personNodes = nodes.filter((n) => n.type === 'People');

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

/**
 * Create a new person node from minimal information
 */
export function createPersonNode(input: {
  name: string;
  email?: string;
  linkedinUrl?: string;
  companyName?: string;
  roleTitle?: string;
}): NBNode {
  const baseSlug = slugify(input.name);

  // Generate a unique ID (caller should check for collisions and append suffix if needed)
  const id = `person:${baseSlug}`;

  const subtitle = input.roleTitle || input.companyName || '';

  const metadata: Record<string, unknown> = {};
  if (input.email) metadata.email = input.email;
  if (input.linkedinUrl) metadata.linkedinUrl = normalizeLinkedIn(input.linkedinUrl);
  if (input.companyName) metadata.companyName = input.companyName;
  if (input.roleTitle) metadata.roleTitle = input.roleTitle;

  return {
    id,
    type: 'People',
    name: input.name,
    subtitle,
    tags: input.companyName ? [input.companyName] : [],
    metadata,
  };
}

/**
 * Ensure person ID is unique by appending suffix if needed
 */
export function ensureUniquePersonId(
  baseNode: NBNode,
  existingNodes: NBNode[]
): NBNode {
  let id = baseNode.id;
  let suffix = 2;

  const existingIds = new Set(existingNodes.map((n) => n.id));

  while (existingIds.has(id)) {
    const baseId = baseNode.id.replace(/person:/, '');
    id = `person:${baseId}-${suffix}`;
    suffix++;
  }

  return { ...baseNode, id };
}

