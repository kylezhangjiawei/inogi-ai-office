import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "cmd.exe" : "npm";
const repoRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const apiRoot = path.join(repoRoot, "apps", "api");

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
    env: process.env,
    shell: false,
    windowsHide: false,
  });

  processes.push(child);
  prefixOutput(child.stdout, prefix, process.stdout);
  prefixOutput(child.stderr, prefix, process.stderr);

  child.on("exit", (code, signal) => {
    const detail = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    process.stderr.write(`[${prefix}] exited with ${detail}\n`);

    if (!shuttingDown && code && code !== 0) {
      shuttingDown = true;
      shutdown(code);
    }
  });

  child.on("error", (error) => {
    process.stderr.write(`[${prefix}] failed to start: ${error.message}\n`);
    if (!shuttingDown) {
      shuttingDown = true;
      shutdown(1);
    }
  });

  return child;
}

let shuttingDown = false;

function shutdown(exitCode = 0) {
  for (const child of processes) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const child of processes) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 500);
}

process.on("SIGINT", () => {
  if (!shuttingDown) {
    shuttingDown = true;
    shutdown(0);
  }
});

process.on("SIGTERM", () => {
  if (!shuttingDown) {
    shuttingDown = true;
    shutdown(0);
  }
});

const apiArgs = isWindows ? ["/d", "/s", "/c", "npm.cmd run start:dev"] : ["run", "start:dev"];
const webArgs = isWindows ? ["/d", "/s", "/c", "npm.cmd run dev:web"] : ["run", "dev:web"];

runProcess("api", npmCommand, apiArgs, { cwd: apiRoot });
runProcess("web", npmCommand, webArgs, { cwd: repoRoot });
