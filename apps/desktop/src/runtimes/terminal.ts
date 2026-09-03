import { spawn } from "node:child_process";
import { shellPath } from "./path";

/**
 * Open the OS terminal running one command — the vendor's own sign-in. The
 * shell hands the member to the binary and steps out: it neither reads what
 * the binary stores nor sees the browser round trip the binary opens.
 */
export async function openInTerminal(command: string): Promise<{ ok: boolean; detail: string | null }> {
  const PATH = await shellPath();
  const env = { ...process.env, PATH };
  try {
    if (process.platform === "darwin") {
      const script = `tell application "Terminal"\nactivate\ndo script "export PATH=${JSON.stringify(PATH)}; ${command.replace(/"/g, '\\"')}"\nend tell`;
      spawn("osascript", ["-e", script], { env, detached: true, stdio: "ignore" }).unref();
      return { ok: true, detail: "Opened in Terminal." };
    }
    if (process.platform === "win32") {
      spawn("cmd.exe", ["/c", "start", "cmd.exe", "/k", command], { env, detached: true, stdio: "ignore", windowsHide: false }).unref();
      return { ok: true, detail: "Opened in a command prompt." };
    }
    const shell = `${command}; echo; echo 'You can close this window.'; exec ${process.env.SHELL || "sh"}`;
    for (const [bin, args] of [
      ["x-terminal-emulator", ["-e", "sh", "-c", shell]],
      ["gnome-terminal", ["--", "sh", "-c", shell]],
      ["konsole", ["-e", "sh", "-c", shell]],
      ["xterm", ["-e", "sh", "-c", shell]],
    ] as const) {
      try {
        const child = spawn(bin, [...args], { env, detached: true, stdio: "ignore" });
        child.unref();
        return { ok: true, detail: `Opened in ${bin}.` };
      } catch {
        /* next */
      }
    }
    return { ok: false, detail: `No terminal found — run \`${command}\` yourself.` };
  } catch (err) {
    return { ok: false, detail: `Could not open a terminal: ${String(err)}. Run \`${command}\` yourself.` };
  }
}
