interface BlogCommentAuthor {
  id: string;
  name: string;
  image: string | null;
}

export interface BlogCommentReactionData {
  userId: string;
  emoji: string;
}

export interface BlogCommentData {
  id: string;
  content: string;
  isPrivate: boolean;
  createdAt: string;
  guestName: string | null;
  author: BlogCommentAuthor | null;
  reactions: BlogCommentReactionData[];
  replies: Omit<BlogCommentData, 'replies'>[];
}
