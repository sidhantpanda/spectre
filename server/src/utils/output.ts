export function summarizeOutput(data: string) {
  const withoutAnsi = data.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  const singleLine = withoutAnsi.replace(/\r/g, " ").replace(/\n/g, "␊").trim();
  if (singleLine.length === 0) return "";
  return singleLine.length > 160 ? `${singleLine.slice(0, 160)}…` : singleLine;
}
