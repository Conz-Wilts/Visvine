import { handleApiError } from '@/lib/api/route';

export function handleMessagingError(error: unknown) {
  return handleApiError(error, 'api.messages.failed');
}
