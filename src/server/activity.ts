import { db } from '@/lib/db';

export interface ActivityInput {
  organizationId?: string | null;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

const serialize = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.slice(0, 4000);
  try {
    return JSON.stringify(v).slice(0, 4000);
  } catch {
    return String(v).slice(0, 4000);
  }
};

/**
 * Append-only audit trail (product doc FR-15). There is deliberately no update
 * or delete function in this module - the table has no application write path
 * other than this insert.
 */
export async function logActivity(input: ActivityInput): Promise<void> {
  await db.activity.create({
    data: {
      organizationId: input.organizationId ?? null,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      previousValue: serialize(input.previousValue),
      newValue: serialize(input.newValue),
      reason: input.reason ?? null,
      metadataJson: JSON.stringify(input.metadata ?? {}),
      ip: input.ip ?? null,
    },
  });
}

/** Diff helper so callers record what actually changed, not the whole record. */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { previous: Partial<T>; next: Partial<T> } | null {
  const previous: Partial<T> = {};
  const next: Partial<T> = {};
  let dirty = false;
  for (const key of Object.keys(after) as (keyof T)[]) {
    const a = before[key];
    const b = after[key];
    const same =
      a === b ||
      (a instanceof Date && b instanceof Date && a.getTime() === b.getTime());
    if (!same) {
      previous[key] = a;
      next[key] = b as T[keyof T];
      dirty = true;
    }
  }
  return dirty ? { previous, next } : null;
}
