/**
 * Messaging service — public barrel for lib/messages.
 * Implementation split into:
 *   - core.ts           (MessagingError, shared query constants, membership guard,
 *                        unread counts, serialization helpers)
 *   - conversationService.ts (conversation CRUD)
 *   - messageService.ts (message CRUD, reactions, read tracking)
 *   - searchService.ts  (search, user lookup, directory)
 */

export { ensureConversationMember } from './core';

export {
  listConversationsForUser,
  findOrCreateDm,
  createChannelConversation,
  listChannelsForSpace,
  listChannelSections,
  createChannelSection,
  updateChannelSection,
  deleteChannelSection,
  joinChannel,
  addMembersToGroup,
  removeMemberFromGroup,
  leaveConversation,
  updateGroupConversation,
} from './conversationService';

export {
  listMessagesForConversation,
  sendMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  toggleStar,
  listStarredMessages,
  markConversationRead,
  getConversationMemberIds,
} from './messageService';

export { searchUsersAndDirectory } from './searchService';
