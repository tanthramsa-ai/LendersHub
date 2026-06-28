/** Strips HTML tags from a string to prevent stored XSS. */
export function stripHtml(value: string | undefined | null): string {
  if (!value) return value as string;
  return value.replace(/<[^>]*>/g, '').trim();
}

/** Recursively sanitizes all string fields in a plain object. */
export function sanitizeStrings<T>(obj: T): T {
  const result = { ...(obj as object) } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (typeof result[key] === 'string') {
      result[key] = stripHtml(result[key] as string);
    }
  }
  return result as T;
}
