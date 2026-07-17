import { spawn } from "node:child_process";

const children = [
  spawn("pnpm", ["run", "dev:server"], { stdio: "inherit" }),
  spawn("pnpm", ["run", "dev:frontend"], { stdio: "inherit" }),
];

let closing = false;
function close(signal = "SIGTERM") {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill(signal);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!closing && code && code !== 0) process.exitCode = code;
    close();
  });
}

process.on("SIGINT", () => close("SIGINT"));
process.on("SIGTERM", () => close("SIGTERM"));
