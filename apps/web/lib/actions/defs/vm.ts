/**
 * The machine: running a command on an agent's own computer.
 *
 * `vm:run` is never folded into `connectors:use`, for the same reason
 * `tools:author` is not `context:write`. What separates reading someone's notes
 * from running arbitrary code in their space has to be a scope a client asks
 * for by name and a human sees spelled out before approving it.
 *
 * A scope is necessary and never sufficient. `resolveTarget` re-resolves the
 * caller's membership and grants from the database on every call, exactly as
 * every other action does, and the machine itself reaches only what its
 * compiled egress policy allows (lib/vm/policy.ts). Nothing here re-implements
 * authorization and nothing here can widen it.
 */
import { z } from 'zod'
import { defineAction, ActionError } from '@/lib/actions/types'
import { resolveTarget } from '@/lib/actions/resolve'
import { isAdmin } from '@/lib/auth'
import { EdgeUnavailableError, edgeConfigured } from '@/lib/vm/edge'
import { browseOnMachine, QuotaExceededError, runOnMachine } from '@/lib/vm/lease'
import { agentPageHref } from '@/lib/agents/config'
import { agentReachHosts } from '@/lib/agents/machineReach'

const spaceArg = z
  .string()
  .describe('The space to act in — list_spaces returns the ids you can act in')

/** Bounded so a caller cannot hold a machine open with one call. */
const MAX_TIMEOUT_SECONDS = 300
/** Enough of a transcript to act on; the rest is in the machine's own files. */
const MAX_OUTPUT_CHARS = 20_000

function clip(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated` : text
}

/**
 * The reach the agent's own runs lease its machine under. The machine is one
 * container per (space, agent) and a lease rewrites its policy in place, so a
 * command from here on the space's whole list would widen a run in flight to
 * hosts its brief never declared. An agent with no brief reaches nothing.
 */
async function reachOf(spaceId: string, agent: string): Promise<string[]> {
  return (await agentReachHosts(spaceId, agent)) ?? []
}

export const VM_ACTIONS = [
  defineAction({
    name: 'vm_exec',
    scope: 'vm:run',
    summary:
      "Run a command on an agent's machine — a real computer in the space, with a filesystem that lasts and no network but what its policy allows.",
    description:
      "Run one command on the machine belonging to an agent in this space, and get back its exit code, stdout and stderr. " +
      'The machine is a container: it has Node, Python, uv, git and ripgrep, a /workspace the space shares, and NO route ' +
      "to the internet except the hosts the agent's declared connectors name — every request it makes is judged and logged. " +
      'It sleeps after ten idle minutes and wakes with a fresh disk, so anything worth keeping goes under /workspace. ' +
      'Use this for work a program does better than a prompt: parsing a file, running a script, transforming data.',
    input: {
      space_id: spaceArg,
      agent: z
        .string()
        .min(1)
        .describe("The agent whose machine to use, e.g. 'weekly-digest'. One machine per agent, never shared."),
      command: z
        .array(z.string().min(1))
        .min(1)
        .max(64)
        .describe("The command and its arguments, e.g. ['python3', '-c', 'print(1+1)']. Not a shell line — no pipes or globs."),
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(MAX_TIMEOUT_SECONDS)
        .optional()
        .describe(`How long to let it run before killing it (default 120, max ${MAX_TIMEOUT_SECONDS})`),
    },
    run: async (ctx, args) => {
      // Machines are an admin capability while the runtime is young: a machine
      // is the space's money and the space's reach, and neither is a member's
      // to spend. This is the one place that decision is made.
      const target = await resolveTarget(ctx, args.space_id)
      if (!(await isAdmin(ctx.userId, args.space_id, ctx.email))) {
        throw new ActionError(403, "Only a space admin can run commands on an agent's machine.")
      }
      if (!edgeConfigured()) {
        throw new ActionError(503, 'This deployment has no agent machines configured.')
      }

      try {
        const result = await runOnMachine(target.context.spaceId, args.agent, args.command, {
          timeoutSeconds: args.timeout_seconds,
          taskAllow: await reachOf(target.context.spaceId, args.agent),
        })
        return {
          exit_code: result.exitCode,
          stdout: clip(result.stdout),
          stderr: clip(result.stderr),
          timed_out: result.timedOut,
          // A cold wake costs seconds and the caller should see it rather than
          // wonder why the first command was slow.
          woke: result.booted,
        }
      } catch (err) {
        // The cap is not a fault: it is the space's own limit, and the caller
        // should read it as "not now" rather than "something broke".
        if (err instanceof QuotaExceededError) throw new ActionError(429, err.message)
        if (err instanceof EdgeUnavailableError) throw new ActionError(503, err.message)
        throw err
      }
    },
  }),
  defineAction({
    name: 'vm_browse',
    scope: 'vm:run',
    summary:
      "Open a page in the agent's own browser — a real Chromium on its machine, with a profile that remembers what it is logged into.",
    description:
      "Open a URL in the browser on this agent's machine and leave it open. The browser is headful on the machine's own " +
      'display, so a human can watch it and take control of it, and its profile lives in the workspace — a session someone ' +
      'logged in during a takeover is still there on the next run. The page can only load if the egress policy allows its ' +
      'host, exactly as every other request from the machine is judged. One browser per machine: calling this again steers ' +
      'the same one rather than starting a second.',
    input: {
      space_id: spaceArg,
      agent: z.string().min(1).describe("The agent whose machine to use, e.g. 'weekly-digest'"),
      url: z
        .string()
        .url()
        .describe("The page to open, e.g. https://example.com/ — https only, and its host must be one the agent's connectors declare"),
    },
    run: async (ctx, args) => {
      const target = await resolveTarget(ctx, args.space_id)
      if (!(await isAdmin(ctx.userId, args.space_id, ctx.email))) {
        throw new ActionError(403, "Only a space admin can drive an agent's browser.")
      }
      if (!edgeConfigured()) {
        throw new ActionError(503, 'This deployment has no agent machines configured.')
      }
      if (!args.url.startsWith('https://')) {
        throw new ActionError(400, 'The machine speaks https; give an https URL.')
      }
      try {
        const result = await browseOnMachine(target.context.spaceId, args.agent, args.url, {
          taskAllow: await reachOf(target.context.spaceId, args.agent),
        })
        return {
          opened: args.url,
          started: result.started,
          already_running: result.alreadyRunning,
          // Where a person goes to see it, which is the point of a headful browser.
          watch: agentPageHref(args.agent, null, target.context.spaceId),
        }
      } catch (err) {
        if (err instanceof QuotaExceededError) throw new ActionError(429, err.message)
        if (err instanceof EdgeUnavailableError) throw new ActionError(503, err.message)
        throw err
      }
    },
  }),
] as const
