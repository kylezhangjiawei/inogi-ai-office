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

async function probeDevPort(port, host) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

function isUnsupportedAddressError(error) {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && (error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL"),
  );
}

export async function assertDevPortAvailable(port, hosts = ["127.0.0.1", "::"], probe = probeDevPort) {
  const candidates = Array.isArray(hosts) ? hosts : [hosts];
  if (candidates.length === 0) {
    throw new TypeError("Development API port check requires at least one host");
  }

  for (const [index, host] of candidates.entries()) {
    try {
      await probe(port, host);
    } catch (error) {
      if (index > 0 && isUnsupportedAddressError(error)) continue;
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      const detail = code ? ` (${code})` : "";
      const message = code === "EADDRINUSE"
        ? `Development API port ${host}:${port} is already in use${detail}`
        : `Unable to inspect development API port ${host}:${port}${detail}`;
      throw new Error(message, { cause: error });
    }
  }
}

export function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

export function unexpectedChildExitCode(code) {
  return Number.isInteger(code) && code > 0 ? code : 1;
}
