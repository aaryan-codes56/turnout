// Stored in UTC, always shown in India time, whatever the server's timezone.
const TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 330;

const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
});
const longDateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});
const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  timeStyle: "short",
});

export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}

/** "Fri, 20 Nov, 6:30 pm – 9:00 pm" */
export function formatEventTime(start: Date, end: Date): string {
  const sameDay = longDateFormat.format(start) === longDateFormat.format(end);
  const startText = `${longDateFormat.format(start)}, ${timeFormat.format(start)}`;
  const endText = sameDay
    ? timeFormat.format(end)
    : `${longDateFormat.format(end)}, ${timeFormat.format(end)}`;
  return `${startText} – ${endText}`;
}

/** Reads a datetime-local value ("2026-11-20T18:30") as India time. */
export function parseIstInput(value: string): Date {
  return new Date(`${value}:00+05:30`);
}

/** The reverse of parseIstInput, for filling in an edit form. */
export function toIstInput(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function formatPrice(paise: number): string {
  if (paise === 0) return "Free";
  const rupees = paise / 100;
  return `₹${Number.isInteger(rupees) ? rupees : rupees.toFixed(2)}`;
}
