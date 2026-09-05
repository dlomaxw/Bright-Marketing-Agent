'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PIPELINE_STAGES, STAGE_LABELS } from '@/lib/enums';
import { inputClass } from '@/components/ui';

export function StageControl({
  organizationId,
  stage,
  canEdit,
}: {
  organizationId: string;
  stage: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(stage);
  const [busy, setBusy] = useState(false);

  if (!canEdit) return null;

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setBusy(true);
    const res = await fetch(`/api/organizations/${organizationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage: next }),
    });
    setBusy(false);
    if (!res.ok) {
      setValue(previous);
      return;
    }
    router.refresh();
  }

  return (
    <label className="flex items-center gap-2">
      <span className="text-xs font-semibold text-muted">Stage</span>
      <select
        value={value}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className={`${inputClass} w-auto min-w-[170px]`}
        aria-label="Pipeline stage"
      >
        {PIPELINE_STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );
}
