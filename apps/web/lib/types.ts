// Shared app types, split by domain under lib/types/. This barrel re-exports
// everything so existing '@/lib/types' imports keep working — prefer importing
// from the specific domain module in new code.

export * from './types/context';
export * from './types/community';
export * from './types/events';
export * from './types/resources';
export * from './types/directory';
