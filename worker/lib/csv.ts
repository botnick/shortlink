/** Minimal RFC-4180 CSV builder. A cell is quoted only when it contains a comma,
 *  quote, or newline; embedded quotes are doubled. Rows are CRLF-separated so the
 *  file opens cleanly in Excel/Sheets as well as on Unix. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cell).join(",")];
  for (const r of rows) lines.push(r.map(cell).join(","));
  return lines.join("\r\n") + "\r\n";
}
