import { redirect } from 'next/navigation';

// The feed is now a view inside the combined Channels page.
export default function FeedPage() {
  redirect('/channels');
}
