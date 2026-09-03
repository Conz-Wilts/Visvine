import { execFile, spawn, type ChildProcess } from "node:child_process";
import { shellPath } from "./path";
import { splitLines } from "./events";

/** Run a binary to completion for a short answer (status, version). Never throws. */
export async function ask(bin: string, args: string[], opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ ok: boolean; code: number; stdout: string; stderr: string; missing: boolean }> {
  const PATH = await shellPath();
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: opts.timeoutMs ?? 15_000, env: { ...process.env, ...opts.env, PATH }, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
      const missing = e?.code === "ENOENT";
      const code = typeof e?.code === "number" ? e.code : e ? 1 : 0;
      resolve({ ok: !err, code, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), missing });
    });
  });
}

/**
 * Spawn a binary and hand every whole stdout line to `onLine`. Resolves with
 * the exit code once it is done; `signal` kills it. stderr is collected for
 * the error message a silent failure would otherwise have none of.
 */
export async function stream(
  bin: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string; signal: AbortSignal },
  onLine: (line: string) => void,
): Promise<{ code: number | null; stderr: string; missing: boolean }> {
  const PATH = await shellPath();
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(bin, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env, PATH }, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      return resolve({ code: null, stderr: String(err), missing: true });
    }
    let buffer = "";
    let stderr = "";
    let missing = false;
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      const out = splitLines(buffer, chunk);
      buffer = out.rest;
      for (const line of out.lines) onLine(line);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 64_000) stderr += chunk;
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") missing = true;
      stderr += String(err.message ?? err);
    });
    child.on("close", (code) => {
      if (buffer.trim()) onLine(buffer);
      resolve({ code, stderr, missing });
    });
    const kill = () => {
      if (!child.killed) child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 3000).unref();
    };
    if (opts.signal.aborted) kill();
    else opts.signal.addEventListener("abort", kill, { once: true });
    if (opts.stdin !== undefined) {
      child.stdin?.write(opts.stdin);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
  });
}
