/**
 * Quotes a CSV cell. Text starting with = + - @ gets a leading apostrophe so
 * a student can't plant a formula that runs when an admin opens the export
 * in Excel or Sheets.
 */
function escapeCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}
