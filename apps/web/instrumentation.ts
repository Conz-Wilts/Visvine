// Server-start hook (Next instrumentation file convention). Arms the nightly
// maintenance schedule — embeddings + link-reason sweeps — on the Node runtime
// only; see lib/notes/nightly.ts for gating and what runs.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startNightlySchedule } = await import('@/lib/notes/nightly')
    startNightlySchedule()
  }
}
