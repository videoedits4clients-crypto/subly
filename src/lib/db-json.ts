/** Tiny helpers around the JSON-encoded String columns used for SQLite compatibility (see prisma/schema.prisma). */
export function toJson<T>(value: T | undefined | null): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export function fromJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
