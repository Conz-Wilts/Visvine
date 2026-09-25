/**
 * `@visvine/tool-kit` — everything a Tool author may import.
 *
 * esbuild compiles this folder into one browser ESM module served from the
 * tools origin, and a Tool's `ui.tsx` resolves the bare specifier to it through
 * the frame document's import map. If it is not exported here, a Tool cannot
 * reach it — which is the point: the surface is small enough to document in one
 * `.d.ts` (see lib/tools/sdkDocs.ts, which must be updated alongside this file).
 */
export * from './components';

export {
  LIVE_QUERY_POLL_MS,
  useBandAction,
  useLiveQuery,
  usePagedList,
  useQuery,
  useSection,
  useSubject,
  useTheme,
  useVisvine,
  VisvineProvider,
} from './hooks';
export type { LiveQueryOptions, PagedListOptions, PagedListResult, QueryResult, VisvineApi } from './hooks';

export { BridgeCallError } from './client';

export type {
  BridgeError,
  BridgeErrorCode,
  ContextEntry,
  ContextHit,
  ContextNote,
  ContextPage,
  ToolDegraded,
  ToolInstallInfo,
  ToolSubject,
  ToolViewer,
} from '@/lib/tools/protocol';
