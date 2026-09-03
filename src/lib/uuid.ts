export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function assertUuid(value: unknown, label: string): string {
  if (!isUuid(value)) throw new Error(`${label} must be a valid UUID`);
  return value.trim();
}

/**
 * Generate a UUID v4 even in browsers/webviews where crypto.randomUUID is not
 * exposed. Cloud table primary/foreign keys must never receive the old compact
 * Math.random identifier format.
 */
export function createUuid(): string {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
    }
  }

  // Last-resort compatibility for restricted webviews. The UUID shape and
  // version/variant bits remain valid for PostgreSQL uuid columns.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : ((random & 0x3) | 0x8);
    return value.toString(16);
  });
}
