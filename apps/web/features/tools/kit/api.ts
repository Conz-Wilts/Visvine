/**
 * The kit's API — the hooks, the error class and the types — shared by both
 * kit majors. Kit 2 (./index.ts) adds the app's components; kit 1 (./kit1.ts)
 * its own, frozen.
 */
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
  ContextLink,
  ContextNote,
  ContextPage,
  DecideAnswer,
  DecideQuestion,
  RecordWhere,
  StateScope,
  ToolDegraded,
  ToolInstallInfo,
  ToolRecord,
  ToolResource,
  ToolSubject,
  ToolViewer,
} from '@/lib/tools/protocol';
