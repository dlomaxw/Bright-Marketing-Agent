import { z } from 'zod';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

/**
 * Typed settings store. Each key declares its schema and default here, so a
 * missing or corrupt row degrades to a safe default instead of a crash.
 */

export const zScoringWeights = z.object({
  urgency: z.number().min(0).max(1),
  impact: z.number().min(0).max(1),
  solutionFit: z.number().min(0).max(1),
  organizationValue: z.number().min(0).max(1),
  contactability: z.number().min(0).max(1),
});
export type ScoringWeights = z.infer<typeof zScoringWeights>;

/** Documentation section 6. */
export const DEFAULT_WEIGHTS: ScoringWeights = {
  urgency: 0.3,
  impact: 0.25,
  solutionFit: 0.2,
  organizationValue: 0.15,
  contactability: 0.1,
};

export const zBands = z.array(
  z.object({ min: z.number(), label: z.string(), action: z.string() }),
);

export const DEFAULT_BANDS = [
  { min: 95, label: 'Immediate outreach', action: 'Personalised outreach within 24 hours' },
  { min: 90, label: 'Strong prospect', action: 'Verify evidence and contact within 3 days' },
  { min: 80, label: 'Good audit opportunity', action: 'Add to the weekly outreach batch' },
  { min: 0, label: 'Maintenance / nurture', action: 'Nurture, research or deprioritise' },
];

const zOutreach = z.object({
  freshnessHours: z.number().int().positive(),
  frequencyCapDays: z.number().int().positive(),
  frequencyCapCount: z.number().int().positive(),
});

const zRetention = z.object({
  evidenceDays: z.number().int().positive(),
  observationDays: z.number().int().positive(),
});

const zBrand = z.object({
  companyName: z.string(),
  tagline: z.string(),
  addressLine: z.string(),
  contactEmail: z.string(),
  contactPhone: z.string(),
  websiteUrl: z.string(),
});

const REGISTRY = {
  'scoring.weights': { schema: zScoringWeights, default: DEFAULT_WEIGHTS },
  'scoring.bands': { schema: zBands, default: DEFAULT_BANDS },
  'outreach.rules': {
    schema: zOutreach,
    default: {
      freshnessHours: env.EVIDENCE_FRESHNESS_HOURS,
      frequencyCapDays: env.EMAIL_FREQUENCY_CAP_DAYS,
      frequencyCapCount: env.EMAIL_FREQUENCY_CAP_COUNT,
    },
  },
  'data.retention': { schema: zRetention, default: { evidenceDays: 365, observationDays: 365 } },
  'brand.details': {
    schema: zBrand,
    default: {
      companyName: 'Bright Illuminated Marketing',
      tagline: 'Bold ideas. Real results. Built bright.',
      addressLine: 'The Square, Third Street, Kampala, Uganda',
      contactEmail: 'brightthoughtsservices@gmail.com',
      contactPhone: '+256 750 421 224',
      websiteUrl: 'https://brightilluminated.com',
    },
  },
} as const;

export type SettingKey = keyof typeof REGISTRY;

export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<z.infer<(typeof REGISTRY)[K]['schema']>> {
  const entry = REGISTRY[key];
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return entry.default as z.infer<(typeof REGISTRY)[K]['schema']>;
  try {
    const parsed = entry.schema.safeParse(JSON.parse(row.valueJson));
    if (parsed.success) return parsed.data as z.infer<(typeof REGISTRY)[K]['schema']>;
  } catch {
    // fall through to the default
  }
  return entry.default as z.infer<(typeof REGISTRY)[K]['schema']>;
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: unknown,
  updatedById?: string,
): Promise<z.infer<(typeof REGISTRY)[K]['schema']>> {
  const parsed = REGISTRY[key].schema.parse(value);
  await db.setting.upsert({
    where: { key },
    create: { key, valueJson: JSON.stringify(parsed), updatedById },
    update: { valueJson: JSON.stringify(parsed), updatedById },
  });
  return parsed as z.infer<(typeof REGISTRY)[K]['schema']>;
}

export function bandFor(
  score: number,
  bands: { min: number; label: string; action: string }[],
): { min: number; label: string; action: string } {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return (
    sorted.find((b) => score >= b.min) ??
    sorted[sorted.length - 1] ?? { min: 0, label: 'Unscored', action: '-' }
  );
}
