// A deliberately broken ui.tsx: the `<main>` element below is never closed, so
// esbuild fails with a diagnostic carrying a line and a column.
// scripts/verify-tools-e2e.ts writes this first and asserts that `write_tool`
// answers with `ui.tsx:<line>:<col> …` rather than a bare "it didn't work" — the
// write → diagnostics round trip is the whole reason that tool returns a build.
export default function Broken() {
  return (
    <main>
      <h1>Broken</h1>
  )
}
