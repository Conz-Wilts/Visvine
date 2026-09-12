import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";

const rl = createInterface({ input, output });
const answer = await rl.question(
  "This will DELETE the local Postgres volume (all data). Type 'reset' to confirm: ",
);
rl.close();

if (answer.trim() !== "reset") {
  console.log("Aborted.");
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("docker", ["compose", "down", "-v"]);
run("docker", ["compose", "up", "-d", "--wait"]);
run("pnpm", ["db:migrate"]);
run("pnpm", ["db:hq:full"]);
console.log("Database reset and reseeded.");
