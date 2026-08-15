// A fixed locale, not the visitor's: these tables render only after the session has
// resolved in the browser, but pinning the format keeps a date the same width in every
// row regardless of who is looking.
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const BYTE_UNITS = ["B", "KB", "MB", "GB"];

/**
 * Binary units, because that is what the storage layer and every desktop file manager
 * report — a 5 MB file measured in decimal megabytes reads as 5.2 and looks wrong next
 * to the same file in Finder.
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";

  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / 1024 ** unit;

  // Whole bytes, and one decimal above that only while it carries information:
  // "1.4 MB" is worth the character, "12.4 MB" is not.
  const rounded =
    unit === 0 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 0 : 1);
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

export function formatDate(iso: string): string {
  return DATE.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}
