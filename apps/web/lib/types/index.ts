// Shared app types, split by domain under lib/types/. This barrel re-exports
// everything so existing '@/lib/types' imports keep working — prefer importing
// from the specific domain module in new code.

export * from './context';
export * from './nodeTypeRegistry';
export * from './plural';
export * from './space';
export * from './events';
export * from './resources';
export * from './directory';
