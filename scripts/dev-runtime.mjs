import { createServer } from "node:net";

export function resolveDevApiPort(env = process.env) {
  const raw = env.INOGI_DEV_API_PORT ?? "3001";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError(`Invalid INOGI_DEV_API_PORT: ${raw}`);
  }
  return port;
}

export function devApiTarget(port) {
  return `http://127.0.0.1:${port}`;
}

export function isInogiApiHealth(payload) {
  return Boolean(payload && typeof payload === "object" && payload.ok === true && payload.service === "inogi-api");
}

export async function assertDevPortAvailable(port, host = "127.0.0.1") {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      const detail = error && typeof error === "object" && "code" in error ? ` (${error.code})` : "";
      reject(new Error(`Development API port ${host}:${port} is already in use${detail}`));
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

export function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

export function unexpectedChildExitCode(code) {
  return Number.isInteger(code) && code > 0 ? code : 1;
}
