import fs from 'node:fs';
import path from 'node:path';
import { BRAND } from '@/config/brand';

/**
 * Brand assets for the document renderers.
 *
 * The logo appears on every generated document — report, proposal and
 * presentation — so it is loaded once and cached. A missing file must never
 * fail a generation: an export without a logo is a cosmetic problem, an export
 * that throws is a broken feature.
 */

let cached: Buffer | null | undefined;

/** Reads the logo from disk. Returns null if it is missing or unreadable. */
export function logoBuffer(): Buffer | null {
  if (cached !== undefined) return cached;
  try {
    const file = path.resolve(process.cwd(), BRAND.logoFile);
    cached = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (!cached) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'brand.logo_missing',
          file,
          note: 'Documents will be generated without a logo.',
        }),
      );
    }
  } catch {
    cached = null;
  }
  return cached;
}

/** The logo as a data URI, for renderers that take one (PowerPoint, HTML). */
export function logoDataUri(): string | null {
  const buffer = logoBuffer();
  return buffer ? `data:image/png;base64,${buffer.toString('base64')}` : null;
}

/** The logo is square (500x500); this keeps it so at any width. */
export function logoDimensions(width: number): { width: number; height: number } {
  return { width, height: width };
}

/**
 * The contact block that appears in every document footer and on the closing
 * slide. Assembled in one place so a phone number cannot be updated in the
 * proposal but missed in the report.
 */
export function contactLines(): string[] {
  return [
    BRAND.companyName,
    BRAND.address,
    BRAND.phones.join(' · '),
    BRAND.email,
    BRAND.websiteUrl.replace(/^https?:\/\//, ''),
  ].filter(Boolean);
}

/** Single-line variant, for a narrow footer. */
export function contactLine(): string {
  return `${BRAND.companyName} · ${BRAND.phones.join(' / ')} · ${BRAND.email}`;
}

/** Resets the cache. Used by tests. */
export function resetBrandAssetCache(): void {
  cached = undefined;
}
