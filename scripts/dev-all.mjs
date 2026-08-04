import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { posixProcessGroupId, windowsProcessTreeKillArgs } from "./dev-process-tree.mjs";
import {
  assertDevPortAvailable,
  childHasExited,
  devApiTarget,
  isInogiApiHealth,
  resolveDevApiPort,
  unexpectedChildExitCode,
} from "./dev-runtime.mjs";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "cmd.exe" : "npm";
const repoRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const apiRoot = path.join(repoRoot, "apps", "api");
const apiPort = resolveDevApiPort();
const apiTarget = devApiTarget(apiPort);

const processes = [];

function prefixOutput(stream, prefix, output) {
  let buffer = "";

  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim().length > 0) {
        output.write(`[${prefix}] ${line}\n`);
      }
    }
  });

  stream.on("end", () => {
    if (buffer.trim().length > 0) {
      output.write(`[${prefix}] ${buffer}\n`);
    }
  });
}

function runProcess(prefix, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    shell: false,
    detached: !isWindows,
    windowsHide: false,
  });

  processes.push(child);
  prefixOutput(child.stdout, prefix, process.stdout);
  prefixOutput(child.stderr, prefix, process.stderr);

  child.on("exit", (code, signal) => {
    const detail = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    process.stderr.write(`[${prefix}] exited with ${detail}\n`);

    if (!shuttingDown) shutdown(unexpectedChildExitCode(code));
  });

  child.on("error", (error) => {
    process.stderr.write(`[${prefix}] failed to start: ${error.message}\n`);
    if (!shuttingDown) shutdown(1);
  });

  return child;
}

let shuttingDown = false;

function terminateChild(child, signal) {
  if (!child.pid || childHasExited(child)) return;
  if (isWindows) {
    spawnSync("taskkill.exe", windowsProcessTreeKillArgs(child.pid), {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(posixProcessGroupId(child.pid), signal);
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ESRCH") throw error;
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of processes) {
    terminateChild(child, "SIGTERM");
  }

  if (isWindows) {
    process.exit(exitCode);
  }

  setTimeout(() => {
    for (const child of processes) {
      terminateChild(child, "SIGKILL");
    }
    process.exit(exitCode);
  }, 500);
}

process.on("SIGINT", () => {
  shutdown(0);
});

process.on("SIGTERM", () => {
  shutdown(0);
});

const apiArgs = isWindows ? ["/d", "/s", "/c", "npm.cmd run start:dev"] : ["run", "start:dev"];
const webArgs = isWindows ? ["/d", "/s", "/c", "npm.cmd run dev:web"] : ["run", "dev:web"];

async function waitForApi(apiChild) {
  const timeoutMs = Number(process.env.INOGI_DEV_API_TIMEOUT_MS ?? 120_000);
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `${apiTarget}/api/health`;

  process.stdout.write(`[dev] waiting for INOGI API at ${healthUrl}\n`);
  while (!shuttingDown && Date.now() < deadline) {
    if (childHasExited(apiChild)) {
      throw new Error("INOGI API exited before becoming ready");
    }
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_500) });
      if (response.ok && isInogiApiHealth(await response.json())) {
        process.stdout.write(`[dev] INOGI API ready on ${apiTarget}; starting web\n`);
        return;
      }
    } catch {
      // Nest watch compilation takes tens of seconds on the first run.
    }
    await delay(500);
  }

  throw new Error(`INOGI API did not become ready within ${timeoutMs}ms (${healthUrl})`);
}

async function main() {
  try {
    await assertDevPortAvailable(apiPort);
  } catch (error) {
    process.stderr.write(`[dev] ${error instanceof Error ? error.message : String(error)}\n`);
    shutdown(1);
    return;
  }

  const apiChild = runProcess("api", npmCommand, apiArgs, {
    cwd: apiRoot,
    env: { PORT: String(apiPort) },
  });

  try {
    await waitForApi(apiChild);
  } catch (error) {
    if (!shuttingDown) {
      process.stderr.write(`[dev] ${error instanceof Error ? error.message : String(error)}\n`);
      shutdown(1);
    }
    return;
  }

  if (!shuttingDown) {
    runProcess("web", npmCommand, webArgs, {
      cwd: repoRoot,
      env: { VITE_DEV_API_TARGET: apiTarget },
    });
  }
}

void main();
