/**
 * Shared DTOs for the intro (warm-introduction) system. The web client and the
 * native apps mirror these shapes. Node ids are person-node ids (e.g. `person:…`).
 */

export interface IntroNodeSummary {
  id: string;
  name: string;
  type: string;
  subtitle: string | null;
  imageUrl: string | null;
}

/** pending → approved (introducer endorsed) → connected (target accepted). */
export type IntroStatus = 'pending' | 'approved' | 'connected' | 'declined';

export interface IntroRequestDTO {
  id: string;
  communityId: string;
  requesterNodeId: string;
  introducerNodeId: string;
  targetNodeId: string;
  messageToIntroducer: string;
  messageToTarget: string;
  endorsement: string | null;
  status: IntroStatus;
  declinedBy: 'introducer' | 'target' | null;
  createdAt: string;
  updatedAt: string;
  requesterNode: IntroNodeSummary | null;
  introducerNode: IntroNodeSummary | null;
  targetNode: IntroNodeSummary | null;
}

/** A person both the requester and the target are connected to ("you both know X"). */
export interface MutualConnection {
  id: string;
  name: string;
  type: string;
  subtitle: string | null;
  imageUrl: string | null;
  sharedSince: string | null;
  relationshipToRequester: string;
  relationshipToTarget: string;
}

/**
 * Provenance attached to a DM conversation that exists because of an accepted
 * introduction — lets the thread show "introduced by …" with the endorsement.
 */
export interface ConversationIntroContext {
  introId: string;
  introducer: IntroNodeSummary | null;
  requesterNodeId: string;
  requesterName: string | null;
  endorsement: string | null;
  connectedAt: string;
}

/** The viewer's intros split by the role they play in each. */
export interface IntroInbox {
  /** Requests where the viewer is the introducer (to approve/decline). */
  incoming: IntroRequestDTO[];
  /** Requests the viewer sent. */
  sent: IntroRequestDTO[];
  /** Intros forwarded to the viewer as the target (to accept/decline). */
  received: IntroRequestDTO[];
}
