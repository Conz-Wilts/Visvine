// The offline runtime: a Tool's bridge answered from its fixtures/ folder,
// under the same gates Visvine applies. What `visvine-tool dev` runs on.

export interface FixtureViewer {
  id: string
  name: string
  isAdmin: boolean
}

export interface FixtureSpace {
  viewer: FixtureViewer
  bindings: Record<string, string>
  settings: Record<string, unknown>
  subject: unknown
  connectors: Record<string, Record<string, unknown>>
  actions: Record<string, unknown>
  ai: { complete?: string; decide?: unknown[] }
  notes: Map<string, { path: string; content: string; frontmatter: Record<string, unknown>; body: string; updatedAt: string }>
  resources: Map<string, { id: string; name: string; kind: string; mimeType: string; bytes: Uint8Array; notePath: string; text: string | null; createdAt: string }>
}

/** Read a Tool's fixtures/ folder: space.json, notes/, resources/. */
export function loadFixtures(root: string): FixtureSpace

export type MockResponse = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }

export interface MockTool {
  name: string
  title: string
  /** The manifest's facts, as @visvine/tool-protocol parses them. */
  facts: unknown
  /** The compiled data.js, or ''. */
  dataBundle: string
}

export interface MockBridge {
  call(method: string, params: unknown): Promise<MockResponse>
  init(): { install: unknown; viewer: FixtureViewer; degraded: unknown; subject: unknown }
  setViewer(viewer: Partial<FixtureViewer>): void
  setTool(tool: MockTool): void
}

export function createMockBridge(opts: { tool: MockTool; space: FixtureSpace; onChange?: (paths: string[]) => void }): MockBridge
