import type { Community } from '@visvine/types';
import type { Event, Conversation, Message, DirectoryMember, User, FullProfile } from '../types';

export const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^(https?:|data:)/.test(url)) return url;
  if (url.startsWith('/')) return `${API_BASE}${url}`;
  return url;
}

function resolveMember<T extends { image_url?: string | null }>(m: T): T {
  return { ...m, image_url: resolveMediaUrl(m.image_url) };
}

function resolveCommunity<T extends { imageUrl?: string | null; image?: string | null }>(c: T): T {
  return { ...c, image: resolveMediaUrl(c.imageUrl ?? c.image) };
}

function resolveUser<T extends { image?: string | null }>(u: T): T {
  return { ...u, image: resolveMediaUrl(u.image) };
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

class ApiService {
  private baseUrl: string;
  private authToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setAuthToken(token: string | null) {
    this.authToken = token;
  }

  async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<ApiResponse<T>> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options?.headers as Record<string, string>),
      };

      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        return { error: data.error || 'Request failed' };
      }

      return { data };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Network error' };
    }
  }

  // Auth
  async getSession(): Promise<ApiResponse<User>> {
    const res = await this.request<{ session: { user: User } | null }>('/api/auth/session');
    const user = res.data?.session?.user;
    return user ? { data: resolveUser(user) } : { error: res.error || 'No session' };
  }

  // Communities
  async getCommunities(): Promise<ApiResponse<Community[]>> {
    const res = await this.request<{ communities: Community[] }>('/api/data/communities');
    if (res.error) return { error: res.error };
    return { data: (res.data?.communities ?? []).map(resolveCommunity) };
  }

  async getCommunity(id: string): Promise<ApiResponse<Community>> {
    const res = await this.request<Community>(`/api/data/communities?id=${id}`);
    if (res.data) res.data = resolveCommunity(res.data);
    return res;
  }

  // Events
  async getEvents(communityId: string): Promise<ApiResponse<{ events: Event[] }>> {
    return this.request<{ events: Event[] }>(`/api/events?communityId=${communityId}`);
  }

  async getEvent(eventId: string): Promise<ApiResponse<Event>> {
    return this.request<Event>(`/api/events/${eventId}`);
  }

  // Messaging
  async getConversations(query?: string): Promise<ApiResponse<{ conversations: Conversation[] }>> {
    const endpoint = query
      ? `/api/messages/conversations?query=${encodeURIComponent(query)}`
      : '/api/messages/conversations';
    return this.request<{ conversations: Conversation[] }>(endpoint);
  }

  async getMessages(conversationId: string, cursor?: string): Promise<ApiResponse<{
    conversation: Conversation;
    messages: Message[];
    nextCursor: string | null;
    hasMore: boolean;
  }>> {
    const endpoint = cursor
      ? `/api/messages/conversations/${conversationId}/messages?cursor=${cursor}`
      : `/api/messages/conversations/${conversationId}/messages`;
    return this.request(endpoint);
  }

  async sendMessage(conversationId: string, text: string): Promise<ApiResponse<Message>> {
    return this.request<Message>(`/api/messages/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  // Directory
  async getDirectoryMembers(communityId: string): Promise<ApiResponse<{ nodes: DirectoryMember[] }>> {
    const res = await this.request<{ nodes: DirectoryMember[] }>(`/api/data/nodes?community_id=${communityId}`);
    if (res.data?.nodes) {
      res.data = { nodes: res.data.nodes.map(resolveMember) };
    }
    return res;
  }

  // Profile
  async getProfile(userId: string): Promise<ApiResponse<DirectoryMember>> {
    const res = await this.request<DirectoryMember>(`/api/profile/${userId}`);
    if (res.data) res.data = resolveMember(res.data);
    return res;
  }

  async getFullProfile(personId: string): Promise<ApiResponse<FullProfile>> {
    const res = await this.request<FullProfile>(`/api/profile/${encodeURIComponent(personId)}`);
    if (res.data?.imageUrl) {
      res.data = { ...res.data, imageUrl: resolveMediaUrl(res.data.imageUrl) };
    }
    return res;
  }

  async updateProfile(userId: string, data: Partial<DirectoryMember>): Promise<ApiResponse<DirectoryMember>> {
    const res = await this.request<DirectoryMember>(`/api/profile/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (res.data) res.data = resolveMember(res.data);
    return res;
  }
}

export const api = new ApiService(API_BASE);
export default api;