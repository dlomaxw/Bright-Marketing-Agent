import { z } from 'zod';

/**
 * The database stores JSON as text (portability contract). Every read goes
 * through a Zod schema so a corrupt or hand-edited column cannot crash a page.
 */
export function parseJson<S extends z.ZodTypeAny>(
  raw: string | null | undefined,
  schema: S,
  fallback: z.infer<S>,
): z.infer<S> {
  if (!raw) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export const zStringArray = z.array(z.string());

export function parseStringArray(raw: string | null | undefined): string[] {
  return parseJson(raw, zStringArray, []);
}

export function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}
