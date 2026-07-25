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
