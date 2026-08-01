export function formatTimestamp(ts: number) {
  const date = new Date(ts);
  return date.toLocaleTimeString();
}

export function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "n/a";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDisk(free?: number, total?: number) {
  if (!free && !total) return "n/a";
  if (free && total) return `${formatBytes(free)} free / ${formatBytes(total)} total`;
  if (total) return `${formatBytes(total)} total`;
  return formatBytes(free);
}

export function formatList(values?: string[]) {
  if (!values || values.length === 0) return "none";
  return values.join(", ");
}

/**
 * The host ports a container can actually be reached on, lowest first.
 *
 * `docker ps` reports one entry per binding, so a service listening on both
 * address families and both protocols appears four times ("0.0.0.0:53->53/tcp",
 * "[::]:53->53/udp", ...). None of that distinguishes one binding from another
 * to someone trying to reach the service, so bindings collapse to the host port
 * alone. Entries with no "->" are exposed by the image but never published to
 * the host, so nothing outside the container can dial them.
 */
export function publishedPorts(ports?: string[]): string[] {
  const hostPorts = new Set<string>();
  for (const entry of ports ?? []) {
    const arrow = entry.indexOf("->");
    if (arrow === -1) continue;
    // The bind address may be IPv6 ("[::]:53"), so the host port is whatever
    // follows the last colon. A published range ("8000-8002") stays one token.
    const binding = entry.slice(0, arrow);
    const hostPort = binding.slice(binding.lastIndexOf(":") + 1).trim();
    if (hostPort) hostPorts.add(hostPort);
  }
  return [...hostPorts].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
}
