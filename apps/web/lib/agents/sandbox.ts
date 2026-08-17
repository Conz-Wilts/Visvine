/**
 * The stage-2 seam: a rented computer handed to the model as an ORDINARY tool
 * (`run_code`), so every model can use it and no vendor leaks into the tool
 * schema or the note contract. Designed here, built later.
 *
 * Boundary (decided on the map): the sandbox is compute only. It never
 * receives connector secrets and cannot reach connector hosts; anything that
 * needs a credential comes back through the isolate as a tool call. Egress
 * is denied but for package registries through a Visvine-managed proxy.
 *
 * `AGENT_SANDBOX_PROVIDER` selects an implementation; unset = the tool is not
 * offered even when a brief asks for `tools: [sandbox]`.
 */
interface SandboxRunInput {
  language: 'python' | 'node' | 'bash'
  code: string
  /** Files to place in the working directory before running. */
  files?: { path: string; content: string }[]
  timeoutMs?: number
}

interface SandboxRunResult {
  exitCode: number
  stdout: string
  stderr: string
  /** Files the run left in its output directory. */
  files: { path: string; content: string }[]
}

export interface SandboxProvider {
  readonly id: string
  run(input: SandboxRunInput): Promise<SandboxRunResult>
}

/** Placeholder until a vendor is chosen: refuses honestly. */
const NoopSandbox: SandboxProvider = {
  id: 'none',
  async run() {
    return { exitCode: 1, stdout: '', stderr: 'sandbox not enabled on this server', files: [] }
  },
}

export function sandboxProvider(): SandboxProvider | null {
  const id = process.env.AGENT_SANDBOX_PROVIDER?.trim()
  if (!id) return null
  // Vendors plug in here (Modal, E2B, Daytona, Cloudflare, Docker…) — one
  // module each, none of them imported until chosen.
  return NoopSandbox
}
