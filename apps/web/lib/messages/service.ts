/**
 * Messaging service — barrel re-export for backwards compatibility.
 * Implementation split into:
 *   - serializers.ts    (types, constants, serialization helpers)
 *   - conversationService.ts (conversation CRUD)
 *   - messageService.ts (message CRUD, reactions, read tracking)
 *   - searchService.ts  (search, user lookup, directory)
 */

export { MessagingError } from './serializers';

export {
  listConversationsForUser,
  getConversationSummaryForUser,
  createDmConversation,
  createGroupConversation,
  createChannelConversation,
  listChannelsForCommunity,
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
  markConversationRead,
  getConversationMemberIds,
  assertConversationMembership,
} from './messageService';

export {
  searchConversationsAndMessages,
  searchUsers,
  searchUsersAndDirectory,
  type DirectoryPerson,
} from './searchService';
