import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Message } from '../../types';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import type { MessagesStackParamList } from '../../navigation/MessagesStack';

type ConversationRouteProp = RouteProp<MessagesStackParamList, 'Conversation'>;

export default function ConversationScreen() {
  const route = useRoute<ConversationRouteProp>();
  const insets = useSafeAreaInsets();
  useAuth();
  const { colors } = useTheme();
  const flatListRef = useRef<FlatList>(null);

  const { conversationId } = route.params;

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    const response = await api.getMessages(conversationId);

    if (response.error) {
      setError(response.error);
    } else if (response.data) {
      setMessages(response.data.messages.reverse());
      setError(null);
    }
    setIsLoading(false);
  }, [conversationId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const handleSend = async () => {
    if (!inputText.trim() || isSending) return;

    setIsSending(true);
    setInputText('');

    const response = await api.sendMessage(conversationId, inputText.trim());

    if (response.data) {
      setMessages(prev => [...prev, response.data!]);
    } else if (response.error) {
      setError(response.error);
      setInputText(inputText);
    }

    setIsSending(false);
  };

  const formatMessageTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isOwn = item.isOwn;

    return (
      <View
        style={[
          styles.messageContainer,
          isOwn ? styles.ownMessage : styles.otherMessage,
        ]}
      >
        {!isOwn && (
          <View style={[styles.senderAvatar, { backgroundColor: colors.accentLight }]}>
            <Text style={[styles.senderAvatarText, { color: colors.accentDark }]}>
              {item.sender.name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View
          style={[
            styles.messageBubble,
            isOwn
              ? [styles.ownBubble, { backgroundColor: colors.accent }]
              : [styles.otherBubble, { backgroundColor: colors.bgPrimary }],
          ]}
        >
          {!isOwn && (
            <Text style={[styles.senderName, { color: colors.textMuted }]}>{item.sender.name}</Text>
          )}
          <Text style={[styles.messageText, { color: isOwn ? '#ffffff' : colors.textPrimary }]}>
            {item.text}
          </Text>
          <Text
            style={[
              styles.messageTime,
              { color: isOwn ? 'rgba(255,255,255,0.7)' : colors.textLight },
            ]}
          >
            {formatMessageTime(item.createdAt)}
          </Text>
        </View>
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.bgSecondary }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bgSecondary }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {error && (
        <View style={[styles.errorBanner, { backgroundColor: colors.bgTertiary }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={[
          styles.messagesList,
          { paddingBottom: insets.bottom + 60 },
        ]}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={[styles.emptyIconWrap, { backgroundColor: colors.bgTertiary }]}>
              <Ionicons name="chatbubbles-outline" size={32} color={colors.textMuted} />
            </View>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>No messages yet</Text>
            <Text style={[styles.emptySubtext, { color: colors.textLight }]}>Start the conversation!</Text>
          </View>
        }
      />

      <View style={[styles.inputContainer, { paddingBottom: insets.bottom, backgroundColor: colors.bgPrimary, borderTopColor: colors.borderLight }]}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.bgTertiary, color: colors.textPrimary }]}
          placeholder="Type a message..."
          value={inputText}
          onChangeText={setInputText}
          multiline
          placeholderTextColor={colors.textLight}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            { backgroundColor: inputText.trim() ? colors.accent : colors.borderDefault },
          ]}
          onPress={handleSend}
          disabled={!inputText.trim() || isSending}
          activeOpacity={0.7}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Ionicons name="arrow-up" size={20} color="#ffffff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorBanner: {
    padding: 12,
    paddingHorizontal: 16,
  },
  errorText: {
    fontSize: 14,
  },
  messagesList: {
    padding: 16,
  },
  messageContainer: {
    flexDirection: 'row',
    marginBottom: 12,
    maxWidth: '80%',
  },
  ownMessage: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  otherMessage: {
    alignSelf: 'flex-start',
  },
  senderAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  senderAvatarText: {
    fontSize: 14,
    fontWeight: '600',
  },
  messageBubble: {
    padding: 12,
    borderRadius: 18,
    maxWidth: '100%',
  },
  ownBubble: {
    borderBottomRightRadius: 6,
  },
  otherBubble: {
    borderBottomLeftRadius: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  messageTime: {
    fontSize: 10,
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
