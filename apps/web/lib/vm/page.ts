/**
 * One step in the browser on an agent's machine: do this (or nothing), then
 * say what the page is now. The script and its shapes are
 * `shared/pageScript.ts`; this is the one command that carries them, under the
 * same lease, reach and run stamp as any other command the agent runs.
 */
import { runOnMachine } from './lease'
import { PAGE_INSTALL_LINE, pageCommandLine, pageScriptMissing, type PageCommand, type PageResult } from './shared/pageScript'

/** The last JSON line a page command printed, or a failure that says what it printed instead. */
export function parsePageResult(stdout: string, stderr: string, exitCode: number): PageResult {
  const line = stdout.trim().split('\n').filter(Boolean).pop() ?? ''
  try {
    const parsed = JSON.parse(line) as PageResult
    if (parsed && typeof parsed === 'object' && typeof parsed.ok === 'boolean') return parsed
  } catch {
    // Falls through: whatever was printed was not the result line.
  }
  return { ok: false, reason: 'failed', message: `The page command did not finish: ${(stderr || stdout).trim().slice(0, 300) || `exit ${exitCode}`}` }
}

export async function pageOnMachine(
  spaceId: string,
  agentName: string,
  command: PageCommand,
  options: { taskAllow?: readonly string[]; runId?: string | null } = {},
): Promise<PageResult> {
  const exec = { timeoutSeconds: 60, runId: options.runId ?? null, taskAllow: options.taskAllow }
  let result = await runOnMachine(spaceId, agentName, pageCommandLine(command), exec)
  if (pageScriptMissing(result.exitCode, result.stderr)) {
    await runOnMachine(spaceId, agentName, PAGE_INSTALL_LINE, exec)
    result = await runOnMachine(spaceId, agentName, pageCommandLine(command), exec)
  }
  return parsePageResult(result.stdout, result.stderr, result.exitCode)
}
