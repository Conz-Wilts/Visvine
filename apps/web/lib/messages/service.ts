/**
 * Messaging service — barrel re-export for backwards compatibility.
 * Implementation split into:
 *   - serializers.ts    (types, constants, serialization helpers)
 *   - conversationService.ts (conversation CRUD)
 *   - messageService.ts (message CRUD, reactions, read tracking)
 *   - searchService.ts  (search, user lookup, directory)
 */

export {
  listConversationsForUser,
  createDmConversation,
  createGroupConversation,
  createChannelConversation,
  listChannelsForCommunity,
  listChannelSpaces,
  createChannelSpace,
  updateChannelSpace,
  deleteChannelSpace,
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
  listPinnedMessages,
  listStarredMessages,
  markConversationRead,
  getConversationMemberIds,
  assertConversationMembership,
} from './messageService';

export {
  searchConversationsAndMessages,
  searchUsersAndDirectory,
} from './searchService';
