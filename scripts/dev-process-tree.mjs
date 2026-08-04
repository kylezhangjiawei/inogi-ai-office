export function windowsProcessTreeKillArgs(pid) {
  const parsedPid = Number(pid);
  if (!Number.isInteger(parsedPid) || parsedPid <= 0) {
    throw new TypeError(`Invalid process id: ${pid}`);
  }

  return ["/PID", String(parsedPid), "/T", "/F"];
}

export function posixProcessGroupId(pid) {
  const parsedPid = Number(pid);
  if (!Number.isInteger(parsedPid) || parsedPid <= 0) {
    throw new TypeError(`Invalid process id: ${pid}`);
  }
  return -parsedPid;
}
